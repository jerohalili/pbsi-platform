import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ClipboardList } from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import { useGet } from '@/hooks/useApi.ts';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.tsx';
import { AssignmentStatusBadge } from '@/components/assignments/AssignmentStatusBadge.tsx';
import type { AssignmentItem } from '@/components/assignments/types.ts';
import { formatDateTime } from '@/lib/utils.ts';

interface CourseOption {
  id: string;
  code: string;
  name: string;
}

const selectClass =
  'flex h-10 items-center rounded-md border border-input bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export default function AssignmentsPage() {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';
  const [courseId, setCourseId] = useState('');

  const { data: courseData } = useGet<{ courses: CourseOption[] }>(['courses'], '/courses');
  const { data, isLoading, isError, refetch } = useGet<{ assignments: AssignmentItem[] }>(
    ['assignments', 'list', courseId],
    courseId ? `/assignments?course_id=${courseId}` : '/assignments',
    { keepPreviousData: true },
  );

  const courses = courseData?.courses ?? [];
  const assignments = data?.assignments ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Assignments</h1>
          <p className="text-muted-foreground">
            {isStudent
              ? 'Hand in your work and see your grades.'
              : 'Review submissions and grade your students’ work. Add assignments from a course’s modules.'}
          </p>
        </div>
        <select
          className={selectClass}
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          aria-label="Filter by course"
        >
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
          <p className="text-sm text-muted-foreground">Couldn’t load assignments.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      ) : assignments.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <ClipboardList className="w-8 h-8 mx-auto mb-3 opacity-60" />
          <p>No assignments yet.</p>
        </Card>
      ) : (
        <div className="rounded-xl border border-input bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assignment</TableHead>
                <TableHead className="w-48">Due</TableHead>
                {isStudent ? (
                  <>
                    <TableHead className="w-48">Status</TableHead>
                    <TableHead className="w-28">Score</TableHead>
                    <TableHead className="w-28">
                      <span className="sr-only">Open</span>
                    </TableHead>
                  </>
                ) : (
                  <>
                    <TableHead className="w-24">Max</TableHead>
                    <TableHead className="w-40">Submissions</TableHead>
                    <TableHead className="w-28">
                      <span className="sr-only">Open</span>
                    </TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    {!isStudent && a.can_manage ? (
                      <span className="font-medium">{a.title}</span>
                    ) : (
                      <Link to={`/assignments/${a.id}`} className="font-medium hover:underline">
                        {a.title}
                      </Link>
                    )}
                    <div className="text-sm text-muted-foreground">
                      {a.course_code} · {a.module_title}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{formatDateTime(a.due_date)}</TableCell>
                  {isStudent ? (
                    <>
                      <TableCell>
                        <AssignmentStatusBadge status={a.status} isLate={a.is_late} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {a.grade !== null ? `${a.grade} / ${a.max_score}` : '—'}
                      </TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="outline" aria-label={`Open assignment ${a.title}`}>
                          <Link to={`/assignments/${a.id}`}>
                            {a.status === 'not_submitted' || a.status === 'overdue' ? 'Submit' : 'View'}
                          </Link>
                        </Button>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="text-sm">{a.max_score}</TableCell>
                      <TableCell className="text-sm">
                        {!isStudent && a.can_manage ? `${a.submitted_count ?? 0} handed in · ${a.graded_count ?? 0} graded` : '—'}
                      </TableCell>
                      <TableCell>
                        {!isStudent && a.can_manage && (
                          <Button asChild size="sm" aria-label={`Open assignment ${a.title}`}>
                            <Link to={`/assignments/${a.id}`}>
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
