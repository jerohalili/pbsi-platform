import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  CalendarDays,
  CircleCheck,
  ClipboardList,
  FileText,
  Inbox,
  ListChecks,
  MessageSquare,
  TriangleAlert,
  GraduationCap,
  Award,
} from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import useStudentDashboard from '@/hooks/useStudentDashboard.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { RowButton, Section, timeAgo } from '@/components/dashboard/DashboardParts.tsx';
import {
  PASSING_GRADE,
  formatManila,
  formatSchoolDay,
  type AttendanceStatus,
  type AttentionNote,
  type StudentSection,
  type TodoItem,
} from '@/lib/studentDashboard.ts';

const icon = 'h-4 w-4';

const ATTENDANCE: Record<AttendanceStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  present: { label: 'Present', variant: 'success' },
  late: { label: 'Late', variant: 'warning' },
  absent: { label: 'Absent', variant: 'destructive' },
  excused: { label: 'Excused', variant: 'secondary' },
};

const TODO_GROUPS: Array<{ group: TodoItem['group']; label: string }> = [
  { group: 'assignment', label: 'Assignments to hand in' },
  { group: 'scheduled', label: 'In person and exams' },
  { group: 'quiz', label: 'Online quizzes to take' },
];

function todoIcon(kind: TodoItem['kind']) {
  if (kind === 'exam') return <ClipboardList className={icon} aria-hidden="true" />;
  if (kind === 'quiz') return <ListChecks className={icon} aria-hidden="true" />;
  return <FileText className={icon} aria-hidden="true" />;
}

function todoDetail(item: TodoItem): string {
  if (item.group === 'scheduled') {
    const what = item.kind === 'exam' ? 'Exam' : item.kind === 'quiz' ? 'In-person quiz' : 'In-person assignment';
    return `${what} · ${item.at ? formatManila(item.at) : ''}${item.room ? ` · ${/^(room|rm|lab)/i.test(item.room) ? item.room : `Room ${item.room}`}` : ''}`;
  }
  if (item.group === 'quiz') {
    return item.time_limit_minutes ? `Online quiz · ${item.time_limit_minutes} min` : 'Online quiz';
  }
  return item.at ? `${item.is_overdue ? 'Was due' : 'Due'} ${formatManila(item.at)}` : '';
}

const REASON_LABEL: Record<AttentionNote['reason'], string> = {
  comment: 'Comment',
  missed_deadline: 'Missed deadline',
  correction: 'Correction',
};

/**
 * The student's dashboard below the four stat cards. `announcements` is the shared announcements
 * box, placed under "Needs your attention" so urgent things stay at the top.
 */
