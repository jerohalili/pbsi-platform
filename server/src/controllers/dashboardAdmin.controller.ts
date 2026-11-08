import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import { httpError } from '../utils/access.js';
import { runSections, SCHOOL_TIMEZONE } from '../utils/dashboardSections.js';
import { schoolYearTerm } from '../utils/gradeTerm.js';

const AUDIT_STREAM_LIMIT = 10;
const ALERT_ITEMS_LIMIT = 10;
// Sign-ins are recorded in the audit trail too, but there are so many that they would bury every
// change an admin cares about. They are counted in the 7-day numbers and stay in the Audit Logs page.
const SIGN_IN_ACTIONS = ['login', 'login_failed', 'login_blocked_inactive'];

/**
 * GET /api/dashboard/admin: what the admin dashboard shows beyond the four stat cards (those still
 * come from /api/dashboard/stats). Each section loads on its own, so one failing query never blanks
 * the page. (The announcements box reads GET /api/announcements, as for the other roles.)
 *
 * The audit stream deliberately carries only who, what and when: no IP address and no before/after
 * values (the Audit Logs page is where an admin goes for the details).
 */
export async function getAdminDashboard(req: Request, res: Response): Promise<void> {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const tz = SCHOOL_TIMEZONE;

  const { data, errors } = await runSections({
    // ---- key numbers, and what happened in the last 7 days (today and the 6 days before it)
    metrics: async () => {
      const [counts] = await sql`
        SELECT
          (SELECT COUNT(*) FROM students st JOIN users u ON u.id = st.user_id WHERE u.is_active = TRUE)::int AS active_students,
          (SELECT COUNT(*) FROM teachers te JOIN users u ON u.id = te.user_id WHERE u.is_active = TRUE)::int AS active_teachers,
          (SELECT COUNT(*) FROM courses)::int AS courses
      `;
      const [window] = await sql`
        SELECT
          COUNT(*) FILTER (WHERE action = 'login')::int AS logins,
          COUNT(*) FILTER (WHERE action IN ('login_failed', 'login_blocked_inactive'))::int AS failed_logins,
          COUNT(*)::int AS events
        FROM audit_logs
        WHERE (created_at AT TIME ZONE ${tz}::text)::date >= (now() AT TIME ZONE ${tz}::text)::date - 6
      `;
      const [handins] = await sql`
        SELECT COUNT(*)::int AS handins FROM submissions
        WHERE (submitted_at AT TIME ZONE ${tz}::text)::date >= (now() AT TIME ZONE ${tz}::text)::date - 6
      `;
      const days = await sql`
        SELECT to_char(d.day, 'YYYY-MM-DD') AS date, COUNT(al.id)::int AS events
        FROM (SELECT ((now() AT TIME ZONE ${tz}::text)::date - g) AS day FROM generate_series(6, 0, -1) AS g) d
        LEFT JOIN audit_logs al ON (al.created_at AT TIME ZONE ${tz}::text)::date = d.day
        GROUP BY d.day
        ORDER BY d.day ASC
      `;
      return {
        active_students: counts.active_students as number,
        active_teachers: counts.active_teachers as number,
        courses: counts.courses as number,
        activity: {
          days,
          events: window.events as number,
          logins: window.logins as number,
          failed_logins: window.failed_logins as number,
          handins: handins.handins as number,
        },
      };
    },

    // ---- the latest changes made in the system: who, what, when
    audit_stream: async () =>
      sql`
        SELECT al.id, al.action, al.entity_type, al.created_at,
               COALESCE(NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), u.email) AS actor_name
        FROM audit_logs al
        JOIN users u ON u.id = al.actor_id
        LEFT JOIN profiles p ON p.user_id = u.id
        WHERE al.action <> ALL (${SIGN_IN_ACTIONS}::text[])
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT ${AUDIT_STREAM_LIMIT}
      `,

    // ---- the current school year and how much is set up in it
    school_year: async () => {
      const term = schoolYearTerm();
      const [row] = await sql`
        SELECT
          (SELECT COUNT(*) FROM courses)::int AS courses,
          (SELECT COUNT(*) FROM timetable)::int AS timetable_entries,
          (SELECT COUNT(*) FROM enrollments)::int AS enrollments,
          (SELECT COUNT(DISTINCT e.student_id) FROM enrollments e
             JOIN students st ON st.id = e.student_id JOIN users u ON u.id = st.user_id
            WHERE u.is_active = TRUE)::int AS students_enrolled,
          (SELECT COUNT(DISTINCT c.teacher_id) FROM courses c
             JOIN teachers te ON te.id = c.teacher_id JOIN users u ON u.id = te.user_id
            WHERE u.is_active = TRUE)::int AS teachers_teaching
      `;
      return { term, start_year: Number(term), end_year: Number(term) + 1, ...row };
    },

    // ---- real problems in the set-up, each with a few examples to open (and the full count)
    alerts: async () => {
      const [noTimetable, noStudents, noModules, idleTeachers, idleStudents] = await Promise.all([
        sql`
          SELECT c.id, c.code, c.name, COUNT(*) OVER()::int AS total
          FROM courses c
          WHERE NOT EXISTS (SELECT 1 FROM timetable t WHERE t.course_id = c.id)
          ORDER BY c.code ASC LIMIT ${ALERT_ITEMS_LIMIT}
        `,
        sql`
          SELECT c.id, c.code, c.name, COUNT(*) OVER()::int AS total
          FROM courses c
          WHERE NOT EXISTS (
            SELECT 1 FROM enrollments e JOIN students st ON st.id = e.student_id JOIN users u ON u.id = st.user_id
            WHERE e.course_id = c.id AND u.is_active = TRUE)
          ORDER BY c.code ASC LIMIT ${ALERT_ITEMS_LIMIT}
        `,
        sql`
          SELECT c.id, c.code, c.name, COUNT(*) OVER()::int AS total
          FROM courses c
          WHERE NOT EXISTS (SELECT 1 FROM modules m WHERE m.course_id = c.id)
          ORDER BY c.code ASC LIMIT ${ALERT_ITEMS_LIMIT}
        `,
        sql`
          SELECT te.id,
                 COALESCE(NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), u.email) AS name,
                 COUNT(*) OVER()::int AS total
          FROM teachers te
          JOIN users u ON u.id = te.user_id
          LEFT JOIN profiles p ON p.user_id = u.id
          WHERE u.is_active = TRUE AND NOT EXISTS (SELECT 1 FROM courses c WHERE c.teacher_id = te.id)
          ORDER BY name ASC LIMIT ${ALERT_ITEMS_LIMIT}
        `,
        sql`
          SELECT st.id,
                 COALESCE(NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), u.email) AS name,
                 COUNT(*) OVER()::int AS total
          FROM students st
          JOIN users u ON u.id = st.user_id
          LEFT JOIN profiles p ON p.user_id = u.id
          WHERE u.is_active = TRUE AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = st.id)
          ORDER BY name ASC LIMIT ${ALERT_ITEMS_LIMIT}
        `,
      ]);
      const course = (r: Record<string, unknown>) => ({ id: r.id as string, label: `${r.code as string} · ${r.name as string}`, link: `/courses/${r.id as string}` });
      const person = (r: Record<string, unknown>) => ({ id: r.id as string, label: r.name as string, link: '/users' });
      const total = (rows: Array<Record<string, unknown>>) => (rows[0]?.total as number | undefined) ?? 0;
      const groups = [
        { key: 'courses_no_timetable', total: total(noTimetable), items: noTimetable.map(course) },
        { key: 'courses_no_students', total: total(noStudents), items: noStudents.map(course) },
        { key: 'courses_no_modules', total: total(noModules), items: noModules.map(course) },
        { key: 'teachers_no_courses', total: total(idleTeachers), items: idleTeachers.map(person) },
        { key: 'students_not_enrolled', total: total(idleStudents), items: idleStudents.map(person) },
      ];
      return { total: groups.reduce((sum, g) => sum + g.total, 0), groups };
    },
  });

  res.json({ generated_at: new Date().toISOString(), ...data, errors });
}
