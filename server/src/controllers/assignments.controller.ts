import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import {
  createAssignmentSchema,
  updateAssignmentSchema,
} from '../utils/validation.js';
import {
  assertCanManageAssignment,
  assertCanManageModule,
  assertCanViewAssignment,
  assertHttpUrl,
  getOwnStudentId,
  httpError,
  optionalUuid,
  parseUuid,
  rethrowDbError,
} from '../utils/access.js';
import {
  deleteFromCloudinary,
  deleteManyFromCloudinary,
  safeFileName,
  signedDownloadUrl,
  uniqueFileName,
  uploadToCloudinary,
} from '../utils/upload.js';
import type { AuthUser } from '../types/index.js';
import { recordAudit, diffValues } from '../utils/audit.js';
import { notifyCourseStudents, formatManila, formatRoom } from '../utils/notify.js';
import { deleteScoresOf } from '../utils/manualScoring.js';
import { deleteMentionsOf } from '../utils/mentions.js';
import { toPercent } from '../utils/gradeTerm.js';

function currentUser(req: Request): AuthUser {
  if (!req.user) throw httpError(401, 'Not authenticated');
  return req.user;
}

interface AssignmentFilters {
  id?: string;
  courseId?: string;
  moduleId?: string;
}

/**
 * Assignments as seen by the signed-in person. Drafts are visible only to the teacher who owns the
 * course (and admins), exactly like quizzes, and students see only the courses they are enrolled in:
 *  - everyone gets the course/module context and `can_manage`
 *  - students also get their own submission and a `status`
 *  - teachers/admins also get submission counts
 */
async function queryAssignments(user: AuthUser, filters: AssignmentFilters) {
  const isStudent = user.role === 'student';
  const ownStudentId = isStudent ? await getOwnStudentId(user.id) : null;

  const rows = await sql`
    SELECT a.id, a.module_id, a.title, a.instructions, a.due_date, a.is_published, a.delivery, a.room,
           a.max_score::float8 AS max_score, a.attachment_url, a.attachment_name,
           (a.attachment_public_id IS NOT NULL) AS has_attachment_file, a.created_at,
           m.title AS module_title,
           c.id AS course_id, c.code AS course_code, c.name AS course_name,
           (te.user_id = ${user.id}) AS is_mine,
           (SELECT COUNT(*) FROM submissions x WHERE x.assignment_id = a.id)::int AS submitted_count,
           (SELECT COUNT(*) FROM submissions x WHERE x.assignment_id = a.id AND x.grade IS NOT NULL)::int AS graded_count,
           (SELECT COUNT(*) FROM manual_scores x WHERE x.item_type = 'assignment' AND x.item_id = a.id)::int AS scored_count,
           (SELECT COUNT(*) FROM enrollments en WHERE en.course_id = c.id)::int AS enrolled_count,
           -- Open notes: a student's own that they have not seen yet; for the course's teacher, all unresolved.
           (CASE
              WHEN ${isStudent}::boolean THEN (
                SELECT COUNT(*) FROM coursework_mentions cm
                WHERE cm.item_type = 'assignment' AND cm.item_id = a.id AND cm.student_id = ${ownStudentId}::uuid
                  AND cm.resolved_at IS NULL AND cm.acknowledged_at IS NULL)
              WHEN (te.user_id = ${user.id} OR ${user.role === 'admin'}::boolean) THEN (
                SELECT COUNT(*) FROM coursework_mentions cm
                WHERE cm.item_type = 'assignment' AND cm.item_id = a.id AND cm.resolved_at IS NULL)
              ELSE NULL
            END)::int AS mention_count,
           ms.score::float8 AS manual_score, ms.feedback AS manual_feedback, ms.graded_at AS manual_graded_at,
           sub.id AS submission_id, sub.file_url AS submission_url,
           sub.file_name AS submission_file_name,
           (sub.file_public_id IS NOT NULL) AS submission_is_file,
           sub.submitted_at, sub.grade::float8 AS grade, sub.feedback, sub.graded_at,
           (sub.id IS NOT NULL AND sub.submitted_at > a.due_date) AS is_late
    FROM assignments a
    JOIN modules m ON m.id = a.module_id
    JOIN courses c ON c.id = m.course_id
    JOIN teachers te ON te.id = c.teacher_id
    LEFT JOIN LATERAL (
      SELECT s.id, s.file_url, s.file_name, s.file_public_id, s.submitted_at, s.grade, s.feedback, s.graded_at
      FROM submissions s
      WHERE s.assignment_id = a.id AND s.student_id = ${ownStudentId}::uuid
      ORDER BY s.submitted_at DESC
      LIMIT 1
    ) sub ON TRUE
    LEFT JOIN manual_scores ms
           ON ms.item_type = 'assignment' AND ms.item_id = a.id AND ms.student_id = ${ownStudentId}::uuid
    WHERE (${filters.id ?? ''}::text = '' OR a.id = NULLIF(${filters.id ?? ''}::text, '')::uuid)
      AND (${filters.courseId ?? ''}::text = '' OR c.id = NULLIF(${filters.courseId ?? ''}::text, '')::uuid)
      AND (${filters.moduleId ?? ''}::text = '' OR a.module_id = NULLIF(${filters.moduleId ?? ''}::text, '')::uuid)
      AND (a.is_published = TRUE OR te.user_id = ${user.id} OR ${user.role === 'admin'}::boolean)
      AND (${!isStudent}::boolean OR EXISTS (
            SELECT 1 FROM enrollments en WHERE en.course_id = c.id AND en.student_id = ${ownStudentId}::uuid
          ))
    ORDER BY a.due_date ASC, a.created_at ASC
  `;

  return rows.map((row) => {
    const canManage = user.role === 'admin' || (user.role === 'teacher' && row.is_mine === true);
    const base = { ...row, can_manage: canManage };
    if (!isStudent) {
      return { ...base, status: null };
    }
    // Students never see how the rest of the class is doing.
    let status: string;
    if (row.delivery === 'in_person') {
      // Checked face to face: nothing to hand in, only a score the teacher types in later.
      const scored = row.manual_score !== null;
      status = scored ? 'scored' : new Date(row.due_date as string).getTime() < Date.now() ? 'awaiting_score' : 'upcoming';
      return {
        ...base,
        status,
        manual_percent: scored ? toPercent(row.manual_score as number, row.max_score as number) : null,
        submitted_count: null,
        graded_count: null,
        scored_count: null,
        enrolled_count: null,
      };
    }
    if (row.submission_id === null) {
      status = new Date(row.due_date as string).getTime() < Date.now() ? 'overdue' : 'not_submitted';
    } else if (row.grade !== null) {
      status = 'graded';
    } else {
      status = 'submitted';
    }
    return { ...base, status, submitted_count: null, graded_count: null, scored_count: null, enrolled_count: null };
  });
}

