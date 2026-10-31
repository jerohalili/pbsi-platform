import { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { cn } from '@/lib/utils.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  ATTENDANCE_STATUSES,
  CONTROL_CLASS,
  STATUS_BADGE,
  formatDay,
  todayInManila,
  type AttendanceStatus,
} from '@/lib/attendance.ts';
import type { CourseOption } from './AttendanceRecords.tsx';

interface RosterRow {
  student_id: string;
  student_number: string | null;
  first_name: string;
  last_name: string;
  /** What is stored in the database (null = never marked for this course and date). */
  saved: AttendanceStatus | null;
  /** What the teacher has selected on screen. */
  status: AttendanceStatus | null;
}

interface RosterResponse {
  students: {
    student_id: string;
    student_number: string | null;
    first_name: string;
    last_name: string;
    status: AttendanceStatus | null;
  }[];
}

const BATCH_SIZE = 500; // the API accepts at most 500 students per request

export function TakeAttendance({ courses }: { courses: CourseOption[] }) {
  const { toast } = useToast();
  const today = todayInManila();
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirtyRows = useMemo(
    () => rows.filter((r) => r.status !== null && r.status !== r.saved),
    [rows],
  );
  const dirty = dirtyRows.length > 0;

  async function loadRoster(forCourse = courseId, forDate = date) {
    if (!forCourse || !forDate) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ course_id: forCourse, date: forDate });
      const res = await api.get<RosterResponse>(`/attendance/roster?${params}`);
      setRows(
        res.data.students.map((s) => ({
          student_id: s.student_id,
          student_number: s.student_number,
          first_name: s.first_name,
          last_name: s.last_name,
          saved: s.status,
          status: s.status,
        })),
      );
    } catch (err) {
      setRows([]);
      toast({
        title: 'Failed to load the class list',
        description: getErrorMessage(err),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  // The course list arrives asynchronously, so pick a valid course once it is there.
  useEffect(() => {
    if (!courses.some((c) => c.id === courseId)) setCourseId(courses[0]?.id ?? '');
  }, [courses]);

  useEffect(() => {
    loadRoster();
  }, [courseId, date]);

  // Warn before closing the tab with marks that were never saved.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function confirmDiscard(): boolean {
    return !dirty || window.confirm('You have unsaved attendance. Discard it?');
  }

  function pick(studentId: string, value: AttendanceStatus) {
    setRows((prev) =>
      prev.map((r) =>
        r.student_id !== studentId
          ? r
          : // Clicking the selected status again undoes it, but only for a student never saved.
            { ...r, status: r.status === value && r.saved === null ? null : value },
      ),
    );
  }

  function markUnmarkedPresent() {
    setRows((prev) => prev.map((r) => (r.status === null ? { ...r, status: 'present' } : r)));
  }

  async function save() {
    if (!dirty) return;
    setSaving(true);
    try {
      let saved = 0;
      for (let i = 0; i < dirtyRows.length; i += BATCH_SIZE) {
        const batch = dirtyRows.slice(i, i + BATCH_SIZE);
        const res = await api.post<{ saved: number }>('/attendance/bulk', {
          course_id: courseId,
          date,
          records: batch.map((r) => ({ student_id: r.student_id, status: r.status })),
        });
        saved += res.data.saved;
      }
      toast({
        title: 'Attendance saved',
        description: `${saved} ${saved === 1 ? 'student' : 'students'} updated for ${formatDay(date)}.`,
        variant: 'success',
      });
      await loadRoster();
    } catch (err) {
      toast({
        title: 'Could not save attendance',
        description: getErrorMessage(err),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 };
    rows.forEach((r) => {
      if (r.status) c[r.status] += 1;
      else c.unmarked += 1;
    });
    return c;
  }, [rows]);

  const needle = search.trim().toLowerCase();
  const visible = needle
    ? rows.filter((r) =>
        `${r.first_name} ${r.last_name} ${r.student_number ?? ''}`.toLowerCase().includes(needle),
      )
    : rows;

  if (courses.length === 0) {
    return (
      <div className="rounded-xl border border-site-border bg-site-card p-8 text-center text-site-muted">
        You don’t have any courses to take attendance for yet. Ask an admin to assign a course to you.
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          aria-label="Course"
          value={courseId}
          onChange={(e) => {
            if (confirmDiscard()) setCourseId(e.target.value);
          }}
          className={CONTROL_CLASS}
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label="Date"
          value={date}
          max={today}
          onChange={(e) => {
            // An emptied or future date is ignored; the server refuses future dates too.
            if (e.target.value && e.target.value <= today && confirmDiscard()) setDate(e.target.value);
          }}
          className={CONTROL_CLASS}
        />
        <input
          type="search"
          aria-label="Search students"
          placeholder="Search students…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={cn(CONTROL_CLASS, 'w-full sm:w-64')}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4 text-sm" aria-live="polite">
        {ATTENDANCE_STATUSES.map((s) => (
          <span key={s.value} className={cn('px-3 py-1 rounded-full font-medium', STATUS_BADGE[s.value])}>
            {s.label}: {counts[s.value]}
          </span>
        ))}
        <span className="px-3 py-1 rounded-full font-medium bg-site-card border border-site-border text-site-muted">
          Not marked: {counts.unmarked}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={markUnmarkedPresent} disabled={loading || counts.unmarked === 0}>
            Mark unmarked as present
          </Button>
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? `Save changes (${dirtyRows.length})` : 'Saved'}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-site-border bg-site-card overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-site-border">
              <th className="px-3 py-4 text-sm font-bold text-site-muted sm:px-6">Student</th>
              <th className="px-3 py-4 text-sm font-bold text-site-muted sm:px-6">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={2} className="px-3 py-8 text-center text-site-muted sm:px-6">
                  Loading class list…
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-3 py-8 text-center text-site-muted sm:px-6">
                  {rows.length === 0 ? 'There are no active students yet.' : 'No students match your search.'}
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr key={r.student_id} className="border-b border-site-border">
                  <td className="px-3 py-3 sm:px-6">
                    <div className="font-medium text-site-text">
                      {r.last_name}, {r.first_name}
                    </div>
                    {r.student_number && <div className="text-xs text-site-muted">{r.student_number}</div>}
                  </td>
                  <td className="px-3 py-3 sm:px-6">
                    <div
                      role="group"
                      aria-label={`Attendance for ${r.first_name} ${r.last_name}`}
                      className="flex flex-wrap gap-1"
                    >
                      {ATTENDANCE_STATUSES.map((s) => {
                        const active = r.status === s.value;
                        return (
                          <button
                            key={s.value}
                            type="button"
                            aria-pressed={active}
                            onClick={() => pick(r.student_id, s.value)}
                            className={cn(
                              'px-3 py-2 sm:py-1.5 rounded-md border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              active
                                ? cn(STATUS_BADGE[s.value], 'border-current')
                                : 'border-site-border bg-white text-site-muted hover:bg-gray-50 dark:bg-card',
                            )}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
