import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from 'react-query';
import { ArrowLeft, Clock } from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import { useGet } from '@/hooks/useApi.ts';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { ConfirmDialog } from '@/components/users/ConfirmDialog.tsx';
import { QUESTION_TYPE_LABEL, type QuizItem, type QuizQuestion } from '@/components/quizzes/types.ts';

/** What POST /quiz-attempts/start answers. */
interface StartResponse {
  /** The quiz was already submitted (for example the time ran out while the student was away). */
  finished: boolean;
  attempt_id?: string;
  timed?: boolean;
  /** Seconds left according to the SERVER's clock, so reloading the page never gives more time. */
  remaining_seconds?: number | null;
  /** What the student had typed before (restored after a reload or on another device). */
  answers?: Record<string, string>;
}

/** How often the typed answers are saved while the student works. */
const AUTOSAVE_DELAY_MS = 4000;
/** If the automatic submit at zero fails (a dropped connection), try again this often. */
const AUTO_SUBMIT_RETRY_MS = 5000;

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function QuizTakePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const deadline = useRef<number | null>(null);
  const autoSubmitted = useRef(false);
  const submittedRef = useRef(false);
  // The clock starts on the server when the page asks to begin; nothing is shown before that.
  const [ready, setReady] = useState(false);
  const [startError, setStartError] = useState('');
  const [startAttempt, setStartAttempt] = useState(0);
  const startedRef = useRef(false);
  const lastSaved = useRef('');
  const nextAutoRetry = useRef(0);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const { data, isLoading, isError, refetch } = useGet<{ quiz: QuizItem; questions: QuizQuestion[] }>(
    ['quiz', id ?? ''],
    `/quizzes/${id}`,
    { enabled: !!id, refetchOnWindowFocus: false },
  );
  const quiz = data?.quiz;
  const questions = data?.questions ?? [];

  const answeredCount = questions.filter((q) => (answers[q.id] ?? '').trim() !== '').length;
  const unanswered = questions.length - answeredCount;

  /** Sends the answers. Throws when the server refuses so callers can show the message. */
  const doSubmit = async (auto = false): Promise<void> => {
    if (!quiz || submittedRef.current) return;
    setSubmitting(true);
    try {
      const { data: result } = await api.post<{ attempt: { id: string; auto_submitted: boolean } }>('/quiz-attempts', {
        quiz_id: quiz.id,
        answers,
        ...(auto ? { auto: true } : {}),
      });
      submittedRef.current = true;
      queryClient.invalidateQueries('quiz');
      queryClient.invalidateQueries('quizzes');
      if (result.attempt.auto_submitted) {
        toast({
          title: 'Time’s up',
          description: 'Your answers were submitted automatically because the time limit ended.',
        });
      }
      navigate(`/quiz-results/${result.attempt.id}`, { replace: true });
    } catch (err) {
      // Already taken (for example in another tab): go to the quiz page instead of a dead end.
      if ((err as { response?: { status?: number } })?.response?.status === 409) {
        toast({ title: getErrorMessage(err), variant: 'destructive' });
        queryClient.invalidateQueries('quiz');
        navigate(`/quizzes/${quiz.id}`, { replace: true });
        return;
      }
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  const submitDirect = async (auto = false) => {
    setSubmitError('');
    try {
      await doSubmit(auto);
    } catch (err) {
      setSubmitError(
        auto
          ? `Time is up, but your answers could not be sent (${getErrorMessage(err)}). Trying again… If this keeps failing, what was last saved is submitted for you automatically.`
          : getErrorMessage(err),
      );
      if (auto) {
        // Let the countdown try again shortly instead of giving up at the deadline.
        autoSubmitted.current = false;
        nextAutoRetry.current = Date.now() + AUTO_SUBMIT_RETRY_MS;
      }
    }
  };

  const onSubmitClick = () => {
    if (unanswered > 0) setConfirmOpen(true);
    else void submitDirect();
  };

  // Ask the server to start the clock, once. For a timed quiz it answers with the time that is really
  // left (the deadline is fixed on the server, so a reload or another device cannot restart it), the
  // answers saved so far, and, only now, the questions.
  useEffect(() => {
    if (!quiz || quiz.status === 'completed' || quiz.delivery === 'in_person' || startedRef.current) return;
    if (user && user.role !== 'student') return;
    startedRef.current = true;
    setStartError('');
    (async () => {
      try {
        const { data: started } = await api.post<StartResponse>('/quiz-attempts/start', { quiz_id: quiz.id });
        if (started.finished && started.attempt_id) {
          queryClient.invalidateQueries('quiz');
          queryClient.invalidateQueries('quizzes');
          toast({ title: 'This quiz is already submitted', description: 'The time limit had ended.' });
          navigate(`/quiz-results/${started.attempt_id}`, { replace: true });
          return;
        }
        if (started.timed && typeof started.remaining_seconds === 'number') {
          deadline.current = Date.now() + started.remaining_seconds * 1000;
          setRemaining(started.remaining_seconds);
          const saved = started.answers ?? {};
          lastSaved.current = JSON.stringify(saved);
          setAnswers((prev) => ({ ...saved, ...prev }));
          await refetch(); // the questions are only sent once the clock has started
        }
        setReady(true);
      } catch (err) {
        startedRef.current = false;
        setStartError(getErrorMessage(err));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz?.id, quiz?.status, user, startAttempt]);

  /** Saves what has been typed (timed quizzes only) so it survives a closed tab, and counts if time runs out. */
  const saveProgress = async (payload: Record<string, string>) => {
    if (!quiz?.time_limit_minutes || submittedRef.current) return;
    const json = JSON.stringify(payload);
    if (json === lastSaved.current) return;
    try {
      await api.put('/quiz-attempts/progress', { quiz_id: quiz.id, answers: payload });
      lastSaved.current = json;
    } catch {
      // Best effort: the next change tries again. A refusal means the time is over or it was submitted.
    }
  };

  // Every few seconds after the last change...
  useEffect(() => {
    if (!ready || submittedRef.current || !quiz?.time_limit_minutes) return;
    const timer = setTimeout(() => void saveProgress(answers), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, ready]);

  // ...and at once when the student leaves the page or switches app (phones suspend background tabs).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && ready) void saveProgress(answersRef.current);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, quiz?.id]);

  useEffect(() => {
    if (remaining === null) return;
    const timer = setInterval(() => {
      if (deadline.current === null) return;
      const left = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0 && !autoSubmitted.current && Date.now() >= nextAutoRetry.current) {
        autoSubmitted.current = true;
        void submitDirect(true);
      }
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining === null, answers]);

  const back = (
    <Link to={`/quizzes/${id}`} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="w-4 h-4 mr-1" /> Back to quiz
    </Link>
  );

  if (user && user.role !== 'student') {
    return (
      <div className="space-y-6">
        {back}
        <Card className="p-6 text-sm text-muted-foreground">Only students can take quizzes.</Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !quiz) {
    return (
      <div className="space-y-6">
        {back}
        <Card className="p-6 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Couldn’t load this quiz. It may not be available.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  // One attempt only: anyone who already finished goes straight to their result.
  // An in-person quiz has nothing to answer online: send the student to its page.
  if (quiz.delivery === 'in_person') return <Navigate to={`/quizzes/${quiz.id}`} replace />;

  if (quiz.status === 'completed' && quiz.attempt_id) {
    return <Navigate to={`/quiz-results/${quiz.attempt_id}`} replace />;
  }

  if (startError) {
    return (
      <div className="space-y-6">
        {back}
        <Card className="p-6 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">{startError}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              startedRef.current = false;
              setStartAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </Card>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const setAnswer = (questionId: string, value: string) =>
    setAnswers((prev) => ({ ...prev, [questionId]: value }));

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="sticky top-0 z-10 -mx-1 px-1 py-3 bg-background/95 backdrop-blur border-b border-input flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">{quiz.title}</h1>
          <p className="text-xs text-muted-foreground">
            {answeredCount} of {questions.length} answered
            {remaining !== null && ' · saved automatically'}
          </p>
        </div>
        {remaining !== null && (
          <div
            className={`flex items-center gap-2 font-mono text-lg ${remaining <= 60 ? 'text-destructive font-bold' : ''}`}
            aria-label="Time left"
          >
            <Clock className="w-5 h-5" /> {formatCountdown(remaining)}
          </div>
        )}
      </div>

      {questions.map((question, index) => (
        <Card key={question.id} className="p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{index + 1}.</span>
            <span>{QUESTION_TYPE_LABEL[question.type]}</span>
            <span>· {question.points} {question.points === 1 ? 'point' : 'points'}</span>
          </div>
          <p className="whitespace-pre-wrap break-words">{question.question_text}</p>
          {question.image_url && (
            <img src={question.image_url} alt="Picture for this question" className="max-h-72 w-auto max-w-full rounded-lg border border-input" loading="lazy" />
          )}

          {question.type === 'mcq' && (
            <div className="space-y-2" role="radiogroup" aria-label={`Question ${index + 1}`}>
              {(question.options ?? []).map((option) => (
                <label key={option} className="flex items-center gap-3 rounded-lg border border-input p-3 text-sm cursor-pointer hover:bg-accent">
                  <input
                    type="radio"
                    name={`q-${question.id}`}
                    checked={answers[question.id] === option}
                    onChange={() => setAnswer(question.id, option)}
                  />
                  {option}
                </label>
              ))}
            </div>
          )}

          {question.type === 'true_false' && (
            <div className="space-y-2" role="radiogroup" aria-label={`Question ${index + 1}`}>
              {(['true', 'false'] as const).map((value) => (
                <label key={value} className="flex items-center gap-3 rounded-lg border border-input p-3 text-sm cursor-pointer hover:bg-accent">
                  <input
                    type="radio"
                    name={`q-${question.id}`}
                    checked={answers[question.id] === value}
                    onChange={() => setAnswer(question.id, value)}
                  />
                  {value === 'true' ? 'True' : 'False'}
                </label>
              ))}
            </div>
          )}

          {question.type === 'short_answer' && (
            <Input
              aria-label={`Answer to question ${index + 1}`}
              placeholder="Type your answer"
              value={answers[question.id] ?? ''}
              onChange={(e) => setAnswer(question.id, e.target.value)}
            />
          )}
        </Card>
      ))}

      {submitError && <p className="text-sm text-destructive">{submitError}</p>}

      <div className="flex items-center gap-4 pb-8">
        <Button onClick={onSubmitClick} disabled={submitting || questions.length === 0}>
          {submitting ? 'Submitting…' : 'Submit quiz'}
        </Button>
        <p className="text-sm text-muted-foreground">You can’t change your answers after submitting.</p>
      </div>

      {confirmOpen && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirmOpen(false)}
          title="Submit with unanswered questions?"
          description={`You haven’t answered ${unanswered} ${unanswered === 1 ? 'question' : 'questions'}. Unanswered questions score zero.`}
          confirmLabel="Submit anyway"
          onConfirm={() => doSubmit()}
        />
      )}
    </div>
  );
}
