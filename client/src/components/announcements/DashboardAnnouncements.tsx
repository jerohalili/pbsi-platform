import { Megaphone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useAuth from '@/hooks/useAuth.ts';
import useAnnouncements from '@/hooks/useAnnouncements.ts';
import { Card } from '@/components/ui/card.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { AnnouncementCard } from './AnnouncementCard.tsx';
import { isLiveNow } from '@/lib/announcements.ts';

const SHOWN = 5;

/** The latest live announcements for the dashboard. Urgent ones come first. */
export function DashboardAnnouncements() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useAnnouncements(Boolean(user));
  const canPost = user?.role === 'admin' || user?.role === 'teacher';

  const live = (data ?? []).filter((a) => isLiveNow(a));
  const sorted = [...live].sort((a, b) => Number(b.is_urgent) - Number(a.is_urgent));
  const shown = sorted.slice(0, SHOWN);

  return (
    <Card data-tour="dash-announcements" className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-bold text-site-text">
          <Megaphone className="h-4 w-4" aria-hidden="true" /> Announcements
        </h2>
        {canPost && (
          <button onClick={() => navigate('/announcements')} className="text-sm text-primary hover:underline">
            Manage
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-site-muted">Announcements are unavailable right now.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-site-muted">No announcements.</p>
      ) : (
        <div className="space-y-3">
          {shown.map((a) => (
            <AnnouncementCard key={a.id} announcement={a} />
          ))}
          {sorted.length > SHOWN && (
            <p className="text-xs text-site-muted">Showing the latest {SHOWN} of {sorted.length}.</p>
          )}
        </div>
      )}
    </Card>
  );
}
