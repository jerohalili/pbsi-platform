import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import {
  assertCanManageCourse,
  getOwnStudentId,
  httpError,
  optionalDate,
  optionalUuid,
  parseUuid,
  rethrowDbError,
} from '../utils/access.js';
import { recordAudit } from '../utils/audit.js';
import { notifyUsers } from '../utils/notify.js';
import type { AuthUser } from '../types/index.js';
import type { AttendanceInput, BulkAttendanceInput } from '../utils/validation.js';

// "Today" is evaluated in the school's timezone, not the database's (UTC).
// Same value as dashboard.controller.ts.
const SCHOOL_TIMEZONE = 'Asia/Manila';

/** Attendance describes something that already happened, so a date after today is refused. */
async function assertNotFutureDate(date: string): Promise<void> {
  const [row] = await sql`
    SELECT (${date}::date > (NOW() AT TIME ZONE ${SCHOOL_TIMEZONE}::text)::date) AS is_future
  `;
  if (row?.is_future) throw httpError(400, 'Attendance cannot be recorded for a future date');
}

/**
 * Attendance is taken for the students enrolled in the course. A student who was removed from the
 * course after being marked on that day can still be corrected, so the day's history stays editable.
 */
async function assertRosterStudents(courseId: string, date: string, studentIds: string[]): Promise<void> {
  const rows = await sql`
    SELECT s AS id
    FROM unnest(${studentIds}::uuid[]) AS s
    WHERE NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = ${courseId} AND e.student_id = s)
      AND NOT EXISTS (
        SELECT 1 FROM attendance a WHERE a.course_id = ${courseId} AND a.student_id = s AND a.date = ${date}::date
      )
  `;
  if (rows.length > 0) {
    throw httpError(409, 'Some of these students are not enrolled in this course. Refresh the page and try again.');
  }
}

export async function listAttendance(_req: Request, res: Response): Promise<void> {
  const { course_id, date, student_id } = _req.query as {
    course_id?: string;
    date?: string;
    student_id?: string;
  };
  const user = _req.user as AuthUser;

  const courseParam = optionalUuid(course_id, 'course id');
  const dateParam = optionalDate(date, 'date');
  let studentParam = optionalUuid(student_id, 'student id');

  // Students only ever see their own attendance.
  if (user.role === 'student') {
    const ownId = await getOwnStudentId(user.id);
    if (!ownId) {
      res.json({ attendance: [] });
      return;
    }
    if (studentParam && studentParam !== ownId) {
      throw httpError(403, 'Forbidden: you can only view your own attendance');
    }
    studentParam = ownId;
  }

  // Teachers only see attendance for the courses they teach; admins see everything.
  const teacherOnly = user.role === 'teacher';

  const records = await sql`
    SELECT a.id, a.student_id, a.course_id, a.date::text AS date, a.status, a.marked_by, a.marked_at,
           c.code AS course_code, c.name AS course_name,
           p.first_name, p.last_name
    FROM attendance a
    JOIN students st ON st.id = a.student_id
    JOIN profiles p ON p.user_id = st.user_id
    JOIN courses c ON c.id = a.course_id
    WHERE (${courseParam}::text = '' OR a.course_id = NULLIF(${courseParam}::text, '')::uuid)
      AND (${dateParam}::text = '' OR a.date = NULLIF(${dateParam}::text, '')::date)
      AND (${studentParam}::text = '' OR a.student_id = NULLIF(${studentParam}::text, '')::uuid)
      AND (${teacherOnly}::boolean = FALSE OR a.course_id IN (
            SELECT tc.id FROM courses tc
            JOIN teachers t ON t.id = tc.teacher_id
            WHERE t.user_id = ${user.id}
          ))
    ORDER BY a.date DESC, c.code ASC, p.last_name ASC, p.first_name ASC
    LIMIT 500
  `;
  res.json({ attendance: records });
}

/**
 * The class list for taking attendance: every active student enrolled in the course, with the
 * status already saved for this course and date (null = not marked yet). A student who was
 * marked that day and has since been removed from the course stays on that day's list.
 */
export async function getRoster(req: Request, res: Response): Promise<void> {
  const user = req.user as AuthUser;
  const { course_id, date } = req.query as { course_id?: string; date?: string };

  const courseId = parseUuid(course_id, 'course id');
  const dateParam = optionalDate(date, 'date');
  if (!dateParam) throw httpError(400, 'A date is required');

  await assertCanManageCourse(user, courseId);

  const students = await sql`
    SELECT st.id AS student_id, st.student_id AS student_number,
           p.first_name, p.last_name,
           a.status, a.marked_at
    FROM students st
    JOIN users u ON u.id = st.user_id
    JOIN profiles p ON p.user_id = u.id
    LEFT JOIN attendance a
           ON a.student_id = st.id AND a.course_id = ${courseId} AND a.date = ${dateParam}::date
    WHERE (
            u.is_active = TRUE
            AND EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = st.id AND e.course_id = ${courseId})
          )
       OR a.id IS NOT NULL
    ORDER BY p.last_name ASC, p.first_name ASC
  `;
  res.json({ students });
}

/**
 * Tells students they were marked absent (the one attendance status worth an alert; "present" and
 * "late" would only add noise). Best effort: never blocks saving attendance.
 */
