import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import { createAnnouncementSchema, updateAnnouncementSchema } from '../utils/validation.js';
import { assertCanManageCourse, httpError, parseUuid } from '../utils/access.js';
import { diffValues, recordAudit } from '../utils/audit.js';
import { courseStudentUserIds, notifyUsers } from '../utils/notify.js';
import type { AuthUser } from '../types/index.js';

function currentUser(req: Request): AuthUser {
  if (!req.user) throw httpError(401, 'Not authenticated');
  return req.user;
}

/**
 * GET /api/announcements
 *
 * Default: what is live for the signed-in person (not deleted, not expired). Admins see everything;
 * teachers see "all", "teachers" and the announcements for courses they teach; students see "all",
 * "students" and the announcements for courses they are enrolled in.
 *
 * ?history=true (admin and teachers only): also expired ones. An admin gets every announcement, a
 * teacher only the ones they wrote.
 */
export async function listAnnouncements(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const history = (req.query as { history?: string }).history === 'true';
  if (history && user.role === 'student') throw httpError(403, 'Not allowed');

  const announcements = await sql`
    SELECT a.id, a.title, a.message, a.audience, a.course_id, a.is_urgent, a.expires_at, a.created_at,
           (a.expires_at IS NOT NULL AND a.expires_at <= now()) AS is_expired,
           (${user.role}::text = 'admin' OR a.created_by = ${user.id}::uuid) AS can_manage,
           c.code AS course_code, c.name AS course_name,
           TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS author_name
    FROM announcements a
    LEFT JOIN courses c ON c.id = a.course_id
    LEFT JOIN profiles p ON p.user_id = a.created_by
    WHERE a.deleted_at IS NULL
      AND (${history}::boolean OR a.expires_at IS NULL OR a.expires_at > now())
      AND (
        CASE WHEN ${history}::boolean
          THEN (${user.role}::text = 'admin' OR a.created_by = ${user.id}::uuid)
          ELSE (
            ${user.role}::text = 'admin'
            OR a.audience = 'all'
            OR (a.audience = 'teachers' AND ${user.role}::text = 'teacher')
            OR (a.audience = 'students' AND ${user.role}::text = 'student')
            OR (a.audience = 'course' AND (
                 (${user.role}::text = 'teacher' AND EXISTS (
                    SELECT 1 FROM courses cc JOIN teachers t ON t.id = cc.teacher_id
                    WHERE cc.id = a.course_id AND t.user_id = ${user.id}::uuid))
              OR (${user.role}::text = 'student' AND EXISTS (
                    SELECT 1 FROM enrollments e JOIN students st ON st.id = e.student_id
                    WHERE e.course_id = a.course_id AND st.user_id = ${user.id}::uuid))
            ))
          )
        END
      )
    ORDER BY a.created_at DESC
    LIMIT 50
  `;
  res.json({ announcements });
}

/** User ids that should get a bell notification for an announcement (the author is left out). */
async function recipientUserIds(audience: string, courseId: string | null, authorId: string): Promise<string[]> {
  let ids: string[];
  if (audience === 'course' && courseId) {
    const [course] = await sql`
      SELECT t.user_id FROM courses c JOIN teachers t ON t.id = c.teacher_id WHERE c.id = ${courseId}
    `;
    ids = [...(await courseStudentUserIds(courseId)), ...(course ? [course.user_id as string] : [])];
  } else {
    const role = audience === 'teachers' ? 'teacher' : audience === 'students' ? 'student' : '';
    const rows = await sql`
      SELECT id FROM users WHERE is_active = TRUE AND (${role}::text = '' OR role = ${role}::text)
    `;
    ids = rows.map((r) => r.id as string);
  }
  return ids.filter((id) => id !== authorId);
}

/**
 * POST /api/announcements { title, message, audience, course_id?, is_urgent?, expires_at? }
 *
 * Admins may post to any audience. A teacher may only post to the students of a course they teach.
 * Posting sends a bell notification to the audience (best effort: a failed notification never
 * undoes a saved announcement) and is audited.
 */
