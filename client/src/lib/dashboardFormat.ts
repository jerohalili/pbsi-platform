/** Date helpers shared by the role dashboards (student, teacher, admin). */

/** "Mon, 3 Nov, 5:00 pm" in Philippine time, whatever the device's timezone is. */
export function formatManila(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "Tuesday, 4 November" from the server's 'YYYY-MM-DD' school date (no timezone shifting). */
export function formatSchoolDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', { weekday: 'long', day: 'numeric', month: 'long' });
}