async function notifyAbsences(courseId: string, date: string, studentIds: string[]): Promise<void> {
  if (studentIds.length === 0) return;
  try {
    const rows = await sql`
      SELECT st.user_id, c.code
      FROM students st
      CROSS JOIN courses c
      WHERE st.id = ANY(${studentIds}::uuid[]) AND c.id = ${courseId}
    `;
    await notifyUsers(
      rows.map((row) => row.user_id as string),
      {
        type: 'attendance',
        title: 'Marked absent',
        message: `You were marked absent in ${rows[0]?.code ?? 'a class'} on ${date}`,
        link: '/attendance',
        course_id: courseId,
      },
    );
  } catch (err) {
    console.error('[attendance] could not notify absent students:', err);
  }
}

export async function markAttendance(req: Request, res: Response): Promise<void> {
  const { student_id, course_id, date, status } = req.body as AttendanceInput;
  const user = req.user as AuthUser;

  await assertCanManageCourse(user, course_id);
  await assertNotFutureDate(date);
  await assertRosterStudents(course_id, date, [student_id]);

  const [previous] = await sql`
    SELECT id, status FROM attendance
    WHERE student_id = ${student_id} AND course_id = ${course_id} AND date = ${date}::date
  `;

  let record;
  try {
    [record] = await sql`
      INSERT INTO attendance (student_id, course_id, date, status, marked_by)
      VALUES (${student_id}, ${course_id}, ${date}, ${status}, ${user.id})
      ON CONFLICT (student_id, course_id, date)
      DO UPDATE SET status = EXCLUDED.status,
                    marked_by = EXCLUDED.marked_by,
                    marked_at = NOW()
      RETURNING id, student_id, course_id, date::text AS date, status, marked_at
    `;
  } catch (err) {
    rethrowDbError(err, { foreignKey: 'That student or course no longer exists' });
  }

  // Changing an already-recorded status is a correction, so keep who changed it and from what.
  if (previous && previous.status !== status) {
    await recordAudit(
      req,
      'attendance.override',
      'attendance',
      record.id as string,
      { status: previous.status },
      { status },
    );
  }
  if (status === 'absent' && previous?.status !== 'absent') {
    await notifyAbsences(course_id, date, [student_id]);
  }
  res.status(201).json({ record });
}

/**
 * Saves a whole class session in one transaction: either every row is stored or none is.
 * Rows whose status is already what was sent are skipped, so re-saving never rewrites who
 * originally marked a student.
 */
export async function markAttendanceBulk(req: Request, res: Response): Promise<void> {
  const { course_id, date, records } = req.body as BulkAttendanceInput;
  const user = req.user as AuthUser;

  const ids = records.map((r) => r.student_id);
  if (new Set(ids).size !== ids.length) throw httpError(400, 'Each student can only appear once');

  await assertCanManageCourse(user, course_id);
  await assertNotFutureDate(date);
  await assertRosterStudents(course_id, date, ids);

  const existingRows = await sql`
    SELECT id, student_id, status FROM attendance
    WHERE course_id = ${course_id} AND date = ${date}::date
  `;
  const existing = new Map(
    existingRows.map((row) => [row.student_id as string, { id: row.id as string, status: row.status as string }]),
  );

  const changed = records.filter((r) => existing.get(r.student_id)?.status !== r.status);
  if (changed.length === 0) {
    res.json({ saved: 0, unchanged: records.length });
    return;
  }

  const statements = changed.map(
    (r) => sql`
      INSERT INTO attendance (student_id, course_id, date, status, marked_by)
      VALUES (${r.student_id}, ${course_id}, ${date}, ${r.status}, ${user.id})
      ON CONFLICT (student_id, course_id, date)
      DO UPDATE SET status = EXCLUDED.status,
                    marked_by = EXCLUDED.marked_by,
                    marked_at = NOW()
      RETURNING id
    `,
  );

  let results;
  try {
    results = await sql.transaction(statements);
  } catch (err) {
    rethrowDbError(err, {
      foreignKey: 'A student or the course no longer exists. Refresh the page and try again.',
    });
  }

  // Corrections (a status that replaced a different one) are audited, like grade overrides.
  await Promise.all(
    changed.flatMap((r, index) => {
      const before = existing.get(r.student_id);
      const id = results[index]?.[0]?.id as string | undefined;
      if (!before || !id) return [];
      return [
        recordAudit(req, 'attendance.override', 'attendance', id, { status: before.status }, { status: r.status }),
      ];
    }),
  );

  await notifyAbsences(
    course_id,
    date,
    changed.filter((r) => r.status === 'absent').map((r) => r.student_id),
  );

  res.json({ saved: changed.length, unchanged: records.length - changed.length });
}

export async function getAttendanceSummary(_req: Request, res: Response): Promise<void> {
  const { student_id: rawId } = _req.params as { student_id: string };
  const user = _req.user as AuthUser;

  // "me" means the signed-in student; anyone else gets an empty summary for it.
  let studentId: string | null;
  if (rawId === 'me') {
    studentId = await getOwnStudentId(user.id);
  } else {
    studentId = parseUuid(rawId, 'student id');
    if (user.role === 'student' && studentId !== (await getOwnStudentId(user.id))) {
      throw httpError(403, 'Forbidden: you can only view your own attendance');
    }
  }

  const [summary] = await sql`
    SELECT
      (COUNT(*) FILTER (WHERE status = 'present'))::int AS present_count,
      (COUNT(*) FILTER (WHERE status = 'absent'))::int AS absent_count,
      (COUNT(*) FILTER (WHERE status = 'late'))::int AS late_count,
      (COUNT(*) FILTER (WHERE status = 'excused'))::int AS excused_count,
      COUNT(*)::int AS total_count,
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE status = 'present') /
        NULLIF(COUNT(*) FILTER (WHERE status IN ('present','absent','late')), 0),
        2
      )::float8 AS attendance_percentage
    FROM attendance
    WHERE student_id = ${studentId}
  `;
  res.json({ summary });
}
