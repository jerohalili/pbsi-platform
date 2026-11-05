import { z } from 'zod';
import { sql } from '../config/db.js';
import type { AppError } from '../middleware/errorHandler.js';
import type { AuthUser } from '../types/index.js';

export function httpError(statusCode: number, message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = statusCode;
  return err;
}

/** Returns the value if it is a valid UUID, otherwise throws a 400 (instead of a database error). */
export function parseUuid(raw: unknown, label = 'id'): string {
  const result = z.string().uuid().safeParse(raw);
  if (!result.success) throw httpError(400, `Invalid ${label}`);
  return result.data;
}

/** students.id of the signed-in user, or null when they have no student record. */
export async function getOwnStudentId(userId: string): Promise<string | null> {
  const [row] = await sql`SELECT id FROM students WHERE user_id = ${userId} LIMIT 1`;
  return row ? (row.id as string) : null;
}

/** teachers.id of the signed-in user, or null when they have no teacher record. */
export async function getOwnTeacherId(userId: string): Promise<string | null> {
  const [row] = await sql`SELECT id FROM teachers WHERE user_id = ${userId} LIMIT 1`;
  return row ? (row.id as string) : null;
}

/**
 * Students see only the courses they are enrolled in. For a student this answers 404 (so the
 * course does not reveal itself) unless they are enrolled; teachers and admins are not restricted
 * here (what they may change is decided by assertCanManageCourse).
 */
export async function assertEnrolledIfStudent(
  user: AuthUser,
  courseId: string,
  notFoundMessage = 'Course not found',
): Promise<void> {
  if (user.role !== 'student') return;
  const [row] = await sql`
    SELECT 1 AS ok
    FROM enrollments e
    JOIN students st ON st.id = e.student_id
    WHERE e.course_id = ${parseUuid(courseId, 'course id')} AND st.user_id = ${user.id}
  `;
  if (!row) throw httpError(404, notFoundMessage);
}

/**
 * Admins may manage any course; teachers only the courses they teach.
 * Throws 404 when the course does not exist and 403 when it belongs to someone else.
 */
export async function assertCanManageCourse(user: AuthUser, courseId: string): Promise<void> {
  const [course] = await sql`
    SELECT c.id, t.user_id AS teacher_user_id
    FROM courses c
    JOIN teachers t ON t.id = c.teacher_id
    WHERE c.id = ${courseId}
  `;
  if (!course) throw httpError(404, 'Course not found');
  if (user.role === 'admin') return;
  if (user.role === 'teacher' && course.teacher_user_id === user.id) return;
  throw httpError(403, 'You can only manage your own courses');
}

/** Same rule as assertCanManageCourse, resolved through a module. Returns the module's course id. */
export async function assertCanManageModule(user: AuthUser, moduleId: string): Promise<string> {
  const [module] = await sql`SELECT course_id FROM modules WHERE id = ${moduleId}`;
  if (!module) throw httpError(404, 'Module not found');
  await assertCanManageCourse(user, module.course_id as string);
  return module.course_id as string;
}

/** Turns common database constraint errors into friendly 409 responses; rethrows anything else. */
export function rethrowDbError(
  err: unknown,
  messages: { unique?: string; foreignKey?: string },
): never {
  const code = (err as { code?: string } | null)?.code;
  if (code === '23505' && messages.unique) throw httpError(409, messages.unique);
  if (code === '23503' && messages.foreignKey) throw httpError(409, messages.foreignKey);
  throw err;
}

/** Optional uuid query filter: '' when absent, 400 when present but malformed. */
export function optionalUuid(raw: unknown, label: string): string {
  if (raw === undefined || raw === null || raw === '') return '';
  return parseUuid(raw, label);
}

/** Optional YYYY-MM-DD query filter: '' when absent, 400 when present but malformed. */
export function optionalDate(raw: unknown, label: string): string {
  if (raw === undefined || raw === null || raw === '') return '';
  const result = z.string().date().safeParse(raw);
  if (!result.success) throw httpError(400, `Invalid ${label}`);
  return result.data;
}

/** Optional whole-number query filter: '' when absent, 400 when present but not an integer. */
export function optionalInt(raw: unknown, label: string): string {
  if (raw === undefined || raw === null || raw === '') return '';
  const result = z.coerce.number().int().safeParse(raw);
  if (!result.success) throw httpError(400, `Invalid ${label}`);
  return String(result.data);
}

/** Links shown to other users must be web links; rejects javascript:, data:, etc. Empty is allowed. */
export function assertHttpUrl(value: string | undefined | null, label: string): void {
  if (value && !/^https?:\/\//i.test(value)) {
    throw httpError(400, `${label} must start with http:// or https://`);
  }
}

export interface ManagedAssignment {
  id: string;
  title: string;
  max_score: number;
  due_date: string;
  course_id: string;
  is_published: boolean;
  delivery: 'online' | 'in_person';
}

/**
 * Admins may manage any assignment; teachers only those in courses they teach.
 * Throws 404 for an unknown assignment and 403 for someone else's.
 */
