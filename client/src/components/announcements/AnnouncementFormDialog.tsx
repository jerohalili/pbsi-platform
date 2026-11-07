import { useEffect, useState } from 'react';
import { useQueryClient } from 'react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import {
  ANNOUNCEMENT_MESSAGE_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  fromLocalInput,
  toLocalInput,
  type Announcement,
  type AnnouncementAudience,
} from '@/lib/announcements.ts';

export interface CourseChoice {
  id: string;
  code: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null: write a new announcement. Otherwise edit this one (the audience cannot change). */
  editing: Announcement | null;
  role: 'admin' | 'teacher';
  /** The courses this person may post to (a teacher: their own; an admin: all). */
  courses: CourseChoice[];
}

const selectClass =
  'flex h-10 w-full items-center rounded-md border border-input bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export function AnnouncementFormDialog({ open, onOpenChange, editing, role, courses }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<AnnouncementAudience>('course');
  const [courseId, setCourseId] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ?? '');
    setMessage(editing?.message ?? '');
    setAudience(editing?.audience ?? (role === 'admin' ? 'all' : 'course'));
    setCourseId(editing?.course_id ?? courses[0]?.id ?? '');
    setUrgent(editing?.is_urgent ?? false);
    setExpires(toLocalInput(editing?.expires_at ?? null));
    setError('');
    setBusy(false);
    // Only when the dialog opens: refreshing the course list must not wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const needsCourse = audience === 'course';
  const canSubmit = title.trim() !== '' && message.trim() !== '' && (!needsCourse || courseId !== '');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const expiresAt = fromLocalInput(expires);
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      setError('The expiry must be in the future.');
      setBusy(false);
      return;
    }
    try {
      if (editing) {
        await api.patch(`/announcements/${editing.id}`, {
          title,
          message,
          is_urgent: urgent,
          expires_at: expiresAt, // null removes the expiry
        });
        toast({ title: 'Announcement updated', description: 'Editing does not notify anyone again.' });
      } else {
        const { data } = await api.post<{ recipients: number }>('/announcements', {
          title,
          message,
          audience,
          ...(needsCourse ? { course_id: courseId } : {}),
          is_urgent: urgent,
          ...(expiresAt ? { expires_at: expiresAt } : {}),
        });
        toast({ title: 'Announcement posted', description: `${data.recipients} ${data.recipients === 1 ? 'person was' : 'people were'} notified.` });
      }
      await queryClient.invalidateQueries(['announcements']);
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit announcement' : 'New announcement'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'The audience cannot be changed. Post a new announcement for a different audience.'
              : role === 'teacher'
                ? 'Sent to the students enrolled in one of your courses, with a notification.'
                : 'Everyone in the audience gets a notification.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {!editing && role === 'admin' && (
            <div className="space-y-2">
              <Label htmlFor="an-audience">Audience</Label>
              <select id="an-audience" className={selectClass} value={audience} onChange={(e) => setAudience(e.target.value as AnnouncementAudience)}>
                <option value="all">Everyone</option>
                <option value="teachers">All teachers</option>
                <option value="students">All students</option>
                <option value="course">One course</option>
              </select>
            </div>
          )}
          {!editing && needsCourse && (
            <div className="space-y-2">
              <Label htmlFor="an-course">Course</Label>
              <select id="an-course" className={selectClass} value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={courses.length === 0}>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
              {courses.length === 0 && <p className="text-xs text-destructive">You have no courses to post to.</p>}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="an-title">Title</Label>
            <Input id="an-title" required maxLength={ANNOUNCEMENT_TITLE_MAX} placeholder="e.g. Classes suspended on Monday" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="an-message">Message</Label>
            <Textarea id="an-message" required rows={6} maxLength={ANNOUNCEMENT_MESSAGE_MAX} value={message} onChange={(e) => setMessage(e.target.value)} />
            <p className="text-right text-xs text-muted-foreground">
              {message.length}/{ANNOUNCEMENT_MESSAGE_MAX}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="an-expires">Hide after (optional)</Label>
            <Input id="an-expires" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
            <p className="text-xs text-muted-foreground">After this time it leaves the dashboards and the banner. Leave empty to keep it until you delete it.</p>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="an-urgent" checked={urgent} onCheckedChange={(v) => setUrgent(v === true)} className="mt-1" />
            <Label htmlFor="an-urgent" className="leading-snug">
              Urgent: show as a red banner on every page until it expires
            </Label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="destructive" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !canSubmit}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Post announcement'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
