import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import {
  assertCanManageCourse,
  getOwnStudentId,
  getOwnTeacherId,
  httpError,
  optionalUuid,
  parseUuid,
} from '../utils/access.js';
import { auditStatement } from '../utils/audit.js';
import { notifyUsers } from '../utils/notify.js';
import { overrideGradeSchema } from '../utils/validation.js';
import { PASSING_GRADE } from '../utils/gradeTerm.js';
import type { AuthUser } from '../types/index.js';

/**
 * Who may see which grades. Students only see their own; teachers only the courses they teach;
 * admins everything. Returns null when nothing is visible (no student/teacher record), so the
 * caller can answer with an empty result instead of querying.
 */
async function resolveGradeScope(
  user: AuthUser,
  requestedStudentId: string,
): Promise<{ studentParam: string; teacherParam: string } | null> {
  let studentParam = requestedStudentId;

  // Students only ever see their own grades.
  if (user.role === 'student') {
    const ownId = await getOwnStudentId(user.id);
    if (!ownId) return null;
    if (studentParam && studentParam !== ownId) {
      throw httpError(403, 'Forbidden: you can only view your own grades');
    }
    studentParam = ownId;
  }

  // Teachers only see grades for the courses they teach (admins see everything).
  let teacherParam = '';
  if (user.role === 'teacher') {
    const ownTeacherId = await getOwnTeacherId(user.id);
    if (!ownTeacherId) return null;
    teacherParam = ownTeacherId;
  }

  return { studentParam, teacherParam };
}

export async function listGrades(_req: Request, res: Response): Promise<void> {
  const { student_id, course_id, term } = _req.query as {
    student_id?: string;
    course_id?: string;
    term?: string;
  };

  const user = _req.user as AuthUser;
  const courseParam = optionalUuid(course_id, 'course id');
  const termParam = term ?? '';

  const scope = await resolveGradeScope(user, optionalUuid(student_id, 'student id'));
  if (!scope) {
    res.json({ grades: [] });
    return;
  }
  const { studentParam, teacherParam } = scope;

  const grades = await sql`
    SELECT g.id, g.student_id, g.course_id, g.assessment_type, g.assessment_id,
           g.score, g.feedback, g.term, g.created_at,
           c.code as course_code, c.name as course_name,
           COALESCE(q.title, a.title, ex.title) AS assessment_title,
           s.student_id AS student_number, p.first_name, p.last_name
    FROM grades g
    JOIN courses c ON c.id = g.course_id
    LEFT JOIN quizzes q ON g.assessment_type = 'quiz' AND q.id = g.assessment_id
    LEFT JOIN assignments a ON g.assessment_type = 'assignment' AND a.id = g.assessment_id
    LEFT JOIN exams ex ON g.assessment_type = 'exam' AND ex.id = g.assessment_id
    JOIN students s ON s.id = g.student_id
    JOIN profiles p ON p.user_id = s.user_id
    WHERE (${studentParam}::text = '' OR g.student_id = NULLIF(${studentParam}::text, '')::uuid)
      AND (${courseParam}::text = '' OR g.course_id = NULLIF(${courseParam}::text, '')::uuid)
      AND (${termParam}::text = '' OR g.term = ${termParam}::text)
      AND (${teacherParam}::text = '' OR c.teacher_id = NULLIF(${teacherParam}::text, '')::uuid)
    ORDER BY g.created_at DESC
  `;
  res.json({ grades });
}

/**
 * GET /api/grades/summary: per-course grade statistics plus an overall average, with the same
 * visibility rules as the grade list. Optional filters: student_id, course_id, term.
 * `at_risk` counts students whose average in that course is below the passing mark (for a
 * student this is simply 0 or 1).
 */
