import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ArrowRight, CheckCircle2, Lock, MessageCircle, Pin, Plus } from 'lucide-react';
import { useGet } from '@/hooks/useApi.ts';
import { Button } from '@/components/ui/button.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { AuthorLine } from '@/components/discussions/AuthorLine.tsx';
import { NewThreadDialog } from '@/components/discussions/NewThreadDialog.tsx';
import type { ThreadSummary } from '@/components/discussions/types.ts';

interface CourseOption {
  id: string;
  code: string;
  name: string;
}

const selectClass =
  'flex h-10 items-center rounded-md border border-input bg-field px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export default function DiscussionsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [creating, setCreating] = useState(false);

  const {
    data: courseData,
    isLoading: loadingCourses,
    isError: coursesFailed,
    refetch: refetchCourses,
  } = useGet<{ courses: CourseOption[] }>(['courses'], '/courses');
  const courses = courseData?.courses ?? [];

  // The course lives in the address (?course=…), so a discussion list can be shared and survives a refresh.
  const requested = searchParams.get('course') ?? '';
  const course = courses.find((c) => c.id === requested) ?? courses[0];
  const courseId = course?.id ?? '';

  const { data, isLoading, isError, refetch } = useGet<{ threads: ThreadSummary[] }>(
    ['discussions', 'course', courseId],
    `/discussions/${courseId}`,
    { enabled: courseId !== '', keepPreviousData: true },
  );
  const threads = data?.threads ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div data-tour="dc-header">
          <h1 className="text-2xl font-bold">Discussions</h1>
          <p className="text-muted-foreground">Ask questions, share ideas and help each other learn.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            data-tour="dc-course"
            className={selectClass}
            value={courseId}
            onChange={(e) => setSearchParams({ course: e.target.value })}
            aria-label="Course"
            disabled={courses.length === 0}
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
          <Button data-tour="dc-new" onClick={() => setCreating(true)} disabled={!courseId}>
            <Plus className="w-4 h-4 mr-2" /> New discussion
          </Button>
        </div>
      </div>

      {loadingCourses || (courseId !== '' && isLoading) ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : coursesFailed || isError ? (
        <Card className="p-6 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Couldn’t load discussions.</p>
          <Button variant="outline" size="sm" onClick={() => (coursesFailed ? refetchCourses() : refetch())}>
            Retry
          </Button>
        </Card>
      ) : courses.length === 0 ? (
        <Card data-tour="dc-empty" className="p-10 text-center text-muted-foreground">
          <MessageCircle className="w-8 h-8 mx-auto mb-3 opacity-60" />
          <p>There are no courses yet, so there is nothing to discuss.</p>
        </Card>
      ) : threads.length === 0 ? (
        <Card data-tour="dc-empty" className="p-10 text-center text-muted-foreground">
          <MessageCircle className="w-8 h-8 mx-auto mb-3 opacity-60" />
          <p className="font-medium text-foreground">No discussions in this course yet</p>
          <p className="text-sm mt-1">Got a question? Someone else is probably wondering the same thing.</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {threads.map((t, i) => (
            <li key={t.id}>
              <Card data-tour={i === 0 ? 'dc-thread' : undefined} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {t.is_pinned && (
                        <Badge variant="outline">
                          <Pin className="w-3 h-3 mr-1" /> Pinned
                        </Badge>
                      )}
                      {t.is_answered && (
                        <Badge variant="success">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Answered
                        </Badge>
                      )}
                      {t.is_locked && (
                        <Badge variant="secondary">
                          <Lock className="w-3 h-3 mr-1" /> Locked
                        </Badge>
                      )}
                    </div>
                    <h2 className="font-semibold break-words">{t.title}</h2>
                    {t.preview && (
                      <p className="text-sm text-muted-foreground line-clamp-2 break-words">{t.preview}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-sm text-muted-foreground">
                    <div className="flex items-center justify-end gap-1">
                      <MessageCircle className="w-4 h-4" />
                      <span>{t.reply_count}</span>
                    </div>
                    <div className="text-xs">
                      {t.reply_count > 0
                        ? `active ${formatDistanceToNow(new Date(t.last_activity_at), { addSuffix: true })}`
                        : 'no replies'}
                    </div>
                    <Button asChild size="sm" className="mt-2" aria-label={`Open discussion ${t.title}`}>
                      <Link to={`/discussions/${t.id}`}>
                        Open <ArrowRight className="w-4 h-4 ml-2" />
                      </Link>
                    </Button>
                  </div>
                </div>
                <AuthorLine person={t} createdAt={t.created_at} editedAt={t.edited_at} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      {course && (
        <NewThreadDialog
          open={creating}
          onOpenChange={setCreating}
          courseId={course.id}
          courseLabel={`${course.code} · ${course.name}`}
          onCreated={(id) => navigate(`/discussions/${id}`)}
        />
      )}
    </div>
  );
}
