import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { DeliveryToggle } from '@/components/coursework/DeliveryToggle.tsx';
import { localInputToIso, toLocalInputValue } from '@/lib/utils.ts';
import type { Delivery } from '@/components/assignments/types.ts';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import type { QuizItem } from './types.ts';

interface QuizFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  /** Required when creating. */
  courseId?: string;
  quiz?: QuizItem | null;
  onSaved: (quiz: { id: string }) => void;
}

export function QuizFormDialog({ open, onOpenChange, mode, courseId, quiz, onSaved }: QuizFormDialogProps) {
  const [title, setTitle] = useState('');
  const [timeLimit, setTimeLimit] = useState('');
  const [delivery, setDelivery] = useState<Delivery>('online');
  const [scheduledAt, setScheduledAt] = useState('');
  const [room, setRoom] = useState('');
  const [maxScore, setMaxScore] = useState('100');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const editing = mode === 'edit' && quiz;
    setTitle(editing ? quiz.title : '');
    setTimeLimit(editing && quiz.time_limit_minutes ? String(quiz.time_limit_minutes) : '');
    setDelivery(editing ? quiz.delivery : 'online');
    setScheduledAt(editing && quiz.scheduled_at ? toLocalInputValue(quiz.scheduled_at) : '');
    setRoom(editing ? (quiz.room ?? '') : '');
    setMaxScore(editing ? String(quiz.max_score) : '100');
    setDetails(editing ? (quiz.details ?? '') : '');
    setBusy(false);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, quiz]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    // An in-person quiz has a date, a room and a maximum score instead of a time limit.
    const payload =
      delivery === 'in_person'
        ? {
            title: title.trim(),
            scheduled_at: localInputToIso(scheduledAt),
            room: room.trim(),
            max_score: Number(maxScore),
            details: details.trim(),
          }
        : {
            title: title.trim(),
            // Blank = no time limit.
            time_limit_minutes: timeLimit.trim() === '' ? null : Number(timeLimit),
            details: details.trim(),
          };
    try {
      const { data } =
        mode === 'create' || !quiz
          ? await api.post<{ quiz: { id: string } }>('/quizzes', { ...payload, delivery, course_id: courseId })
          : await api.patch<{ quiz: { id: string } }>(`/quizzes/${quiz.id}`, payload);
      onSaved(data.quiz);
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New quiz' : 'Edit quiz'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? delivery === 'in_person'
                ? 'Announced here and taken face to face. You enter each score afterwards. It starts as a draft until you publish it.'
                : 'The quiz starts as a draft. Add questions, then publish it for students.'
              : delivery === 'in_person'
                ? 'Change the title, date, room, maximum score or details.'
                : 'Change the title, the time limit or the instructions.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'create' && (
            <DeliveryToggle
              value={delivery}
              onChange={setDelivery}
              hints={{
                online: 'Students answer questions on the site and it is graded automatically.',
                in_person: 'Only announced here (date, time, room). You check it face to face and enter the scores.',
              }}
            />
          )}
          <div className="space-y-2">
            <Label htmlFor="qf-title">Title</Label>
            <Input id="qf-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          {delivery === 'in_person' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="qf-at">Date and time</Label>
                <Input id="qf-at" type="datetime-local" required value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qf-room">Room (optional)</Label>
                <Input id="qf-room" maxLength={100} value={room} onChange={(e) => setRoom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qf-max">Maximum score</Label>
                <Input id="qf-max" type="number" min={1} max={1000} step="any" required value={maxScore} onChange={(e) => setMaxScore(e.target.value)} />
              </div>
            </div>
          ) : (
          <div className="space-y-2">
            <Label htmlFor="qf-time">Time limit in minutes (optional)</Label>
            <Input
              id="qf-time"
              type="number"
              min={1}
              max={600}
              step={1}
              placeholder="No time limit"
              value={timeLimit}
              onChange={(e) => setTimeLimit(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Students see a countdown and the quiz is submitted automatically when it ends.
            </p>
          </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="qf-details">{delivery === 'in_person' ? 'Coverage and reminders (optional)' : 'Instructions (optional)'}</Label>
            <Textarea id="qf-details" rows={3} maxLength={5000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="destructive" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : mode === 'create' ? 'Create quiz' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
