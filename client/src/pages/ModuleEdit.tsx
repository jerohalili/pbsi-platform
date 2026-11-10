import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from 'react-query';
import { ArrowLeft } from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import { useGet } from '@/hooks/useApi.ts';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import type { ModuleFormValues } from '@/components/courses/ModuleFormDialog.tsx';
import { ModuleContentManager } from '@/components/courses/ModuleContentManager.tsx';

interface Course {
  id: string;
  code: string;
  name: string;
  is_mine: boolean;
}

export default function ModuleEditPage() {
  const { courseId, moduleId } = useParams<{ courseId: string; moduleId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useGet<{ course: Course; modules: ModuleFormValues[] }>(
    ['course', courseId ?? ''],
    `/courses/${courseId}`,
    { enabled: !!courseId },
  );

  const course = data?.course;
  const module = data?.modules.find((m) => m.id === moduleId);
  const isAdmin = user?.role === 'admin';
  const canEdit = !!course && (isAdmin || (user?.role === 'teacher' && course.is_mine));

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Fill the form once per module, so a background refetch never overwrites what is being typed.
  useEffect(() => {
    if (!module) return;
    setTitle(module.title);
    setDescription(module.rich_description ?? '');
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module?.id]);

  const courseHref = `/courses/${courseId}`;

  const back = (
    <Link to={courseHref} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="w-4 h-4 mr-1" /> {course ? `${course.code} · ${course.name}` : 'Course'}
    </Link>
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!module) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/modules/${module.id}`, {
        title: title.trim(),
        rich_description: description.trim(),
      });
      queryClient.invalidateQueries('course');
      queryClient.invalidateQueries('courses');
      toast({ title: 'Module updated', variant: 'success' });
      navigate(courseHref);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        {back}
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !course) {
    return (
      <div className="space-y-6">
        {back}
        <Card className="p-6 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Couldn’t load this course. It may no longer exist.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  if (!module) {
    return (
      <div className="space-y-6">
        {back}
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">This module doesn’t exist in this course.</p>
        </Card>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="space-y-6">
        {back}
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">You don’t have permission to edit this module.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div data-tour="me-header" className="space-y-2">
        {back}
        <h1 className="text-2xl font-bold">Edit module</h1>
        <p className="text-sm text-muted-foreground">
          A module is one unit of the course: lesson notes plus content blocks (text, video, images, files,
          links) for students to study.
        </p>
      </div>

      <Card data-tour="me-details" className="p-5">
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="me-title">Title</Label>
            <Input id="me-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="me-desc">Lesson notes (optional)</Label>
            <Textarea id="me-desc" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button type="button" variant="destructive" onClick={() => navigate(courseHref)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Card>

      <Card data-tour="me-blocks" className="p-5">
        <ModuleContentManager moduleId={module.id} />
      </Card>
    </div>
  );
}
