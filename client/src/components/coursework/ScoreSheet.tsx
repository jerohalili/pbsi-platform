import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from 'react-query';
import { Save } from 'lucide-react';
import { useGet } from '@/hooks/useApi.ts';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx';

export type ScoredType = 'assignment' | 'quiz' | 'exam';

interface SheetRow {
  student_id: string;
  student_number: string;
  first_name: string | null;
  last_name: string | null;
  is_active: boolean;
  score: number | null;
  feedback: string | null;
  graded_at: string | null;
}

interface Sheet {
  item: { type: ScoredType; id: string; title: string; max_score: number; is_published: boolean };
  rows: SheetRow[];
}

interface Draft {
  score: string;
  feedback: string;
}

const fullName = (r: SheetRow) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || 'Unnamed student';

/** Why a typed score cannot be saved, or '' when it is fine (or blank). */
function scoreProblem(value: string, max: number): string {
  if (value.trim() === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Enter a number';
  if (n < 0) return 'Can’t be negative';
  if (n > max) return `Maximum is ${max}`;
  return '';
}

interface ScoreSheetProps {
  type: ScoredType;
  itemId: string;
}

/**
 * The teacher's score sheet for an exam or an in-person assignment / quiz: one row per enrolled
 * student, scores typed in after checking the work face to face. Only the rows that changed are sent;
 * a blank score clears that student's score.
 */
export function ScoreSheet({ type, itemId }: ScoreSheetProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const tableRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError, refetch } = useGet<Sheet>(['scores', type, itemId], `/scores/${type}/${itemId}`, {
    staleTime: 0,
    refetchOnMount: 'always',
  });
  // Memoised: a fresh [] on every render would make the effect below reset the draft in a loop.
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const max = data?.item.max_score ?? 0;
  const published = data?.item.is_published ?? false;

  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // What the server holds, as the strings shown in the boxes.
  const saved = useMemo(() => {
    const map: Record<string, Draft> = {};
    for (const r of rows) map[r.student_id] = { score: r.score === null ? '' : String(r.score), feedback: r.feedback ?? '' };
    return map;
  }, [rows]);

  // Start from the server's copy whenever it (re)loads.
  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const dirtyIds = rows
    .map((r) => r.student_id)
    .filter((id) => draft[id] && (draft[id].score !== saved[id]?.score || draft[id].feedback !== saved[id]?.feedback));
  const problems: Record<string, string> = {};
  for (const id of dirtyIds) problems[id] = scoreProblem(draft[id].score, max);
  const hasProblem = dirtyIds.some((id) => problems[id]);
  const scoredCount = rows.filter((r) => (draft[r.student_id]?.score ?? '').trim() !== '').length;

  const setField = (id: string, field: keyof Draft, value: string) =>
    setDraft((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { score: '', feedback: '' }), [field]: value } }));

  /** Enter moves down to the next student's score box, like a spreadsheet. */
  const onScoreKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const boxes = Array.from(tableRef.current?.querySelectorAll<HTMLInputElement>('input[data-score-box]') ?? []);
    const next = boxes[boxes.indexOf(e.currentTarget) + 1];
    next?.focus();
    next?.select();
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const scores = dirtyIds.map((id) => {
        const d = draft[id];
        const blank = d.score.trim() === '';
        return { student_id: id, score: blank ? null : Number(d.score), feedback: blank ? null : d.feedback.trim() || null };
      });
      const { data: result } = await api.put<{ saved: number; cleared: number }>(`/scores/${type}/${itemId}`, { scores });
      const parts = [
        result.saved > 0 ? `${result.saved} saved` : null,
        result.cleared > 0 ? `${result.cleared} cleared` : null,
      ].filter(Boolean);
      toast({
        title: 'Scores saved',
        description: parts.length > 0 ? `${parts.join(' · ')}. Students were notified of new scores.` : 'No changes.',
        variant: 'success',
      });
      await refetch();
      for (const key of ['exam', 'exams', 'assignment', 'assignments', 'quiz', 'quizzes', 'grades', 'dashboard-stats']) {
        queryClient.invalidateQueries(key);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return (
      <Card className="p-6 flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Couldn’t load the score sheet.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {scoredCount} of {rows.length} scored · maximum {max} points
        </p>
        <div className="flex items-center gap-2">
          {dirtyIds.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(saved)} disabled={busy}>
              Discard changes
            </Button>
          )}
          <Button type="button" onClick={save} disabled={busy || dirtyIds.length === 0 || hasProblem || !published}>
            <Save className="w-4 h-4 mr-2" />
            {busy ? 'Saving…' : dirtyIds.length > 0 ? `Save ${dirtyIds.length} ${dirtyIds.length === 1 ? 'change' : 'changes'}` : 'Save scores'}
          </Button>
        </div>
      </div>

      {!published && (
        <p className="text-sm text-muted-foreground rounded-md border border-input p-3">
          Publish this first. Students can only be given scores for what they can see.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No students are enrolled in this course yet. Add them from the course page.
        </Card>
      ) : (
        <div ref={tableRef} className="rounded-xl border border-input bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead className="w-44">Score (max {max})</TableHead>
                <TableHead className="min-w-56">Comment (optional)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const d = draft[r.student_id] ?? { score: '', feedback: '' };
                const problem = problems[r.student_id];
                return (
                  <TableRow key={r.student_id}>
                    <TableCell>
                      <p className="font-medium">
                        {fullName(r)}
                        {!r.is_active && (
                          <Badge variant="warning" className="ml-2 align-middle">
                            Deactivated
                          </Badge>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">{r.student_number}</p>
                    </TableCell>
                    <TableCell>
                      <Input
                        data-score-box
                        inputMode="decimal"
                        value={d.score}
                        onChange={(e) => setField(r.student_id, 'score', e.target.value)}
                        onKeyDown={onScoreKeyDown}
                        disabled={busy || !published}
                        aria-label={`Score for ${fullName(r)}`}
                        aria-invalid={!!problem}
                        placeholder="—"
                      />
                      {problem && <p className="text-xs text-destructive mt-1">{problem}</p>}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={d.feedback}
                        onChange={(e) => setField(r.student_id, 'feedback', e.target.value)}
                        disabled={busy || !published || d.score.trim() === ''}
                        maxLength={2000}
                        aria-label={`Comment for ${fullName(r)}`}
                        placeholder={d.score.trim() === '' ? 'Enter a score first' : 'Shown to the student'}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
