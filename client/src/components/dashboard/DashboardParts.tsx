import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';

/** Pieces shared by the role dashboards: a section with its own states, a clickable row, a relative time. */
export const iconClass = 'h-4 w-4';

export function timeAgo(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : formatDistanceToNow(d, { addSuffix: true });
}

/** One section of the dashboard: its own title, and its own loading, error and empty states. */
export function Section({
  title,
  icon: sectionIcon,
  loading,
  failed,
  onRetry,
  empty,
  emptyIcon,
  emptyText,
  action,
  tour,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  empty: boolean;
  emptyIcon: React.ReactNode;
  emptyText: string;
  action?: React.ReactNode;
  /** Marks the section for the page walkthrough (data-tour). */
  tour?: string;
  children: React.ReactNode;
}) {
  return (
    <Card data-tour={tour} className="p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold text-site-text">
          {sectionIcon} {title}
        </h2>
        {action}
      </div>
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : failed ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-site-muted">This section could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : empty ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center text-site-muted">
          {emptyIcon}
          <p className="text-sm">{emptyText}</p>
        </div>
      ) : (
        children
      )}
    </Card>
  );
}

/** A clickable row that opens something. */
export function RowButton({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex w-full items-start gap-3 rounded-md p-2 text-left transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

/** "Room 204" unless the room already says what it is ("Lab 2", "Rm 5"). */
export function roomLabel(room: string): string {
  return /^(room|rm|lab)/i.test(room) ? room : `Room ${room}`;
}
