import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Plus } from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import { useGet } from '@/hooks/useApi.ts';
import { formatDateTime, formatRoom } from '@/lib/utils.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { AssignmentStatusBadge } from '@/components/assignments/AssignmentStatusBadge.tsx';
import type { AssignmentItem } from '@/components/assignments/types.ts';
import type { QuizItem } from '@/components/quizzes/types.ts';
import type { ExamItem } from '@/components/exams/types.ts';
import { InPersonBadge, ManualStatusBadge } from '@/components/coursework/shared.tsx';

type Kind = 'assignment' | 'quiz' | 'exam';
type Tab = 'all' | Kind;
/** A student's progress on an item: still to do, handed in / waiting for a score, or finished. */
type State = 'todo' | 'waiting' | 'done';

interface CourseOption {
  id: string;
  code: string;
  name: string;
  is_mine?: boolean;
}

/** One line of the list, whichever kind of item it came from. */
interface Row {
  key: string;
  kind: Kind;
  id: string;
  title: string;
  courseCode: string;
  inPerson: boolean;
  /** Due date, quiz date or exam time; null for an online quiz (open any time). */
  when: string | null;
  /** Under the date: the room, or what the date means. */
  whenNote: string;
  published: boolean;
  canManage: boolean;
  href: string;
  // What a student sees
  state: State | null;
  statusNode: ReactNode;
  scoreText: string | null;
  // What the course's teacher sees
  summary: string | null;
  needsScoring: boolean;
  /** Notes from the teacher: a student's unseen ones; for the course's teacher, the unresolved ones. */
  mentionCount: number;
}

const KIND_LABEL: Record<Kind, string> = { assignment: 'Assignment', quiz: 'Quiz', exam: 'Exam' };
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'assignment', label: 'Assignments' },
  { value: 'quiz', label: 'Quizzes' },
  { value: 'exam', label: 'Exams' },
];

const STATE_OF: Record<string, State> = {
  not_submitted: 'todo',
  overdue: 'todo',
  not_taken: 'todo',
  upcoming: 'todo',
  submitted: 'waiting',
  awaiting_score: 'waiting',
  graded: 'done',
  completed: 'done',
  scored: 'done',
};

const selectClass =
  'flex h-10 items-center rounded-md border border-input bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const isPast = (iso: string | null) => !!iso && new Date(iso).getTime() < Date.now();

/** An in-person item has been held and not everyone has a score yet. */
const unscored = (published: boolean, when: string | null, scored: number | null, enrolled: number | null) =>
  published && isPast(when) && scored !== null && enrolled !== null && scored < enrolled;

const scoredSummary = (scored: number | null, enrolled: number | null) =>
  `${scored ?? 0} of ${enrolled ?? 0} scored`;

function fromAssignment(a: AssignmentItem): Row {
  const inPerson = a.delivery === 'in_person';
  return {
    key: `assignment-${a.id}`,
    kind: 'assignment',
    id: a.id,
    title: a.title,
    courseCode: a.course_code,
    inPerson,
    when: a.due_date,
    whenNote: inPerson ? (a.room ? formatRoom(a.room) : 'In person') : 'Due date',
    published: a.is_published,
    canManage: a.can_manage,
    href: `/assignments/${a.id}`,
    state: a.status ? (STATE_OF[a.status] ?? null) : null,
    statusNode: a.status ? <AssignmentStatusBadge status={a.status} isLate={a.is_late} /> : null,
    scoreText: inPerson
      ? a.manual_score !== null
        ? `${a.manual_score} / ${a.max_score}`
        : null
      : a.grade !== null
        ? `${a.grade} / ${a.max_score}`
        : null,
    summary: inPerson
      ? scoredSummary(a.scored_count, a.enrolled_count)
      : `${a.submitted_count ?? 0} handed in · ${a.graded_count ?? 0} graded`,
    needsScoring: inPerson
      ? unscored(a.is_published, a.due_date, a.scored_count, a.enrolled_count)
      : (a.submitted_count ?? 0) > (a.graded_count ?? 0),
    mentionCount: a.mention_count ?? 0,
  };
}