export async function getGradeSummary(req: Request, res: Response): Promise<void> {
  const { student_id, course_id, term } = req.query as {
    student_id?: string;
    course_id?: string;
    term?: string;
  };
  const user = req.user as AuthUser;
  const courseParam = optionalUuid(course_id, 'course id');
  const termParam = term ?? '';

  const scope = await resolveGradeScope(user, optionalUuid(student_id, 'student id'));
  if (!scope) {
    res.json({ overall: { average: null, items: 0, students: 0 }, courses: [] });
    return;
  }
  const { studentParam, teacherParam } = scope;

  const [row] = await sql`
    WITH scoped AS (
      SELECT g.student_id, g.course_id, g.assessment_type, g.score::float8 AS score
      FROM grades g
      JOIN courses c ON c.id = g.course_id
      WHERE (${studentParam}::text = '' OR g.student_id = NULLIF(${studentParam}::text, '')::uuid)
        AND (${courseParam}::text = '' OR g.course_id = NULLIF(${courseParam}::text, '')::uuid)
        AND (${termParam}::text = '' OR g.term = ${termParam}::text)
        AND (${teacherParam}::text = '' OR c.teacher_id = NULLIF(${teacherParam}::text, '')::uuid)
    ), per_student AS (
      SELECT course_id, student_id, AVG(score) AS avg_score
      FROM scoped
      GROUP BY course_id, student_id
    )
    SELECT
      (SELECT json_build_object(
                'average', ROUND(AVG(score)::numeric, 2)::float8,
                'items', COUNT(*)::int,
                'students', COUNT(DISTINCT student_id)::int)
         FROM scoped) AS overall,
      COALESCE((
        SELECT json_agg(t ORDER BY t.course_code)
        FROM (
          SELECT c.id AS course_id, c.code AS course_code, c.name AS course_name,
                 COUNT(DISTINCT sc.student_id)::int AS students,
                 COUNT(*)::int AS items,
                 ROUND(AVG(sc.score)::numeric, 2)::float8 AS average,
                 ROUND(MAX(sc.score)::numeric, 2)::float8 AS highest,
                 ROUND(MIN(sc.score)::numeric, 2)::float8 AS lowest,
                 ROUND((AVG(sc.score) FILTER (WHERE sc.assessment_type = 'assignment'))::numeric, 2)::float8
                   AS assignment_average,
                 ROUND((AVG(sc.score) FILTER (WHERE sc.assessment_type = 'quiz'))::numeric, 2)::float8
                   AS quiz_average,
                 ROUND((AVG(sc.score) FILTER (WHERE sc.assessment_type = 'exam'))::numeric, 2)::float8
                   AS exam_average,
                 (SELECT COUNT(*) FROM per_student ps
                   WHERE ps.course_id = c.id AND ps.avg_score < ${PASSING_GRADE}::numeric)::int AS at_risk
          FROM scoped sc
          JOIN courses c ON c.id = sc.course_id
          GROUP BY c.id, c.code, c.name
        ) t
      ), '[]'::json) AS courses
  `;
  // json columns normally arrive already parsed; tolerate a driver that returns them as text.
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
  res.json({ overall: parse(row.overall), courses: parse(row.courses) });
}

export async function getStudentGPA(_req: Request, res: Response): Promise<void> {
  const { student_id: rawId } = _req.params as { student_id: string };
  const user = _req.user as AuthUser;

  // "me" means the signed-in student; anyone else has no grades of their own.
  let studentId: string | null;
  if (rawId === 'me') {
    studentId = await getOwnStudentId(user.id);
  } else {
    studentId = parseUuid(rawId, 'student id');
    if (user.role === 'student' && studentId !== (await getOwnStudentId(user.id))) {
      throw httpError(403, 'Forbidden: you can only view your own grades');
    }
  }
  if (!studentId) {
    res.json({ gpa: { cumulative_gpa: null, total_assessments: 0 } });
    return;
  }

  const [result] = await sql`
    SELECT
      ROUND(AVG(g.score)::numeric, 2)::float8 AS cumulative_gpa,
      COUNT(*)::int AS total_assessments
    FROM grades g
    WHERE g.student_id = ${studentId}
  `;
  res.json({ gpa: result });
}

/**
 * PATCH /api/grades/:id: a teacher (for their own courses) or an admin adjusts a recorded grade.
 * Only the grades row changes; the original submission or quiz attempt is left as it was, and a
 * later re-grade of the same assignment replaces the adjustment.
 */
export async function overrideGrade(req: Request, res: Response): Promise<void> {
  const user = req.user as AuthUser;
  const id = parseUuid(req.params.id, 'grade id');
  const input = overrideGradeSchema.parse(req.body);

  const [grade] = await sql`
    SELECT g.id, g.course_id, g.score, g.feedback, g.assessment_type, g.assessment_id,
           s.user_id AS student_user_id,
           COALESCE(q.title, a.title, ex.title) AS assessment_title
    FROM grades g
    JOIN students s ON s.id = g.student_id
    LEFT JOIN quizzes q ON g.assessment_type = 'quiz' AND q.id = g.assessment_id
    LEFT JOIN assignments a ON g.assessment_type = 'assignment' AND a.id = g.assessment_id
    LEFT JOIN exams ex ON g.assessment_type = 'exam' AND ex.id = g.assessment_id
    WHERE g.id = ${id}
  `;
  if (!grade) throw httpError(404, 'Grade not found');
  await assertCanManageCourse(user, grade.course_id as string);

  const score = Math.round(input.score * 100) / 100;
  const feedbackProvided = input.feedback !== undefined;

  const nextFeedback = feedbackProvided ? input.feedback || null : (grade.feedback as string | null);

  // A grade override must never go unrecorded, so the change and its audit row share one
  // transaction: either both are stored or neither is.
  const [updateResult] = await sql.transaction([
    sql`
      UPDATE grades
      SET score = ${score}::numeric,
          feedback = CASE WHEN ${feedbackProvided}::boolean THEN ${input.feedback || null} ELSE feedback END
      WHERE id = ${id}
      RETURNING id, score::float8 AS score, feedback
    `,
    auditStatement(
      req,
      'grade.override',
      'grade',
      id,
      { score: Number(grade.score), feedback: grade.feedback },
      { score, feedback: nextFeedback },
    ),
  ]);
  const updated = updateResult?.[0];
  if (!updated) throw httpError(404, 'Grade not found');

  // Let the student know. Best effort: a notification problem must never undo the change.
  await notifyUsers([grade.student_user_id as string], {
    type: 'grade',
    title: 'Grade adjusted',
    message: `${grade.assessment_title ?? 'Your grade'}: now ${score}%`,
    link: '/grades',
    course_id: grade.course_id as string,
  });

  res.json({ grade: updated });
}
