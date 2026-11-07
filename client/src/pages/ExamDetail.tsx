import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from 'react-query';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import { useGet } from '@/hooks/useApi.ts';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { useToast } from '@/components/ui/toast.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { ConfirmDialog } from '@/components/users/ConfirmDialog.tsx';
import { ExamFormDialog } from '@/components/exams/ExamFormDialog.tsx';
import type { ExamItem } from '@/components/exams/types.ts';
import { InPersonBadge, InPersonInfo, MyScoreCard } from '@/components/coursework/shared.tsx';
import { ScoreSheet } from '@/components/coursework/ScoreSheet.tsx';
import { MentionsPanel, MyMentions } from '@/components/coursework/mentions.tsx';

export default function ExamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');

  const isStudent = user?.role === 'student';
  const { data, isLoading, isError, refetch } = useGet<{ exam: ExamItem }>(['exam', id ?? ''], `/exams/${id}`, {
    enabled: !!id,
  });
  const exam = data?.exam;
  const canManage = !isStudent && !!exam?.can_manage;

  const refreshAll = () => {
    for (const key of ['exam', 'exams', 'scores', 'grades', 'dashboard-stats']) queryClient.invalidateQueries(key);
  };

  const back = (
    <Link
      to="/coursework?type=exam"
      className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="w-4 h-4 mr-1" /> Coursework
    </Link>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (isError || !exam) {
    return (
      <div className="space-y-6">
        {back}
        <Card className="p-6 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Couldn’t load this exam. It may no longer exist.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  const togglePublish = async () => {
    setPublishing(true);
    setPublishError('');
    try {
      await api.patch(`/exams/${exam.id}`, { is_published: !exam.is_published });
      toast({
        title: exam.is_published ? 'Exam unpublished' : 'Exam announced',
        description: exam.is_published ? undefined : 'Enrolled students were notified.',
        variant: 'success',
      });
      refreshAll();
    } catch (err) {
      setPublishError(getErrorMessage(err));
    } finally {
      setPublishing(false);
    }
  };

  const confirmDelete = async () => {
    await api.delete(`/exams/${exam.id}`);
    toast({ title: 'Exam deleted', variant: 'success' });
    refreshAll();
    navigate('/coursework?type=exam', { replace: true });
  };

  const scored = (exam.scored_count ?? 0) > 0;

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        {back}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">{exam.course_code}</Badge>
              <Badge variant="secondary">Exam</Badge>
              <InPersonBadge />
              {canManage && (
                <Badge variant={exam.is_published ? 'success' : 'warning'}>{exam.is_published ? 'Published' : 'Draft'}</Badge>
              )}
            </div>
            <h1 className="text-2xl font-bold">{exam.title}</h1>
            <p className="text-sm text-muted-foreground">{exam.course_name}</p>
          </div>
          {canManage && (
            <div className="flex gap-2 shrink-0 flex-wrap">
              <Button
                onClick={togglePublish}
                disabled={publishing || (exam.is_published && scored)}
                variant={exam.is_published ? 'outline' : 'default'}
                title={
                  exam.is_published && scored
                    ? 'Scores have already been recorded, so this exam can no longer be unpublished.'
                    : undefined
                }
              >
                {exam.is_published ? 'Unpublish' : 'Publish'}
              </Button>
              <Button onClick={() => setEditing(true)}>
                <Pencil className="w-4 h-4 mr-2" /> Edit
              </Button>
              <Button variant="destructive" onClick={() => setDeleting(true)}>
                <Trash2 className="w-4 h-4 mr-2" /> Delete
              </Button>
            </div>
          )}
        </div>
        {publishError && <p className="text-sm text-destructive">{publishError}</p>}
        {canManage && !exam.is_published && (
          <p className="text-sm text-muted-foreground">
            This exam is a draft. Students can’t see it, and won’t be notified, until you publish it.
          </p>
        )}
      </div>

      <InPersonInfo
        whenLabel="Exam date"
        when={exam.exam_at}
        room={exam.room}
        durationMinutes={exam.duration_minutes}
        maxScore={exam.max_score}
        details={exam.details}
      />

      {isStudent && <MyMentions itemType="exam" itemId={exam.id} />}

      {isStudent && (
        <section className="space-y-4">
          <h2 className="text-xl font-bold">Your score</h2>
          <MyScoreCard
            status={exam.status}
            score={exam.my_score}
            max={exam.max_score}
            percent={exam.my_percent}
            feedback={exam.my_feedback}
            gradedAt={exam.my_graded_at}
          />
        </section>
      )}

      {canManage && (
        <section className="space-y-4">
          <h2 className="text-xl font-bold">Scores</h2>
          <p className="text-sm text-muted-foreground">
            Enter each student’s score after checking their paper. Students see their own score and comment, and are
            notified when it appears.
          </p>
          <ScoreSheet type="exam" itemId={exam.id} />
        </section>
      )}

      {canManage && (
        <MentionsPanel
          itemType="exam"
          itemId={exam.id}
          courseId={exam.course_id}
          itemTitle={exam.title}
          isPublished={exam.is_published}
        />
      )}

      <ExamFormDialog
        open={editing}
        onOpenChange={setEditing}
        mode="edit"
        exam={exam}
        onSaved={() => {
          toast({ title: 'Exam updated', variant: 'success' });
          refreshAll();
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this exam?"
        description="The exam and every score entered for it will be deleted, and those grades disappear from the Grades page. This can’t be undone."
        confirmLabel="Delete exam"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
