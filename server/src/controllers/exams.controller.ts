import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import { createExamSchema, updateExamSchema } from '../utils/validation.js';
import {
  assertCanManageCourse,
  getOwnStudentId,
  httpError,
  optionalUuid,
  parseUuid,
} from '../utils/access.js';
import { recordAudit, diffValues } from '../utils/audit.js';
import { formatRoom, formatManila, notifyCourseStudents } from '../utils/notify.js';
import { deleteScoresOf } from '../utils/manualScoring.js';
import { toPercent } from '../utils/gradeTerm.js';
import type { AuthUser } from '../types/index.js';

function currentUser(req: Request): AuthUser {
  if (!req.user) throw httpError(401, 'Not authenticated');
  return req.user;
}

interface ExamFilters {
  id?: string;
  courseId?: string;
}

/**
 * Exams as seen by the signed-in person. Like quizzes: a draft is visible only to the teacher who
 * owns the course (and admins), and students see only the courses they are enrolled in.
 *  - everyone gets the schedule and `can_manage`
 *  - students also get their own score (typed in by the teacher) and a `status`
 *  - the teacher who runs the course also gets how many students have a score
 */
async function queryExams(user: AuthUser, filters: ExamFilters) {
  const isStudent = user.role === 'student';
  const ownStudentId = isStudent ? await getOwnStudentId(user.id) : null;

  const rows = await sql`
    SELECT e.id, e.course_id, e.title, e.details, e.exam_at, e.duration_minutes, e.room,
           e.max_score::float8 AS max_score, e.is_published, e.created_at,
           c.code AS course_code, c.name AS course_name,
           (te.user_id = ${user.id}) AS is_mine,
           (SELECT COUNT(*) FROM manual_scores s WHERE s.item_type = 'exam' AND s.item_id = e.id)::int AS scored_count,
           (SELECT COUNT(*) FROM enrollments en WHERE en.course_id = e.course_id)::int AS enrolled_count,
           ms.score::float8 AS my_score, ms.feedback AS my_feedback, ms.graded_at AS my_graded_at
    FROM exams e
    JOIN courses c ON c.id = e.course_id
    JOIN teachers te ON te.id = c.teacher_id
    LEFT JOIN manual_scores ms
           ON ms.item_type = 'exam' AND ms.item_id = e.id AND ms.student_id = ${ownStudentId}::uuid
    WHERE (${filters.id ?? ''}::text = '' OR e.id = NULLIF(${filters.id ?? ''}::text, '')::uuid)
      AND (${filters.courseId ?? ''}::text = '' OR e.course_id = NULLIF(${filters.courseId ?? ''}::text, '')::uuid)
      AND (e.is_published = TRUE OR te.user_id = ${user.id} OR ${user.role === 'admin'}::boolean)
      AND (${!isStudent}::boolean OR EXISTS (
            SELECT 1 FROM enrollments en WHERE en.course_id = e.course_id AND en.student_id = ${ownStudentId}::uuid
          ))
    ORDER BY e.exam_at ASC, e.created_at ASC
  `;

  return rows.map((row) => {
    const canManage = user.role === 'admin' || (user.role === 'teacher' && row.is_mine === true);
    const base = { ...row, can_manage: canManage };
    if (isStudent) {
      // Students never see how the rest of the class did.
      const scored = row.my_score !== null;
      const status = scored
        ? 'scored'
        : new Date(row.exam_at as string).getTime() < Date.now()
          ? 'awaiting_score'
          : 'upcoming';
      return {
        ...base,
        status,
        my_percent: scored ? toPercent(row.my_score as number, row.max_score as number) : null,
        scored_count: null,
        enrolled_count: null,
      };
    }
    return canManage
      ? { ...base, status: null }
      : { ...base, status: null, scored_count: null, enrolled_count: null };
  });
}

export async function listExams(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const query = req.query as { course_id?: string };
  const exams = await queryExams(user, { courseId: optionalUuid(query.course_id, 'course id') || undefined });
  res.json({ exams });
}

export async function getExam(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'exam id');
  const [exam] = await queryExams(user, { id });
  // A draft, or an exam of a course the student is not in, does not exist as far as they can tell.
  if (!exam) throw httpError(404, 'Exam not found');
  res.json({ exam });
}

interface ManagedExam {
  id: string;
  course_id: string;
  course_code: string;
  title: string;
  exam_at: string;
  room: string | null;
  duration_minutes: number | null;
  is_published: boolean;
}

/** Admins may manage any exam; teachers only the exams of courses they teach. */
async function assertCanManageExam(user: AuthUser, examId: string): Promise<ManagedExam> {
  const [row] = await sql`
    SELECT e.id, e.course_id, c.code AS course_code, e.title, e.exam_at, e.room, e.duration_minutes,
           e.is_published, te.user_id AS teacher_user_id
    FROM exams e
    JOIN courses c ON c.id = e.course_id
    JOIN teachers te ON te.id = c.teacher_id
    WHERE e.id = ${examId}
  `;
  if (!row) throw httpError(404, 'Exam not found');
  if (user.role !== 'admin' && !(user.role === 'teacher' && row.teacher_user_id === user.id)) {
    throw httpError(403, 'You can only manage exams in your own courses');
  }
  return row as unknown as ManagedExam;
}

