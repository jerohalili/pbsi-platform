import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge.tsx';
import { audienceLabel, type Announcement } from '@/lib/announcements.ts';

function timeAgo(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : formatDistanceToNow(d, { addSuffix: true });
}

/** One announcement: badges, the full message (line breaks kept), who posted it and when. */
export function AnnouncementCard({ announcement: a, actions }: { announcement: Announcement; actions?: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-md border border-input p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="break-words font-semibold">{a.title}</h3>
          {a.is_urgent && <Badge variant="destructive">Urgent</Badge>}
          {a.is_expired && <Badge variant="outline">Expired</Badge>}
          <Badge variant="secondary">{audienceLabel(a)}</Badge>
        </div>
        {actions}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{a.message}</p>
      <p className="text-xs text-muted-foreground">
        {a.author_name ? `${a.author_name} · ` : ''}
        {timeAgo(a.created_at)}
        {a.expires_at && !a.is_expired ? ` · expires ${timeAgo(a.expires_at)}` : ''}
      </p>
    </div>
  );
}
