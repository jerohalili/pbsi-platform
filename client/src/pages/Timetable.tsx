import useAuth from '@/hooks/useAuth.ts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { cn } from '@/lib/utils.ts';
import { Button } from '@/components/ui/button.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { ConfirmDialog } from '@/components/users/ConfirmDialog.tsx';
import { TimetableFormDialog } from '@/components/timetable/TimetableFormDialog.tsx';
import {
  DAY_NAMES,
  DAY_SHORT,
  MIN_PERIODS,
  type TimetableCourse,
  type TimetableEntry,
} from '@/components/timetable/types.ts';

type View = 'mine' | 'all';

// One label column plus one column per school day (Monday-Saturday).
const GRID_COLS = 'grid grid-cols-[88px_repeat(6,minmax(0,1fr))]';

export default function TimetablePage() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [courses, setCourses] = useState<TimetableCourse[]>([]);
  const [view, setView] = useState<View>('mine');

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editing, setEditing] = useState<TimetableEntry | null>(null);
  const [cell, setCell] = useState<{ day?: number; period?: number }>({});
  const [deleting, setDeleting] = useState<TimetableEntry | null>(null);

  const isTeacher = user?.role === 'teacher';
  const canEdit = user?.role === 'admin' || isTeacher;
  const onlyMine = isTeacher && view === 'mine';

  const loadTimetable = useCallback(async () => {
    try {
      const res = await api.get<{ timetable: TimetableEntry[] }>('/timetable', {
        params: onlyMine ? { mine: 'true' } : undefined,
      });
      setEntries(res.data.timetable);
      setLoaded(true);
    } catch (err) {
      toast({ title: 'Failed to load timetable', description: getErrorMessage(err), variant: 'destructive' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyMine]);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadTimetable();
  }, [isAuthenticated, loadTimetable]);

  useEffect(() => {
    if (!isAuthenticated || !canEdit) return;
    api
      .get<{ courses: (TimetableCourse & { is_mine: boolean })[] }>('/courses')
      .then((r) => setCourses(r.data.courses))
      .catch((err) =>
        toast({ title: 'Failed to load courses', description: getErrorMessage(err), variant: 'destructive' }),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, canEdit]);

  // Several classes can share a day and period (different rooms and teachers), so each cell is a list.
  const { grid, periods, periodTimes } = useMemo(() => {
    const grid: Record<string, TimetableEntry[]> = {};
    const times: Record<number, { start: string; end: string }> = {};
    let max = MIN_PERIODS;
    for (const e of entries) {
      (grid[`${e.day_of_week}-${e.period_number}`] ??= []).push(e);
      times[e.period_number] ??= { start: e.start_time, end: e.end_time };
      max = Math.max(max, e.period_number);
    }
    return {
      grid,
      periods: Array.from({ length: max }, (_, i) => i + 1),
      periodTimes: times,
    };
  }, [entries]);

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

  // A teacher schedules only the courses they teach; an admin any course.
  const schedulable = isTeacher ? courses.filter((c) => c.is_mine) : courses;
  const canAdd = canEdit && schedulable.length > 0;
  // JS getDay(): Sunday = 0, so Monday-Saturday are already 1-6.
  const today = new Date().getDay();

  const openCreate = (day?: number, period?: number) => {
    setFormMode('create');
    setEditing(null);
    setCell({ day, period });
    setFormOpen(true);
  };
  const openEdit = (entry: TimetableEntry) => {
    setFormMode('edit');
    setEditing(entry);
    setFormOpen(true);
  };
  const handleSaved = () => {
    toast({ title: formMode === 'create' ? 'Class added' : 'Class updated', variant: 'success' });
    loadTimetable();
  };
  const handleDelete = async () => {
    if (!deleting) return;
    await api.delete(`/timetable/${deleting.id}`);
    toast({ title: 'Class removed', variant: 'success' });
    loadTimetable();
  };

  return (
    <div className="w-full bg-site-bg px-0 py-6 md:min-h-screen md:px-4 md:py-12">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div data-tour="tt-header">
            <h1 className="text-2xl font-bold text-site-text">Weekly Timetable</h1>
            <p className="text-site-muted">
              {isTeacher
                ? 'Your classes by day and period. Add or change the ones for courses you teach.'
                : canEdit
                  ? 'Class schedule by day and period. Add, move or remove classes for any course.'
                  : 'Class schedule by day and period.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isTeacher && (
              <div data-tour="tt-scope" className="flex gap-1" role="tablist" aria-label="Timetable scope">
                {(
                  [
                    { id: 'mine', label: 'My classes' },
                    { id: 'all', label: 'Whole school' },
                  ] as { id: View; label: string }[]
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={view === t.id}
                    onClick={() => setView(t.id)}
                    className={cn(
                      'px-3 py-2 rounded-md text-sm font-medium border transition-colors',
                      view === t.id
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-white text-site-muted border-site-border hover:text-site-text dark:bg-card',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            {canAdd && (
              <Button data-tour="tt-add" onClick={() => openCreate()}>
                <Plus className="w-4 h-4 mr-1" /> Add class
              </Button>
            )}
          </div>
        </div>

        {canEdit && courses.length > 0 && !canAdd && (
          <p className="mb-4 text-sm text-site-muted">You are not assigned to any course yet, so there is nothing to schedule.</p>
        )}

        {loaded && entries.length === 0 && (
          <p className="mb-4 text-sm text-site-muted">
            {canAdd ? 'No classes scheduled yet. Use “Add class” to build the timetable.' : 'No classes are scheduled yet.'}
          </p>
        )}

        {/* Phones: one card per day instead of the wide grid. */}
        <div data-tour="tt-days" className="space-y-4 md:hidden">
          {DAY_NAMES.map((dayName, dayIdx) => {
            const dayEntries = entries
              .filter((e) => e.day_of_week === dayIdx + 1)
              .sort((a, b) => a.period_number - b.period_number || a.start_time.localeCompare(b.start_time));
            return (
              <section key={dayName} className="rounded-xl border border-site-border bg-site-card">
                <div
                  className={cn(
                    'flex items-center justify-between rounded-t-xl border-b border-site-border px-4 py-3',
                    today === dayIdx + 1 ? 'bg-primary/15 text-primary' : 'bg-primary/5',
                  )}
                >
                  <h2 className="font-bold">
                    {dayName}
                    {today === dayIdx + 1 && <span className="ml-2 text-xs font-medium">Today</span>}
                  </h2>
                  {canAdd && (
                    <button
                      type="button"
                      aria-label={`Add a class on ${dayName}`}
                      onClick={() => openCreate(dayIdx + 1)}
                      className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-primary/10"
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  )}
                </div>
                {dayEntries.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-site-muted">No classes</p>
                ) : (
                  <ul className="divide-y divide-site-border">
                    {dayEntries.map((e) => (
                      <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                        <div className="w-14 shrink-0 text-center">
                          <div className="text-xs text-site-muted">Period</div>
                          <div className="text-lg font-bold text-site-text">{e.period_number}</div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-site-text">{e.course_code}</div>
                          <div className="text-sm text-site-text">{e.course_name}</div>
                          <div className="mt-1 text-xs text-site-muted">
                            {e.start_time}–{e.end_time} · {e.room}
                          </div>
                          <div className="text-xs text-site-muted">
                            {e.teacher_first_name} {e.teacher_last_name}
                          </div>
                        </div>
                        {e.can_manage && (
                          <div className="flex shrink-0 -mr-2">
                            <button
                              type="button"
                              aria-label={`Edit ${e.course_code}`}
                              onClick={() => openEdit(e)}
                              className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Remove ${e.course_code}`}
                              onClick={() => setDeleting(e)}
                              className="flex h-10 w-10 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        <div data-tour="tt-grid" className="hidden rounded-xl border border-site-border bg-site-card overflow-x-auto md:block">
          <div className="min-w-[980px]">
            <div className={cn(GRID_COLS, 'border-b border-site-border')}>
              <div className="px-3 py-4 font-bold text-site-text border-r border-site-border">Period</div>
              {DAY_SHORT.map((day, i) => (
                <div
                  key={day}
                  className={cn(
                    'px-3 py-4 font-bold text-center border-r border-site-border last:border-r-0',
                    today === i + 1 ? 'bg-primary/15 text-primary' : 'bg-primary/5',
                  )}
                >
                  {day}
                </div>
              ))}
            </div>

            {periods.map((period) => (
              <div
                key={period}
                className={cn(GRID_COLS, 'border-b border-site-border last:border-b-0')}
              >
                <div className="px-3 py-3 border-r border-site-border bg-gray-50 dark:bg-muted/40">
                  <div className="font-medium text-site-text">{period}</div>
                  {periodTimes[period] && (
                    <div className="text-[10px] text-site-muted leading-tight">
                      {periodTimes[period].start}–{periodTimes[period].end}
                    </div>
                  )}
                </div>
                {DAY_SHORT.map((_day, dayIdx) => {
                  const here = grid[`${dayIdx + 1}-${period}`] ?? [];
                  return (
                    <div
                      key={dayIdx}
                      className="group relative px-2 py-2 border-r border-site-border last:border-r-0 min-h-[84px] flex flex-col gap-1"
                    >
                      {here.map((e) => (
                        <div key={e.id} className="rounded-lg bg-primary p-2 text-white shadow-sm">
                          <div className="flex items-start justify-between gap-1">
                            <div className="min-w-0">
                              <div className="font-bold text-sm">{e.course_code}</div>
                              <div className="truncate text-xs">{e.course_name}</div>
                            </div>
                            {e.can_manage && (
                              <div className="flex shrink-0 -mr-1 -mt-1">
                                <button
                                  type="button"
                                  aria-label={`Edit ${e.course_code}`}
                                  onClick={() => openEdit(e)}
                                  className="p-1 rounded hover:bg-white/20"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Remove ${e.course_code}`}
                                  onClick={() => setDeleting(e)}
                                  className="p-1 rounded hover:bg-white/20"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="text-[10px] opacity-80">
                            {e.teacher_first_name} {e.teacher_last_name}
                          </div>
                          <div className="text-[10px] opacity-80">
                            {e.room} · {e.start_time}–{e.end_time}
                          </div>
                        </div>
                      ))}
                      {canAdd && (
                        <button
                          type="button"
                          aria-label={`Add a class on ${DAY_SHORT[dayIdx]} period ${period}`}
                          onClick={() => openCreate(dayIdx + 1, period)}
                          className={cn(
                            'flex items-center justify-center rounded-lg border border-dashed border-site-border text-site-muted hover:text-primary hover:border-primary transition-opacity',
                            here.length === 0
                              ? 'flex-1 opacity-0 group-hover:opacity-100 focus:opacity-100'
                              : 'h-6 opacity-0 group-hover:opacity-100 focus:opacity-100',
                          )}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <TimetableFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        courses={schedulable}
        entry={editing}
        initialDay={cell.day}
        initialPeriod={cell.period}
        periodTimes={periodTimes}
        onSaved={handleSaved}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove this class?"
        description={
          deleting
            ? `${deleting.course_code} on ${DAY_SHORT[deleting.day_of_week - 1]}, period ${deleting.period_number} will be removed from the timetable.`
            : ''
        }
        confirmLabel="Remove"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}
