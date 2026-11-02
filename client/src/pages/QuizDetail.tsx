import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from 'react-query';
import { ArrowLeft, Check, Lock, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import { useGet } from '@/hooks/useApi.ts';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { formatDateTime } from '@/lib/utils.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx';
import { QuizFormDialog } from '@/components/quizzes/QuizFormDialog.tsx';
import { QuestionFormDialog } from '@/components/quizzes/QuestionFormDialog.tsx';
import {
  QUESTION_TYPE_LABEL,
  formatCorrectAnswer,
  formatTimeLimit,
  type QuizItem,
  type QuizQuestion,
} from '@/components/quizzes/types.ts';
import { ConfirmDialog } from '@/components/users/ConfirmDialog.tsx';

interface AttemptRow {
  student_id: string;
  student_number: string;
  first_name: string | null;
  last_name: string | null;
  attempt_id: string | null;
  score: number | null;
  submitted_at: string | null;
  /** The time limit ended and the server submitted what the student had. */
  auto_submitted?: boolean;
}

export default function QuizDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editingQuiz, setEditingQuiz] = useState(false);
  const [questionDialog, setQuestionDialog] = useState<{ question: QuizQuestion | null } | null>(null);
  const [deleteQuestionTarget, setDeleteQuestionTarget] = useState<QuizQuestion | null>(null);
  const [deletingQuiz, setDeletingQuiz] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');

  const isStudent = user?.role === 'student';

  const { data, isLoading, isError, refetch } = useGet<{ quiz: QuizItem; questions: QuizQuestion[] }>(
    ['quiz', id ?? ''],
    `/quizzes/${id}`,
    { enabled: !!id },
  );
  const quiz = data?.quiz;
  const questions = data?.questions ?? [];
  const canManage = !isStudent && !!quiz?.can_manage;

  const { data: attemptData, isLoading: attemptsLoading } = useGet<{ attempts: AttemptRow[] }>(
    ['quiz-attempts', id ?? ''],
    `/quiz-attempts?quiz_id=${id}`,
    { enabled: !!id && canManage },
  );
  const attempts = attemptData?.attempts ?? [];

  const refreshAll = () => {
    queryClient.invalidateQueries('quiz');
    queryClient.invalidateQueries('quizzes');
    queryClient.invalidateQueries('quiz-attempts');
  };

  const back = (
    <Link to="/quizzes" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="w-4 h-4 mr-1" /> Quizzes
    </Link>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {back}
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-32 w-full" />
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

  const locked = canManage && (quiz.attempt_count ?? 0) > 0;
  const takenCount = attempts.filter((a) => a.attempt_id).length;

  const togglePublish = async () => {
    setPublishing(true);
    setPublishError('');
    try {
      await api.patch(`/quizzes/${quiz.id}`, { is_published: !quiz.is_published });
      toast({ title: quiz.is_published ? 'Quiz unpublished' : 'Quiz published', variant: 'success' });
      refreshAll();
    } catch (err) {
      setPublishError(getErrorMessage(err));
    } finally {
      setPublishing(false);
    }
  };

  const confirmDeleteQuiz = async () => {
    await api.delete(`/quizzes/${quiz.id}`);
    toast({ title: 'Quiz deleted', variant: 'success' });
    queryClient.invalidateQueries('quizzes');
    navigate('/quizzes');
    setDeletingQuiz(false);
  };

  const deleteQuestion = async () => {
    if (!deleteQuestionTarget) return;
    await api.delete(`/quizzes/${quiz.id}/questions/${deleteQuestionTarget.id}`);
    toast({ title: 'Question deleted', variant: 'success' });
    refreshAll();
    setDeleteQuestionTarget(null);
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        {back}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">{quiz.course_code}</Badge>
              {canManage && <Badge variant={quiz.is_published ? 'success' : 'warning'}>{quiz.is_published ? 'Published' : 'Draft'}</Badge>}
            </div>
            <h1 className="text-2xl font-bold">{quiz.title}</h1>
            <p className="text-sm text-muted-foreground">
              {quiz.question_count} {quiz.question_count === 1 ? 'question' : 'questions'} · {quiz.total_points} points ·{' '}
              {formatTimeLimit(quiz.time_limit_minutes)}
            </p>
          </div>
          {canManage && (
            <div className="flex gap-2 shrink-0 flex-wrap">
              <Button onClick={togglePublish} disabled={publishing} variant={quiz.is_published ? 'outline' : 'default'}>
                {quiz.is_published ? 'Unpublish' : 'Publish'}
              </Button>
              <Button onClick={() => setEditingQuiz(true)}>
                <Pencil className="w-4 h-4 mr-2" /> Edit
              </Button>
              {canManage && (
                <Button variant="destructive" onClick={() => setDeletingQuiz(true)}>
                  <Trash2 className="w-4 h-4 mr-2" /> Delete
                </Button>
              )}
            </div>
          )}
        </div>
        {publishError && <p className="text-sm text-destructive">{publishError}</p>}
      </div>

      {isStudent && (
        <Card className="p-6 space-y-4">
          {quiz.status === 'completed' && quiz.attempt_id ? (
            <>
              <p className="text-lg font-semibold">Your score: {quiz.my_score}%</p>
              <p className="text-sm text-muted-foreground">Taken {formatDateTime(quiz.my_submitted_at)}. Each quiz can only be taken once.</p>
              <Button asChild>
                <Link to={`/quiz-results/${quiz.attempt_id}`}>View result</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm">
                You can take this quiz <strong>once</strong>.{' '}
                {quiz.time_limit_minutes
                  ? `You will have ${quiz.time_limit_minutes} minutes. The timer starts when you press Start and keeps running even if you close the page. Your answers are saved as you go and submitted automatically when time runs out.`
                  : 'There is no time limit.'}
              </p>
              <Button asChild>
                <Link to={`/quizzes/${quiz.id}/take`}>
                  <Play className="w-4 h-4 mr-2" /> Start quiz
                </Link>
              </Button>
            </>
          )}
        </Card>
      )}

      {!isStudent && !canManage && (
        <Card className="p-6 text-sm text-muted-foreground">
          Only this course’s teacher (or an administrator) can edit this quiz and see its results.
        </Card>
      )}

      {canManage && (
        <>
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">Questions</h2>
              <Button onClick={() => setQuestionDialog({ question: null })} disabled={locked}>
                <Plus className="w-4 h-4 mr-2" /> Add question
              </Button>
            </div>

            {locked && (
              <Card className="p-4 flex items-start gap-3 text-sm text-muted-foreground">
                <Lock className="w-4 h-4 mt-0.5 shrink-0" />
                Students have already taken this quiz, so its questions are locked to keep the results fair.
              </Card>
            )}

            {questions.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                <p>No questions yet.</p>
                <p className="text-sm mt-1">Add at least one question, then publish the quiz.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {questions.map((question, index) => (
                  <Card key={question.id} className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
                          <span className="font-semibold text-foreground">{index + 1}.</span>
                          <Badge variant="outline">{QUESTION_TYPE_LABEL[question.type]}</Badge>
                          <span>{question.points} {question.points === 1 ? 'point' : 'points'}</span>
                        </div>
                        <p className="whitespace-pre-wrap break-words">{question.question_text}</p>
                        {question.image_url && (
                          <img src={question.image_url} alt="Picture for this question" className="max-h-72 w-auto max-w-full rounded-lg border border-input" loading="lazy" />
                        )}
                        {question.type === 'mcq' && (
                          <ul className="space-y-1 text-sm">
                            {(question.options ?? []).map((option) => (
                              <li key={option} className="flex items-center gap-2">
                                {option === question.correct_answer ? (
                                  <Check className="w-4 h-4 text-green-600 shrink-0" aria-label="Correct answer" />
                                ) : (
                                  <span className="w-4 shrink-0" />
                                )}
                                <span className={option === question.correct_answer ? 'font-medium' : 'text-muted-foreground'}>{option}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {question.type !== 'mcq' && question.correct_answer !== undefined && (
                          <p className="text-sm">
                            <span className="text-muted-foreground">Correct answer: </span>
                            <span className="font-medium">{formatCorrectAnswer(question.type, question.correct_answer)}</span>
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0">
                        <Button variant="ghost" size="icon" aria-label={`Edit question ${index + 1}`} title="Edit" disabled={locked} onClick={() => setQuestionDialog({ question })}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`Delete question ${index + 1}`} title="Delete" disabled={locked} className="text-destructive hover:text-destructive" onClick={() => setDeleteQuestionTarget(question)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-bold">Results</h2>
            {attemptsLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {takenCount} taken · {attempts.length - takenCount} not taken
                  {quiz.average_score !== null ? ` · class average ${quiz.average_score}%` : ''}
                </p>
                <div className="rounded-xl border border-input bg-card overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead className="w-28">Score</TableHead>
                        <TableHead className="w-52">Taken</TableHead>
                        <TableHead className="w-28 text-right">Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attempts.map((a) => {
                        const name = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || a.student_number;
                        return (
                          <TableRow key={a.student_id}>
                            <TableCell>
                              <div className="font-medium">{name}</div>
                              <div className="text-xs text-muted-foreground">{a.student_number}</div>
                            </TableCell>
                            <TableCell className="text-sm">
                              {a.attempt_id ? (
                                <span className="inline-flex items-center gap-2 flex-wrap">
                                  {a.score}%
                                  {a.auto_submitted && (
                                    <Badge variant="warning" className="whitespace-nowrap" title="Submitted automatically when the time limit ended">
                                      Auto-submitted
                                    </Badge>
                                  )}
                                </span>
                              ) : (
                                <Badge variant="outline">Not taken</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">{a.submitted_at ? formatDateTime(a.submitted_at) : '—'}</TableCell>
                            <TableCell className="text-right">
                              {a.attempt_id && (
                                <Button asChild variant="outline" size="sm">
                                  <Link to={`/quiz-results/${a.attempt_id}`} aria-label={`View result for ${name}`}>View</Link>
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </section>
        </>
      )}

      <QuizFormDialog
        open={editingQuiz}
        onOpenChange={setEditingQuiz}
        mode="edit"
        quiz={quiz}
        onSaved={() => {
          refreshAll();
          toast({ title: 'Quiz updated', variant: 'success' });
        }}
      />

      <QuestionFormDialog
        open={questionDialog !== null}
        onOpenChange={(open) => !open && setQuestionDialog(null)}
        quizId={quiz.id}
        question={questionDialog?.question ?? null}
        onSaved={() => {
          refreshAll();
          toast({ title: questionDialog?.question ? 'Question updated' : 'Question added', variant: 'success' });
        }}
      />

      {deleteQuestionTarget && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleteQuestionTarget(null)}
          title="Delete this question?"
          description="This question will be removed from the quiz."
          confirmLabel="Delete"
          destructive
          onConfirm={deleteQuestion}
        />
      )}

      {deletingQuiz && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeletingQuiz(false)}
          title="Delete this quiz?"
          description={`“${quiz.title}” and all its questions and attempts will be removed permanently.`}
          confirmLabel="Delete"
          destructive
          onConfirm={confirmDeleteQuiz}
        />
      )}
    </div>
  );
}
