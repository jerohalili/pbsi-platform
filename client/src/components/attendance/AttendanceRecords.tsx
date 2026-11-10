import { useEffect, useState } from 'react';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { Button } from '@/components/ui/button.tsx';
import { CONTROL_CLASS, formatDay } from '@/lib/attendance.ts';
import { StatusBadge } from './StatusBadge.tsx';

export interface CourseOption {
  id: string;
  code: string;
  name: string;
}

interface AttendanceRecord {
  id: string;
  student_id: string;
  course_id: string;
  date: string;
  status: string;
  course_code: string;
  course_name: string;
  first_name: string;
  last_name: string;
}

interface Props {
  courses: CourseOption[];
  /** Staff also see which student each record belongs to; students only ever see their own. */
  showStudent: boolean;
}

/** Read-only history, newest first (the server returns at most 500 rows). */
export function AttendanceRecords({ courses, showStudent }: Props) {
  const { toast } = useToast();
  const [courseId, setCourseId] = useState('');
  const [date, setDate] = useState('');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (courseId) params.set('course_id', courseId);
        if (date) params.set('date', date);
        const res = await api.get<{ attendance: AttendanceRecord[] }>(`/attendance?${params}`);
        if (!cancelled) setRecords(res.data.attendance);
      } catch (err) {
        if (!cancelled) {
          toast({
            title: 'Failed to load attendance',
            description: getErrorMessage(err),
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [courseId, date]);

  const columns = showStudent ? 4 : 3;

  return (
    <div>
      <div data-tour="att-filters" className="flex flex-wrap items-center gap-3 mb-4">
        <select
          aria-label="Filter by course"
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          className={CONTROL_CLASS}
        >
          <option value="">All courses</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="Filter by date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={CONTROL_CLASS}
        />
        {date && (
          <Button variant="ghost" size="sm" onClick={() => setDate('')}>
            Clear date
          </Button>
        )}
      </div>

      <div data-tour="att-records" className="rounded-xl border border-site-border bg-site-card overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-site-border">
              {showStudent && <th className="px-6 py-4 text-sm font-bold text-site-muted">Student</th>}
              <th className="px-6 py-4 text-sm font-bold text-site-muted">Course</th>
              <th className="px-6 py-4 text-sm font-bold text-site-muted">Date</th>
              <th className="px-6 py-4 text-sm font-bold text-site-muted">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns} className="px-6 py-8 text-center text-site-muted">
                  Loading…
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={columns} className="px-6 py-8 text-center text-site-muted">
                  No attendance records found.
                </td>
              </tr>
            ) : (
              records.map((r) => (
                <tr key={r.id} className="border-b border-site-border">
                  {showStudent && (
                    <td className="px-6 py-4 font-medium text-site-text">
                      {r.first_name} {r.last_name}
                    </td>
                  )}
                  <td className="px-6 py-4 text-site-text text-sm">
                    <span className="font-medium">{r.course_code}</span>
                    <span className="text-site-muted"> — {r.course_name}</span>
                  </td>
                  <td className="px-6 py-4 text-site-muted text-sm">{formatDay(r.date)}</td>
                  <td className="px-6 py-4">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {records.length === 500 && (
        <p className="mt-2 text-xs text-site-muted">
          Showing the 500 most recent records. Use the filters to narrow the list.
        </p>
      )}
    </div>
  );
}
