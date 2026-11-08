import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  CalendarDays,
  CircleCheck,
  ClipboardList,
  FileEdit,
  FileText,
  Inbox,
  ListChecks,
  MessageSquare,
  Activity,
  PenLine,
  StickyNote,
} from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import useTeacherDashboard from '@/hooks/useTeacherDashboard.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { RowButton, Section, iconClass as icon, roomLabel, timeAgo } from '@/components/dashboard/DashboardParts.tsx';
import { formatManila, formatSchoolDay } from '@/lib/dashboardFormat.ts';
import type {
  ActivityEntry,
  OpenMention,
  PendingScoreItem,
  TeacherClass,
  TeacherSection,
} from '@/lib/teacherDashboard.ts';

function kindIcon(kind: 'assignment' | 'quiz' | 'exam') {
  if (kind === 'exam') return <ClipboardList className={icon} aria-hidden="true" />;
  if (kind === 'quiz') return <ListChecks className={icon} aria-hidden="true" />;
  return <FileText className={icon} aria-hidden="true" />;
}

const KIND_LABEL = { assignment: 'Assignment', quiz: 'Quiz', exam: 'Exam' } as const;

function pendingDetail(item: PendingScoreItem): string {
  if (item.source === 'submissions') {
    return `${item.pending_count} ${item.pending_count === 1 ? 'hand-in' : 'hand-ins'} to grade · oldest ${timeAgo(item.since)}`;
  }
  return `${item.pending_count} ${item.pending_count === 1 ? 'student has' : 'students have'} no score yet · was ${formatManila(item.since)}`;
}

function attendanceBadge(c: TeacherClass) {
  if (c.student_count === 0) return <span className="shrink-0 text-xs text-site-muted">No students</span>;
  if (c.attendance_marked === 0) return <Badge variant="warning">Attendance not taken</Badge>;
  if (c.attendance_marked < c.student_count) return <Badge variant="warning">{c.attendance_marked} of {c.student_count} marked</Badge>;
  return <Badge variant="success">Attendance taken</Badge>;
}

function activityText(a: ActivityEntry): string {
  const who = a.actor_name || 'A student';
  switch (a.kind) {
    case 'submission':
      return `${who} handed in ${a.title}`;
    case 'quiz_attempt':
      return `${who} took ${a.title}${typeof a.score === 'number' ? ` (${Math.round(a.score * 100) / 100}%)` : ''}`;
    case 'discussion':
      return `${who} started “${a.title}”`;
    default:
      return `${who} replied in “${a.title}”`;
  }
}

function activityIcon(kind: ActivityEntry['kind']) {
  if (kind === 'submission') return <FileText className={icon} aria-hidden="true" />;
  if (kind === 'quiz_attempt') return <ListChecks className={icon} aria-hidden="true" />;
  return <MessageSquare className={icon} aria-hidden="true" />;
}

const REASON_LABEL: Record<OpenMention['reason'], string> = {
  comment: 'Comment',
  missed_deadline: 'Missed deadline',
  correction: 'Correction',
};

/**
 * The teacher's dashboard below the four stat cards. `announcements` is the shared announcements
 * box (it already includes announcements for the teacher's own courses).
 */
