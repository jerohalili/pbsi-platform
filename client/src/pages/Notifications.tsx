import useAuth from '@/hooks/useAuth.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from 'react-query';
import {
  Award,
  Bell,
  Calendar,
  CheckCheck,
  ClipboardList,
  GraduationCap,
  FileText,
  Info,
  MessageCircle,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { UNREAD_COUNT_KEY } from '@/hooks/useUnreadNotifications.ts';
import { Button } from '@/components/ui/button.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { useToast } from '@/components/ui/toast.tsx';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

interface NotificationsResponse {
  notifications: Notification[];
  total: number;
  unread_count: number;
  page: number;
}

type Filter = 'all' | 'unread';

const PAGE_SIZE = 20;

const TYPE_ICONS: Record<string, LucideIcon> = {
  grade: Award,
  assignment: FileText,
  quiz: ClipboardList,
  exam: GraduationCap,
  attendance: Calendar,
  discussion: MessageCircle,
  system: Info,
  announcement: Bell,
};

/** "5 min ago", "3 h ago", "2 d ago", then a plain date. */
function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function NotificationsPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [items, setItems] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>('all');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  // Ignores the answer of a request that was overtaken by a newer one (e.g. a quick filter change).
  const requestId = useRef(0);

  const refreshBadge = useCallback(
    () => queryClient.invalidateQueries(UNREAD_COUNT_KEY),
    [queryClient],
  );

  const load = useCallback(
    async (nextPage: number, nextFilter: Filter, append: boolean) => {
      const id = ++requestId.current;
      if (append) setLoadingMore(true);
      else setStatus('loading');
      try {
        const res = await api.get<NotificationsResponse>('/notifications', {
          params: { page: nextPage, limit: PAGE_SIZE, unread: nextFilter === 'unread' ? 'true' : undefined },
        });
        if (id !== requestId.current) return;
        setItems((current) => (append ? [...current, ...res.data.notifications] : res.data.notifications));
        setTotal(res.data.total);
        setUnreadCount(res.data.unread_count);
        setPage(nextPage);
        setStatus('ready');
      } catch (err) {
        if (id !== requestId.current) return;
        if (append) {
          toast({ title: 'Couldn’t load more', description: getErrorMessage(err), variant: 'destructive' });
        } else {
          setStatus('error');
        }
      } finally {
        if (id === requestId.current) setLoadingMore(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    void load(1, filter, false);
  }, [isAuthenticated, filter, load]);

  async function markRead(n: Notification) {
    if (n.is_read) return;
    // Optimistic: the row updates at once and is put back if the server says no.
    setItems((current) => current.map((item) => (item.id === n.id ? { ...item, is_read: true } : item)));
    setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await api.patch(`/notifications/${n.id}/read`);
      void refreshBadge();
    } catch (err) {
      setItems((current) => current.map((item) => (item.id === n.id ? { ...item, is_read: false } : item)));
      setUnreadCount((count) => count + 1);
      toast({ title: 'Couldn’t mark as read', description: getErrorMessage(err), variant: 'destructive' });
    }
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await api.patch('/notifications/read-all');
      setUnreadCount(0);
      if (filter === 'unread') {
        setItems([]);
        setTotal(0);
      } else {
        setItems((current) => current.map((item) => ({ ...item, is_read: true })));
      }
      void refreshBadge();
    } catch (err) {
      toast({ title: 'Couldn’t mark all as read', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setMarkingAll(false);
    }
  }

  async function remove(n: Notification) {
    try {
      await api.delete(`/notifications/${n.id}`);
      setItems((current) => current.filter((item) => item.id !== n.id));
      setTotal((count) => Math.max(0, count - 1));
      if (!n.is_read) setUnreadCount((count) => Math.max(0, count - 1));
      void refreshBadge();
    } catch (err) {
      toast({ title: 'Couldn’t remove the notification', description: getErrorMessage(err), variant: 'destructive' });
    }
  }

  function open(n: Notification) {
    void markRead(n);
    if (!n.link) return;
    if (n.link.startsWith('/')) navigate(n.link);
    else window.open(n.link, '_blank', 'noopener,noreferrer');
  }

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-site-bg flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-2 animate-pulse">
          <div className="w-10 h-10 rounded-full bg-site-border"></div>
          <p className="text-site-muted text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="w-full bg-site-bg px-0 py-6 md:min-h-screen md:px-4 md:py-12">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-site-text">Notifications</h1>
            <p className="text-site-muted">
              {unreadCount > 0
                ? `You have ${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}.`
                : 'You’re all caught up.'}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={markAllRead} disabled={unreadCount === 0 || markingAll}>
            <CheckCheck className="mr-2 h-4 w-4" />
            Mark all as read
          </Button>
        </div>

        <div className="mb-4 inline-flex rounded-lg border border-site-border bg-white p-1" role="group" aria-label="Filter notifications">
          {(['all', 'unread'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                filter === value ? 'bg-primary text-primary-foreground' : 'text-site-muted hover:text-site-text'
              }`}
            >
              {value === 'all' ? 'All' : `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
            </button>
          ))}
        </div>

        {status === 'loading' && (
          <div className="space-y-3" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-xl border border-site-border bg-site-card px-6 py-12 text-center">
            <p className="font-medium text-site-text">We couldn’t load your notifications.</p>
            <p className="mb-4 text-sm text-site-muted">Check your connection and try again.</p>
            <Button variant="outline" onClick={() => load(1, filter, false)}>
              Try again
            </Button>
          </div>
        )}

        {status === 'ready' && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Bell className="mb-4 h-16 w-16 text-site-muted/30" />
            <p className="text-site-muted">
              {filter === 'unread' ? 'No unread notifications.' : 'You have no notifications yet.'}
            </p>
          </div>
        )}

        {status === 'ready' && items.length > 0 && (
          <>
            <ul className="overflow-hidden rounded-xl border border-site-border bg-site-card">
              {items.map((n) => {
                const Icon = TYPE_ICONS[n.type] ?? Bell;
                return (
                  <li
                    key={n.id}
                    className={`flex items-stretch gap-1 border-b border-site-border last:border-b-0 ${
                      n.is_read ? '' : 'bg-primary/5'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => open(n)}
                      className="flex min-w-0 flex-1 items-start gap-4 px-4 py-4 text-left transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                          n.is_read ? 'bg-site-border/50 text-site-muted' : 'bg-primary/15 text-primary'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={`truncate text-sm ${n.is_read ? 'text-site-text' : 'font-semibold text-site-text'}`}>
                            {n.title}
                          </span>
                          {!n.is_read && (
                            <>
                              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                              <span className="sr-only">Unread</span>
                            </>
                          )}
                        </span>
                        <span className="mt-0.5 block text-sm text-site-muted">{n.message}</span>
                        <time
                          dateTime={n.created_at}
                          title={new Date(n.created_at).toLocaleString('en-PH')}
                          className="mt-1 block text-xs text-site-muted/80"
                        >
                          {timeAgo(n.created_at)}
                        </time>
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center pr-2">
                      <button
                        type="button"
                        onClick={() => remove(n)}
                        aria-label={`Remove notification: ${n.title}`}
                        title="Remove"
                        className="rounded-md p-2 text-site-muted transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 flex items-center justify-between text-sm text-site-muted">
              <span>
                Showing {items.length} of {total}
              </span>
              {items.length < total && (
                <Button variant="outline" size="sm" onClick={() => load(page + 1, filter, true)} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
