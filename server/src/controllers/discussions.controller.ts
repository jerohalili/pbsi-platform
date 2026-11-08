import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import {
  createReplySchema,
  createThreadSchema,
  discussionReportSchema,
  updateReplySchema,
  updateThreadSchema,
} from '../utils/validation.js';
import { assertEnrolledIfStudent, httpError, parseUuid } from '../utils/access.js';
import { recordAudit } from '../utils/audit.js';
import { notifyUsers } from '../utils/notify.js';
import type { AuthUser } from '../types/index.js';

function currentUser(req: Request): AuthUser {
  if (!req.user) throw httpError(401, 'Not authenticated');
  return req.user;
}

interface ThreadRow {
  id: string;
  course_id: string;
  title: string;
  body: string;
  author_id: string;
  is_pinned: boolean;
  is_locked: boolean;
  answer_reply_id: string | null;
  created_at: string;
  edited_at: string | null;
  course_code: string;
  course_name: string;
  course_teacher_user_id: string;
  author_role: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
}

interface ReplyRow {
  id: string;
  thread_id: string;
  author_id: string;
  parent_reply_id: string | null;
  deleted_at: string | null;
}

/** Admins moderate every discussion; a teacher moderates the discussions of the courses they teach. */
function canModerate(user: AuthUser, courseTeacherUserId: string): boolean {
  return user.role === 'admin' || (user.role === 'teacher' && courseTeacherUserId === user.id);
}

/** A thread that has not been deleted, with its course and author. Throws 404 otherwise. */
async function fetchThread(id: string): Promise<ThreadRow> {
  const [thread] = await sql`
    SELECT dt.id, dt.course_id, dt.title, dt.body, dt.author_id, dt.is_pinned, dt.is_locked,
           dt.answer_reply_id, dt.created_at, dt.edited_at,
           c.code AS course_code, c.name AS course_name, t.user_id AS course_teacher_user_id,
           u.role::text AS author_role, p.first_name, p.last_name, p.avatar_url
    FROM discussion_threads dt
    JOIN courses c ON c.id = dt.course_id
    JOIN teachers t ON t.id = c.teacher_id
    JOIN users u ON u.id = dt.author_id
    JOIN profiles p ON p.user_id = u.id
    WHERE dt.id = ${id} AND dt.deleted_at IS NULL
  `;
  if (!thread) throw httpError(404, 'Discussion not found');
  return thread as ThreadRow;
}

/** A reply (even a removed one) together with its thread's course teacher. Throws 404 when missing. */
async function fetchReply(id: string): Promise<ReplyRow & { course_teacher_user_id: string; thread_locked: boolean; thread_deleted: boolean }> {
  const [reply] = await sql`
    SELECT dr.id, dr.thread_id, dr.author_id, dr.parent_reply_id, dr.deleted_at,
           t.user_id AS course_teacher_user_id, dt.is_locked AS thread_locked,
           (dt.deleted_at IS NOT NULL) AS thread_deleted
    FROM discussion_replies dr
    JOIN discussion_threads dt ON dt.id = dr.thread_id
    JOIN courses c ON c.id = dt.course_id
    JOIN teachers t ON t.id = c.teacher_id
    WHERE dr.id = ${id}
  `;
  if (!reply || reply.thread_deleted) throw httpError(404, 'Reply not found');
  return reply as ReplyRow & { course_teacher_user_id: string; thread_locked: boolean; thread_deleted: boolean };
}

async function displayName(userId: string): Promise<string> {
  const [row] = await sql`SELECT first_name, last_name FROM profiles WHERE user_id = ${userId}`;
  const name = `${row?.first_name ?? ''} ${row?.last_name ?? ''}`.trim();
  return name || 'Someone';
}

/** Best effort: a notification problem must never undo or block a post. */
function notify(userIds: Iterable<string>, courseId: string, title: string, message: string, link: string): Promise<void> {
  return notifyUsers(userIds, { type: 'discussion', title, message, link, course_id: courseId });
}