function examMessage(title: string, code: string, when: string, room: string | null): string {
  return `${title} (${code}) · ${formatManila(when)}${room ? ` · ${formatRoom(room as string)}` : ''}`;
}

export async function createExam(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const input = createExamSchema.parse(req.body);
  await assertCanManageCourse(user, input.course_id);

  // New exams start as drafts: students hear about one only when it is published.
  const [created] = await sql`
    INSERT INTO exams (course_id, title, details, exam_at, duration_minutes, room, max_score, is_published, created_by)
    VALUES (${input.course_id}, ${input.title}, ${input.details || null}, ${input.exam_at},
            ${input.duration_minutes ?? null}, ${input.room || null}, ${input.max_score}, FALSE, ${user.id})
    RETURNING id
  `;
  await recordAudit(req, 'exam.create', 'exam', created.id as string, null, {
    title: input.title,
    course_id: input.course_id,
    exam_at: input.exam_at,
  });
  const [exam] = await queryExams(user, { id: created.id as string });
  res.status(201).json({ exam });
}

export async function updateExam(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'exam id');
  const input = updateExamSchema.parse(req.body);
  const before = await assertCanManageExam(user, id);

  // Taking an exam back to draft would hide scores students have already been given.
  if (input.is_published === false && before.is_published) {
    const [scored] = await sql`
      SELECT COUNT(*)::int AS n FROM manual_scores WHERE item_type = 'exam' AND item_id = ${id}
    `;
    if (scored && scored.n > 0) {
      throw httpError(409, 'Scores have already been recorded, so this exam can no longer be unpublished.');
    }
  }
  // Lowering the maximum below a score that was already typed in would leave an impossible score.
  if (input.max_score !== undefined) {
    const [over] = await sql`
      SELECT COUNT(*)::int AS n FROM manual_scores
      WHERE item_type = 'exam' AND item_id = ${id} AND score > ${input.max_score}::numeric
    `;
    if (over && over.n > 0) {
      throw httpError(409, 'Some students already have a score higher than that maximum.');
    }
  }

  const durationProvided = input.duration_minutes !== undefined;
  const detailsProvided = input.details !== undefined;
  const roomProvided = input.room !== undefined;
  await sql`
    UPDATE exams
    SET title = COALESCE(${input.title ?? null}, title),
        details = CASE WHEN ${detailsProvided}::boolean THEN NULLIF(${input.details ?? ''}::text, '') ELSE details END,
        exam_at = COALESCE(${input.exam_at ?? null}::timestamptz, exam_at),
        duration_minutes = CASE WHEN ${durationProvided}::boolean THEN ${input.duration_minutes ?? null}::int ELSE duration_minutes END,
        room = CASE WHEN ${roomProvided}::boolean THEN NULLIF(${input.room ?? ''}::text, '') ELSE room END,
        max_score = COALESCE(${input.max_score ?? null}::numeric, max_score),
        is_published = COALESCE(${input.is_published ?? null}::boolean, is_published)
    WHERE id = ${id}
  `;

  const changes = diffValues(
    {
      title: before.title,
      exam_at: new Date(before.exam_at).toISOString(),
      room: before.room,
      is_published: before.is_published,
    },
    {
      title: input.title,
      exam_at: input.exam_at ? new Date(input.exam_at).toISOString() : undefined,
      room: roomProvided ? input.room || null : undefined,
      is_published: input.is_published,
    },
  );
  if (changes) await recordAudit(req, 'exam.update', 'exam', id, changes.old, changes.new);

  // Students are told once when the exam is announced, and again if its time or place changes.
  try {
    const [fresh] = await sql`SELECT title, exam_at, room, is_published FROM exams WHERE id = ${id}`;
    if (fresh?.is_published) {
      const announced = !before.is_published;
      const moved =
        before.is_published &&
        (new Date(fresh.exam_at as string).getTime() !== new Date(before.exam_at).getTime() ||
          (fresh.room ?? null) !== (before.room ?? null));
      if (announced || moved) {
        await notifyCourseStudents(before.course_id, {
          type: 'exam',
          title: announced ? 'New exam' : 'Exam updated',
          message: examMessage(fresh.title as string, before.course_code, fresh.exam_at as string, fresh.room as string | null),
          link: `/exams/${id}`,
        });
      }
    }
  } catch (err) {
    console.error('[exams] could not notify students:', err);
  }

  const [exam] = await queryExams(user, { id });
  res.json({ exam });
}

export async function deleteExam(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'exam id');
  const before = await assertCanManageExam(user, id);

  // The typed-in scores, and the grade rows they created, go with the exam.
  await deleteScoresOf('exam', [id]);
  await sql`DELETE FROM exams WHERE id = ${id}`;
  await recordAudit(req, 'exam.delete', 'exam', id, { title: before.title, course_id: before.course_id }, null);
  res.json({ message: 'Exam deleted' });
}
