import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQueryClient } from 'react-query';
import { Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import { useGet } from '@/hooks/useApi.ts';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { ConfirmDialog } from '@/components/users/ConfirmDialog.tsx';
import { AnnouncementCard } from '@/components/announcements/AnnouncementCard.tsx';
import { AnnouncementFormDialog, type CourseChoice } from '@/components/announcements/AnnouncementFormDialog.tsx';
import api from '@/lib/api.ts';
import { ANNOUNCEMENTS_HISTORY_KEY, type Announcement } from '@/lib/announcements.ts';

type Filter = 'live' | 'expired';

interface CourseRow extends CourseChoice {
  is_mine: boolean;
}

/** Admins and teachers: write announcements, and see, edit or delete the ones they may manage. */
export default function AnnouncementsPage() {
  const { user } = useAuth();
  const role = user?.role === 'admin' ? 'admin' : 'teacher';
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>('live');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);

  const { data, isLoading, isError, refetch } = useGet<{ announcements: Announcement[] }>(
    ANNOUNCEMENTS_HISTORY_KEY,
    '/announcements?history=true',
    { enabled: !!user, staleTime: 0, refetchOnMount: 'always' },
  );
  const { data: courseData } = useGet<{ courses: CourseRow[] }>(['courses'], '/courses', { enabled: !!user });
  // A teacher may post only to their own courses; an admin to any.
  const courses = (courseData?.courses ?? []).filter((c) => role === 'admin' || c.is_mine);

  const all = data?.announcements ?? [];
  const shown = all.filter((a) => (filter === 'expired' ? a.is_expired : !a.is_expired));

  const remove = async () => {
    if (!deleting) return;
    await api.delete(`/announcements/${deleting.id}`);
    await queryClient.invalidateQueries(['announcements']);
    toast({ title: 'Announcement deleted' });
  };

  // Students have no announcements page (they read them on the dashboard); the server refuses them anyway.
  if (user?.role === 'student') return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div data-tour="an-header">
          <h1 className="text-2xl font-bold">Announcements</h1>
          <p className="text-muted-foreground">
            {role === 'admin'
              ? 'Post to everyone, to teachers, to students, or to one course.'
              : 'Post to the students of your courses. Admins can see everything you post.'}
          </p>
        </div>
        <Button
          data-tour="an-new"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> New announcement
        </Button>
      </div>

      <div data-tour="an-tabs" className="flex gap-1" role="tablist" aria-label="Announcement list">
        {(['live', 'expired'] as Filter[]).map((f) => (
          <Button key={f} role="tab" aria-selected={filter === f} variant={filter === f ? 'default' : 'ghost'} size="sm" onClick={() => setFilter(f)}>
            {f === 'live' ? 'Live' : 'Expired'} ({all.filter((a) => (f === 'expired' ? a.is_expired : !a.is_expired)).length})
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card className="flex items-center justify-between gap-4 p-6">
          <p className="text-sm text-muted-foreground">Couldn't load announcements.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </Card>
      ) : shown.length === 0 ? (
        <Card data-tour="an-empty" className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
          <Megaphone className="h-8 w-8" aria-hidden="true" />
          <p>{filter === 'live' ? 'No live announcements.' : 'No expired announcements.'}</p>
        </Card>
      ) : (
        <div data-tour="an-list" className="space-y-3">
          {shown.map((a, i) => (
            <AnnouncementCard
              key={a.id}
              announcement={a}
              actions={
                a.can_manage ? (
                  <div data-tour={i === 0 ? 'an-actions' : undefined} className="flex">
                    <Button variant="ghost" size="sm" aria-label={`Edit ${a.title}`} onClick={() => { setEditing(a); setFormOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="destructive" size="sm" aria-label={`Delete ${a.title}`} onClick={() => setDeleting(a)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      <AnnouncementFormDialog open={formOpen} onOpenChange={setFormOpen} editing={editing} role={role} courses={courses} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this announcement?"
        description="It disappears for everyone. People who were already notified keep their notification."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </div>
  );
}
