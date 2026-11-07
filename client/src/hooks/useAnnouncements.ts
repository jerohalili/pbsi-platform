import { useQuery } from 'react-query';
import api from '@/lib/api.ts';
import { ANNOUNCEMENTS_LIVE_KEY, type Announcement } from '@/lib/announcements.ts';

/**
 * The announcements that are live for the signed-in person (the banner and the dashboard box share
 * this one query). Refreshed every minute and when the tab regains focus, so an urgent notice
 * appears without a reload. Failures are silent: an announcement box must never get in the way.
 */
export default function useAnnouncements(enabled: boolean) {
  return useQuery<Announcement[]>(
    ANNOUNCEMENTS_LIVE_KEY,
    async () => (await api.get<{ announcements: Announcement[] }>('/announcements')).data.announcements,
    { enabled, refetchInterval: 60_000, refetchOnWindowFocus: true, staleTime: 15_000, retry: false },
  );
}