export async function createAnnouncement(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const input = createAnnouncementSchema.parse(req.body);

  if (user.role === 'teacher' && input.audience !== 'course') {
    throw httpError(403, 'Teachers can only post to the students of their own courses');
  }
  if (input.audience === 'course') {
    await assertCanManageCourse(user, input.course_id as string);
  }
  if (input.expires_at && new Date(input.expires_at).getTime() <= Date.now()) {
    throw httpError(400, 'The expiry must be in the future');
  }

  const [created] = await sql`
    INSERT INTO announcements (title, message, audience, course_id, is_urgent, expires_at, created_by)
    VALUES (${input.title}, ${input.message}, ${input.audience}, ${input.course_id ?? null}::uuid,
            ${input.is_urgent}, ${input.expires_at ?? null}::timestamptz, ${user.id})
    RETURNING id, created_at
  `;

  const recipients = await recipientUserIds(input.audience, input.course_id ?? null, user.id).catch((err) => {
    console.error('[announcements] could not look up recipients:', err);
    return [] as string[];
  });

  await recordAudit(req, 'announcement.create', 'announcement', created.id as string, null, {
    audience: input.audience,
    course_id: input.course_id ?? null,
    is_urgent: input.is_urgent,
    recipients: recipients.length,
  });

  const message = input.message.length > 1000 ? `${input.message.slice(0, 997)}...` : input.message;
  await notifyUsers(recipients, {
    type: 'announcement',
    title: input.is_urgent ? `Urgent: ${input.title}` : input.title,
    message,
    link: '/dashboard',
  });

  res.status(201).json({ id: created.id, created_at: created.created_at, recipients: recipients.length });
}

/** The announcement if it exists, is not deleted, and the signed-in user wrote it (or is an admin). */
async function loadOwnAnnouncement(user: AuthUser, rawId: string) {
  const id = parseUuid(rawId, 'announcement id');
  const [row] = await sql`
    SELECT id, title, message, is_urgent, expires_at, created_by
    FROM announcements WHERE id = ${id} AND deleted_at IS NULL
  `;
  if (!row) throw httpError(404, 'Announcement not found');
  if (user.role !== 'admin' && row.created_by !== user.id) {
    throw httpError(403, 'You can only change announcements you posted');
  }
  return row;
}

/**
 * PATCH /api/announcements/:id { title?, message?, is_urgent?, expires_at? (null clears it) }
 * The audience cannot change (that would need a new announcement), and editing does not notify again.
 */
export async function updateAnnouncement(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const input = updateAnnouncementSchema.parse(req.body);
  const before = await loadOwnAnnouncement(user, req.params.id);

  if (input.expires_at && new Date(input.expires_at).getTime() <= Date.now()) {
    throw httpError(400, 'The expiry must be in the future');
  }
  const changesExpiry = input.expires_at !== undefined;

  const [after] = await sql`
    UPDATE announcements SET
      title      = COALESCE(${input.title ?? null}::text, title),
      message    = COALESCE(${input.message ?? null}::text, message),
      is_urgent  = COALESCE(${input.is_urgent ?? null}::boolean, is_urgent),
      expires_at = CASE WHEN ${changesExpiry}::boolean THEN ${input.expires_at ?? null}::timestamptz ELSE expires_at END
    WHERE id = ${before.id} AND deleted_at IS NULL
    RETURNING id, title, message, is_urgent, expires_at
  `;
  if (!after) throw httpError(404, 'Announcement not found');

  const diff = diffValues(
    { title: before.title, message: before.message, is_urgent: before.is_urgent, expires_at: before.expires_at },
    { title: after.title, message: after.message, is_urgent: after.is_urgent, expires_at: after.expires_at },
  );
  if (diff) await recordAudit(req, 'announcement.update', 'announcement', after.id as string, diff.old, diff.new);

  res.json({ announcement: after });
}

/** DELETE /api/announcements/:id: soft delete; it disappears everywhere but stays in the audit trail. */
export async function deleteAnnouncement(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const before = await loadOwnAnnouncement(user, req.params.id);

  await sql`UPDATE announcements SET deleted_at = now() WHERE id = ${before.id} AND deleted_at IS NULL`;
  await recordAudit(req, 'announcement.delete', 'announcement', before.id as string, { title: before.title }, null);

  res.json({ message: 'Announcement deleted' });
}
