import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import { getOwnTeacherId, httpError } from '../utils/access.js';
import { runSections, SCHOOL_TIMEZONE } from '../utils/dashboardSections.js';

const PENDING_LIMIT = 15;
const DRAFTS_LIMIT = 10;
const ACTIVITY_LIMIT = 10;
const MENTIONS_LIMIT = 10;
const COURSEWORK_PATH: Record<string, string> = { assignment: '/assignments', quiz: '/quizzes', exam: '/exams' };

function itemLink(kind: string, id: string): string {
  return `${COURSEWORK_PATH[kind] ?? '/coursework'}/${id}`;
}

const byTimeDesc = (a: { at: unknown }, b: { at: unknown }) => new Date(b.at as string).getTime() - new Date(a.at as string).getTime();
const byTimeAsc = (a: { since: unknown }, b: { since: unknown }) => new Date(a.since as string).getTime() - new Date(b.since as string).getTime();

/**
 * GET /api/dashboard/teacher: what the teacher dashboard shows beyond the four stat cards (those
 * still come from /api/dashboard/stats). Everything is limited to the teacher's own courses and to
 * active students who are enrolled. Each section loads on its own, so one failing query never
 * blanks the page. (The announcements box reads GET /api/announcements, as for students.)
 */
export async function getTeacherDashboard(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) throw httpError(401, 'Not authenticated');
  const teacherId = await getOwnTeacherId(user.id);
  if (!teacherId) throw httpError(404, 'Teacher record not found');

  const tz = SCHOOL_TIMEZONE;

  const { data, errors } = await runSections({
    // ---- today's classes, with how many students are in each and how many attendance marks exist
    today: async () => {
      const [day] = await sql`
        SELECT EXTRACT(ISODOW FROM (now() AT TIME ZONE ${tz}::text))::int AS day_of_week,
               to_char((now() AT TIME ZONE ${tz}::text), 'YYYY-MM-DD') AS date
      `;
      const classes = await sql`
        SELECT t.id, t.period_number, to_char(t.start_time, 'HH24:MI') AS start_time,
               to_char(t.end_time, 'HH24:MI') AS end_time, t.room,
               c.id AS course_id, c.code AS course_code, c.name AS course_name,
               (SELECT COUNT(*) FROM enrollments e
                  JOIN students st ON st.id = e.student_id JOIN users u ON u.id = st.user_id
                 WHERE e.course_id = c.id AND u.is_active = TRUE)::int AS student_count,
               (SELECT COUNT(*) FROM attendance a
                 WHERE a.course_id = c.id AND a.date::date = (now() AT TIME ZONE ${tz}::text)::date)::int AS attendance_marked
        FROM timetable t
        JOIN courses c ON c.id = t.course_id
        WHERE t.teacher_id = ${teacherId}::uuid AND t.day_of_week = ${day.day_of_week as number}
        ORDER BY t.period_number ASC, t.start_time ASC
      `;
      return { date: day.date as string, day_of_week: day.day_of_week as number, classes };
    },

    // ---- pending scores: the work only a person can score. Online quizzes are graded by the
    //      system and never appear. Oldest first, so the longest wait is on top.
    pending_scores: async () => {
      const [submissions, scores] = await Promise.all([
        // handed-in online assignments that still have no grade
        sql`
          SELECT a.id, a.title, c.id AS course_id, c.code AS course_code,
                 COUNT(*)::int AS pending_count, MIN(s.submitted_at) AS since
          FROM submissions s
          JOIN assignments a ON a.id = s.assignment_id
          JOIN modules m ON m.id = a.module_id
          JOIN courses c ON c.id = m.course_id
          WHERE c.teacher_id = ${teacherId}::uuid AND s.grade IS NULL AND a.delivery = 'online'
            AND EXISTS (
              SELECT 1 FROM enrollments e JOIN students st ON st.id = e.student_id JOIN users u ON u.id = st.user_id
              WHERE e.course_id = c.id AND e.student_id = s.student_id AND u.is_active = TRUE)
          GROUP BY a.id, a.title, c.id, c.code
        `,
        // in-person items (exams, in-person assignments and quizzes) whose date has passed and
        // that still have enrolled students without a score
        sql`
          SELECT p.kind, p.id, p.title, p.at AS since, p.course_id, p.course_code, p.pending_count
          FROM (
            SELECT x.*,
                   (SELECT COUNT(*) FROM enrollments e
                      JOIN students st ON st.id = e.student_id JOIN users u ON u.id = st.user_id
                     WHERE e.course_id = x.course_id AND u.is_active = TRUE
                       AND NOT EXISTS (SELECT 1 FROM manual_scores ms
                                        WHERE ms.item_type = x.kind AND ms.item_id = x.id AND ms.student_id = e.student_id)
                   )::int AS pending_count
            FROM (
              SELECT 'assignment'::text AS kind, a.id, a.title, a.due_date AS at, c.id AS course_id, c.code AS course_code
              FROM assignments a JOIN modules m ON m.id = a.module_id JOIN courses c ON c.id = m.course_id
              WHERE c.teacher_id = ${teacherId}::uuid AND a.is_published = TRUE AND a.delivery = 'in_person' AND a.due_date <= now()
              UNION ALL
              SELECT 'quiz'::text, q.id, q.title, q.scheduled_at, c.id, c.code
              FROM quizzes q JOIN courses c ON c.id = q.course_id
              WHERE c.teacher_id = ${teacherId}::uuid AND q.is_published = TRUE AND q.delivery = 'in_person' AND q.scheduled_at <= now()
              UNION ALL
              SELECT 'exam'::text, e.id, e.title, e.exam_at, c.id, c.code
              FROM exams e JOIN courses c ON c.id = e.course_id
              WHERE c.teacher_id = ${teacherId}::uuid AND e.is_published = TRUE AND e.exam_at <= now()
            ) x
          ) p
          WHERE p.pending_count > 0
        `,
      ]);
      const all = [
        ...submissions.map((r) => ({
          kind: 'assignment',
          source: 'submissions',
          id: r.id as string,
          title: r.title as string,
          course_id: r.course_id as string,
          course_code: r.course_code as string,
          pending_count: r.pending_count as number,
          since: r.since as string,
          link: itemLink('assignment', r.id as string),
        })),
        ...scores.map((r) => ({
          kind: r.kind as string,
          source: 'scores',
          id: r.id as string,
          title: r.title as string,
          course_id: r.course_id as string,
          course_code: r.course_code as string,
          pending_count: r.pending_count as number,
          since: r.since as string,
          link: itemLink(r.kind as string, r.id as string),
        })),
      ].sort(byTimeAsc);
      return {
        items: all.slice(0, PENDING_LIMIT),
        total_items: all.length,
        total_students: all.reduce((sum, i) => sum + i.pending_count, 0),
      };
    },

    // ---- drafts waiting to be published
    drafts: async () => {
      const rows = await sql`
        SELECT d.kind, d.id, d.title, d.created_at, d.course_id, d.course_code, COUNT(*) OVER()::int AS total
        FROM (
          SELECT 'assignment'::text AS kind, a.id, a.title, a.created_at, c.id AS course_id, c.code AS course_code
          FROM assignments a JOIN modules m ON m.id = a.module_id JOIN courses c ON c.id = m.course_id
          WHERE c.teacher_id = ${teacherId}::uuid AND a.is_published = FALSE
          UNION ALL
          SELECT 'quiz'::text, q.id, q.title, q.created_at, c.id, c.code
          FROM quizzes q JOIN courses c ON c.id = q.course_id
          WHERE c.teacher_id = ${teacherId}::uuid AND q.is_published = FALSE
          UNION ALL
          SELECT 'exam'::text, e.id, e.title, e.created_at, c.id, c.code
          FROM exams e JOIN courses c ON c.id = e.course_id
          WHERE c.teacher_id = ${teacherId}::uuid AND e.is_published = FALSE
        ) d
        ORDER BY d.created_at DESC
        LIMIT ${DRAFTS_LIMIT}
      `;
      return {
        total: (rows[0]?.total as number | undefined) ?? 0,
        items: rows.map(({ total: _total, ...r }) => ({ ...r, link: itemLink(r.kind as string, r.id as string) })),
      };
    },

    // ---- quick access to the teacher's courses, with the unread notifications of each
    courses: async () =>
      sql`
        SELECT c.id AS course_id, c.code, c.name,
               (SELECT COUNT(*) FROM enrollments e
                  JOIN students st ON st.id = e.student_id JOIN users u ON u.id = st.user_id
                 WHERE e.course_id = c.id AND u.is_active = TRUE)::int AS student_count,
               (SELECT COUNT(*) FROM notifications n
                 WHERE n.user_id = ${user.id} AND n.course_id = c.id AND n.is_read = FALSE)::int AS unread
        FROM courses c
        WHERE c.teacher_id = ${teacherId}::uuid
        ORDER BY c.code ASC
      `,

    // ---- what students did lately in these courses: hand-ins, quiz attempts, discussion posts
    recent_activity: async () => {
      const [submitted, attempts, threads, replies] = await Promise.all([
        sql`
          SELECT s.id, s.submitted_at AS at, a.id AS item_id, a.title, c.code AS course_code,
                 TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS actor_name
          FROM submissions s
          JOIN assignments a ON a.id = s.assignment_id
          JOIN modules m ON m.id = a.module_id
          JOIN courses c ON c.id = m.course_id
          JOIN students st ON st.id = s.student_id
          LEFT JOIN profiles p ON p.user_id = st.user_id
          WHERE c.teacher_id = ${teacherId}::uuid
          ORDER BY s.submitted_at DESC
          LIMIT ${ACTIVITY_LIMIT}
        `,
        sql`
          SELECT qa.id, qa.submitted_at AS at, qa.score::float8 AS score, q.id AS item_id, q.title, c.code AS course_code,
                 TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS actor_name
          FROM quiz_attempts qa
          JOIN quizzes q ON q.id = qa.quiz_id
          JOIN courses c ON c.id = q.course_id
          JOIN students st ON st.id = qa.student_id
          LEFT JOIN profiles p ON p.user_id = st.user_id
          WHERE c.teacher_id = ${teacherId}::uuid
          ORDER BY qa.submitted_at DESC
          LIMIT ${ACTIVITY_LIMIT}
        `,
        sql`
          SELECT dt.id, dt.created_at AS at, dt.id AS item_id, dt.title, c.code AS course_code,
                 TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS actor_name
          FROM discussion_threads dt
          JOIN courses c ON c.id = dt.course_id
          LEFT JOIN profiles p ON p.user_id = dt.author_id
          WHERE c.teacher_id = ${teacherId}::uuid AND dt.deleted_at IS NULL AND dt.author_id <> ${user.id}::uuid
          ORDER BY dt.created_at DESC
          LIMIT ${ACTIVITY_LIMIT}
        `,
        sql`
          SELECT dr.id, dr.created_at AS at, dt.id AS item_id, dt.title, c.code AS course_code,
                 TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS actor_name
          FROM discussion_replies dr
          JOIN discussion_threads dt ON dt.id = dr.thread_id
          JOIN courses c ON c.id = dt.course_id
          LEFT JOIN profiles p ON p.user_id = dr.author_id
          WHERE c.teacher_id = ${teacherId}::uuid AND dr.deleted_at IS NULL AND dt.deleted_at IS NULL
            AND dr.author_id <> ${user.id}::uuid
          ORDER BY dr.created_at DESC
          LIMIT ${ACTIVITY_LIMIT}
        `,
      ]);
      return [
        ...submitted.map((r) => ({ kind: 'submission', id: r.id, at: r.at, actor_name: r.actor_name, title: r.title, course_code: r.course_code, link: itemLink('assignment', r.item_id as string) })),
        ...attempts.map((r) => ({ kind: 'quiz_attempt', id: r.id, at: r.at, actor_name: r.actor_name, title: r.title, course_code: r.course_code, score: r.score, link: itemLink('quiz', r.item_id as string) })),
        ...threads.map((r) => ({ kind: 'discussion', id: r.id, at: r.at, actor_name: r.actor_name, title: r.title, course_code: r.course_code, link: `/discussions/${r.item_id as string}` })),
        ...replies.map((r) => ({ kind: 'reply', id: r.id, at: r.at, actor_name: r.actor_name, title: r.title, course_code: r.course_code, link: `/discussions/${r.item_id as string}` })),
      ]
        .sort(byTimeDesc)
        .slice(0, ACTIVITY_LIMIT);
    },

    // ---- the notes this teacher wrote that are still open (not resolved), with the student and item
    open_mentions: async () => {
      const [notes, [{ count }]] = await Promise.all([
        sql`
          SELECT cm.id, cm.reason, LEFT(cm.message, 200) AS message, cm.created_at,
                 (cm.acknowledged_at IS NOT NULL) AS acknowledged,
                 cm.item_type, cm.item_id, c.code AS course_code, COALESCE(a.title, q.title, ex.title) AS item_title,
                 TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS student_name
          FROM coursework_mentions cm
          JOIN courses c ON c.id = cm.course_id
          JOIN students st ON st.id = cm.student_id
          LEFT JOIN profiles p ON p.user_id = st.user_id
          LEFT JOIN assignments a ON cm.item_type = 'assignment' AND a.id = cm.item_id
          LEFT JOIN quizzes q ON cm.item_type = 'quiz' AND q.id = cm.item_id
          LEFT JOIN exams ex ON cm.item_type = 'exam' AND ex.id = cm.item_id
          WHERE c.teacher_id = ${teacherId}::uuid AND cm.resolved_at IS NULL
          ORDER BY cm.created_at DESC
          LIMIT ${MENTIONS_LIMIT}
        `,
        sql`
          SELECT COUNT(*)::int AS count
          FROM coursework_mentions cm JOIN courses c ON c.id = cm.course_id
          WHERE c.teacher_id = ${teacherId}::uuid AND cm.resolved_at IS NULL
        `,
      ]);
      return { count: count as number, notes: notes.map((n) => ({ ...n, link: itemLink(n.item_type as string, n.item_id as string) })) };
    },
  });

  res.json({ generated_at: new Date().toISOString(), ...data, errors });
}
