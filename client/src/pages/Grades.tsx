import useAuth from '@/hooks/useAuth.ts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Award, ClipboardList, Download, GraduationCap, Search, Users } from 'lucide-react';

import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { CONTROL_CLASS } from '@/lib/attendance.ts';
import { cn, formatAverage, formatDate } from '@/lib/utils.ts';
import {
  PASSING_GRADE,
  describeGrade,
  downloadCsv,
  formatTerm,
  gradeBarColor,
  scoreNeededNext,
  toCsv,
} from '@/lib/grades.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { AdjustGradeDialog, AdjustGradeTarget } from '@/components/grades/AdjustGradeDialog.tsx';

interface Grade {
  id: string;
  student_id: string;
  course_id: string;
  course_code: string;
  course_name: string;
  assessment_type: string;
  assessment_id: string;
  assessment_title: string | null;
  // Postgres `numeric` reaches the browser as a string (e.g. "80.00"); it is a percentage 0-100.
  score: number | string;
  feedback: string | null;
  term: string;
  created_at: string;
  first_name: string;
  last_name: string;
  student_number: string;
}

interface CourseSummary {
  course_id: string;
  course_code: string;
  course_name: string;
  students: number;
  items: number;
  average: number | null;
  highest: number | null;
  lowest: number | null;
  assignment_average: number | null;
  quiz_average: number | null;
  exam_average: number | null;
  at_risk: number;
}

interface Summary {
  overall: { average: number | null; items: number; students: number };
  courses: CourseSummary[];
}

type SortKey = 'newest' | 'highest' | 'lowest' | 'name';

const EMPTY_SUMMARY: Summary = { overall: { average: null, items: 0, students: 0 }, courses: [] };

function titleOf(g: Grade): string {
  return g.assessment_title ?? `#${g.assessment_id.slice(0, 6)}`;
}

/** Progress bar with a tick at the passing mark. */
function ScoreBar({ value }: { value: number | string | null | undefined }) {
  const n = Number(value);
  const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  return (
    <div
      className="relative h-2 w-full rounded-full bg-site-border"
      role="progressbar"
      aria-label="Average grade"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div className={cn('h-2 rounded-full transition-all', gradeBarColor(value))} style={{ width: `${pct}%` }} />
      <div
        className="absolute -top-[3px] h-[14px] w-px bg-site-muted"
        style={{ left: `${PASSING_GRADE}%` }}
        title={`Passing mark: ${PASSING_GRADE}%`}
      />
    </div>
  );
}

function DescriptorBadge({ value }: { value: number | string | null | undefined }) {
  const d = describeGrade(value);
  if (!d) return null;
  return <Badge variant={d.variant}>{d.label}</Badge>;
}

function StatCard({
  icon,
  label,
  value,
  sub,
  children,
  alert,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  children?: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <div className={cn('rounded-xl border bg-site-card p-5 shadow-sm', alert ? 'border-red-300' : 'border-site-border')}>
      <div className="flex items-center gap-2 text-sm text-site-muted">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold text-site-text">{value}</div>
      {sub && <div className="mt-1 text-xs text-site-muted">{sub}</div>}
      {children && <div className="mt-3 space-y-2">{children}</div>}
    </div>
  );
}

