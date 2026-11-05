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
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { localInputToIso, toLocalInputValue } from '@/lib/utils.ts';
import type { ExamItem } from './types.ts';

interface ExamFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  /** Required when creating. */
  courseId?: string;
  exam?: ExamItem | null;
  onSaved: (exam: { id: string }) => void;
}

export function ExamFormDialog({ open, onOpenChange, mode, courseId, exam, onSaved }: ExamFormDialogProps) {
  const [title, setTitle] = useState('');
  const [examAt, setExamAt] = useState('');
  const [duration, setDuration] = useState('');
  const [room, setRoom] = useState('');
  const [maxScore, setMaxScore] = useState('100');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const editing = mode === 'edit' && exam;
    setTitle(editing ? exam.title : '');
    setExamAt(editing ? toLocalInputValue(exam.exam_at) : '');
    setDuration(editing && exam.duration_minutes ? String(exam.duration_minutes) : '');
    setRoom(editing ? (exam.room ?? '') : '');
    setMaxScore(editing ? String(exam.max_score) : '100');
    setDetails(editing ? (exam.details ?? '') : '');
    setBusy(false);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, exam]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const payload = {
      title: title.trim(),
      exam_at: localInputToIso(examAt),
      duration_minutes: duration.trim() === '' ? null : Number(duration),
      // Blank clears the field when editing.
      room: room.trim(),
      details: details.trim(),
      max_score: Number(maxScore),
    };
    try {
      const { data } =
        mode === 'create' || !exam
          ? await api.post<{ exam: { id: string } }>('/exams', { ...payload, course_id: courseId })
          : await api.patch<{ exam: { id: string } }>(`/exams/${exam.id}`, payload);
      onSaved(data.exam);
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
          <DialogTitle>{mode === 'create' ? 'New exam' : 'Edit exam'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Exams are announced here and taken in person. After checking the papers you enter each student’s score. The exam starts as a draft until you publish it.'
              : 'Students are notified again if you change the date, time or room of a published exam.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ef-title">Title</Label>
            <Input id="ef-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ef-at">Date and time</Label>
              <Input id="ef-at" type="datetime-local" required value={examAt} onChange={(e) => setExamAt(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ef-room">Room (optional)</Label>
              <Input id="ef-room" maxLength={100} value={room} onChange={(e) => setRoom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ef-duration">Duration in minutes (optional)</Label>
              <Input
                id="ef-duration"
                type="number"
                min={1}
                max={720}
                step={1}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ef-max">Maximum score</Label>
              <Input id="ef-max" type="number" min={1} max={1000} step="any" required value={maxScore} onChange={(e) => setMaxScore(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ef-details">Coverage and reminders (optional)</Label>
            <Textarea
              id="ef-details"
              rows={5}
              maxLength={10000}
              placeholder="Topics covered, what to bring, rules…"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="destructive" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : mode === 'create' ? 'Create exam' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
