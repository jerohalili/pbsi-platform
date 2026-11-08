import useAuth from '@/hooks/useAuth.ts';
import { useGet } from '@/hooks/useApi.ts';
import { Card } from '@/components/ui/card.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import {
  Users,
  BookOpen,
  Award,
  Calendar,
  Bell,
  GraduationCap,
  ClipboardCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { DashboardAnnouncements } from '@/components/announcements/DashboardAnnouncements.tsx';
import StudentDashboard from '@/components/dashboard/StudentDashboard.tsx';
import TeacherDashboard from '@/components/dashboard/TeacherDashboard.tsx';
import AdminDashboard from '@/components/dashboard/AdminDashboard.tsx';

type DashboardRole = 'admin' | 'teacher' | 'student';

interface ActivityItem {
  id: string;
  title: string;
  created_at: string;
}

interface DashboardResponse {
  role: DashboardRole;
  stats: Record<string, number | null>;
  recent_activity: ActivityItem[];
}

interface StatCardDef {
  key: string;
  title: string;
  icon: React.ReactNode;
  format?: (value: number) => string;
}

const iconClass = 'w-5 h-5';
const percent = (v: number) => `${v}%`;

// Which cards each role sees. Keys match the fields returned by GET /dashboard/stats.
const STAT_CARDS: Record<DashboardRole, StatCardDef[]> = {
  admin: [
    { key: 'students', title: 'Students', icon: <Users className={iconClass} /> },
    { key: 'courses', title: 'Courses', icon: <BookOpen className={iconClass} /> },
    { key: 'attendance_today', title: "Today's Attendance", icon: <Calendar className={iconClass} />, format: percent },
    { key: 'ungraded_submissions', title: 'Ungraded Submissions', icon: <ClipboardCheck className={iconClass} /> },
  ],
  teacher: [
    { key: 'my_courses', title: 'My Courses', icon: <BookOpen className={iconClass} /> },
    { key: 'students', title: 'Students', icon: <Users className={iconClass} /> },
    { key: 'attendance_today', title: "Today's Attendance", icon: <Calendar className={iconClass} />, format: percent },
    { key: 'ungraded_submissions', title: 'Ungraded Submissions', icon: <ClipboardCheck className={iconClass} /> },
  ],
  student: [
    { key: 'gpa', title: 'Average Grade', icon: <GraduationCap className={iconClass} />, format: percent },
    { key: 'attendance_overall', title: 'My Attendance', icon: <Calendar className={iconClass} />, format: percent },
    { key: 'graded_items', title: 'Graded Items', icon: <Award className={iconClass} /> },
    { key: 'unread_notifications', title: 'Unread Notifications', icon: <Bell className={iconClass} /> },
  ],
};

function formatStat(def: StatCardDef, value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return def.format ? def.format(value) : value.toLocaleString();
}

function timeAgo(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : formatDistanceToNow(date, { addSuffix: true });
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = (user?.role as string) ?? 'student';

  const { data, isLoading, isError, refetch } = useGet<DashboardResponse>(
    ['dashboard-stats', user?.id ?? ''],
    '/dashboard/stats',
    { enabled: !!user, retry: 1, staleTime: 30 * 1000 },
  );
  const statCards = STAT_CARDS[data?.role ?? (role as DashboardRole)] ?? STAT_CARDS.student;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-site-text">Dashboard</h1>
          <p className="text-site-muted">
            Welcome back, {user?.email?.split('@')[0]} ({role})
          </p>
        </div>
      </div>

      {/* Stat cards */}
      {isError ? (
        <Card className="p-6 flex items-center justify-between gap-4">
          <p className="text-sm text-site-muted">Couldn't load dashboard data.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {statCards.map((card) => (
            <Card key={card.key} className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-site-muted">{card.title}</p>
                  {isLoading ? (
                    <Skeleton className="h-8 w-16 mt-1" />
                  ) : (
                    <p className="text-2xl font-bold text-site-text">
                      {formatStat(card, data?.stats[card.key])}
                    </p>
                  )}
                </div>
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  {card.icon}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {role === 'student' ? (
        <StudentDashboard announcements={<DashboardAnnouncements />} />
      ) : role === 'teacher' ? (
        <TeacherDashboard announcements={<DashboardAnnouncements />} />
      ) : role === 'admin' ? (
        <AdminDashboard announcements={<DashboardAnnouncements />} />
      ) : (
        <DashboardAnnouncements />
      )}

      {/* Recent activity */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-bold text-site-text">Recent Activity</h2>
          <button
            onClick={() => navigate('/notifications')}
            className="text-sm text-primary hover:underline"
          >
            View all
          </button>
        </div>
        <div className="space-y-4">
          {isLoading ? (
            <>
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </>
          ) : isError ? (
            <p className="text-sm text-site-muted">Recent activity is unavailable right now.</p>
          ) : data && data.recent_activity.length > 0 ? (
            data.recent_activity.map((item) => (
              <ActivityRow
                key={item.id}
                icon={<Bell className="w-4 h-4 text-site-muted" />}
                text={item.title}
                time={timeAgo(item.created_at)}
              />
            ))
          ) : (
            <p className="text-sm text-site-muted">No recent activity.</p>
          )}
        </div>
      </Card>
    </div>
  );
}


function ActivityRow({ icon, text, time }: { icon: React.ReactNode; text: string; time: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-site-text">
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
        {icon}
      </div>
      <div className="flex-1">
        <p className="font-medium">{text}</p>
        <p className="text-xs text-site-muted">{time}</p>
      </div>
    </div>
  );
}

