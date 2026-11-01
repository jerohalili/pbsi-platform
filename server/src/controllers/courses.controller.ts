import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import { courseSchema } from '../utils/validation.js';
import {
  assertCanManageCourse,
  assertEnrolledIfStudent,
  getOwnTeacherId,
  httpError,
  parseUuid,
  rethrowDbError,
} from '../utils/access.js';
import type { AuthUser } from '../types/index.js';
import { recordAudit, diffValues } from '../utils/audit.js';

function currentUser(req: Request): AuthUser {
  if (!req.user) throw httpError(401, 'Not authenticated');
  return req.user;
}

async function fetchCourse(id: string, userId: string) {
  const [course] = await sql`
    SELECT c.id, c.code, c.name, c.description, c.credits, c.created_at,
           t.id AS teacher_id,
           p.first_name AS teacher_first_name,
           p.last_name AS teacher_last_name,
           (t.user_id = ${userId}) AS is_mine
    FROM courses c
    JOIN teachers t ON t.id = c.teacher_id
    JOIN users u ON u.id = t.user_id
    JOIN profiles p ON p.user_id = u.id
    WHERE c.id = ${id}
  `;
  return course;
}

/** Staff see every course; a student sees only the courses they are enrolled in. */
export async function listCourses(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const isStudent = user.role === 'student';

  const courses = await sql`
    SELECT c.id, c.code, c.name, c.description, c.credits, c.created_at,
           t.id AS teacher_id,
           p.first_name AS teacher_first_name,
           p.last_name AS teacher_last_name,
           (t.user_id = ${user.id}) AS is_mine
    FROM courses c
    JOIN teachers t ON t.id = c.teacher_id
    JOIN users u ON u.id = t.user_id
    JOIN profiles p ON p.user_id = u.id
    WHERE ${!isStudent}::boolean OR c.id IN (
      SELECT e.course_id
      FROM enrollments e
      JOIN students st ON st.id = e.student_id
      WHERE st.user_id = ${user.id}
    )
    ORDER BY c.code ASC
  `;
  res.json({ courses });
}

export async function getCourse(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'course id');

  await assertEnrolledIfStudent(user, id);
  const course = await fetchCourse(id, user.id);
  if (!course) throw httpError(404, 'Course not found');

  const modules = await sql`
    SELECT m.id, m.course_id, m.title, m.rich_description, m.video_url,
           m.attachment_url, m.order_index, m.created_at
    FROM modules m
    WHERE m.course_id = ${id}
    ORDER BY m.order_index ASC, m.created_at ASC
  `;

  res.json({ course, modules });
}

export async function createCourse(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  // The validation middleware does not replace req.body, so parse again to apply defaults.
  const input = courseSchema.parse(req.body);

  let teacherId: string | undefined = input.teacher_id;
  if (user.role === 'teacher') {
    const own = await getOwnTeacherId(user.id);
    if (!own) throw httpError(404, 'Teacher profile not found');
    teacherId = own;
  }
  if (!teacherId) throw httpError(400, 'Please choose the teacher for this course');

  const [teacher] = await sql`SELECT id FROM teachers WHERE id = ${teacherId}`;
  if (!teacher) throw httpError(404, 'Teacher not found');

  try {
    const [created] = await sql`
      INSERT INTO courses (code, name, description, credits, teacher_id)
      VALUES (${input.code}, ${input.name}, ${input.description || null}, ${input.credits}, ${teacherId})
      RETURNING id
    `;
    await recordAudit(req, 'course.create', 'course', created.id as string, null, {
      code: input.code,
      name: input.name,
      teacher_id: teacherId,
    });
    res.status(201).json({ course: await fetchCourse(created.id as string, user.id) });
  } catch (err) {
    rethrowDbError(err, { unique: 'A course with this code already exists' });
  }
}

export async function updateCourse(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'course id');
  const input = courseSchema.partial().parse(req.body);

  await assertCanManageCourse(user, id);

  if (input.teacher_id !== undefined) {
    if (user.role !== 'admin') throw httpError(403, 'Only an administrator can change a course’s teacher');
    const [teacher] = await sql`SELECT id FROM teachers WHERE id = ${input.teacher_id}`;
    if (!teacher) throw httpError(404, 'Teacher not found');
  }

  const descriptionProvided = input.description !== undefined;
  const [before] = await sql`
    SELECT code, name, description, credits, teacher_id FROM courses WHERE id = ${id}
  `;

  try {
    await sql`
      UPDATE courses
      SET code = COALESCE(${input.code ?? null}, code),
          name = COALESCE(${input.name ?? null}, name),
          description = CASE WHEN ${descriptionProvided}::boolean THEN ${input.description || null} ELSE description END,
          credits = COALESCE(${input.credits ?? null}, credits),
          teacher_id = COALESCE(${input.teacher_id ?? null}, teacher_id)
      WHERE id = ${id}
    `;
  } catch (err) {
    rethrowDbError(err, { unique: 'A course with this code already exists' });
  }

  if (before) {
    const changes = diffValues(before, {
      code: input.code,
      name: input.name,
      description: descriptionProvided ? input.description || null : undefined,
      credits: input.credits,
      teacher_id: input.teacher_id,
    });
    if (changes) await recordAudit(req, 'course.update', 'course', id, changes.old, changes.new);
  }

  res.json({ course: await fetchCourse(id, user.id) });
}

export async function deleteCourse(req: Request, res: Response): Promise<void> {
  const id = parseUuid(req.params.id, 'course id');
  const user = currentUser(req);
  await assertCanManageCourse(user, id);
  const [before] = await sql`SELECT code, name FROM courses WHERE id = ${id}`;

  // Cascade delete all related content before removing the course.
  await sql`DELETE FROM timetable WHERE course_id = ${id}`;
  await sql`DELETE FROM enrollments WHERE course_id = ${id}`;
  await sql`DELETE FROM attendance WHERE course_id = ${id}`;
  await sql`DELETE FROM grades WHERE course_id = ${id}`;
  // Deleting modules cascades to their assignments and submissions.
  await sql`DELETE FROM modules WHERE course_id = ${id}`;
  // Deleting quizzes cascades to their questions and attempts.
  await sql`DELETE FROM quizzes WHERE course_id = ${id}`;

  const [course] = await sql`DELETE FROM courses WHERE id = ${id} RETURNING id`;
  if (!course) throw httpError(404, 'Course not found');
  await recordAudit(req, 'course.delete', 'course', id, before ? { code: before.code, name: before.name } : null, null);
  res.json({ message: 'Course deleted' });
}