function fromQuiz(q: QuizItem): Row {
  const inPerson = q.delivery === 'in_person';
  const state = q.status ? (STATE_OF[q.status] ?? null) : null;
  let statusNode: ReactNode = null;
  if (q.status === 'completed') statusNode = <Badge variant="success">Completed</Badge>;
  else if (q.status === 'not_taken') statusNode = <Badge variant="outline">Not taken</Badge>;
  else if (q.status) statusNode = <ManualStatusBadge status={q.status} />;
  return {
    key: `quiz-${q.id}`,
    kind: 'quiz',
    id: q.id,
    title: q.title,
    courseCode: q.course_code,
    inPerson,
    when: inPerson ? q.scheduled_at : null,
    whenNote: inPerson ? (q.room ? formatRoom(q.room) : 'In person') : 'Open any time',
    published: q.is_published,
    canManage: q.can_manage,
    href: `/quizzes/${q.id}`,
    state,
    statusNode,
    scoreText: inPerson
      ? q.manual_score !== null
        ? `${q.manual_score} / ${q.max_score}`
        : null
      : q.status === 'completed' && q.my_score !== null
        ? `${q.my_score}%`
        : null,
    summary: inPerson
      ? scoredSummary(q.scored_count, q.enrolled_count)
      : `${q.attempt_count ?? 0} taken${q.average_score !== null ? ` · average ${q.average_score}%` : ''}`,
    needsScoring: inPerson ? unscored(q.is_published, q.scheduled_at, q.scored_count, q.enrolled_count) : false,
    mentionCount: q.mention_count ?? 0,
  };
}

function fromExam(x: ExamItem): Row {
  return {
    key: `exam-${x.id}`,
    kind: 'exam',
    id: x.id,
    title: x.title,
    courseCode: x.course_code,
    inPerson: true,
    when: x.exam_at,
    whenNote: x.room ? formatRoom(x.room) : 'In person',
    published: x.is_published,
    canManage: x.can_manage,
    href: `/exams/${x.id}`,
    state: x.status ? (STATE_OF[x.status] ?? null) : null,
    statusNode: x.status ? <ManualStatusBadge status={x.status} /> : null,
    scoreText: x.my_score !== null ? `${x.my_score} / ${x.max_score}` : null,
    summary: scoredSummary(x.scored_count, x.enrolled_count),
    needsScoring: unscored(x.is_published, x.exam_at, x.scored_count, x.enrolled_count),
    mentionCount: x.mention_count ?? 0,
  };
}

/** Dated items by date, undated last. */
function compareWhen(a: Row, b: Row, direction: 1 | -1): number {
  const ta = a.when ? new Date(a.when).getTime() : null;
  const tb = b.when ? new Date(b.when).getTime() : null;
  if (ta === null && tb === null) return a.title.localeCompare(b.title);
  if (ta === null) return 1;
  if (tb === null) return -1;
  return (ta - tb) * direction;
}

/**
 * Students: what is still open first, soonest first; finished items after, most recent first.
 * Everyone else: newest date first.
 */
function sortRows(rows: Row[], isStudent: boolean): Row[] {
  return [...rows].sort((a, b) => {
    if (!isStudent) return compareWhen(a, b, -1);
    const fa = a.state === 'done' ? 1 : 0;
    const fb = b.state === 'done' ? 1 : 0;
    if (fa !== fb) return fa - fb;
    return compareWhen(a, b, fa === 0 ? 1 : -1);
  });
}

