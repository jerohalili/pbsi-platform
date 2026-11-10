import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from 'react-query';
import { BookOpen, Plus } from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import { useGet } from '@/hooks/useApi.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { CourseFormDialog } from '@/components/courses/CourseFormDialog.tsx';

interface Course {
  id: string;
  code: string;
  name: string;
  description: string | null;
  credits: number;
  teacher_id: string;
  teacher_first_name: string | null;
  teacher_last_name: string | null;
  is_mine: boolean;
}

export default function CoursesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const { data, isLoading, isError, refetch } = useGet<{ courses: Course[] }>(
    ['courses'],
    '/courses',
    // A student's list changes when a teacher enrolls or removes them, so don't serve it stale.
    { staleTime: 0, refetchOnMount: 'always' },
  );

  const isAdmin = user?.role === 'admin';
  const canCreate = isAdmin || user?.role === 'teacher';
  const courses = data?.courses ?? [];

  return (
    <div className="space-y-6">
      <div data-tour="courses-header" className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Courses</h1>
          <p className="text-muted-foreground">
            {canCreate ? 'Create and manage courses and their modules.' : 'Browse your courses and their modules.'}
          </p>
        </div>
        {canCreate && (
          <Button data-tour="courses-new" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4 mr-2" /> New Course
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card className="p-6 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Couldn’t load courses.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      ) : courses.length === 0 ? (
        <Card data-tour="courses-empty" className="p-10 text-center text-muted-foreground">
          <BookOpen className="w-8 h-8 mx-auto mb-3 opacity-60" />
          <p>{canCreate ? 'No courses yet.' : 'You’re not enrolled in any courses yet.'}</p>
          {canCreate ? (
            <p className="text-sm mt-1">Use “New Course” to create the first one.</p>
          ) : (
            <p className="text-sm mt-1">Your teacher or an administrator will add you to your courses.</p>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {courses.map((c, i) => (
            <Link key={c.id} to={`/courses/${c.id}`} data-tour={i === 0 ? 'courses-card' : undefined} className="block focus:outline-none focus:ring-2 focus:ring-ring rounded-xl">
              <Card className="p-5 h-full hover:border-primary/40 transition-colors">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <Badge variant="outline">{c.code}</Badge>
                  <div className="flex items-center gap-2">
                    {c.is_mine && <Badge variant="success">Your course</Badge>}
                    <span className="text-xs text-muted-foreground">
                      {c.credits} {c.credits === 1 ? 'credit' : 'credits'}
                    </span>
                  </div>
                </div>
                <h2 className="font-bold text-lg leading-snug">{c.name}</h2>
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2 min-h-[2.5rem]">
                  {c.description || 'No description.'}
                </p>
                <p className="text-sm mt-4">
                  <span className="text-muted-foreground">Teacher: </span>
                  {`${c.teacher_first_name ?? ''} ${c.teacher_last_name ?? ''}`.trim() || '—'}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <CourseFormDialog
        open={creating}
        onOpenChange={setCreating}
        mode="create"
        isAdmin={isAdmin}
        onSaved={(course) => {
          queryClient.invalidateQueries('courses');
          toast({ title: 'Course created', variant: 'success' });
          navigate(`/courses/${course.id}`);
        }}
      />
    </div>
  );
}