export async function listAssignments(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const query = req.query as { course_id?: string; module_id?: string };

  const assignments = await queryAssignments(user, {
    courseId: optionalUuid(query.course_id, 'course id') || undefined,
    moduleId: optionalUuid(query.module_id, 'module id') || undefined,
  });
  res.json({ assignments });
}

export async function getAssignment(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'assignment id');

  const [assignment] = await queryAssignments(user, { id });
  if (!assignment) throw httpError(404, 'Assignment not found');
  res.json({ assignment });
}

export async function createAssignment(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  // The validation middleware does not replace req.body, so parse again to apply defaults.
  const input = createAssignmentSchema.parse(req.body);
  assertHttpUrl(input.attachment_url, 'Material link');

  const courseId = await assertCanManageModule(user, input.module_id);

  // New assignments start as drafts; students hear about one only when it is published.
  const [created] = await sql`
    INSERT INTO assignments (module_id, title, instructions, due_date, max_score, attachment_url, is_published, delivery, room)
    VALUES (${input.module_id}, ${input.title}, ${input.instructions || null},
            ${input.due_date}, ${input.max_score}, ${input.attachment_url || null}, FALSE,
            ${input.delivery}, ${input.room || null})
    RETURNING id
  `;

  await recordAudit(req, 'assignment.create', 'assignment', created.id as string, null, {
    title: input.title,
    due_date: new Date(input.due_date).toISOString(),
    max_score: input.max_score,
    course_id: courseId,
    delivery: input.delivery,
  });

  const [assignment] = await queryAssignments(user, { id: created.id as string });
  res.status(201).json({ assignment });
}

