import { sql } from '../config/db.js';

export interface NotificationContent {
  type: string;
  title: string;
  message: string;
  /** An in-app path such as "/grades", or a full web address. */
  link?: string | null;
}

/**
 * Creates one notification per recipient with a single INSERT.
 *
 * Best effort: a notification problem must never undo or block the action that caused it, so
 * failures are logged (with enough detail to find them) instead of thrown.
 */
export async function notifyUsers(userIds: Iterable<string>, content: NotificationContent): Promise<void> {
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return;

  try {
    await sql`
      INSERT INTO notifications (user_id, type, title, message, link)
      SELECT r, ${content.type}::text, ${content.title}::text, ${content.message}::text, ${content.link || null}::text
      FROM unnest(${recipients}::uuid[]) AS r
    `;
  } catch (err) {
    console.error(`[notify] could not create "${content.type}" notification for ${recipients.length} user(s):`, err);
  }
}

/** User ids of the active students enrolled in one course. */
export async function courseStudentUserIds(courseId: string): Promise<string[]> {
  const rows = await sql`
    SELECT st.user_id
    FROM enrollments e
    JOIN students st ON st.id = e.student_id
    JOIN users u ON u.id = st.user_id
    WHERE e.course_id = ${courseId} AND u.is_active = TRUE
  `;
  return rows.map((row) => row.user_id as string);
}

/**
 * Notifies the active students enrolled in a course (a new assignment, a published quiz).
 * Best effort, like notifyUsers (the lookup is covered too).
 */
export async function notifyCourseStudents(courseId: string, content: NotificationContent): Promise<void> {
  try {
    await notifyUsers(await courseStudentUserIds(courseId), content);
  } catch (err) {
    console.error(`[notify] could not look up students for \"${content.type}\" notification:`, err);
  }
}

/** "Mon 3 Nov, 5:00 pm" in Philippine time, for use inside a notification message. */
export function formatManila(value: string | Date): string {
  return new Date(value).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** A room as people type it ("204", "Room 204", "Lab 3"): "Room " is added only to a bare number or name. */
export function formatRoom(room: string): string {
  const trimmed = room.trim();
  return /^(room|rm|lab|laboratory|hall|gym|auditorium|library)\b/i.test(trimmed) ? trimmed : `Room ${trimmed}`;
}