export default function CourseworkPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isStudent = user?.role === 'student';
  const isAdmin = user?.role === 'admin';
  const canCreate = isAdmin || user?.role === 'teacher';

  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('type');
  const tab: Tab = rawTab === 'assignment' || rawTab === 'quiz' || rawTab === 'exam' ? rawTab : 'all';
  const [courseId, setCourseId] = useState('');
  const [view, setView] = useState('');
  const [creating, setCreating] = useState(false);

  const { data: courseData } = useGet<{ courses: CourseOption[] }>(['courses'], '/courses');
  const courses = courseData?.courses ?? [];

  // Enrollment and publishing change what a student may see, so always ask the server again.
  const fresh = { keepPreviousData: true, staleTime: 0, refetchOnMount: 'always' as const };
  const assignments = useGet<{ assignments: AssignmentItem[] }>(
    ['assignments', 'list', courseId],
    courseId ? `/assignments?course_id=${courseId}` : '/assignments',
    fresh,
  );
  const quizzes = useGet<{ quizzes: QuizItem[] }>(
    ['quizzes', 'list', courseId],
    courseId ? `/quizzes?course_id=${courseId}` : '/quizzes',
    fresh,
  );
  const exams = useGet<{ exams: ExamItem[] }>(
    ['exams', 'list', courseId],
    courseId ? `/exams?course_id=${courseId}` : '/exams',
    fresh,
  );

  const isLoading = assignments.isLoading || quizzes.isLoading || exams.isLoading;
  const isError = assignments.isError || quizzes.isError || exams.isError;
  const retry = () => {
    void assignments.refetch();
    void quizzes.refetch();
    void exams.refetch();
  };

  const allRows = useMemo(
    () => [
      ...(assignments.data?.assignments ?? []).map(fromAssignment),
      ...(quizzes.data?.quizzes ?? []).map(fromQuiz),
      ...(exams.data?.exams ?? []).map(fromExam),
    ],
    [assignments.data, quizzes.data, exams.data],
  );

  const counts = {
    all: allRows.length,
    assignment: allRows.filter((r) => r.kind === 'assignment').length,
    quiz: allRows.filter((r) => r.kind === 'quiz').length,
    exam: allRows.filter((r) => r.kind === 'exam').length,
  };

  const rows = useMemo(() => {
    let list = tab === 'all' ? allRows : allRows.filter((r) => r.kind === tab);
    if (view === 'draft') list = list.filter((r) => r.canManage && !r.published);
    else if (view === 'scoring') list = list.filter((r) => r.canManage && r.needsScoring);
    else if (view === 'notes') list = list.filter((r) => r.mentionCount > 0);
    else if (view === 'todo' || view === 'waiting' || view === 'done') list = list.filter((r) => r.state === view);
    return sortRows(list, isStudent);
  }, [allRows, tab, view, isStudent]);

  const setTab = (next: Tab) => {
    setSearchParams(next === 'all' ? {} : { type: next }, { replace: true });
  };

  const viewOptions = isStudent
    ? [
        { value: '', label: 'Everything' },
        { value: 'notes', label: 'Needs attention' },
        { value: 'todo', label: 'To do' },
        { value: 'waiting', label: 'Waiting for a score' },
        { value: 'done', label: 'Done' },
      ]
    : [
        { value: '', label: 'Everything' },
        { value: 'draft', label: 'Drafts' },
        { value: 'scoring', label: 'Needs scoring' },
        { value: 'notes', label: 'Open notes' },
      ];

  return (
    <div className="space-y-6">
      <div data-tour="cw-header" className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Coursework</h1>
          <p className="text-sm text-muted-foreground">
            {isStudent
              ? 'Your assignments, quizzes and exams in one place.'
              : 'Assignments, quizzes and exams in one place. Some are done online; others are announced here and scored by hand.'}
          </p>
        </div>
        <div data-tour="cw-filters" className="flex items-center gap-2 flex-wrap">
          <select
            className={selectClass}
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            aria-label="Filter by course"
          >
            <option value="">All courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
          <select
            className={selectClass}
            value={view}
            onChange={(e) => setView(e.target.value)}
            aria-label="Filter by status"
          >
            {viewOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {canCreate && (
            <Button data-tour="cw-new" onClick={() => setCreating(true)}>
              <Plus className="w-4 h-4 mr-2" /> New
            </Button>
          )}
        </div>
      </div>

      <div data-tour="cw-tabs" className="flex gap-2 flex-wrap" role="group" aria-label="Kind of coursework">
        {TABS.map((t) => (
          <Button
            key={t.value}
            size="sm"
            variant={tab === t.value ? 'default' : 'outline'}
            aria-pressed={tab === t.value}
            onClick={() => setTab(t.value)}
          >
            {t.label} ({counts[t.value]})
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card className="p-6 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Couldn’t load your coursework.</p>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </Card>
      ) : rows.length === 0 ? (
        <Card data-tour="cw-empty" className="p-8 text-center text-muted-foreground">
          {allRows.length === 0 ? (
            <>
              <p>Nothing here yet.</p>
              <p className="text-sm mt-1">
                {isStudent
                  ? 'Assignments, quizzes and exams from your courses will appear here.'
                  : 'Use “New” to add an assignment, a quiz or an exam.'}
              </p>
            </>
          ) : (
            <p>Nothing matches these filters.</p>
          )}
        </Card>
      ) : (
        <div data-tour="cw-table" className="rounded-xl border border-input bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>{isStudent ? 'Status' : 'Progress'}</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link to={r.href} className="font-medium hover:underline">
                        {r.title}
                      </Link>
                      {!isStudent && r.canManage && !r.published && <Badge variant="warning">Draft</Badge>}
                      {isStudent && r.mentionCount > 0 && <Badge variant="warning">New note</Badge>}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      <Badge variant="secondary">{KIND_LABEL[r.kind]}</Badge>
                      {r.inPerson && r.kind !== 'exam' && <InPersonBadge />}
                      <span className="text-sm text-muted-foreground">{r.courseCode}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{r.when ? formatDateTime(r.when) : '—'}</p>
                    <p className="text-xs text-muted-foreground">{r.whenNote}</p>
                  </TableCell>
                  <TableCell>
                    {isStudent ? (
                      <div className="space-y-1">
                        {r.statusNode}
                        {r.scoreText && <p className="text-sm text-muted-foreground">{r.scoreText}</p>}
                      </div>
                    ) : r.canManage ? (
                      <div className="space-y-1">
                        <p className="text-sm">{r.summary}</p>
                        {r.needsScoring && <Badge variant="warning">Needs scoring</Badge>}
                        {r.mentionCount > 0 && (
                          <Badge variant="outline">
                            {r.mentionCount} open {r.mentionCount === 1 ? 'note' : 'notes'}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline" aria-label={`Open ${KIND_LABEL[r.kind].toLowerCase()} ${r.title}`}>
                      <Link to={r.href}>
                        Open <ArrowRight className="w-4 h-4 ml-2" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canCreate && (
        <NewCourseworkDialog
          open={creating}
          onOpenChange={setCreating}
          courses={courses.filter((c) => isAdmin || c.is_mine === true)}
          defaultCourseId={courseId}
          onContinue={(kind, course) => navigate(`/courses/${course}?new=${kind}`)}
        />
      )}
    </div>
  );
}

interface NewCourseworkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courses: CourseOption[];
  defaultCourseId: string;
  onContinue: (kind: Kind, courseId: string) => void;
}

/**
 * Asks what and for which course, then opens the creation form on that course's page (an assignment
 * belongs to a module, a quiz or exam to the course, so the form needs the course around it).
 */
function NewCourseworkDialog({ open, onOpenChange, courses, defaultCourseId, onContinue }: NewCourseworkDialogProps) {
  const [kind, setKind] = useState<Kind>('assignment');
  const [course, setCourse] = useState('');
  const chosen = course || (courses.some((c) => c.id === defaultCourseId) ? defaultCourseId : (courses[0]?.id ?? ''));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New coursework</DialogTitle>
          <DialogDescription>
            Choose what to create and where. You can make it online, or announce it here and score it by hand
            afterwards.
          </DialogDescription>
        </DialogHeader>

        {courses.length === 0 ? (
          <p className="text-sm text-muted-foreground">You don’t teach any courses yet, so there is nowhere to add it.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>What</Label>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="What to create">
                {(['assignment', 'quiz', 'exam'] as const).map((k) => (
                  <Button
                    key={k}
                    type="button"
                    variant={kind === k ? 'default' : 'outline'}
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                  >
                    {KIND_LABEL[k]}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nc-course">Course</Label>
              <select id="nc-course" className={`${selectClass} w-full`} value={chosen} onChange={(e) => setCourse(e.target.value)}>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!chosen} onClick={() => onContinue(kind, chosen)}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