export async function updateAssignment(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'assignment id');
  const input = updateAssignmentSchema.parse(req.body);
  assertHttpUrl(input.attachment_url, 'Material link');

  const before = await assertCanManageAssignment(user, id);

  // Never let the maximum drop below a grade that has already been given.
  if (input.max_score !== undefined) {
    const [over] = await sql`
      SELECT COUNT(*)::int AS n FROM submissions
      WHERE assignment_id = ${id} AND grade IS NOT NULL AND grade > ${input.max_score}
    `;
    if (over && over.n > 0) {
      throw httpError(
        409,
        `${over.n} grade${over.n === 1 ? ' is' : 's are'} already higher than ${input.max_score}. Adjust those grades first.`,
      );
    }
  }

  // Same for scores the teacher typed in for an in-person assignment.
  if (input.max_score !== undefined && before.delivery === 'in_person') {
    const [over] = await sql`
      SELECT COUNT(*)::int AS n FROM manual_scores
      WHERE item_type = 'assignment' AND item_id = ${id} AND score > ${input.max_score}::numeric
    `;
    if (over && over.n > 0) {
      throw httpError(409, 'Some students already have a score higher than that maximum. Adjust those scores first.');
    }
  }

  // Taking an in-person assignment back to draft would hide scores students have already been given.
  if (input.is_published === false && before.is_published && before.delivery === 'in_person') {
    const [scored] = await sql`
      SELECT COUNT(*)::int AS n FROM manual_scores WHERE item_type = 'assignment' AND item_id = ${id}
    `;
    if (scored && scored.n > 0) {
      throw httpError(409, 'Scores have already been recorded, so this assignment can no longer be unpublished.');
    }
  }

  // Taking an assignment back to draft would hide work students have already handed in.
  if (input.is_published === false && before.is_published) {
    const [handedIn] = await sql`SELECT COUNT(*)::int AS n FROM submissions WHERE assignment_id = ${id}`;
    if (handedIn && handedIn.n > 0) {
      throw httpError(409, 'Students have already handed in work, so this assignment can no longer be unpublished.');
    }
  }

  // Optional text fields: undefined = leave unchanged, '' = clear.
  const instructionsProvided = input.instructions !== undefined;
  const attachmentProvided = input.attachment_url !== undefined;
  const roomProvided = input.room !== undefined;

  await sql`
    UPDATE assignments
    SET title = COALESCE(${input.title ?? null}, title),
        instructions = CASE WHEN ${instructionsProvided}::boolean THEN ${input.instructions || null} ELSE instructions END,
        due_date = COALESCE(${input.due_date ?? null}::timestamptz, due_date),
        max_score = COALESCE(${input.max_score ?? null}::numeric, max_score),
        is_published = COALESCE(${input.is_published ?? null}::boolean, is_published),
        room = CASE WHEN ${roomProvided}::boolean THEN NULLIF(${input.room ?? ''}::text, '') ELSE room END,
        attachment_url = CASE WHEN ${attachmentProvided}::boolean THEN ${input.attachment_url || null} ELSE attachment_url END
    WHERE id = ${id}
  `;

  const changes = diffValues(
    {
      title: before.title,
      max_score: before.max_score,
      due_date: new Date(before.due_date).toISOString(),
      is_published: before.is_published,
    },
    {
      title: input.title,
      max_score: input.max_score,
      due_date: input.due_date ? new Date(input.due_date).toISOString() : undefined,
      is_published: input.is_published,
    },
  );
  if (changes) await recordAudit(req, 'assignment.update', 'assignment', id, changes.old, changes.new);

  // Work that has just been opened is news for students (not every later edit of it).
  if (!before.is_published && input.is_published === true) {
    try {
      const [fresh] = await sql`
        SELECT a.title, a.due_date, a.delivery, a.room, c.code
        FROM assignments a
        JOIN modules m ON m.id = a.module_id
        JOIN courses c ON c.id = m.course_id
        WHERE a.id = ${id}
      `;
      if (fresh) {
        await notifyCourseStudents(before.course_id, {
          type: 'assignment',
          title: 'New assignment',
          message:
            fresh.delivery === 'in_person'
              ? `${fresh.title}${fresh.code ? ` (${fresh.code})` : ''} · in person · ${formatManila(fresh.due_date as string)}${fresh.room ? ` · ${formatRoom(fresh.room as string)}` : ''}`
              : `${fresh.title}${fresh.code ? ` (${fresh.code})` : ''} is due ${formatManila(fresh.due_date as string)}`,
          link: `/assignments/${id}`,
        });
      }
    } catch (err) {
      console.error('[assignments] could not notify students:', err);
    }
  }

  const [assignment] = await queryAssignments(user, { id });
  res.json({ assignment });
}

