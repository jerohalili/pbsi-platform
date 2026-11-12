import { useEffect, useState } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import useAuth from '@/hooks/useAuth.ts';
import useAnnouncements from '@/hooks/useAnnouncements.ts';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { audienceLabel, isLiveNow } from '@/lib/announcements.ts';
import { AnnouncementCard } from './AnnouncementCard.tsx';

const MAX_SHOWN = 2;

/**
 * Urgent announcements, shown under the top bar on every page until they expire. Each one can be
 * closed with its X. That choice lives only in memory: it holds while the person moves between
 * pages, and a refresh or signing in again brings the banner back (the announcement itself also
 * stays on the dashboard). "Read the full announcement" opens the whole text here, without
 * leaving the page.
 */
export function AnnouncementBanner() {
  const { user } = useAuth();
  const { data } = useAnnouncements(Boolean(user));
  const userId = user?.id;

  const [dismissed, setDismissed] = useState<string[]>([]);
  const [readOpen, setReadOpen] = useState(false);

  // Signing in again (or a different person signing in) starts with nothing dismissed.
  useEffect(() => {
    setDismissed([]);
  }, [userId]);

  // Re-check expiry every 30 s, so a banner left open on a screen goes away by itself.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const dismiss = (id: string) => setDismissed((current) => (current.includes(id) ? current : [...current, id]));

  const urgent = (data ?? []).filter((a) => a.is_urgent && isLiveNow(a, now) && !dismissed.includes(a.id));
  if (urgent.length === 0) return null;

  const shown = urgent.slice(0, MAX_SHOWN);

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
            <button
              type="button"
              onClick={() => dismiss(a.id)}
              aria-label={`Dismiss announcement: ${a.title}`}
              className="-my-1 shrink-0 rounded p-1.5 hover:bg-destructive/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setReadOpen(true)}
        className="mt-1 text-xs font-medium underline underline-offset-2"
      >
        {urgent.length > 1 ? `Read all ${urgent.length} urgent announcements` : 'Read the full announcement'}
      </button>

      <Dialog open={readOpen} onOpenChange={setReadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Urgent {urgent.length > 1 ? 'announcements' : 'announcement'}</DialogTitle>
            <DialogDescription>The full text, exactly as it was posted.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {urgent.map((a) => (
              <AnnouncementCard key={a.id} announcement={a} />
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReadOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
