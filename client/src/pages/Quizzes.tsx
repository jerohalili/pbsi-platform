import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, HelpCircle } from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import { useGet } from '@/hooks/useApi.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx';
import { formatTimeLimit, type QuizItem } from '@/components/quizzes/types.ts';

interface CourseOption {
  id: string;
  code: string;
  name: string;
}

const selectClass =
  'flex h-10 items-center rounded-md border border-input bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export default function QuizzesPage() {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';
  const [courseId, setCourseId] = useState('');

  const { data: courseData } = useGet<{ courses: CourseOption[] }>(['courses'], '/courses');
  const { data, isLoading, isError, refetch } = useGet<{ quizzes: QuizItem[] }>(
    ['quizzes', 'list', courseId],
    courseId ? `/quizzes?course_id=${courseId}` : '/quizzes',
    { keepPreviousData: true, staleTime: 0, refetchOnMount: 'always' },
  );

  const courses = courseData?.courses ?? [];
  const quizzes = data?.quizzes ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Quizzes</h1>
          <p className="text-muted-foreground">
            {isStudent
              ? 'Take your quizzes and see your results.'
              : 'Review your quizzes and how students did. Create new quizzes from a course page.'}
          </p>
        </div>
        <select className={selectClass} value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label="Filter by course">
          <option value="">All courses</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} · {c.name}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card className="p-6 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Couldn’t load quizzes.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      ) : quizzes.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <HelpCircle className="w-8 h-8 mx-auto mb-3 opacity-60" />
          <p>No quizzes yet.</p>
        </Card>
      ) : (
        <div className="rounded-xl border border-input bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quiz</TableHead>
                <TableHead className="w-36">Questions</TableHead>
                <TableHead className="w-32">Time</TableHead>
                {isStudent ? (
                  <TableHead className="w-48">Your result</TableHead>
                ) : (
                  <>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-40">Taken</TableHead>
                    <TableHead className="w-28">
                      <span className="sr-only">Open</span>
                    </TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {quizzes.map((q) => (
                <TableRow key={q.id}>
                  <TableCell>
                    {(!isStudent && q.can_manage) ? (
                      <span className="font-medium">{q.title}</span>
                    ) : (
                      <Link to={`/quizzes/${q.id}`} className="font-medium hover:underline">
                        {q.title}
                      </Link>
                    )}
                    <div className="text-sm text-muted-foreground">{q.course_code} · {q.course_name}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {q.question_count} · {q.total_points} pts
                  </TableCell>
                  <TableCell className="text-sm">{formatTimeLimit(q.time_limit_minutes)}</TableCell>
                  {isStudent ? (
                    <TableCell>
                      {q.status === 'completed' && q.attempt_id ? (
                        <Link to={`/quiz-results/${q.attempt_id}`} className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                          <Badge variant="success">Completed</Badge> {q.my_score}%
                        </Link>
                      ) : (
                        <Button asChild size="sm">
                          <Link to={`/quizzes/${q.id}`}>Take quiz</Link>
                        </Button>
                      )}
                    </TableCell>
                  ) : (
                    <>
                      <TableCell>
                        <Badge variant={q.is_published ? 'success' : 'outline'}>{q.is_published ? 'Published' : 'Draft'}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {(!isStudent && q.can_manage)
                          ? `${q.attempt_count ?? 0}${q.average_score !== null ? ` · avg ${q.average_score}%` : ''}`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {(!isStudent && q.can_manage) && (
                          <Button asChild size="sm" aria-label={`Open quiz ${q.title}`}>
                            <Link to={`/quizzes/${q.id}`}>
                              Open <ArrowRight className="w-4 h-4 ml-2" />
                            </Link>
                          </Button>
                        )}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
