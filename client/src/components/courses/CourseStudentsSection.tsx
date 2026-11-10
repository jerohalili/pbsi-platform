import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from 'react-query';
import { UserMinus, UserPlus, Users } from 'lucide-react';
import { useGet } from '@/hooks/useApi.ts';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { ConfirmDialog } from '@/components/users/ConfirmDialog.tsx';

interface EnrolledStudent {
  student_id: string;
  student_number: string;
  first_name: string | null;
  last_name: string | null;
  is_active: boolean;
  enrolled_at: string;
}

/** A row of GET /students (only the fields used here). */
interface StudentRecord {
  id: string;
  student_id: string;
  first_name: string | null;
  last_name: string | null;
  is_active: boolean;
}

const fullName = (s: { first_name: string | null; last_name: string | null }) =>
  `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || 'Unnamed student';

interface CourseStudentsSectionProps {
  courseId: string;
  courseCode: string;
}

/**
 * Who is in this course. Only the course's teacher and admins see it. Students see only the
 * courses they are enrolled in, so this list decides what each student can open.
 */
export function CourseStudentsSection({ courseId, courseCode }: CourseStudentsSectionProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<EnrolledStudent | null>(null);

  const { data, isLoading, isError, refetch } = useGet<{ enrollments: EnrolledStudent[] }>(
    ['enrollments', courseId],
    `/courses/${courseId}/enrollments`,
    { staleTime: 0, refetchOnMount: 'always' },
  );
  const enrolled = data?.enrollments ?? [];
  const enrolledIds = useMemo(() => new Set(enrolled.map((s) => s.student_id)), [enrolled]);

  const refresh = () => queryClient.invalidateQueries('enrollments');

  const confirmRemove = async () => {
    if (!removeTarget) return;
    await api.delete(`/courses/${courseId}/enrollments/${removeTarget.student_id}`);
    toast({ title: 'Student removed from the course', description: fullName(removeTarget), variant: 'success' });
    refresh();
  };

  return (
    <section data-tour="cd-students" className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold">Students{data ? ` (${enrolled.length})` : ''}</h2>
          <p className="text-sm text-muted-foreground">
            Only the students listed here can see this course, its work and its quizzes.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <UserPlus className="w-4 h-4 mr-2" /> Add students
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card className="p-6 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Couldn’t load the students of this course.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      ) : enrolled.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-3 opacity-60" />
          <p>No students are enrolled yet.</p>
          <p className="text-sm mt-1">Use “Add students” so they can see this course.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-input max-h-96 overflow-y-auto">
          {enrolled.map((s) => (
            <div key={s.student_id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {fullName(s)}
                  {!s.is_active && (
                    <Badge variant="warning" className="ml-2 align-middle">
                      Deactivated
                    </Badge>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">{s.student_number}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${fullName(s)} from ${courseCode}`}
                title="Remove from course"
                onClick={() => setRemoveTarget(s)}
              >
                <UserMinus className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </Card>
      )}

      <AddStudentsDialog
        open={adding}
        onOpenChange={setAdding}
        courseId={courseId}
        courseCode={courseCode}
        enrolledIds={enrolledIds}
        onAdded={(count, skipped) => {
          toast({
            title: count === 1 ? '1 student added' : `${count} students added`,
            description: skipped > 0 ? `${skipped} skipped (already enrolled or not active).` : undefined,
            variant: 'success',
          });
          refresh();
        }}
      />

      {removeTarget && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoveTarget(null)}
          title="Remove this student from the course?"
          description={`${fullName(removeTarget)} will no longer see ${courseCode}. Their grades, submissions, quiz attempts and attendance are kept, and you can add them back at any time.`}
          confirmLabel="Remove"
          destructive
          onConfirm={confirmRemove}
        />
      )}
    </section>
  );
}

interface AddStudentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  courseCode: string;
  enrolledIds: Set<string>;
  onAdded: (added: number, skipped: number) => void;
}

function AddStudentsDialog({ open, onOpenChange, courseId, courseCode, enrolledIds, onAdded }: AddStudentsDialogProps) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Every student is loaded once, when the dialog opens; searching then filters instantly.
  const { data, isLoading, isError, refetch } = useGet<{ students: StudentRecord[] }>(
    ['students', 'enrollable'],
    '/students',
    { enabled: open, staleTime: 0, refetchOnMount: 'always' },
  );

  useEffect(() => {
    if (open) {
      setSearch('');
      setSelected(new Set());
      setError('');
    }
  }, [open]);

  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.students ?? [])
      .filter((s) => s.is_active && !enrolledIds.has(s.id))
      .filter(
        (s) =>
          !needle ||
          fullName(s).toLowerCase().includes(needle) ||
          (s.student_id ?? '').toLowerCase().includes(needle),
      );
  }, [data, enrolledIds, search]);

  const allShownSelected = candidates.length > 0 && candidates.every((s) => selected.has(s.id));

  const toggle = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleAllShown = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) candidates.forEach((s) => next.delete(s.id));
      else candidates.forEach((s) => next.add(s.id));
      return next;
    });

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const { data: result } = await api.post<{ added: number; skipped: number }>(
        `/courses/${courseId}/enrollments`,
        { student_ids: Array.from(selected) },
      );
      onAdded(result.added, result.skipped);
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add students to {courseCode}</DialogTitle>
          <DialogDescription>
            Choose the students who should see this course. They will be notified.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or student number"
            aria-label="Search students"
          />

          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Couldn’t load students.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {search.trim() ? 'No matching students.' : 'Every active student is already in this course.'}
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {candidates.length} {candidates.length === 1 ? 'student' : 'students'} available
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={toggleAllShown}>
                  {allShownSelected ? 'Clear shown' : 'Select all shown'}
                </Button>
              </div>
              <div className="rounded-lg border border-input divide-y divide-input max-h-72 overflow-y-auto">
                {candidates.map((s) => (
                  <label
                    key={s.id}
                    htmlFor={`enroll-${s.id}`}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      id={`enroll-${s.id}`}
                      className="h-5 w-5 border-2 border-muted-foreground data-[state=checked]:border-primary"
                      checked={selected.has(s.id)}
                      onCheckedChange={(checked) => toggle(s.id, checked === true)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate">{fullName(s)}</span>
                      <span className="block text-xs text-muted-foreground">{s.student_id}</span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={busy || selected.size === 0}>
            {busy ? 'Adding…' : selected.size === 0 ? 'Add students' : `Add ${selected.size} ${selected.size === 1 ? 'student' : 'students'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