export async function assertCanManageAssignment(
  user: AuthUser,
  assignmentId: string,
): Promise<ManagedAssignment> {
  const [a] = await sql`
    SELECT a.id, a.title, a.max_score::float8 AS max_score, a.due_date, a.is_published, a.delivery,
           m.course_id, te.user_id AS teacher_user_id
    FROM assignments a
    JOIN modules m ON m.id = a.module_id
    JOIN courses c ON c.id = m.course_id
    JOIN teachers te ON te.id = c.teacher_id
    WHERE a.id = ${assignmentId}
  `;
  if (!a) throw httpError(404, 'Assignment not found');
  if (user.role !== 'admin' && !(user.role === 'teacher' && a.teacher_user_id === user.id)) {
    throw httpError(403, 'You can only manage assignments in your own courses');
  }
  return {
    id: a.id as string,
    title: a.title as string,
    max_score: a.max_score as number,
    due_date: a.due_date as string,
    course_id: a.course_id as string,
    is_published: a.is_published as boolean,
    delivery: a.delivery as 'online' | 'in_person',
  };
}

/**
 * Who may open an assignment (its page, its material file): a draft is visible only to the teacher
 * who owns the course and to admins; a published assignment to everyone allowed to see it.
 * Answers 404 either way, so a draft never reveals that it exists.
 */
export async function assertCanViewAssignment(user: AuthUser, assignmentId: string): Promise<void> {
  const [a] = await sql`
    SELECT a.is_published, m.course_id, te.user_id AS teacher_user_id
    FROM assignments a
    JOIN modules m ON m.id = a.module_id
    JOIN courses c ON c.id = m.course_id
    JOIN teachers te ON te.id = c.teacher_id
    WHERE a.id = ${assignmentId}
  `;
  if (!a) throw httpError(404, 'Assignment not found');
  const owner = user.role === 'admin' || (user.role === 'teacher' && a.teacher_user_id === user.id);
  if (!owner && a.is_published !== true) throw httpError(404, 'Assignment not found');
  await assertEnrolledIfStudent(user, a.course_id as string, 'Assignment not found');
}

/**
 * A student may hand in work only for a published assignment of a course they are enrolled in.
 * Answers 404 otherwise, so a draft or someone else's course never reveals that it exists.
 */
export async function assertStudentCanHandIn(studentId: string, assignmentId: string): Promise<void> {
  const [a] = await sql`
    SELECT a.id, a.delivery
    FROM assignments a
    JOIN modules m ON m.id = a.module_id
    WHERE a.id = ${assignmentId}
      AND a.is_published = TRUE
      AND EXISTS (
        SELECT 1 FROM enrollments e WHERE e.course_id = m.course_id AND e.student_id = ${studentId}
      )
  `;
  if (!a) throw httpError(404, 'Assignment not found');
  // An in-person assignment is checked face to face; there is nothing to hand in online.
  if (a.delivery === 'in_person') {
    throw httpError(409, 'This assignment is checked in person, so there is nothing to hand in online.');
  }
}

export interface ManagedQuiz {
  id: string;
  course_id: string;
  title: string;
  is_published: boolean;
  time_limit_minutes: number | null;
  delivery: 'online' | 'in_person';
}

/**
 * Admins may manage any quiz; teachers only quizzes in courses they teach.
 * Throws 404 for an unknown quiz and 403 for someone else's.
 */
export async function assertCanManageQuiz(user: AuthUser, quizId: string): Promise<ManagedQuiz> {
  const [q] = await sql`
    SELECT q.id, q.course_id, q.title, q.is_published, q.time_limit_minutes, q.delivery,
           te.user_id AS teacher_user_id
    FROM quizzes q
    JOIN courses c ON c.id = q.course_id
    JOIN teachers te ON te.id = c.teacher_id
    WHERE q.id = ${quizId}
  `;
  if (!q) throw httpError(404, 'Quiz not found');
  if (user.role !== 'admin' && !(user.role === 'teacher' && q.teacher_user_id === user.id)) {
    throw httpError(403, 'You can only manage quizzes in your own courses');
  }
  return {
    id: q.id as string,
    course_id: q.course_id as string,
    title: q.title as string,
    is_published: q.is_published as boolean,
    time_limit_minutes: q.time_limit_minutes as number | null,
    delivery: q.delivery as 'online' | 'in_person',
  };
}

/**
 * Admins may manage any timetable entry; teachers only entries for courses they teach
 * (matched via the entry's teacher record).
 * Throws 404 for an unknown entry and 403 for someone else's.
 */
export async function assertCanManageTimetableEntry(
  user: AuthUser,
  entryId: string,
): Promise<void> {
  const [entry] = await sql`
    SELECT t.id, te.user_id AS teacher_user_id
    FROM timetable t
    JOIN teachers te ON te.id = t.teacher_id
    WHERE t.id = ${entryId}
  `;
  if (!entry) throw httpError(404, 'Timetable entry not found');
  if (user.role !== 'admin' && !(user.role === 'teacher' && entry.teacher_user_id === user.id)) {
    throw httpError(403, 'You can only manage timetable entries for your own courses');
  }
}

/** Once a student has taken a quiz its questions are frozen, so graded results stay meaningful. */
export async function assertQuizQuestionsEditable(quizId: string): Promise<void> {
  // An in-person quiz has no online questions at all: it is only announced and scored by hand.
  const [kind] = await sql`SELECT delivery FROM quizzes WHERE id = ${quizId}`;
  if (kind?.delivery === 'in_person') {
    throw httpError(409, 'An in-person quiz has no online questions: it is announced here and scored by hand.');
  }
  const [row] = await sql`SELECT COUNT(*)::int AS n FROM quiz_attempts WHERE quiz_id = ${quizId}`;
  if (row && row.n > 0) {
    throw httpError(
      409,
      'Students have already taken this quiz, so its questions can no longer be changed.',
    );
  }
}
