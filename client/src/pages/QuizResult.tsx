import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { useGet } from '@/hooks/useApi.ts';
import { formatDateTime } from '@/lib/utils.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { QUESTION_TYPE_LABEL, formatCorrectAnswer, type QuestionType } from '@/components/quizzes/types.ts';

interface AttemptSummary {
  id: string;
  quiz_id: string;
  quiz_title: string;
  course_code: string;
  course_name: string;
  score: number;
  earned_points: number;
  total_points: number;
  submitted_at: string;
  /** True when the time limit ended and the server submitted what the student had. */
  auto_submitted: boolean;
  /** Only teachers/admins see whose attempt it is. */
  student_name: string | null;
}

interface QuestionResult {
  question_id: string;
  question_text: string;
  image_url?: string | null;
  type: QuestionType;
  options: string[] | null;
  points: number;
  your_answer: string;
  correct_answer: string;
  is_correct: boolean;
  points_earned: number;
}

export default function QuizResultPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const { data, isLoading, isError, refetch } = useGet<{ attempt: AttemptSummary; results: QuestionResult[] }>(
    ['quiz-attempt', attemptId ?? ''],
    `/quiz-attempts/${attemptId}`,
    { enabled: !!attemptId },
  );

  const attempt = data?.attempt;
  const results = data?.results ?? [];

  const back = (
    <Link to={attempt ? `/quizzes/${attempt.quiz_id}` : '/quizzes'} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="w-4 h-4 mr-1" /> Back to quiz
    </Link>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !attempt) {
    return (
      <div className="space-y-6">
        {back}
        <Card className="p-6 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Couldn’t load this result.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  const correctCount = results.filter((r) => r.is_correct).length;

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="space-y-4">
        {back}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{attempt.course_code}</Badge>
            {attempt.student_name && <span className="text-sm text-muted-foreground">{attempt.student_name}</span>}
          </div>
          <h1 className="text-2xl font-bold">{attempt.quiz_title}</h1>
          <p className="text-sm text-muted-foreground">Taken {formatDateTime(attempt.submitted_at)}</p>
        </div>
        {attempt.auto_submitted && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-100 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-100"
          >
            <Clock className="w-5 h-5 shrink-0 mt-0.5" />
            <p>
              {attempt.student_name
                ? 'This quiz was submitted automatically because the time limit ended. Only the answers saved before the deadline were graded.'
                : 'Time ran out, so your quiz was submitted automatically at the deadline. Only the answers you had entered by then were graded; questions you hadn’t answered scored zero.'}
            </p>
          </div>
        )}
        <Card className="p-6">
          <p className="text-3xl font-bold">{attempt.score}%</p>
          <p className="text-sm text-muted-foreground mt-1">
            {attempt.earned_points} of {attempt.total_points} points · {correctCount} of {results.length} questions correct
          </p>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">Your answers</h2>
        {results.map((result, index) => (
          <Card key={result.question_id} className="p-5 space-y-3">
            <div className="flex items-start gap-3">
              {result.is_correct ? (
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" aria-label="Correct" />
              ) : (
                <XCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" aria-label="Incorrect" />
              )}
              <div className="space-y-2 min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{index + 1}.</span>
                  <span>{QUESTION_TYPE_LABEL[result.type]}</span>
                  <span>
                    · {result.points_earned} / {result.points} {result.points === 1 ? 'point' : 'points'}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words">{result.question_text}</p>
                {result.image_url && (
                  <img src={result.image_url} alt="Picture for this question" className="max-h-72 w-auto max-w-full rounded-lg border border-input" loading="lazy" />
                )}
                <p className="text-sm">
                  <span className="text-muted-foreground">Your answer: </span>
                  {result.your_answer.trim() === '' ? (
                    <span className="italic text-muted-foreground">No answer</span>
                  ) : (
                    <span className={result.is_correct ? 'font-medium text-green-700' : 'font-medium text-destructive'}>
                      {formatCorrectAnswer(result.type === 'short_answer' ? 'mcq' : result.type, result.your_answer)}
                    </span>
                  )}
                </p>
                {!result.is_correct && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Correct answer: </span>
                    <span className="font-medium">{formatCorrectAnswer(result.type, result.correct_answer)}</span>
                  </p>
                )}
              </div>
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}
