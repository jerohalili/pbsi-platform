import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import useAnnouncements from '@/hooks/useAnnouncements.ts';
import { audienceLabel, isLiveNow } from '@/lib/announcements.ts';

const MAX_SHOWN = 2;

/**
 * Urgent announcements, shown under the top bar on every page until they expire. Not dismissible:
 * "urgent" means the sender wants it seen. The full text is on the dashboard.
 */
export function AnnouncementBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data } = useAnnouncements(Boolean(user));

  // Re-check expiry every 30 s, so a banner left open on a screen goes away by itself.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const urgent = (data ?? []).filter((a) => a.is_urgent && isLiveNow(a, now));
  if (urgent.length === 0) return null;

  const shown = urgent.slice(0, MAX_SHOWN);
  const onDashboard = location.pathname === '/dashboard';

  return (
    <div role="alert" className="sticky top-16 z-40 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-destructive backdrop-blur">
      <div className="space-y-1">
        {shown.map((a) => (
          <div key={a.id} className="flex items-start gap-2 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1">
              <span className="font-semibold">{a.title}</span>
              <span className="text-foreground/70"> · {audienceLabel(a)}</span>
              <span className="line-clamp-2 break-words text-foreground">{a.message}</span>
            </p>
          </div>
        ))}
      </div>
      {(urgent.length > MAX_SHOWN || !onDashboard) && (
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="mt-1 text-xs font-medium underline underline-offset-2"
        >
          {urgent.length > MAX_SHOWN ? `Read all ${urgent.length} urgent announcements` : 'Read the full announcement'}
        </button>
      )}
    </div>
  );
}