function shorten(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** GET /api/discussions/:course_id — the discussions of one course, pinned first, then most recent activity. */
export async function listThreads(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const courseId = parseUuid(req.params.course_id, 'course id');
  await assertEnrolledIfStudent(user, courseId);

  const [course] = await sql`SELECT id FROM courses WHERE id = ${courseId}`;
  if (!course) throw httpError(404, 'Course not found');

  const threads = await sql`
    SELECT dt.id, dt.course_id, dt.title, LEFT(dt.body, 200) AS preview, dt.author_id,
           dt.is_pinned, dt.is_locked, (dt.answer_reply_id IS NOT NULL) AS is_answered,
           dt.created_at, dt.edited_at,
           u.role::text AS author_role, p.first_name, p.last_name, p.avatar_url,
           (SELECT COUNT(*) FROM discussion_replies dr
             WHERE dr.thread_id = dt.id AND dr.deleted_at IS NULL)::int AS reply_count,
           COALESCE((SELECT MAX(dr.created_at) FROM discussion_replies dr
                      WHERE dr.thread_id = dt.id AND dr.deleted_at IS NULL), dt.created_at) AS last_activity_at
    FROM discussion_threads dt
    JOIN users u ON u.id = dt.author_id
    JOIN profiles p ON p.user_id = u.id
    WHERE dt.course_id = ${courseId} AND dt.deleted_at IS NULL
    ORDER BY dt.is_pinned DESC, last_activity_at DESC
    LIMIT 200
  `;
  res.json({ threads });
}

/** GET /api/discussions/threads/:thread_id */
export async function getThread(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const threadId = parseUuid(req.params.thread_id, 'discussion id');
  const { course_teacher_user_id, ...thread } = await fetchThread(threadId);
  await assertEnrolledIfStudent(user, thread.course_id, 'Discussion not found');

  res.json({
    thread: {
      ...thread,
      is_mine: thread.author_id === user.id,
      can_moderate: canModerate(user, course_teacher_user_id),
    },
  });
}

/** POST /api/discussions */
export async function createThread(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const input = createThreadSchema.parse(req.body);

  const [course] = await sql`SELECT id, code, teacher_id FROM courses WHERE id = ${input.course_id}`;
  if (!course) throw httpError(404, 'Course not found');
  await assertEnrolledIfStudent(user, input.course_id);

  const [thread] = await sql`
    INSERT INTO discussion_threads (course_id, title, body, author_id)
    VALUES (${input.course_id}, ${input.title}, ${input.body}, ${user.id})
    RETURNING id, course_id, title, body, author_id, created_at
  `;

  const [teacher] = await sql`SELECT user_id FROM teachers WHERE id = ${course.teacher_id}`;
  if (teacher && teacher.user_id !== user.id) {
    const name = await displayName(user.id);
    await notify(
      [teacher.user_id as string],
      input.course_id,
      'New discussion',
      `${name} started “${shorten(input.title)}” in ${course.code}`,
      `/discussions/${thread.id}`,
    );
  }

  res.status(201).json({ thread });
}

/** PATCH /api/discussions/threads/:thread_id — the author edits the text; teachers and admins pin, lock and mark answers. */
export async function updateThread(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const threadId = parseUuid(req.params.thread_id, 'discussion id');
  const input = updateThreadSchema.parse(req.body);
  const thread = await fetchThread(threadId);

  const moderator = canModerate(user, thread.course_teacher_user_id);
  const isAuthor = thread.author_id === user.id;
  const editsText = input.title !== undefined || input.body !== undefined;
  const changesFlags = input.is_pinned !== undefined || input.is_locked !== undefined;

  if (editsText) {
    if (!isAuthor) throw httpError(403, 'Only the author can edit this post');
    if (thread.is_locked && !moderator) throw httpError(403, 'This discussion is locked');
  }
  if (changesFlags && !moderator) throw httpError(403, 'Only the course teacher or an admin can pin or lock a discussion');
  if (input.answer_reply_id !== undefined && !isAuthor && !moderator) {
    throw httpError(403, 'Only the author or the course teacher can mark an answer');
  }

  let answerReplyId = thread.answer_reply_id;
  if (input.answer_reply_id !== undefined) {
    answerReplyId = input.answer_reply_id;
    if (answerReplyId !== null) {
      const [reply] = await sql`
        SELECT id FROM discussion_replies
        WHERE id = ${answerReplyId} AND thread_id = ${threadId} AND deleted_at IS NULL
      `;
      if (!reply) throw httpError(400, 'That reply is not part of this discussion');
    }
  }

  const title = input.title ?? thread.title;
  const body = input.body ?? thread.body;
  const isPinned = input.is_pinned ?? thread.is_pinned;
  const isLocked = input.is_locked ?? thread.is_locked;
  const textChanged = title !== thread.title || body !== thread.body;

  await sql`
    UPDATE discussion_threads
    SET title = ${title}, body = ${body}, is_pinned = ${isPinned}, is_locked = ${isLocked},
        answer_reply_id = ${answerReplyId},
        edited_at = CASE WHEN ${textChanged}::boolean THEN now() ELSE edited_at END
    WHERE id = ${threadId} AND deleted_at IS NULL
  `;

  if (isPinned !== thread.is_pinned || isLocked !== thread.is_locked) {
    await recordAudit(
      req,
      'discussion.moderate',
      'discussion_threads',
      threadId,
      { is_pinned: thread.is_pinned, is_locked: thread.is_locked },
      { is_pinned: isPinned, is_locked: isLocked },
    );
  }

  res.json({ message: 'Discussion updated' });
}

/** DELETE /api/discussions/threads/:thread_id — the author (while nobody else replied) or a teacher/admin. */
export async function deleteThread(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const threadId = parseUuid(req.params.thread_id, 'discussion id');
  const thread = await fetchThread(threadId);
  const moderator = canModerate(user, thread.course_teacher_user_id);

  if (!moderator) {
    if (thread.author_id !== user.id) throw httpError(403, 'You can only delete your own discussions');
    const [others] = await sql`
      SELECT COUNT(*)::int AS n FROM discussion_replies
      WHERE thread_id = ${threadId} AND author_id <> ${user.id} AND deleted_at IS NULL
    `;
    if (Number(others?.n ?? 0) > 0) {
      throw httpError(409, 'Other people have replied, so only the course teacher or an admin can delete this discussion');
    }
  }

  await sql`
    UPDATE discussion_threads SET deleted_at = now(), deleted_by = ${user.id}
    WHERE id = ${threadId} AND deleted_at IS NULL
  `;
  if (thread.author_id !== user.id) {
    await recordAudit(req, 'discussion.thread.delete', 'discussion_threads', threadId, { title: thread.title }, null);
  }
  res.json({ message: 'Discussion deleted' });
}

/** GET /api/discussions/:thread_id/replies — oldest first. Removed replies come back as placeholders without text. */
export async function listReplies(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const threadId = parseUuid(req.params.thread_id, 'discussion id');
  const thread = await fetchThread(threadId);
  await assertEnrolledIfStudent(user, thread.course_id, 'Discussion not found');

  const replies = await sql`
    SELECT dr.id, dr.thread_id, dr.author_id, dr.parent_reply_id,
           CASE WHEN dr.deleted_at IS NULL THEN dr.content END AS content,
           (dr.deleted_at IS NOT NULL) AS is_deleted,
           (dr.deleted_at IS NOT NULL AND dr.deleted_by IS DISTINCT FROM dr.author_id) AS removed_by_moderator,
           dr.created_at, dr.edited_at,
           u.role::text AS author_role, p.first_name, p.last_name, p.avatar_url
    FROM discussion_replies dr
    JOIN users u ON u.id = dr.author_id
    JOIN profiles p ON p.user_id = u.id
    WHERE dr.thread_id = ${threadId}
    ORDER BY dr.created_at ASC
    LIMIT 500
  `;
  res.json({ replies });
}

/** POST /api/discussions/:thread_id/replies */
export async function createReply(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const threadId = parseUuid(req.params.thread_id, 'discussion id');
  const input = createReplySchema.parse(req.body);
  const thread = await fetchThread(threadId);
  await assertEnrolledIfStudent(user, thread.course_id, 'Discussion not found');

  if (thread.is_locked && !canModerate(user, thread.course_teacher_user_id)) {
    throw httpError(403, 'This discussion is locked');
  }

  let parentAuthorId: string | null = null;
  if (input.parent_reply_id) {
    const [parent] = await sql`
      SELECT author_id FROM discussion_replies
      WHERE id = ${input.parent_reply_id} AND thread_id = ${threadId} AND deleted_at IS NULL
    `;
    if (!parent) throw httpError(400, 'The reply you are answering is not part of this discussion');
    parentAuthorId = parent.author_id as string;
  }

  const [reply] = await sql`
    INSERT INTO discussion_replies (thread_id, author_id, parent_reply_id, content)
    VALUES (${threadId}, ${user.id}, ${input.parent_reply_id ?? null}, ${input.content})
    RETURNING id, thread_id, author_id, parent_reply_id, content, created_at
  `;

  // The asker, the person being answered and the course teacher hear about it (never the writer).
  const recipients = new Set<string>([thread.author_id, thread.course_teacher_user_id]);
  if (parentAuthorId) recipients.add(parentAuthorId);
  recipients.delete(user.id);
  if (recipients.size > 0) {
    const name = await displayName(user.id);
    await notify(recipients, thread.course_id, 'New reply', `${name} replied in “${shorten(thread.title)}”`, `/discussions/${threadId}`);
  }

  res.status(201).json({ reply });
}

/** PATCH /api/discussions/replies/:reply_id — only the author edits a reply. */
export async function updateReply(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const replyId = parseUuid(req.params.reply_id, 'reply id');
  const input = updateReplySchema.parse(req.body);
  const reply = await fetchReply(replyId);

  if (reply.author_id !== user.id) throw httpError(403, 'Only the author can edit this reply');
  if (reply.deleted_at) throw httpError(409, 'This reply was removed');
  if (reply.thread_locked && !canModerate(user, reply.course_teacher_user_id)) {
    throw httpError(403, 'This discussion is locked');
  }

  await sql`
    UPDATE discussion_replies SET content = ${input.content}, edited_at = now()
    WHERE id = ${replyId} AND deleted_at IS NULL
  `;
  res.json({ message: 'Reply updated' });
}

/** DELETE /api/discussions/replies/:reply_id — the author or a teacher/admin. The reply stays as a placeholder. */
export async function deleteReply(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const replyId = parseUuid(req.params.reply_id, 'reply id');
  const reply = await fetchReply(replyId);

  const moderator = canModerate(user, reply.course_teacher_user_id);
  if (reply.author_id !== user.id && !moderator) throw httpError(403, 'You can only delete your own replies');
  if (reply.deleted_at) {
    res.json({ message: 'Reply deleted' });
    return;
  }

  await sql`
    UPDATE discussion_replies SET deleted_at = now(), deleted_by = ${user.id}
    WHERE id = ${replyId} AND deleted_at IS NULL
  `;
  // A removed reply can no longer be the answer.
  await sql`UPDATE discussion_threads SET answer_reply_id = NULL WHERE answer_reply_id = ${replyId}`;

  if (reply.author_id !== user.id) {
    await recordAudit(req, 'discussion.reply.delete', 'discussion_replies', replyId, { thread_id: reply.thread_id }, null);
  }
  res.json({ message: 'Reply deleted' });
}

async function fileReport(
  req: Request,
  res: Response,
  target: { threadId: string; replyId: string | null; authorId: string; teacherUserId: string; threadTitle: string; courseCode: string; courseId: string },
): Promise<void> {
  const user = currentUser(req);
  const input = discussionReportSchema.parse(req.body);

  if (target.authorId === user.id) throw httpError(400, 'You cannot report your own post');

  const [report] = await sql`
    INSERT INTO discussion_reports (thread_id, reply_id, reporter_id, reason)
    VALUES (${target.replyId ? null : target.threadId}, ${target.replyId}, ${user.id}, ${input.reason})
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
  if (!report) throw httpError(409, 'You already reported this post');

  // The course teacher and the admins hear about it. The reporter's name is not shown to them,
  // so reporting is safe to do; the audit log still records it.
  const admins = await sql`SELECT id FROM users WHERE role::text = 'admin' AND is_active = TRUE`;
  const recipients = new Set<string>([target.teacherUserId, ...admins.map((a) => a.id as string)]);
  recipients.delete(user.id);
  recipients.delete(target.authorId);
  await notify(
    recipients,
    target.courseId,
    'Discussion post reported',
    `A post in “${shorten(target.threadTitle, 50)}” (${target.courseCode}) was reported: ${shorten(input.reason, 120)}`,
    `/discussions/${target.threadId}`,
  );

  await recordAudit(req, 'discussion.report', 'discussion_reports', report.id as string, null, {
    thread_id: target.threadId,
    reply_id: target.replyId,
  });
  res.status(201).json({ message: 'Thank you. A teacher or admin will review this post.' });
}

/** POST /api/discussions/threads/:thread_id/report */
export async function reportThread(req: Request, res: Response): Promise<void> {
  const threadId = parseUuid(req.params.thread_id, 'discussion id');
  const thread = await fetchThread(threadId);
  await fileReport(req, res, {
    threadId,
    replyId: null,
    authorId: thread.author_id,
    teacherUserId: thread.course_teacher_user_id,
    threadTitle: thread.title,
    courseCode: thread.course_code,
    courseId: thread.course_id,
  });
}

/** POST /api/discussions/replies/:reply_id/report */
export async function reportReply(req: Request, res: Response): Promise<void> {
  const replyId = parseUuid(req.params.reply_id, 'reply id');
  const reply = await fetchReply(replyId);
  if (reply.deleted_at) throw httpError(409, 'This reply was already removed');
  const thread = await fetchThread(reply.thread_id);
  await fileReport(req, res, {
    threadId: thread.id,
    replyId,
    authorId: reply.author_id,
    teacherUserId: thread.course_teacher_user_id,
    threadTitle: thread.title,
    courseCode: thread.course_code,
    courseId: thread.course_id,
  });
}
