import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import { createMentionSchema, updateMentionSchema, MENTION_ITEM_TYPES } from '../utils/validation.js';
import { assertCanManageCourse, getOwnStudentId, httpError, parseUuid } from '../utils/access.js';
import { recordAudit } from '../utils/audit.js';
import { loadMentionItem, mentionLink, type MentionItemType } from '../utils/mentions.js';
import type { AuthUser } from '../types/index.js';

function currentUser(req: Request): AuthUser {
  if (!req.user) throw httpError(401, 'Not authenticated');
  return req.user;
}

const NOTIFICATION_TITLE: Record<string, string> = {
  comment: 'Comment from your teacher',
  missed_deadline: 'Missed deadline',
  correction: 'Needs a correction',
};

/**
 * POST /api/mentions { item_type, item_id, student_ids, reason, message }
 *
 * A teacher (of the course) or an admin writes a note to one or more enrolled students about an
 * assignment, quiz or exam: a comment on their work, a missed deadline, a correction to make. Each
 * student gets their own copy and a notification. Only published items can be mentioned on, because
 * a student must be able to open what the note is about.
 */
export async function createMentions(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const input = createMentionSchema.parse(req.body);

  const item = await loadMentionItem(input.item_type, input.item_id);
  if (!item) throw httpError(404, 'That assignment, quiz or exam was not found');
  await assertCanManageCourse(user, item.course_id);
  if (!item.is_published) {
    throw httpError(409, 'Publish it first: students can only be mentioned on what they can see.');
  }

  const studentIds = [...new Set(input.student_ids)];
  const strangers = await sql`
    SELECT s AS id
    FROM unnest(${studentIds}::uuid[]) AS s
    WHERE NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = ${item.course_id} AND e.student_id = s)
  `;
  if (strangers.length > 0) {
    throw httpError(409, 'Some of these students are not in this course. Refresh the page and try again.');
  }

  const created = await sql`
    INSERT INTO coursework_mentions (item_type, item_id, student_id, course_id, reason, message, created_by)
    SELECT ${item.type}::text, ${item.id}::uuid, s, ${item.course_id}::uuid, ${input.reason}::text, ${input.message}::text, ${user.id}::uuid
    FROM unnest(${studentIds}::uuid[]) AS s
    RETURNING id
  `;

  await recordAudit(req, 'mention.create', item.type, item.id, null, {
    course_id: item.course_id,
    reason: input.reason,
    students: created.length,
  });

  // Best effort: a failed notification never undoes a saved note.
  try {
    const text = `${item.title} (${item.course_code}): ${input.message}`.slice(0, 1000);
    await sql`
      INSERT INTO notifications (user_id, type, title, message, link)
      SELECT st.user_id, 'mention', ${NOTIFICATION_TITLE[input.reason]}::text, ${text}::text, ${mentionLink(item.type, item.id)}::text
      FROM students st
      WHERE st.id = ANY(${studentIds}::uuid[])
    `;
  } catch (err) {
    console.error('[mentions] could not notify students:', err);
  }

  res.status(201).json({ created: created.length });
}

/**
 * GET /api/mentions?item_type=&item_id=
 * The course's teacher (or an admin) gets every note on the item; a student gets only the notes
 * written to them (and only while they are enrolled in the course).
 */
export async function listMentions(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const query = req.query as { item_type?: string; item_id?: string };
  if (!query.item_type || !(MENTION_ITEM_TYPES as readonly string[]).includes(query.item_type)) {
    throw httpError(400, 'Unknown kind of item');
  }
  const type = query.item_type as MentionItemType;
  const itemId = parseUuid(query.item_id, 'item id');

  const item = await loadMentionItem(type, itemId);
  if (!item) throw httpError(404, 'That assignment, quiz or exam was not found');

  if (user.role === 'student') {
    const studentId = await getOwnStudentId(user.id);
    const mentions = await sql`
      SELECT cm.id, cm.reason, cm.message, cm.created_at, cm.acknowledged_at, cm.resolved_at,
             TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS teacher_name
      FROM coursework_mentions cm
      LEFT JOIN profiles p ON p.user_id = cm.created_by
      WHERE cm.item_type = ${type} AND cm.item_id = ${itemId} AND cm.student_id = ${studentId}::uuid
        AND EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = cm.course_id AND e.student_id = cm.student_id)
        AND ${item.is_published}::boolean
      ORDER BY cm.created_at DESC
    `;
    res.json({ mentions });
    return;
  }

  await assertCanManageCourse(user, item.course_id);
  const mentions = await sql`
    SELECT cm.id, cm.student_id, st.student_id AS student_number,
           TRIM(COALESCE(sp.first_name, '') || ' ' || COALESCE(sp.last_name, '')) AS student_name,
           cm.reason, cm.message, cm.created_at, cm.acknowledged_at, cm.resolved_at,
           TRIM(COALESCE(tp.first_name, '') || ' ' || COALESCE(tp.last_name, '')) AS teacher_name
    FROM coursework_mentions cm
    JOIN students st ON st.id = cm.student_id
    LEFT JOIN profiles sp ON sp.user_id = st.user_id
    LEFT JOIN profiles tp ON tp.user_id = cm.created_by
    WHERE cm.item_type = ${type} AND cm.item_id = ${itemId}
    ORDER BY cm.created_at DESC
  `;
  res.json({ mentions });
}

/** POST /api/mentions/:id/acknowledge: the student says they have seen the note. */
export async function acknowledgeMention(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'note id');
  const studentId = await getOwnStudentId(user.id);
  const [updated] = await sql`
    UPDATE coursework_mentions
    SET acknowledged_at = COALESCE(acknowledged_at, now())
    WHERE id = ${id} AND student_id = ${studentId}::uuid
    RETURNING id, acknowledged_at
  `;
  // Someone else's note is indistinguishable from one that does not exist.
  if (!updated) throw httpError(404, 'Note not found');
  res.json({ mention: updated });
}

async function loadManagedMention(user: AuthUser, id: string) {
  const [row] = await sql`SELECT id, course_id, item_type, item_id, reason, resolved_at FROM coursework_mentions WHERE id = ${id}`;
  if (!row) throw httpError(404, 'Note not found');
  await assertCanManageCourse(user, row.course_id as string);
  return row;
}

/** PATCH /api/mentions/:id { resolved }: the teacher closes a note when the matter is settled, or reopens it. */
export async function updateMention(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'note id');
  const input = updateMentionSchema.parse(req.body);
  const before = await loadManagedMention(user, id);

  const [mention] = await sql`
    UPDATE coursework_mentions
    SET resolved_at = CASE WHEN ${input.resolved}::boolean THEN COALESCE(resolved_at, now()) ELSE NULL END
    WHERE id = ${id}
    RETURNING id, resolved_at
  `;
  await recordAudit(req, 'mention.update', before.item_type as string, before.item_id as string, null, {
    resolved: input.resolved,
  });
  res.json({ mention });
}

/** DELETE /api/mentions/:id: removes a note written by mistake. */
export async function deleteMention(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'note id');
  const before = await loadManagedMention(user, id);
  await sql`DELETE FROM coursework_mentions WHERE id = ${id}`;
  await recordAudit(req, 'mention.delete', before.item_type as string, before.item_id as string, { reason: before.reason }, null);
  res.json({ message: 'Note deleted' });
}
