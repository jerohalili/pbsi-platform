import { useNavigate } from 'react-router-dom';
import { Activity, BookOpen, CircleCheck, GraduationCap, History, TriangleAlert, Users } from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import useAdminDashboard from '@/hooks/useAdminDashboard.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { RowButton, Section, iconClass as icon, timeAgo } from '@/components/dashboard/DashboardParts.tsx';
import { ALERT_TITLE, actionLabel, weekdayShort, type AdminSection } from '@/lib/adminDashboard.ts';

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-input p-3">
      <p className="text-2xl font-bold text-site-text">{value}</p>
      <p className="text-xs text-site-muted">{label}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-site-muted">{label}</span>
      <span className="font-semibold text-site-text">{value}</span>
    </div>
  );
}

/**
 * The admin's dashboard below the four stat cards. Problems come first (an alert only appears when
 * something is actually wrong). `announcements` is the shared announcements box.
 */
export default function AdminDashboard({ announcements }: { announcements: React.ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useAdminDashboard(user?.id);

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
  const failed = (name: AdminSection) => !loading && (Boolean(data?.errors?.[name]) || data?.[name] === null);
  const retry = () => void refetch();
  const metrics = data?.metrics;
  const days = metrics?.activity.days ?? [];
  const peak = Math.max(1, ...days.map((d) => d.events));
  const year = data?.school_year;
  const alertGroups = (data?.alerts?.groups ?? []).filter((g) => g.total > 0);

  return (
    <>
      {/* Alerts: real set-up problems. Shown first, and only when there is something to fix. */}
      <Section
        title="Needs attention"
        icon={<TriangleAlert className={icon} aria-hidden="true" />}
        loading={loading}
        failed={failed('alerts')}
        onRetry={retry}
        empty={alertGroups.length === 0}
        emptyIcon={<CircleCheck className="h-6 w-6" aria-hidden="true" />}
        emptyText="Everything is set up."
        action={data?.alerts && data.alerts.total > 0 ? <Badge variant="warning">{data.alerts.total} to fix</Badge> : undefined}
      >
        <div className="space-y-5">
          {alertGroups.map((g) => (
            <div key={g.key}>
              <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-site-text">
                {ALERT_TITLE[g.key]} <Badge variant="warning">{g.total}</Badge>
              </p>
              <div className="space-y-1">
                {g.items.map((item) => (
                  <RowButton key={item.id} onClick={() => navigate(item.link)} label={`Open ${item.label}`}>
                    <span className="break-words text-sm text-site-text">{item.label}</span>
                  </RowButton>
                ))}
                {g.total > g.items.length && <p className="px-2 text-xs text-site-muted">and {g.total - g.items.length} more</p>}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* The school at a glance + the last 7 days */}
        <Section
          title="The school at a glance"
          icon={<Users className={icon} aria-hidden="true" />}
          loading={loading}
          failed={failed('metrics')}
          onRetry={retry}
          empty={false}
          emptyIcon={null}
          emptyText=""
        >
          {metrics && (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-3">
                <Tile label="Active students" value={metrics.active_students} />
                <Tile label="Active teachers" value={metrics.active_teachers} />
                <Tile label="Courses" value={metrics.courses} />
              </div>
              <div>
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-site-text">
                  <Activity className={icon} aria-hidden="true" /> Last 7 days
                </p>
                <div
                  role="img"
                  aria-label={`Recorded events per day: ${days.map((d) => `${weekdayShort(d.date)} ${d.events}`).join(', ')}`}
                  className="flex h-24 items-end gap-2"
                >
                  {days.map((d) => (
                    <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${weekdayShort(d.date)}: ${d.events}`}>
                      <span className="text-[10px] text-site-muted">{d.events}</span>
                      <div className="w-full rounded-t bg-primary/70" style={{ height: `${Math.max(4, Math.round((d.events / peak) * 100))}%` }} />
                      <span className="text-[10px] text-site-muted">{weekdayShort(d.date)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-1">
                  <Fact label="Events recorded" value={metrics.activity.events} />
                  <Fact label="Sign-ins" value={metrics.activity.logins} />
                  <Fact label="Failed sign-ins" value={metrics.activity.failed_logins} />
                  <Fact label="Hand-ins" value={metrics.activity.handins} />
                </div>
              </div>
            </div>
          )}
        </Section>

        {/* School year */}
        <Section
          title={year ? `School year ${year.start_year}–${year.end_year}` : 'School year'}
          icon={<GraduationCap className={icon} aria-hidden="true" />}
          loading={loading}
          failed={failed('school_year')}
          onRetry={retry}
          empty={false}
          emptyIcon={null}
          emptyText=""
        >
          {year && (
            <div className="space-y-2">
              <Fact label="Courses" value={year.courses} />
              <Fact label="Timetable entries" value={year.timetable_entries} />
              <Fact label="Enrollments" value={year.enrollments} />
              <Fact label="Students enrolled" value={year.students_enrolled} />
              <Fact label="Teachers teaching" value={year.teachers_teaching} />
              <p className="pt-2 text-xs text-site-muted">Philippine school years start in June.</p>
            </div>
          )}
        </Section>
      </div>

      {announcements}

      {/* Recent changes */}
      <Section
        title="Recent changes"
        icon={<History className={icon} aria-hidden="true" />}
        loading={loading}
        failed={failed('audit_stream')}
        onRetry={retry}
        empty={(data?.audit_stream?.length ?? 0) === 0}
        emptyIcon={<BookOpen className="h-6 w-6" aria-hidden="true" />}
        emptyText="No changes recorded yet."
        action={
          <button type="button" onClick={() => navigate('/audit-logs')} className="text-sm text-primary hover:underline">
            View all
          </button>
        }
      >
        <ul className="divide-y divide-border">
          {data?.audit_stream?.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-site-text">{actionLabel(e.action)}</p>
                <p className="text-xs text-site-muted">{e.actor_name}</p>
              </div>
              <span className="shrink-0 text-xs text-site-muted">{timeAgo(e.created_at)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