export default function GradesPage() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const [grades, setGrades] = useState<Grade[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [adjusting, setAdjusting] = useState<AdjustGradeTarget | null>(null);

  const [search, setSearch] = useState('');
  const [courseId, setCourseId] = useState('');
  const [term, setTerm] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');

  // Teachers (their own courses) and admins (all courses) see every student's grades and may adjust them.
  const canManage = user?.role === 'admin' || user?.role === 'teacher';

  const fetchGrades = useCallback(async () => {
    const res = await api.get<{ grades: Grade[] }>('/grades');
    setGrades(res.data.grades);
  }, []);

  const fetchSummary = useCallback(async () => {
    const res = await api.get<Summary>('/grades/summary', { params: term ? { term } : undefined });
    setSummary(res.data);
  }, [term]);

  const reload = useCallback(async () => {
    try {
      await Promise.all([fetchGrades(), fetchSummary()]);
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      toast({ title: 'Failed to load grades', description: getErrorMessage(err), variant: 'destructive' });
    }
    // toast identity can change between renders; reloading must not depend on it.
  }, [fetchGrades, fetchSummary]);

  useEffect(() => {
    if (!isAuthenticated) return;
    reload();
  }, [isAuthenticated, reload]);

  const terms = useMemo(() => [...new Set(grades.map((g) => g.term))].sort().reverse(), [grades]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = grades.filter((g) => {
      if (courseId && g.course_id !== courseId) return false;
      if (term && g.term !== term) return false;
      if (type && g.assessment_type !== type) return false;
      if (!q) return true;
      const haystack = [titleOf(g), g.course_name, g.course_code, canManage ? `${g.first_name} ${g.last_name} ${g.student_number}` : '']
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
    // The API already returns newest first, so 'newest' keeps that order.
    if (sort === 'highest') filtered.sort((a, b) => Number(b.score) - Number(a.score));
    if (sort === 'lowest') filtered.sort((a, b) => Number(a.score) - Number(b.score));
    if (sort === 'name') {
      filtered.sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`));
    }
    return filtered;
  }, [grades, courseId, term, type, search, sort, canManage]);

  const atRisk = summary.courses.reduce((sum, c) => sum + c.at_risk, 0);
  const passingCourses = summary.courses.filter((c) => Number(c.average) >= PASSING_GRADE).length;
  const bestCourse = summary.courses.reduce<CourseSummary | null>(
    (best, c) => (c.average != null && (!best || Number(c.average) > Number(best.average)) ? c : best),
    null,
  );
  const filtersActive = Boolean(search || courseId || term || type);

  function exportCsv() {
    const header = [
      ...(canManage ? ['Student ID', 'Student'] : []),
      'Course code',
      'Course',
      'Assessment',
      'Type',
      'Score (%)',
      'Descriptor',
      'Term',
      'Date',
      'Feedback',
    ];
    const data = rows.map((g) => [
      ...(canManage ? [g.student_number, `${g.first_name} ${g.last_name}`] : []),
      g.course_code,
      g.course_name,
      titleOf(g),
      g.assessment_type,
      Number(g.score).toFixed(2),
      describeGrade(g.score)?.label ?? '',
      formatTerm(g.term),
      g.created_at.slice(0, 10),
      g.feedback ?? '',
    ]);
    downloadCsv(`grades-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(header, data));
  }

  function clearFilters() {
    setSearch('');
    setCourseId('');
    setTerm('');
    setType('');
  }

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-site-bg flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-2 animate-pulse">
          <div className="w-10 h-10 rounded-full bg-site-border"></div>
          <p className="text-site-muted text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="w-full bg-site-bg px-0 py-6 md:min-h-screen md:px-4 md:py-12">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-site-text">Grades</h1>
            <p className="text-site-muted">
              {user?.role === 'admin'
                ? 'Grades recorded across all courses. You can adjust any of them.'
                : canManage
                  ? 'Grades recorded in the courses you teach. You can adjust any of them.'
                  : 'Your grades, course by course. Every assignment and quiz counts equally toward your average.'}
            </p>
          </div>
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
        </div>

        {status === 'error' ? (
          <div className="rounded-xl border border-site-border bg-site-card p-8 text-center text-site-muted space-y-3">
            <p>Couldn’t load grades.</p>
            <Button variant="outline" size="sm" onClick={reload}>
              Retry
            </Button>
          </div>
        ) : status === 'loading' ? (
          <div className="rounded-xl border border-site-border bg-site-card p-8 text-center text-site-muted">
            Loading grades…
          </div>
        ) : (
          <>
            {/* Headline numbers */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
              <StatCard
                icon={<GraduationCap className="w-4 h-4" />}
                label={canManage ? 'Class average' : 'Average grade'}
                value={formatAverage(summary.overall.average)}
              >
                {summary.overall.average != null && (
                  <>
                    <ScoreBar value={summary.overall.average} />
                    <DescriptorBadge value={summary.overall.average} />
                  </>
                )}
              </StatCard>
              {canManage ? (
                <>
                  <StatCard
                    icon={<Users className="w-4 h-4" />}
                    label="Students graded"
                    value={summary.overall.students}
                    sub={`${summary.courses.length} course${summary.courses.length === 1 ? '' : 's'}`}
                  />
                  <StatCard
                    icon={<ClipboardList className="w-4 h-4" />}
                    label="Graded items"
                    value={summary.overall.items}
                    sub="Assignments and quizzes"
                  />
                  <StatCard
                    icon={<AlertTriangle className="w-4 h-4" />}
                    label="At risk"
                    value={atRisk}
                    sub={`Student course averages below ${PASSING_GRADE}%`}
                    alert={atRisk > 0}
                  />
                </>
              ) : (
                <>
                  <StatCard
                    icon={<ClipboardList className="w-4 h-4" />}
                    label="Graded items"
                    value={summary.overall.items}
                    sub="Assignments and quizzes"
                  />
                  <StatCard
                    icon={<Award className="w-4 h-4" />}
                    label="Courses passing"
                    value={`${passingCourses} / ${summary.courses.length}`}
                    sub={`Average of ${PASSING_GRADE}% or higher`}
                  />
                  <StatCard
                    icon={<GraduationCap className="w-4 h-4" />}
                    label="Best course"
                    value={bestCourse ? formatAverage(bestCourse.average) : 'N/A'}
                    sub={bestCourse ? `${bestCourse.course_code}: ${bestCourse.course_name}` : 'No grades yet'}
                  />
                </>
              )}
            </div>

            {/* Per-course breakdown: click a card to filter the table below to that course. */}
            {summary.courses.length > 0 && (
              <div className="mb-8">
                <h2 className="text-sm font-bold text-site-muted mb-3">By course</h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {summary.courses.map((c) => {
                    const selected = courseId === c.course_id;
                    const needed =
                      !canManage && c.average != null && Number(c.average) < PASSING_GRADE
                        ? scoreNeededNext(Number(c.average), c.items)
                        : 0;
                    const failing = !canManage && c.average != null && Number(c.average) < PASSING_GRADE;
                    return (
                      <button
                        key={c.course_id}
                        type="button"
                        onClick={() => setCourseId(selected ? '' : c.course_id)}
                        aria-pressed={selected}
                        className={cn(
                          'text-left rounded-xl border bg-site-card p-5 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          selected ? 'border-site-text ring-1 ring-site-text' : 'border-site-border',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-site-muted">{c.course_code}</div>
                            <div className="font-bold text-site-text truncate">{c.course_name}</div>
                          </div>
                          <div className="text-xl font-bold text-site-text shrink-0">{formatAverage(c.average)}</div>
                        </div>
                        <div className="mt-3 space-y-2">
                          <ScoreBar value={c.average} />
                          <DescriptorBadge value={c.average} />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-site-muted">
                          <span>Assignments: {formatAverage(c.assignment_average)}</span>
                          <span>Quizzes: {formatAverage(c.quiz_average)}</span>
                          <span>Exams: {formatAverage(c.exam_average)}</span>
                          <span>{c.items} item{c.items === 1 ? '' : 's'}</span>
                        </div>
                        {canManage && (
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-site-muted">
                            <span>{c.students} student{c.students === 1 ? '' : 's'}</span>
                            <span>High: {formatAverage(c.highest)}</span>
                            <span>Low: {formatAverage(c.lowest)}</span>
                            {c.at_risk > 0 && <Badge variant="destructive">{c.at_risk} at risk</Badge>}
                          </div>
                        )}
                        {failing && (
                          <p className="mt-3 text-xs text-site-muted">
                            {needed !== null && needed > 0
                              ? `Score at least ${needed}% on your next assessment to reach ${PASSING_GRADE}%.`
                              : `It will take more than one strong score to reach ${PASSING_GRADE}%.`}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-site-muted pointer-events-none" />
                <Input
                  type="text"
                  aria-label="Search grades"
                  placeholder={canManage ? 'Search student, course or assessment...' : 'Search course or assessment...'}
                  className="w-72 pl-9 bg-white dark:bg-card"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                aria-label="Filter by course"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className={CONTROL_CLASS}
              >
                <option value="">All courses</option>
                {summary.courses.map((c) => (
                  <option key={c.course_id} value={c.course_id}>
                    {c.course_code}: {c.course_name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by school year"
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setCourseId('');
                }}
                className={CONTROL_CLASS}
              >
                <option value="">All school years</option>
                {terms.map((t) => (
                  <option key={t} value={t}>
                    {formatTerm(t)}
                  </option>
                ))}
              </select>
              <select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)} className={CONTROL_CLASS}>
                <option value="">Assignments, quizzes and exams</option>
                <option value="assignment">Assignments</option>
                <option value="quiz">Quizzes</option>
                <option value="exam">Exams</option>
              </select>
              <select aria-label="Sort grades" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={CONTROL_CLASS}>
                <option value="newest">Newest first</option>
                <option value="highest">Highest score</option>
                <option value="lowest">Lowest score</option>
                {canManage && <option value="name">Student name</option>}
              </select>
              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
              <span className="ml-auto text-xs text-site-muted">
                Showing {rows.length} of {grades.length}
              </span>
            </div>

            {/* Table */}
            <div className="rounded-xl border border-site-border bg-site-card overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-site-border">
                    {canManage && <th className="px-6 py-4 text-sm font-bold text-site-muted">Student</th>}
                    <th className="px-6 py-4 text-sm font-bold text-site-muted">Course</th>
                    <th className="px-6 py-4 text-sm font-bold text-site-muted">Assessment</th>
                    <th className="px-6 py-4 text-sm font-bold text-site-muted">Type</th>
                    <th className="px-6 py-4 text-sm font-bold text-site-muted">Score</th>
                    <th className="px-6 py-4 text-sm font-bold text-site-muted">Date</th>
                    {canManage && <th className="px-6 py-4 text-sm font-bold text-site-muted text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={canManage ? 7 : 5} className="px-6 py-8 text-center text-site-muted">
                        {grades.length === 0 ? 'No grades recorded yet.' : 'No grades match your filters.'}
                      </td>
                    </tr>
                  ) : (
                    rows.map((g) => (
                      <tr key={g.id} className="border-b border-site-border align-top">
                        {canManage && (
                          <td className="px-6 py-4 text-sm text-site-text">
                            {g.first_name} {g.last_name}
                            <div className="text-xs text-site-muted">{g.student_number}</div>
                          </td>
                        )}
                        <td className="px-6 py-4 font-medium text-site-text">
                          {g.course_name}
                          <div className="text-xs font-normal text-site-muted">{g.course_code}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-site-text">
                          {titleOf(g)}
                          {g.feedback && (
                            <div className="mt-1 max-w-xs text-xs text-site-muted whitespace-pre-line">
                              Feedback: {g.feedback}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-site-muted capitalize">{g.assessment_type}</td>
                        <td className="px-6 py-4">
                          <div className="font-medium text-site-text">{formatAverage(g.score)}</div>
                          <div className="mt-1">
                            <DescriptorBadge value={g.score} />
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-site-muted whitespace-nowrap">
                          {formatDate(g.created_at)}
                          <div className="text-xs">{formatTerm(g.term)}</div>
                        </td>
                        {canManage && (
                          <td className="px-6 py-4 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setAdjusting({
                                  gradeId: g.id,
                                  studentName: `${g.first_name} ${g.last_name}`,
                                  assessmentTitle: titleOf(g),
                                  score: g.score,
                                  feedback: g.feedback,
                                })
                              }
                            >
                              Adjust
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <AdjustGradeDialog
        open={adjusting !== null}
        onOpenChange={(open) => !open && setAdjusting(null)}
        target={adjusting}
        onSaved={() => {
          toast({ title: 'Grade updated', variant: 'success' });
          reload();
        }}
      />
    </div>
  );
}