export default function StudentDashboard({ announcements }: { announcements: React.ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useStudentDashboard(user?.id);

  if (isError && !data) {
    return (
      <>
        {announcements}
        <Card className="flex items-center justify-between gap-4 p-6">
          <p className="text-sm text-site-muted">Couldn't load your dashboard.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      </>
    );
  }

  const loading = isLoading;
  const failed = (name: StudentSection) => !loading && (Boolean(data?.errors?.[name]) || data?.[name] === null);
  const retry = () => void refetch();

  return (
    <>
      {/* Needs attention: only when there is something (or when it failed, so it is never silently missing) */}
      {failed('attention') ? (
        <Card className="flex items-center justify-between gap-3 p-4">
          <p className="text-sm text-site-muted">Your notes from teachers could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </Card>
      ) : data?.attention && data.attention.count > 0 ? (
        <Card className="border-amber-300 bg-amber-50/60 p-6 dark:border-amber-700 dark:bg-amber-950/30">
          <h2 className="mb-3 flex items-center gap-2 font-bold text-site-text">
            <TriangleAlert className={icon} aria-hidden="true" /> Needs your attention ({data.attention.count})
          </h2>
          <div className="space-y-1">
            {data.attention.notes.map((n) => (
              <RowButton key={n.id} onClick={() => navigate(n.link)} label={`Open ${n.item_title ?? 'the item'}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={n.reason === 'missed_deadline' ? 'destructive' : 'warning'}>{REASON_LABEL[n.reason]}</Badge>
                    <span className="break-words text-sm font-medium text-site-text">{n.item_title ?? 'Coursework'}</span>
                    <span className="text-xs text-site-muted">{n.course_code}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 break-words text-sm text-site-text">{n.message}</p>
                  <p className="text-xs text-site-muted">{timeAgo(n.created_at)}</p>
                </div>
              </RowButton>
            ))}
          </div>
          {data.attention.count > data.attention.notes.length && (
            <p className="mt-2 text-xs text-site-muted">Showing the latest {data.attention.notes.length} of {data.attention.count}.</p>
          )}
        </Card>
      ) : null}

      {announcements}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Today */}
        <Section
          title="Today"
          icon={<CalendarDays className={icon} aria-hidden="true" />}
          loading={loading}
          failed={failed('today')}
          onRetry={retry}
          empty={(data?.today?.classes.length ?? 0) === 0}
          emptyIcon={<CalendarDays className="h-6 w-6" aria-hidden="true" />}
          emptyText="No classes today."
          action={data?.today ? <span className="text-xs text-site-muted">{formatSchoolDay(data.today.date)}</span> : undefined}
        >
          <ul className="space-y-3">
            {data?.today?.classes.map((c) => {
              const att = c.attendance_status ? ATTENDANCE[c.attendance_status] : null;
              return (
                <li key={c.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-site-text">
                      {c.start_time}–{c.end_time} · {c.course_code}
                    </p>
                    <p className="break-words text-xs text-site-muted">
                      {c.course_name}
                      {c.room ? ` · ${/^(room|rm|lab)/i.test(c.room) ? c.room : `Room ${c.room}`}` : ''}
                      {c.teacher_name ? ` · ${c.teacher_name}` : ''}
                    </p>
                  </div>
                  {att ? <Badge variant={att.variant}>{att.label}</Badge> : <span className="shrink-0 text-xs text-site-muted">Not marked yet</span>}
                </li>
              );
            })}
          </ul>
        </Section>

        {/* To-do */}
        <Section
          title="To-do"
          icon={<ListChecks className={icon} aria-hidden="true" />}
          loading={loading}
          failed={failed('todo')}
          onRetry={retry}
          empty={(data?.todo?.items.length ?? 0) === 0}
          emptyIcon={<CircleCheck className="h-6 w-6" aria-hidden="true" />}
          emptyText="You're all caught up."
        >
          <div className="space-y-4">
            {TODO_GROUPS.map(({ group, label }) => {
              const items = data?.todo?.items.filter((i) => i.group === group) ?? [];
              if (items.length === 0) return null;
              return (
                <div key={group}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-site-muted">{label}</p>
                  <div className="space-y-1">
                    {items.map((item) => (
                      <RowButton key={`${item.kind}-${item.id}`} onClick={() => navigate(item.link)} label={`Open ${item.title}`}>
                        <span className="mt-0.5 text-site-muted">{todoIcon(item.kind)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="break-words text-sm font-medium text-site-text">{item.title}</span>
                            {item.is_overdue && <Badge variant="destructive">Overdue</Badge>}
                          </div>
                          <p className="text-xs text-site-muted">
                            {item.course_code} · {todoDetail(item)}
                          </p>
                        </div>
                      </RowButton>
                    ))}
                  </div>
                </div>
              );
            })}
            {data?.todo?.truncated && (
              <p className="text-xs text-site-muted">
                Showing the first few of each kind.{' '}
                <button type="button" className="text-primary hover:underline" onClick={() => navigate('/coursework')}>
                  Open Coursework for all of it
                </button>
              </p>
            )}
          </div>
        </Section>
      </div>

      {/* Courses */}
      <Section
        title="My courses"
        icon={<BookOpen className={icon} aria-hidden="true" />}
        loading={loading}
        failed={failed('courses')}
        onRetry={retry}
        empty={(data?.courses?.length ?? 0) === 0}
        emptyIcon={<GraduationCap className="h-6 w-6" aria-hidden="true" />}
        emptyText="You're not enrolled in any course yet."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data?.courses?.map((c) => (
            <button
              key={c.course_id}
              type="button"
              onClick={() => navigate(`/courses/${c.course_id}`)}
              aria-label={`Open ${c.code}${c.unread > 0 ? `, ${c.unread} unread` : ''}`}
              className="rounded-lg border border-input p-4 text-left transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-site-text">{c.code}</p>
                {c.unread > 0 && <Badge variant="destructive">{c.unread} new</Badge>}
              </div>
              <p className="break-words text-sm text-site-text">{c.name}</p>
              {c.teacher_name && <p className="text-xs text-site-muted">{c.teacher_name}</p>}
            </button>
          ))}
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent grades */}
        <Section
          title="Recent grades"
          icon={<Award className={icon} aria-hidden="true" />}
          loading={loading}
          failed={failed('recent_grades')}
          onRetry={retry}
          empty={(data?.recent_grades?.length ?? 0) === 0}
          emptyIcon={<Award className="h-6 w-6" aria-hidden="true" />}
          emptyText="No grades yet."
          action={
            <button type="button" onClick={() => navigate('/grades')} className="text-sm text-primary hover:underline">
              View all
            </button>
          }
        >
          <ul className="space-y-3">
            {data?.recent_grades?.map((g) => (
              <li key={g.id} className="space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-site-text">{g.title ?? 'Graded item'}</p>
                    <p className="text-xs text-site-muted">
                      {g.course_code} · {timeAgo(g.created_at)}
                    </p>
                  </div>
                  <Badge variant={g.score >= PASSING_GRADE ? 'success' : 'warning'}>{Math.round(g.score * 100) / 100}%</Badge>
                </div>
                {g.feedback && <p className="line-clamp-2 break-words text-sm italic text-site-muted">“{g.feedback}”</p>}
              </li>
            ))}
          </ul>
        </Section>

        {/* Discussion highlights */}
        <Section
          title="Discussion highlights"
          icon={<MessageSquare className={icon} aria-hidden="true" />}
          loading={loading}
          failed={failed('discussion_highlights')}
          onRetry={retry}
          empty={(data?.discussion_highlights?.length ?? 0) === 0}
          emptyIcon={<Inbox className="h-6 w-6" aria-hidden="true" />}
          emptyText="No new discussion activity."
        >
          <div className="space-y-1">
            {data?.discussion_highlights?.map((n) => (
              <RowButton key={n.id} onClick={() => navigate(n.link ?? '/discussions')} label={`Open ${n.title}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-site-text">
                    {n.title}
                    {n.course_code && <span className="ml-2 text-xs font-normal text-site-muted">{n.course_code}</span>}
                  </p>
                  <p className="line-clamp-2 break-words text-sm text-site-muted">{n.message}</p>
                  <p className="text-xs text-site-muted">{timeAgo(n.created_at)}</p>
                </div>
              </RowButton>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
