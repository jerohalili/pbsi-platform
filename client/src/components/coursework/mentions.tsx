import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from 'react-query';
import { MessageSquarePlus, Trash2 } from 'lucide-react';
import { useGet } from '@/hooks/useApi.ts';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { formatDateTime } from '@/lib/utils.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { ConfirmDialog } from '@/components/users/ConfirmDialog.tsx';

export type MentionItemType = 'assignment' | 'quiz' | 'exam';
export type MentionReason = 'comment' | 'missed_deadline' | 'correction';

export const REASON_LABEL: Record<MentionReason, string> = {
  comment: 'Comment',
  missed_deadline: 'Missed deadline',
  correction: 'Needs a correction',
};

/** A starting point for the note; the teacher edits it freely. */
const TEMPLATE: Record<MentionReason, string> = {
  comment: '',
  missed_deadline: 'The deadline for this has passed and I have not received your work. Please see me about it.',
  correction: 'Please correct this and let me know when it is done.',
};

const MAX_LENGTH = 1000;

export function ReasonBadge({ reason }: { reason: MentionReason }) {
  const variant = reason === 'missed_deadline' ? 'destructive' : reason === 'correction' ? 'warning' : 'secondary';
  return <Badge variant={variant}>{REASON_LABEL[reason]}</Badge>;
}

/** Keeps the lists on the Coursework page, the item pages and the notes themselves up to date. */
function useRefreshMentions() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ['mentions', 'assignments', 'assignment', 'quizzes', 'quiz', 'exams', 'exam']) {
      queryClient.invalidateQueries(key);
    }
  };
}

