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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import api from '@/lib/api.ts';
import { FILE_RULES, checkFile, sendFile } from '@/lib/upload.ts';
import { FilePicker } from '@/components/common/FilePicker.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { getErrorMessage } from '@/lib/errors.ts';
import { localInputToIso, toLocalInputValue } from '@/lib/utils.ts';
import type { AssignmentItem } from './types.ts';

interface AssignmentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  /** Required when creating: the module the assignment belongs to. */
  moduleId?: string;
  /** Available modules for selection when creating from the assignments section. */
  modules?: { id: string; title: string }[];
  assignment?: AssignmentItem | null;
  onSaved: (assignment: { id: string }) => void;
}

export function AssignmentFormDialog({
  open,
  onOpenChange,
  mode,
  moduleId,
  modules,
  assignment,
  onSaved,
}: AssignmentFormDialogProps) {
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [maxScore, setMaxScore] = useState('100');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [selectedModuleId, setSelectedModuleId] = useState<string | undefined>(moduleId);
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    const editing = mode === 'edit' && assignment;
    setTitle(editing ? assignment.title : '');
    setInstructions(editing ? (assignment.instructions ?? '') : '');
    setDueDate(editing ? toLocalInputValue(assignment.due_date) : '');
    setMaxScore(editing ? String(assignment.max_score) : '100');
    setAttachmentUrl(editing ? (assignment.attachment_url ?? '') : '');
    setSelectedModuleId(editing ? undefined : moduleId);
    setFile(null);
    setRemoveFile(false);
    setProgress(0);
    setBusy(false);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, assignment, moduleId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (file) {
      const problem = checkFile(file, FILE_RULES.document);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setBusy(true);
    const payload = {
      title: title.trim(),
      instructions: instructions.trim(),
      due_date: localInputToIso(dueDate),
      max_score: Number(maxScore),
      attachment_url: attachmentUrl.trim(),
    };
    try {
      const { data } =
        mode === 'create' || !assignment
          ? await api.post<{ assignment: { id: string } }>('/assignments', { ...payload, module_id: selectedModuleId })
          : await api.patch<{ assignment: { id: string } }>(`/assignments/${assignment.id}`, payload);
      // The assignment is saved first; its material file is attached to the saved assignment.
      try {
        if (file) {
          await sendFile('put', `/assignments/${data.assignment.id}/attachment`, file, {}, setProgress);
        } else if (removeFile && assignment?.has_attachment_file) {
          await api.delete(`/assignments/${data.assignment.id}/attachment`);
        }
      } catch (fileErr) {
        // Do not keep the dialog open: retrying would create the assignment a second time.
        onSaved(data.assignment);
        onOpenChange(false);
        toast({
          title: 'Assignment saved, but the file wasn’t uploaded',
          description: `${getErrorMessage(fileErr)} Edit the assignment to try again.`,
          variant: 'destructive',
        });
        return;
      }
      onSaved(data.assignment);
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
          <DialogTitle>{mode === 'create' ? 'New assignment' : 'Edit assignment'}</DialogTitle>
          <DialogDescription>
            Students hand in a file or a link to their work. You can attach one material file and/or a link.
            {mode === 'create' && ' New assignments start as drafts: students can’t see them until you publish.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'create' && !moduleId && modules && modules.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="af-module">Module</Label>
              <Select
                value={selectedModuleId ?? ''}
                onValueChange={(val) => setSelectedModuleId(val)}
              >
                <SelectTrigger id="af-module">
                  <SelectValue placeholder="Select a module" />
                </SelectTrigger>
                <SelectContent>
                  {modules.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="af-title">Title</Label>
            <Input id="af-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="af-instructions">Instructions (optional)</Label>
            <Textarea id="af-instructions" rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="af-due">Due date</Label>
              <Input id="af-due" type="datetime-local" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="af-max">Maximum score</Label>
              <Input id="af-max" type="number" min={1} max={1000} step="any" required value={maxScore} onChange={(e) => setMaxScore(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="af-attach">Material link (optional)</Label>
            <Input id="af-attach" type="url" placeholder="https://…" value={attachmentUrl} onChange={(e) => setAttachmentUrl(e.target.value)} />
          </div>

          {mode === 'edit' && assignment?.has_attachment_file && !file && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-input p-3 text-sm">
              <span className="min-w-0 truncate">
                Current file: <span className="font-medium">{assignment.attachment_name ?? 'material'}</span>
                {removeFile && <span className="ml-2 text-destructive">(will be removed)</span>}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => setRemoveFile((v) => !v)} disabled={busy}>
                {removeFile ? 'Keep' : 'Remove'}
              </Button>
            </div>
          )}
          <FilePicker
            label={assignment?.has_attachment_file ? 'Replace material file (optional)' : 'Material file (optional)'}
            rule={FILE_RULES.document}
            file={file}
            onChange={(next) => {
              setFile(next);
              if (next) setRemoveFile(false);
            }}
            disabled={busy}
          />
          {busy && file && <p className="text-xs text-muted-foreground">Uploading file… {progress}%</p>}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="destructive" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : mode === 'create' ? 'Create assignment' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