export async function deleteAssignment(req: Request, res: Response): Promise<void> {
  const id = parseUuid(req.params.id, 'assignment id');
  const user = currentUser(req);
  const before = await assertCanManageAssignment(user, id);

  // Collected now, deleted from Cloudinary only once the rows are really gone.
  const [material] = await sql`SELECT attachment_public_id FROM assignments WHERE id = ${id}`;
  const handedIn = await sql`
    SELECT file_public_id FROM submissions WHERE assignment_id = ${id} AND file_public_id IS NOT NULL
  `;

  // Cascade delete submissions before removing the assignment. The scores typed in for an in-person
  // assignment go with it (online work keeps its grades, as it always has).
  await sql`DELETE FROM submissions WHERE assignment_id = ${id}`;
  if (before.delivery === 'in_person') await deleteScoresOf('assignment', [id]);
  await deleteMentionsOf('assignment', [id]);
  try {
    const [assignment] = await sql`DELETE FROM assignments WHERE id = ${id} RETURNING id`;
    if (!assignment) throw httpError(404, 'Assignment not found');
  } catch (err) {
    rethrowDbError(err, {
      foreignKey: 'Other records still reference this assignment, so it can’t be deleted.',
    });
  }
  await deleteManyFromCloudinary(
    [
      ...handedIn.map((row) => row.file_public_id as string),
      (material?.attachment_public_id as string | null | undefined) ?? null,
    ],
    'raw',
    'authenticated',
  );
  await recordAudit(req, 'assignment.delete', 'assignment', id, { title: before.title, course_id: before.course_id }, null);
  res.json({ message: 'Assignment deleted' });
}

// ---- Teacher material file (one private file per assignment) ------------------------------

/** PUT /api/assignments/:id/attachment — multipart field "file". Replaces any existing material file. */
export async function setAttachment(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'assignment id');
  await assertCanManageAssignment(user, id);

  const file = req.file;
  if (!file) throw httpError(400, 'Choose a file to upload');

  const [existing] = await sql`SELECT attachment_public_id FROM assignments WHERE id = ${id}`;
  const uploaded = await uploadToCloudinary(
    file.buffer,
    uniqueFileName(file.originalname),
    `pbsi/materials/${id}`,
    'raw',
    { type: 'authenticated' },
  );

  try {
    await sql`
      UPDATE assignments
      SET attachment_public_id = ${uploaded.public_id}, attachment_name = ${safeFileName(file.originalname)}
      WHERE id = ${id}
    `;
  } catch (err) {
    await deleteFromCloudinary(uploaded.public_id, 'raw', 'authenticated');
    throw err;
  }

  const old = existing?.attachment_public_id as string | null | undefined;
  if (old && old !== uploaded.public_id) await deleteFromCloudinary(old, 'raw', 'authenticated');

  const [assignment] = await queryAssignments(user, { id });
  res.json({ assignment });
}

/** DELETE /api/assignments/:id/attachment */
export async function removeAttachment(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'assignment id');
  await assertCanManageAssignment(user, id);

  const [existing] = await sql`SELECT attachment_public_id FROM assignments WHERE id = ${id}`;
  await sql`UPDATE assignments SET attachment_public_id = NULL, attachment_name = NULL WHERE id = ${id}`;
  const old = existing?.attachment_public_id as string | null | undefined;
  if (old) await deleteFromCloudinary(old, 'raw', 'authenticated');

  const [assignment] = await queryAssignments(user, { id });
  res.json({ assignment });
}

/** GET /api/assignments/:id/attachment — a short-lived signed link, for anyone who can see the assignment. */
export async function downloadAttachment(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'assignment id');
  await assertCanViewAssignment(user, id);
  const [row] = await sql`SELECT attachment_public_id, attachment_name FROM assignments WHERE id = ${id}`;
  if (!row) throw httpError(404, 'Assignment not found');
  if (!row.attachment_public_id) throw httpError(404, 'This assignment has no material file');

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    url: signedDownloadUrl(row.attachment_public_id as string, 'raw'),
    file_name: row.attachment_name ?? 'material',
  });
}
