import { sql } from '../config/db.js';
import { gradeQuiz, type GradableQuestion } from './quizGrading.js';
import { schoolYearTerm } from './gradeTerm.js';
import { notifyUsers } from './notify.js';

/**
 * How long after the deadline a submission is still counted as what the student typed (slow
 * networks, a phone that wakes up late, clock rounding). Later than this, the answers the server
 * saved while the student was working are used instead, so the extra time buys nothing.
 */
export const SUBMIT_GRACE_SECONDS = 15;

/** How many expired sessions one sweep closes. A large class is finished by the next pass. */
const SWEEP_BATCH = 100;

export interface RecordedAttempt {
  id: string;
  quiz_id: string;
  student_id: string;
  score: number;
  submitted_at: string;
  auto_submitted: boolean;
  earned_points: number;
  total_points: number;
}

/** Keeps only answers to real questions of the quiz (an unknown id is ignored, as when grading). */
export function cleanAnswers(
  questions: Array<{ id: string }>,
  raw: Record<string, string>,
  trim = true,
): Record<string, string> {
  const known = new Set(questions.map((q) => q.id));
  const answers: Record<string, string> = {};
  for (const [questionId, answer] of Object.entries(raw)) {
    if (known.has(questionId) && typeof answer === 'string') answers[questionId] = trim ? answer.trim() : answer;
  }
  return answers;
}

/**
 * Grades and stores one attempt together with its grade row, unless this student already has an
 * attempt (then it returns null and nothing is written).
 *
 * "Insert unless one exists" is NOT safe on its own: two requests at the same moment (a submit and the
 * sweep, two tabs, a double tap) each look before either has written, and both insert, because the
 * table has no unique constraint to stop them. So the two statements run in one transaction that
 * first takes a lock for this quiz and student. The second request waits for the first to finish and
 * then sees its attempt.
 */
export async function recordAttempt(args: {
  quizId: string;
  courseId: string;
  studentId: string;
  questions: GradableQuestion[];
  answers: Record<string, string>;
  autoSubmitted: boolean;
}): Promise<RecordedAttempt | null> {
  const grade = gradeQuiz(args.questions, args.answers);
  const [, inserted] = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${args.quizId}::text || ':' || ${args.studentId}::text, 0))`,
    sql`
    WITH ins AS (
      INSERT INTO quiz_attempts (quiz_id, student_id, score, answers, auto_submitted)
      SELECT ${args.quizId}::uuid, ${args.studentId}::uuid, ${grade.score}::numeric,
             ${JSON.stringify(args.answers)}::jsonb, ${args.autoSubmitted}::boolean
      WHERE NOT EXISTS (
        SELECT 1 FROM quiz_attempts
        WHERE quiz_id = ${args.quizId}::uuid AND student_id = ${args.studentId}::uuid
      )
      RETURNING id, quiz_id, student_id, score, submitted_at, auto_submitted
    ),
    g AS (
      INSERT INTO grades (student_id, course_id, assessment_type, assessment_id, score, term)
      SELECT ins.student_id, ${args.courseId}::uuid, 'quiz', ins.quiz_id, ins.score, ${schoolYearTerm()}::text
      FROM ins
      WHERE NOT EXISTS (
        SELECT 1 FROM grades
        WHERE student_id = ins.student_id AND assessment_type = 'quiz' AND assessment_id = ins.quiz_id
      )
      RETURNING id
    )
    SELECT id, quiz_id, student_id, score::float8 AS score, submitted_at, auto_submitted FROM ins
  `,
  ]);
  const attempt = inserted[0];
  if (!attempt) return null;
  return {
    ...(attempt as Omit<RecordedAttempt, 'earned_points' | 'total_points'>),
    earned_points: grade.earned_points,
    total_points: grade.total_points,
  };
}

/**
 * Submits, on the student's behalf, every timed quiz whose time (plus the grace period) is over and
 * that the student never handed in: what they had typed is graded and stored as their attempt,
 * flagged auto_submitted, and they are notified. Optionally limited to one quiz and/or one student.
 *
 * Called when someone looks at the affected data (a student opening the quiz, a teacher opening the
 * results) so those pages are always right, and by a background sweep so grades do not wait for a
 * page view. It never throws: a failure here must not break the page that triggered it. Returns how
 * many attempts it created.
 */
export async function autoSubmitExpired(filter: { quizId?: string; studentId?: string } = {}): Promise<number> {
  try {
    const quizId = filter.quizId ?? '';
    const studentId = filter.studentId ?? '';
    const rows = await sql`
      SELECT s.quiz_id, s.student_id, s.answers, q.course_id, q.title, st.user_id
      FROM quiz_sessions s
      JOIN quizzes q ON q.id = s.quiz_id
      JOIN students st ON st.id = s.student_id
      WHERE s.expires_at + (${SUBMIT_GRACE_SECONDS}::int * interval '1 second') < now()
        AND NOT EXISTS (
          SELECT 1 FROM quiz_attempts a WHERE a.quiz_id = s.quiz_id AND a.student_id = s.student_id
        )
        AND (${quizId}::text = '' OR s.quiz_id = NULLIF(${quizId}::text, '')::uuid)
        AND (${studentId}::text = '' OR s.student_id = NULLIF(${studentId}::text, '')::uuid)
      ORDER BY s.expires_at ASC
      LIMIT ${SWEEP_BATCH}
    `;

    let created = 0;
    const questionsByQuiz = new Map<string, GradableQuestion[]>();
    for (const row of rows) {
      try {
        const id = row.quiz_id as string;
        if (!questionsByQuiz.has(id)) {
          questionsByQuiz.set(
            id,
            (await sql`SELECT id, type, correct_answer, points FROM quiz_questions WHERE quiz_id = ${id}`) as GradableQuestion[],
          );
        }
        const questions = questionsByQuiz.get(id) ?? [];
        const attempt = await recordAttempt({
          quizId: id,
          courseId: row.course_id as string,
          studentId: row.student_id as string,
          questions,
          answers: cleanAnswers(questions, (row.answers ?? {}) as Record<string, string>),
          autoSubmitted: true,
        });
        if (!attempt) continue; // submitted by someone else a moment ago
        created += 1;
        await notifyUsers([row.user_id as string], {
          type: 'quiz',
          title: 'Quiz submitted automatically',
          message: `Time ran out on “${row.title as string}”, so your answers were submitted automatically. You scored ${attempt.score}%.`,
          link: `/quiz-results/${attempt.id}`,
        });
      } catch (err) {
        console.error('[quiz-timer] could not submit an expired attempt:', err);
      }
    }
    return created;
  } catch (err) {
    console.error('[quiz-timer] could not look for expired attempts:', err);
    return 0;
  }
}

let sweeping = false;

/** Closes expired attempts once a minute, so grades appear without anyone opening a page. */
export function startQuizSweep(intervalMs = 60_000): void {
  const run = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      let created: number;
      do {
        created = await autoSubmitExpired();
      } while (created >= SWEEP_BATCH);
    } finally {
      sweeping = false;
    }
  };
  void run();
  setInterval(run, intervalMs).unref();
}