export default function TeacherDashboard({ announcements }: { announcements: React.ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useTeacherDashboard(user?.id);

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
  const failed = (name: TeacherSection) => !loading && (Boolean(data?.errors?.[name]) || data?.[name] === null);
  const retry = () => void refetch();
  const pending = data?.pending_scores;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending scores */}
        <Section
          title="Pending scores"
          icon={<PenLine className={icon} aria-hidden="true" />}
          loading={loading}
          failed={failed('pending_scores')}
          onRetry={retry}
          empty={(pending?.items.length ?? 0) === 0}
          emptyIcon={<CircleCheck className="h-6 w-6" aria-hidden="true" />}
          emptyText="Nothing is waiting for a score."
          action={
            pending && pending.total_students > 0 ? (
              <Badge variant="warning">{pending.total_students} to score</Badge>
            ) : undefined
          }
        >
          <div className="space-y-1">
            {pending?.items.map((item) => (
              <RowButton key={`${item.source}-${item.kind}-${item.id}`} onClick={() => navigate(item.link)} label={`Open ${item.title}`}>
                <span className="mt-0.5 text-site-muted">{kindIcon(item.kind)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-words text-sm font-medium text-site-text">{item.title}</span>
                    <Badge variant="outline">{KIND_LABEL[item.kind]}</Badge>
                  </div>
                  <p className="text-xs text-site-muted">
                    {item.course_code} · {pendingDetail(item)}
                  </p>
                </div>
              </RowButton>
            ))}
            {pending && pending.total_items > pending.items.length && (
              <p className="pt-1 text-xs text-site-muted">Showing the oldest {pending.items.length} of {pending.total_items} items.</p>
            )}
          </div>
        </Section>

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
          <div className="space-y-1">
            {data?.today?.classes.map((c) => (
              <RowButton key={c.id} onClick={() => navigate('/attendance')} label={`Take attendance for ${c.course_code}`}>
                <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-site-text">
                      {c.start_time}–{c.end_time} · {c.course_code}
                    </p>
                    <p className="break-words text-xs text-site-muted">
                      {c.course_name}
                      {c.room ? ` · ${roomLabel(c.room)}` : ''} · {c.student_count} {c.student_count === 1 ? 'student' : 'students'}
                    </p>
                  </div>
                  {attendanceBadge(c)}
                </div>
              </RowButton>
            ))}
          </div>
        </Section>
      </div>

      {announcements}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Open notes to students */}
        <Section
          title="Open notes"
          icon={<StickyNote className={icon} aria-hidden="true" />}
          loading={loading}
          failed={failed('open_mentions')}
          onRetry={retry}
          empty={(data?.open_mentions?.count ?? 0) === 0}
          emptyIcon={<Inbox className="h-6 w-6" aria-hidden="true" />}
          emptyText="No open notes to students."
          action={data?.open_mentions && data.open_mentions.count > 0 ? <Badge variant="secondary">{data.open_mentions.count} open</Badge> : undefined}
        >
          <div className="space-y-1">
            {data?.open_mentions?.notes.map((n) => (
              <RowButton key={n.id} onClick={() => navigate(n.link)} label={`Open ${n.item_title ?? 'the item'}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-site-text">{n.student_name || 'A student'}</span>
                    <Badge variant={n.reason === 'missed_deadline' ? 'destructive' : 'warning'}>{REASON_LABEL[n.reason]}</Badge>
                    <Badge variant={n.acknowledged ? 'success' : 'outline'}>{n.acknowledged ? 'Seen' : 'Not seen yet'}</Badge>
                  </div>
                  <p className="text-xs text-site-muted">
                    {n.course_code} · {n.item_title ?? 'Coursework'} · {timeAgo(n.created_at)}
                  </p>
                  <p className="line-clamp-2 break-words text-sm text-site-text">{n.message}</p>
                </div>
              </RowButton>
            ))}
            {data?.open_mentions && data.open_mentions.count > data.open_mentions.notes.length && (
              <p className="pt-1 text-xs text-site-muted">Showing the latest {data.open_mentions.notes.length} of {data.open_mentions.count}.</p>
            )}
          </div>
        </Section>

        {/* Drafts */}
        <Section
          title="Drafts to publish"
          icon={<FileEdit className={icon} aria-hidden="true" />}
          loading={loading}
          failed={failed('drafts')}
          onRetry={retry}
          empty={(data?.drafts?.items.length ?? 0) === 0}
          emptyIcon={<CircleCheck className="h-6 w-6" aria-hidden="true" />}
          emptyText="No drafts waiting."
          action={data?.drafts && data.drafts.total > 0 ? <Badge variant="secondary">{data.drafts.total}</Badge> : undefined}
        >
          <div className="space-y-1">
            {data?.drafts?.items.map((d) => (
              <RowButton key={`${d.kind}-${d.id}`} onClick={() => navigate(d.link)} label={`Open draft ${d.title}`}>
                <span className="mt-0.5 text-site-muted">{kindIcon(d.kind)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-words text-sm font-medium text-site-text">{d.title}</span>
                    <Badge variant="outline">Draft {KIND_LABEL[d.kind].toLowerCase()}</Badge>
                  </div>
                  <p className="text-xs text-site-muted">
                    {d.course_code} · started {timeAgo(d.created_at)}
                  </p>
                </div>
              </RowButton>
            ))}
            {data?.drafts && data.drafts.total > data.drafts.items.length && (
              <p className="pt-1 text-xs text-site-muted">Showing the latest {data.drafts.items.length} of {data.drafts.total} drafts.</p>
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
        emptyIcon={<BookOpen className="h-6 w-6" aria-hidden="true" />}
        emptyText="You don't have any courses yet."
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
              <p className="text-xs text-site-muted">
                {c.student_count} {c.student_count === 1 ? 'student' : 'students'}
              </p>
            </button>
          ))}
        </div>
      </Section>

      {/* What students did lately */}
      <Section
        title="Student activity"
        icon={<Activity className={icon} aria-hidden="true" />}
        loading={loading}
        failed={failed('recent_activity')}
        onRetry={retry}
        empty={(data?.recent_activity?.length ?? 0) === 0}
        emptyIcon={<Inbox className="h-6 w-6" aria-hidden="true" />}
        emptyText="No student activity yet."
      >
        <div className="space-y-1">
          {data?.recent_activity?.map((a) => (
            <RowButton key={`${a.kind}-${a.id}`} onClick={() => navigate(a.link)} label={activityText(a)}>
              <span className="mt-0.5 text-site-muted">{activityIcon(a.kind)}</span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm text-site-text">{activityText(a)}</p>
                <p className="text-xs text-site-muted">
                  {a.course_code} · {timeAgo(a.at)}
                </p>
              </div>
            </RowButton>
          ))}
        </div>
      </Section>
    </>
  );
}
