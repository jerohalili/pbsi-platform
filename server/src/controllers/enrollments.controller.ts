import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import { enrollStudentsSchema } from '../utils/validation.js';
import { assertCanManageCourse, httpError, parseUuid } from '../utils/access.js';
import { recordAudit } from '../utils/audit.js';
import { notifyUsers } from '../utils/notify.js';
import type { AuthUser } from '../types/index.js';

function currentUser(req: Request): AuthUser {
  if (!req.user) throw httpError(401, 'Not authenticated');
  return req.user;
}

/** GET /api/courses/:course_id/enrollments: the students in a course (its teacher, or an admin). */
export async function listEnrollments(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const courseId = parseUuid(req.params.course_id, 'course id');
  await assertCanManageCourse(user, courseId);

  const enrollments = await sql`
    SELECT st.id AS student_id, st.student_id AS student_number,
           p.first_name, p.last_name, u.is_active, e.enrolled_at
    FROM enrollments e
    JOIN students st ON st.id = e.student_id
    JOIN users u ON u.id = st.user_id
    JOIN profiles p ON p.user_id = u.id
    WHERE e.course_id = ${courseId}
    ORDER BY p.last_name ASC, p.first_name ASC
  `;
  res.json({ enrollments });
}

/**
 * POST /api/courses/:course_id/enrollments { student_ids }: enrolls active students.
 * Students who are already enrolled (or are not active students) are skipped, so the call can
 * simply be repeated. The new students are told they were added.
 */
export async function addEnrollments(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const courseId = parseUuid(req.params.course_id, 'course id');
  // The validation middleware does not replace req.body, so parse again to apply defaults.
  const input = enrollStudentsSchema.parse(req.body);
  await assertCanManageCourse(user, courseId);

  const ids = [...new Set(input.student_ids)];
  const added = await sql`
    WITH ins AS (
      INSERT INTO enrollments (course_id, student_id, enrolled_by)
      SELECT ${courseId}::uuid, st.id, ${user.id}::uuid
      FROM students st
      JOIN users u ON u.id = st.user_id
      WHERE st.id = ANY(${ids}::uuid[]) AND u.is_active = TRUE
      ON CONFLICT (course_id, student_id) DO NOTHING
      RETURNING student_id
    )
    SELECT ins.student_id, st.user_id
    FROM ins
    JOIN students st ON st.id = ins.student_id
  `;

  if (added.length > 0) {
    await recordAudit(req, 'enrollment.add', 'enrollment', courseId, null, {
      course_id: courseId,
      student_ids: added.map((row) => row.student_id as string),
    });
    try {
      const [course] = await sql`SELECT code, name FROM courses WHERE id = ${courseId}`;
      await notifyUsers(
        added.map((row) => row.user_id as string),
        {
          type: 'system',
          title: 'Added to a course',
          message: `You were added to ${course?.code ?? 'a course'}${course?.name ? ` · ${course.name}` : ''}`,
          link: `/courses/${courseId}`,
          course_id: courseId,
        },
      );
    } catch (err) {
      console.error('[enrollments] could not notify students:', err);
    }
  }

  res.status(201).json({ added: added.length, skipped: ids.length - added.length });
}

/**
 * DELETE /api/courses/:course_id/enrollments/:student_id: removes a student from a course.
 * Their grades, submissions, quiz attempts and attendance are kept; the course simply stops being
 * visible to them.
 */
export async function removeEnrollment(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const courseId = parseUuid(req.params.course_id, 'course id');
  const studentId = parseUuid(req.params.student_id, 'student id');
  await assertCanManageCourse(user, courseId);

  const [removed] = await sql`
    DELETE FROM enrollments WHERE course_id = ${courseId} AND student_id = ${studentId}
    RETURNING student_id
  `;
  if (!removed) throw httpError(404, 'That student is not enrolled in this course');

  await recordAudit(req, 'enrollment.remove', 'enrollment', courseId, { course_id: courseId, student_id: studentId }, null);

  try {
    const [row] = await sql`
      SELECT st.user_id, c.code
      FROM students st
      CROSS JOIN courses c
      WHERE st.id = ${studentId} AND c.id = ${courseId}
    `;
    if (row) {
      await notifyUsers([row.user_id as string], {
        type: 'system',
        title: 'Removed from a course',
        message: `You were removed from ${row.code}. Your grades and past work are kept.`,
        link: null, // no course_id on purpose: they can no longer open the course, so it must not count there
      });
    }
  } catch (err) {
    console.error('[enrollments] could not notify the student:', err);
  }

  res.json({ message: 'Student removed from the course' });
}