const fullName = (s: { first_name: string | null; last_name: string | null }) =>
  `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || 'Unnamed student';

// ================================================================================================
// Writing a note (teacher)
// ================================================================================================

interface EnrolledStudent {
  student_id: string;
  student_number: string;
  first_name: string | null;
  last_name: string | null;
  is_active: boolean;
}

interface MentionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemType: MentionItemType;
  itemId: string;
  courseId: string;
  itemTitle: string;
  /** Students ticked when the dialog opens (for example the one whose row's button was pressed). */
  initialStudentIds?: string[];
  initialReason?: MentionReason;
}

/**
 * A teacher writes a note to one or more students about this assignment, quiz or exam: a comment
 * on their work, a reminder of a missed deadline, a correction to make. Each student is notified.
 */
export function MentionDialog({
  open,
  onOpenChange,
  itemType,
  itemId,
  courseId,
  itemTitle,
  initialStudentIds,
  initialReason,
}: MentionDialogProps) {
  const { toast } = useToast();
  const refresh = useRefreshMentions();

  const { data, isLoading, isError, refetch } = useGet<{ enrollments: EnrolledStudent[] }>(
    ['enrollments', courseId],
    `/courses/${courseId}/enrollments`,
    { enabled: open, staleTime: 0, refetchOnMount: 'always' },
  );
  const students = useMemo(() => (data?.enrollments ?? []).filter((s) => s.is_active), [data]);

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState<MentionReason>('comment');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const start = initialReason ?? 'comment';
    setSearch('');
    setSelected(new Set(initialStudentIds ?? []));
    setReason(start);
    setMessage(TEMPLATE[start]);
    setBusy(false);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return students.filter(
      (s) => !needle || fullName(s).toLowerCase().includes(needle) || s.student_number.toLowerCase().includes(needle),
    );
  }, [students, search]);
  const allShownSelected = shown.length > 0 && shown.every((s) => selected.has(s.student_id));

  const changeReason = (next: MentionReason) => {
    // Swap the suggested wording, but never overwrite something the teacher wrote.
    setMessage((current) => (current.trim() === '' || current === TEMPLATE[reason] ? TEMPLATE[next] : current));
    setReason(next);
  };

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
      if (allShownSelected) shown.forEach((s) => next.delete(s.student_id));
      else shown.forEach((s) => next.add(s.student_id));
      return next;
    });

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const { data: result } = await api.post<{ created: number }>('/mentions', {
        item_type: itemType,
        item_id: itemId,
        student_ids: Array.from(selected),
        reason,
        message: message.trim(),
      });
      toast({
        title: result.created === 1 ? 'Note sent' : `Note sent to ${result.created} students`,
        description: 'They were notified.',
        variant: 'success',
      });
      refresh();
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const canSend = selected.size > 0 && message.trim().length > 0 && !busy;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Write a note</DialogTitle>
          <DialogDescription>
            About “{itemTitle}”. Each student you choose gets this note and is notified. Only they can read it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>What is it about?</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="group" aria-label="What is it about?">
              {(Object.keys(REASON_LABEL) as MentionReason[]).map((r) => (
                <Button
                  key={r}
                  type="button"
                  size="sm"
                  variant={reason === r ? 'default' : 'outline'}
                  aria-pressed={reason === r}
                  onClick={() => changeReason(r)}
                >
                  {REASON_LABEL[r]}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mn-search">Students</Label>
            <Input
              id="mn-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or student number"
            />
            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : isError ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">Couldn’t load the students of this course.</p>
                <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            ) : shown.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3 text-center">
                {search.trim() ? 'No matching students.' : 'No students are enrolled in this course yet.'}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{selected.size} chosen</p>
                  <Button type="button" variant="ghost" size="sm" onClick={toggleAllShown}>
                    {allShownSelected ? 'Clear shown' : 'Select all shown'}
                  </Button>
                </div>
                <div className="rounded-lg border border-input divide-y divide-input max-h-56 overflow-y-auto">
                  {shown.map((s) => (
                    <label
                      key={s.student_id}
                      htmlFor={`mn-${s.student_id}`}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40"
                    >
                      <Checkbox
                        id={`mn-${s.student_id}`}
                        className="h-5 w-5 border-2 border-muted-foreground data-[state=checked]:border-primary"
                        checked={selected.has(s.student_id)}
                        onCheckedChange={(checked) => toggle(s.student_id, checked === true)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium truncate">{fullName(s)}</span>
                        <span className="block text-xs text-muted-foreground">{s.student_number}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="mn-message">Your note</Label>
            <Textarea
              id="mn-message"
              rows={4}
              maxLength={MAX_LENGTH}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write what the student should know or do"
            />
            <p className="text-xs text-muted-foreground text-right">
              {message.length} / {MAX_LENGTH}
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={send} disabled={!canSend}>
            {busy
              ? 'Sending…'
              : selected.size > 1
                ? `Send to ${selected.size} students`
                : 'Send note'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================================================================================================
// The notes on an item (teacher)
// ================================================================================================

interface ManagerMention {
  id: string;
  student_id: string;
  student_number: string;
  student_name: string;
  reason: MentionReason;
  message: string;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  teacher_name: string;
}

interface MentionsPanelProps {
  itemType: MentionItemType;
  itemId: string;
  courseId: string;
  itemTitle: string;
  isPublished: boolean;
}

/** For the course's teacher: every note written on this item, with who has seen it and what is settled. */
export function MentionsPanel({ itemType, itemId, courseId, itemTitle, isPublished }: MentionsPanelProps) {
  const { toast } = useToast();
  const refresh = useRefreshMentions();
  const [writing, setWriting] = useState(false);
  const [deleting, setDeleting] = useState<ManagerMention | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading, isError, refetch } = useGet<{ mentions: ManagerMention[] }>(
    ['mentions', itemType, itemId],
    `/mentions?item_type=${itemType}&item_id=${itemId}`,
    { staleTime: 0, refetchOnMount: 'always' },
  );
  const mentions = data?.mentions ?? [];
  const open = mentions.filter((m) => !m.resolved_at).length;

  const setResolved = async (mention: ManagerMention, resolved: boolean) => {
    setError('');
    try {
      await api.patch(`/mentions/${mention.id}`, { resolved });
      refresh();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    await api.delete(`/mentions/${deleting.id}`);
    toast({ title: 'Note deleted', variant: 'success' });
    refresh();
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold">Notes to students</h2>
          <p className="text-sm text-muted-foreground">
            Comment on a student’s work, remind them of a missed deadline, or ask for a correction.
            {mentions.length > 0 && ` ${open} open · ${mentions.length - open} resolved.`}
          </p>
        </div>
        <Button
          onClick={() => setWriting(true)}
          disabled={!isPublished}
          title={isPublished ? undefined : 'Publish this first: students can only be mentioned on what they can see.'}
        >
          <MessageSquarePlus className="w-4 h-4 mr-2" /> Write a note
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card className="p-6 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Couldn’t load the notes.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      ) : mentions.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No notes yet.{!isPublished && ' Publish this first, then you can write to students about it.'}
        </Card>
      ) : (
        <div className="space-y-3">
          {mentions.map((m) => (
            <Card key={m.id} className={`p-4 space-y-3 ${m.resolved_at ? 'opacity-70' : ''}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{m.student_name || m.student_number}</span>
                    <span className="text-xs text-muted-foreground">{m.student_number}</span>
                    <ReasonBadge reason={m.reason} />
                    {m.resolved_at ? (
                      <Badge variant="success">Resolved</Badge>
                    ) : m.acknowledged_at ? (
                      <Badge variant="secondary">Seen</Badge>
                    ) : (
                      <Badge variant="warning">Not seen yet</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {m.teacher_name ? `${m.teacher_name} · ` : ''}
                    {formatDateTime(m.created_at)}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => setResolved(m, !m.resolved_at)}>
                    {m.resolved_at ? 'Reopen' : 'Mark resolved'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete the note to ${m.student_name || m.student_number}`}
                    onClick={() => setDeleting(m)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <p className="text-sm whitespace-pre-wrap break-words">{m.message}</p>
            </Card>
          ))}
        </div>
      )}

      <MentionDialog
        open={writing}
        onOpenChange={setWriting}
        itemType={itemType}
        itemId={itemId}
        courseId={courseId}
        itemTitle={itemTitle}
      />
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setDeleting(null)}
          title="Delete this note?"
          description={`The note to ${deleting.student_name || deleting.student_number} will be removed for good. Use this for a note written by mistake; to close a matter, mark it resolved instead.`}
          confirmLabel="Delete note"
          destructive
          onConfirm={confirmDelete}
        />
      )}
    </section>
  );
}

// ================================================================================================
// The notes written to me (student)
// ================================================================================================

interface StudentMention {
  id: string;
  reason: MentionReason;
  message: string;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  teacher_name: string;
}

/** For a student: the notes their teacher wrote to them about this item, highlighted at the top of the page. */
export function MyMentions({ itemType, itemId }: { itemType: MentionItemType; itemId: string }) {
  const refresh = useRefreshMentions();
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data } = useGet<{ mentions: StudentMention[] }>(
    ['mentions', itemType, itemId],
    `/mentions?item_type=${itemType}&item_id=${itemId}`,
    { staleTime: 0, refetchOnMount: 'always' },
  );
  const mentions = data?.mentions ?? [];
  if (mentions.length === 0) return null;

  const gotIt = async (id: string) => {
    setBusyId(id);
    setError('');
    try {
      await api.post(`/mentions/${id}/acknowledge`);
      refresh();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-3" aria-label="Notes from your teacher">
      <h2 className="text-xl font-bold">Notes from your teacher</h2>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {mentions.map((m) => (
        <div
          key={m.id}
          className={`rounded-lg border p-4 space-y-3 ${
            m.resolved_at
              ? 'border-input bg-card'
              : 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-100'
          }`}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <ReasonBadge reason={m.reason} />
              <span className="text-xs opacity-80">
                {m.teacher_name ? `${m.teacher_name} · ` : ''}
                {formatDateTime(m.created_at)}
              </span>
            </div>
            {m.resolved_at ? (
              <Badge variant="success">Resolved</Badge>
            ) : m.acknowledged_at ? (
              <Badge variant="secondary">You’ve seen this</Badge>
            ) : (
              <Button size="sm" onClick={() => gotIt(m.id)} disabled={busyId === m.id}>
                {busyId === m.id ? 'Saving…' : 'Got it'}
              </Button>
            )}
          </div>
          <p className="text-sm whitespace-pre-wrap break-words">{m.message}</p>
        </div>
      ))}
    </section>
  );
}
