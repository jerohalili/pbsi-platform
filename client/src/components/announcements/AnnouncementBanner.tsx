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

/** Dismissed banners are remembered per person on this device (a shared school computer must not carry one person's choice to the next). */
const dismissedKey = (userId: string) => `pbsi:dismissedBanners:${userId}`;

function readDismissed(userId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(dismissedKey(userId)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeDismissed(userId: string, ids: string[]): void {
  try {
    localStorage.setItem(dismissedKey(userId), JSON.stringify(ids));
  } catch {
    // Storage can be full or blocked; the banner is then simply hidden until the page reloads.
  }
}

/**
 * Urgent announcements, shown under the top bar on every page until they expire. Each one can be
 * closed with its X (this hides only the banner on this device; the announcement stays on the
 * dashboard). "Read the full announcement" opens the whole text here, without leaving the page.
 */
export function AnnouncementBanner() {
  const { user } = useAuth();
  const { data } = useAnnouncements(Boolean(user));
  const userId = user?.id;

  const [dismissed, setDismissed] = useState<string[]>([]);
  const [readOpen, setReadOpen] = useState(false);

  // Load this person's dismissed list when they sign in (or a different person signs in).
  useEffect(() => {
    setDismissed(userId ? readDismissed(userId) : []);
  }, [userId]);

  // Re-check expiry every 30 s, so a banner left open on a screen goes away by itself.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const dismiss = (id: string) => {
    if (!userId) return;
    // Keep only ids that still exist, so the saved list cannot grow forever.
    const next = Array.from(new Set([...dismissed, id])).filter((x) => (data ?? []).some((a) => a.id === x));
    setDismissed(next);
    writeDismissed(userId, next);
  };

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
