import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import { getOwnStudentId, httpError } from '../utils/access.js';
import { runSections, SCHOOL_TIMEZONE } from '../utils/dashboardSections.js';

const TODO_GROUP_LIMIT = 10;
const COURSEWORK_PATH: Record<string, string> = { assignment: '/assignments', quiz: '/quizzes', exam: '/exams' };

function itemLink(kind: string, id: string): string {
  return `${COURSEWORK_PATH[kind] ?? '/coursework'}/${id}`;
}

/**
 * GET /api/dashboard/student: everything the student dashboard shows beyond the four stat cards
 * (those still come from /api/dashboard/stats). Only enrolled courses and published items appear.
 * Every section is loaded on its own, so one failing query never blanks the page.
 */
export async function getStudentDashboard(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) throw httpError(401, 'Not authenticated');
  const studentId = await getOwnStudentId(user.id);
  if (!studentId) throw httpError(404, 'Student record not found');

  const tz = SCHOOL_TIMEZONE;

  const { data, errors } = await runSections({
    // ---- today's classes, with this student's own attendance for each
    today: async () => {
      const [day] = await sql`
        SELECT EXTRACT(ISODOW FROM (now() AT TIME ZONE ${tz}::text))::int AS day_of_week,
               to_char((now() AT TIME ZONE ${tz}::text), 'YYYY-MM-DD') AS date
      `;
      const classes = await sql`
        SELECT t.id, t.period_number, to_char(t.start_time, 'HH24:MI') AS start_time,
               to_char(t.end_time, 'HH24:MI') AS end_time, t.room,
               c.id AS course_id, c.code AS course_code, c.name AS course_name,
               TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS teacher_name,
               att.status AS attendance_status
        FROM timetable t
        JOIN courses c ON c.id = t.course_id
        JOIN teachers te ON te.id = t.teacher_id
        LEFT JOIN profiles p ON p.user_id = te.user_id
        LEFT JOIN LATERAL (
          SELECT a.status FROM attendance a
          WHERE a.student_id = ${studentId}::uuid AND a.course_id = t.course_id
            AND a.date::date = (now() AT TIME ZONE ${tz}::text)::date
          LIMIT 1
        ) att ON TRUE
        WHERE t.day_of_week = ${day.day_of_week as number}
          AND EXISTS (SELECT 1 FROM enrollments en WHERE en.course_id = c.id AND en.student_id = ${studentId}::uuid)
        ORDER BY t.period_number ASC, t.start_time ASC
      `;
      return { date: day.date as string, day_of_week: day.day_of_week as number, classes };
    },

    // ---- to-do: unsubmitted assignments (overdue first), then in-person items and exams by date,
    //      then published online quizzes not yet taken
    todo: async () => {
      const [assignments, scheduled, quizzes] = await Promise.all([
        sql`
          SELECT a.id, a.title, a.due_date AS at, (a.due_date < now()) AS is_overdue,
                 c.id AS course_id, c.code AS course_code
          FROM assignments a
          JOIN modules m ON m.id = a.module_id
          JOIN courses c ON c.id = m.course_id
          WHERE a.is_published = TRUE AND a.delivery = 'online'
            AND EXISTS (SELECT 1 FROM enrollments en WHERE en.course_id = c.id AND en.student_id = ${studentId}::uuid)
            AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.assignment_id = a.id AND s.student_id = ${studentId}::uuid)
          ORDER BY a.due_date ASC
          LIMIT ${TODO_GROUP_LIMIT + 1}
        `,
        sql`
          SELECT x.kind, x.id, x.title, x.at, x.room, x.course_id, x.course_code
          FROM (
            SELECT 'assignment'::text AS kind, a.id, a.title, a.due_date AS at, a.room, c.id AS course_id, c.code AS course_code
            FROM assignments a JOIN modules m ON m.id = a.module_id JOIN courses c ON c.id = m.course_id
            WHERE a.is_published = TRUE AND a.delivery = 'in_person'
            UNION ALL
            SELECT 'quiz'::text, q.id, q.title, q.scheduled_at, q.room, c.id, c.code
            FROM quizzes q JOIN courses c ON c.id = q.course_id
            WHERE q.is_published = TRUE AND q.delivery = 'in_person'
            UNION ALL
            SELECT 'exam'::text, e.id, e.title, e.exam_at, e.room, c.id, c.code
            FROM exams e JOIN courses c ON c.id = e.course_id
            WHERE e.is_published = TRUE
          ) x
          WHERE x.at >= (date_trunc('day', now() AT TIME ZONE ${tz}::text) AT TIME ZONE ${tz}::text)
            AND EXISTS (SELECT 1 FROM enrollments en WHERE en.course_id = x.course_id AND en.student_id = ${studentId}::uuid)
          ORDER BY x.at ASC
          LIMIT ${TODO_GROUP_LIMIT + 1}
        `,
        sql`
          SELECT q.id, q.title, q.time_limit_minutes, c.id AS course_id, c.code AS course_code
          FROM quizzes q
          JOIN courses c ON c.id = q.course_id
          WHERE q.is_published = TRUE AND q.delivery = 'online'
            AND EXISTS (SELECT 1 FROM enrollments en WHERE en.course_id = c.id AND en.student_id = ${studentId}::uuid)
            AND NOT EXISTS (SELECT 1 FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.student_id = ${studentId}::uuid)
          ORDER BY q.created_at DESC
          LIMIT ${TODO_GROUP_LIMIT + 1}
        `,
      ]);
      const cut = <T,>(rows: T[]) => rows.slice(0, TODO_GROUP_LIMIT);
      const items = [
        ...cut(assignments).map((r) => ({ group: 'assignment', kind: 'assignment', ...r, link: itemLink('assignment', r.id as string) })),
        ...cut(scheduled).map((r) => ({ group: 'scheduled', ...r, link: itemLink(r.kind as string, r.id as string) })),
        ...cut(quizzes).map((r) => ({ group: 'quiz', kind: 'quiz', ...r, link: itemLink('quiz', r.id as string) })),
      ];
      return {
        items,
        truncated: assignments.length > TODO_GROUP_LIMIT || scheduled.length > TODO_GROUP_LIMIT || quizzes.length > TODO_GROUP_LIMIT,
      };
    },

    // ---- one card per enrolled course, with its unread notifications
    courses: async () =>
      sql`
        SELECT c.id AS course_id, c.code, c.name,
               TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS teacher_name,
               (SELECT COUNT(*) FROM notifications n
                 WHERE n.user_id = ${user.id} AND n.course_id = c.id AND n.is_read = FALSE)::int AS unread
        FROM enrollments en
        JOIN courses c ON c.id = en.course_id
        JOIN teachers te ON te.id = c.teacher_id
        LEFT JOIN profiles p ON p.user_id = te.user_id
        WHERE en.student_id = ${studentId}::uuid
        ORDER BY c.code ASC
      `,

    // ---- the latest grades, with the teacher's feedback
    recent_grades: async () =>
      sql`
        SELECT g.id, g.assessment_type, g.assessment_id, g.score::float8 AS score, g.feedback, g.created_at,
               COALESCE(q.title, a.title, ex.title) AS title, c.code AS course_code
        FROM grades g
        JOIN courses c ON c.id = g.course_id
        LEFT JOIN quizzes q ON g.assessment_type = 'quiz' AND q.id = g.assessment_id
        LEFT JOIN assignments a ON g.assessment_type = 'assignment' AND a.id = g.assessment_id
        LEFT JOIN exams ex ON g.assessment_type = 'exam' AND ex.id = g.assessment_id
        WHERE g.student_id = ${studentId}::uuid
        ORDER BY g.created_at DESC
        LIMIT 5
      `,

    // ---- needs attention: notes from a teacher that this student has not seen yet
    attention: async () => {
      const notes = await sql`
        SELECT cm.id, cm.item_type, cm.item_id, cm.reason, LEFT(cm.message, 200) AS message, cm.created_at,
               c.code AS course_code, COALESCE(a.title, q.title, ex.title) AS item_title
        FROM coursework_mentions cm
        JOIN courses c ON c.id = cm.course_id
        LEFT JOIN assignments a ON cm.item_type = 'assignment' AND a.id = cm.item_id
        LEFT JOIN quizzes q ON cm.item_type = 'quiz' AND q.id = cm.item_id
        LEFT JOIN exams ex ON cm.item_type = 'exam' AND ex.id = cm.item_id
        WHERE cm.student_id = ${studentId}::uuid AND cm.resolved_at IS NULL AND cm.acknowledged_at IS NULL
        ORDER BY cm.created_at DESC
        LIMIT 10
      `;
      const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count FROM coursework_mentions
        WHERE student_id = ${studentId}::uuid AND resolved_at IS NULL AND acknowledged_at IS NULL
      `;
      return { count: count as number, notes: notes.map((n) => ({ ...n, link: itemLink(n.item_type as string, n.item_id as string) })) };
    },

    // ---- discussion highlights: there is no read-tracking in discussions, so these are the
    //      unread discussion notifications
    discussion_highlights: async () =>
      sql`
        SELECT n.id, n.title, n.message, n.link, n.created_at, c.code AS course_code
        FROM notifications n
        LEFT JOIN courses c ON c.id = n.course_id
        WHERE n.user_id = ${user.id} AND n.type = 'discussion' AND n.is_read = FALSE
        ORDER BY n.created_at DESC
        LIMIT 5
      `,
  });

  res.json({ generated_at: new Date().toISOString(), ...data, errors });
}
