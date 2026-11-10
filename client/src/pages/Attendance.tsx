import useAuth from '@/hooks/useAuth.ts';
import { useEffect, useState } from 'react';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { cn } from '@/lib/utils.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { AttendanceRecords, type CourseOption } from '@/components/attendance/AttendanceRecords.tsx';
import { TakeAttendance } from '@/components/attendance/TakeAttendance.tsx';

interface Summary {
  present_count: number;
  absent_count: number;
  late_count: number;
  excused_count: number;
  total_count: number;
  attendance_percentage: number | null;
}

interface CourseRow extends CourseOption {
  is_mine: boolean;
}

type Tab = 'take' | 'records';

export default function AttendancePage() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('take');

  // Admins and teachers take attendance; students only read their own.
  const canTake = user?.role === 'admin' || user?.role === 'teacher';

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    async function load() {
      try {
        const requests: Promise<unknown>[] = [
          api.get<{ courses: CourseRow[] }>('/courses').then((r) => {
            setCourses(r.data.courses);
            setCoursesLoaded(true);
          }),
        ];
        if (!canTake) {
          requests.push(
            api.get<{ summary: Summary }>('/attendance/summary/me').then((r) => setSummary(r.data.summary)),
          );
        }
        await Promise.all(requests);
      } catch (err) {
        toast({ title: 'Failed to load attendance', description: getErrorMessage(err), variant: 'destructive' });
      }
    }
    load();
  }, [isAuthenticated, user?.id, canTake]);

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

  // A teacher takes attendance only for the courses they teach; an admin for any course.
  const takeableCourses = user?.role === 'teacher' ? courses.filter((c) => c.is_mine) : courses;

  return (
    <div className="w-full bg-site-bg px-0 py-6 md:min-h-screen md:px-4 md:py-12">
      <div className="max-w-5xl mx-auto">
        <div data-tour="att-header" className="mb-8">
          <h1 className="text-2xl font-bold text-site-text">Attendance</h1>
          <p className="text-site-muted">
            {user?.role === 'admin'
              ? 'Take attendance for any course and review past records.'
              : canTake
                ? 'Take attendance for the courses you teach and review past records.'
                : 'Your attendance across all of your courses.'}
          </p>
        </div>

        {!canTake && summary && (
          <>
            <div data-tour="att-summary" className="grid gap-4 grid-cols-2 md:grid-cols-5 mb-2">
              {[
                { label: 'Present', value: summary.present_count, color: 'text-green-700' },
                { label: 'Absent', value: summary.absent_count, color: 'text-red-700' },
                { label: 'Late', value: summary.late_count, color: 'text-amber-700' },
                { label: 'Excused', value: summary.excused_count, color: 'text-gray-700' },
                {
                  label: 'Attendance',
                  value: summary.attendance_percentage == null ? 'N/A' : `${summary.attendance_percentage}%`,
                  color: 'text-primary',
                },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-site-border bg-site-card p-6 shadow-sm">
                  <div className="mb-2 text-sm font-medium text-site-text">{s.label}</div>
                  <div className={cn('text-2xl font-bold', s.color)}>{s.value}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-site-muted mb-8">
              Attendance % = present ÷ (present + absent + late). Excused days are not counted, and a late day does
              not count as present.
            </p>
          </>
        )}

        {canTake && (
          <div data-tour="att-tabs" className="flex gap-2 mb-6" role="tablist" aria-label="Attendance sections">
            {(
              [
                { id: 'take', label: 'Take attendance' },
                { id: 'records', label: 'Records' },
              ] as { id: Tab; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'px-4 py-2 rounded-md text-sm font-medium border transition-colors',
                  tab === t.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-white text-site-muted border-site-border hover:text-site-text dark:bg-card',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {canTake && !coursesLoaded ? (
          <p className="text-site-muted text-sm">Loading courses…</p>
        ) : canTake && tab === 'take' ? (
          <TakeAttendance courses={takeableCourses} />
        ) : (
          <AttendanceRecords courses={canTake ? takeableCourses : courses} showStudent={canTake} />
        )}
      </div>
    </div>
  );
}
