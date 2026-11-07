import { format } from 'date-fns';

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_MESSAGE_MAX = 2000;

export type AnnouncementAudience = 'all' | 'teachers' | 'students' | 'course';

export interface Announcement {
  id: string;
  title: string;
  message: string;
  audience: AnnouncementAudience;
  course_id: string | null;
  course_code: string | null;
  course_name: string | null;
  is_urgent: boolean;
  expires_at: string | null;
  is_expired: boolean;
  created_at: string;
  author_name: string;
  can_manage: boolean;
}

/** Query keys. Everything starts with 'announcements', so one invalidation refreshes them all. */
export const ANNOUNCEMENTS_LIVE_KEY = ['announcements', 'live'];
export const ANNOUNCEMENTS_HISTORY_KEY = ['announcements', 'history'];

export function audienceLabel(a: Pick<Announcement, 'audience' | 'course_code'>): string {
  switch (a.audience) {
    case 'all':
      return 'Everyone';
    case 'teachers':
      return 'All teachers';
    case 'students':
      return 'All students';
    default:
      return a.course_code ? `${a.course_code} students` : 'One course';
  }
}

/** An urgent announcement is a banner only while it has not expired (checked here too, so a banner left open expires). */
export function isLiveNow(a: Pick<Announcement, 'expires_at'>, now = Date.now()): boolean {
  return !a.expires_at || new Date(a.expires_at).getTime() > now;
}

/** ISO timestamp -> the value a <input type="datetime-local"> expects (browser's local time). */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : format(d, "yyyy-MM-dd'T'HH:mm");
}

/** <input type="datetime-local"> value -> ISO timestamp with offset, or null when empty. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
