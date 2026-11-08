import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import { httpError, parseUuid } from '../utils/access.js';
import { recordAudit } from '../utils/audit.js';
import { notificationSchema } from '../utils/validation.js';

function currentUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw httpError(401, 'Not authenticated');
  return id;
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * GET /api/notifications?page=1&limit=20&unread=true
 * Newest first. `unread_count` is always the person's total unread, whatever the filter.
 */
export async function listNotifications(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  const limit = clampInt(req.query.limit, 20, 1, 100);
  const page = clampInt(req.query.page, 1, 1, 100000);
  const unreadOnly = req.query.unread === 'true';

  const [notifications, [counts]] = await Promise.all([
    sql`
      SELECT id, user_id, type, title, message, link, is_read, created_at
      FROM notifications
      WHERE user_id = ${userId}
        AND (${unreadOnly}::boolean = FALSE OR is_read = FALSE)
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `,
    sql`
      SELECT COUNT(*) FILTER (WHERE ${unreadOnly}::boolean = FALSE OR is_read = FALSE)::int AS total,
             COUNT(*) FILTER (WHERE is_read = FALSE)::int AS unread
      FROM notifications
      WHERE user_id = ${userId}
    `,
  ]);

  res.json({
    notifications,
    total: counts?.total ?? 0,
    unread_count: counts?.unread ?? 0,
    page,
    limit,
  });
}

/** GET /api/notifications/unread-count: cheap, polled by the sidebar badge. */
export async function getUnreadCount(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  const [row] = await sql`
    SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = ${userId} AND is_read = FALSE
  `;
  res.json({ unread_count: row?.unread ?? 0 });
}

/**
 * GET /api/notifications/unread-by-course: the signed-in person's unread notifications, counted per
 * course (only courses with at least one). A student only gets courses they are enrolled in.
 * Notifications that are not about one course are not counted here (they are in the badge total).
 */
export async function getUnreadByCourse(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) throw httpError(401, 'Not authenticated');
  const courses = await sql`
    SELECT c.id AS course_id, c.code, c.name, COUNT(n.id)::int AS unread
    FROM notifications n
    JOIN courses c ON c.id = n.course_id
    WHERE n.user_id = ${user.id} AND n.is_read = FALSE
      AND (
        ${user.role}::text <> 'student'
        OR EXISTS (
          SELECT 1 FROM enrollments e JOIN students st ON st.id = e.student_id
          WHERE e.course_id = c.id AND st.user_id = ${user.id}
        )
      )
    GROUP BY c.id, c.code, c.name
    ORDER BY c.code ASC
  `;
  res.json({ courses });
}

export async function markNotificationRead(req: Request, res: Response): Promise<void> {
  const id = parseUuid(req.params.id, 'notification id');
  const userId = currentUserId(req);

  const [notification] = await sql`
    UPDATE notifications
    SET is_read = TRUE
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, is_read
  `;
  if (!notification) throw httpError(404, 'Notification not found');
  res.json({ notification });
}

/** PATCH /api/notifications/read-all */
export async function markAllNotificationsRead(req: Request, res: Response): Promise<void> {
  const userId = currentUserId(req);
  const [row] = await sql`
    WITH updated AS (
      UPDATE notifications SET is_read = TRUE
      WHERE user_id = ${userId} AND is_read = FALSE
      RETURNING id
    )
    SELECT COUNT(*)::int AS updated FROM updated
  `;
  res.json({ updated: row?.updated ?? 0 });
}

/** DELETE /api/notifications/:id: a person dismisses one of their own notifications. */
export async function deleteNotification(req: Request, res: Response): Promise<void> {
  const id = parseUuid(req.params.id, 'notification id');
  const userId = currentUserId(req);

  const [removed] = await sql`
    DELETE FROM notifications WHERE id = ${id} AND user_id = ${userId} RETURNING id
  `;
  if (!removed) throw httpError(404, 'Notification not found');
  res.json({ message: 'Notification removed' });
}

/**
 * POST /api/notifications: staff send a message to one person.
 * Admins may write to anyone active; teachers only to students (least privilege).
 */
export async function createNotification(req: Request, res: Response): Promise<void> {
  const actorId = currentUserId(req);
  // The validation middleware does not replace req.body, so parse again to apply defaults.
  const input = notificationSchema.parse(req.body);

  const [recipient] = await sql`
    SELECT id, role::text AS role FROM users WHERE id = ${input.user_id} AND is_active = TRUE
  `;
  if (!recipient) throw httpError(404, 'Recipient not found');
  if (req.user?.role === 'teacher' && recipient.role !== 'student') {
    throw httpError(403, 'Teachers can only send notifications to students');
  }

  const [notification] = await sql`
    INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (${input.user_id}, ${input.type}, ${input.title}, ${input.message}, ${input.link || null})
    RETURNING id, user_id, type, title, message, link, is_read, created_at
  `;

  // Staff messages are the one kind of notification a person writes by hand, so they are recorded.
  await recordAudit(req, 'notification.send', 'notification', notification.id as string, null, {
    recipient_id: input.user_id,
    type: input.type,
    title: input.title,
    sent_by: actorId,
  });
  res.status(201).json({ notification });
}
