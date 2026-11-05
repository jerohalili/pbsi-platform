import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import { saveQuizProgressSchema, startQuizAttemptSchema, submitQuizAttemptSchema } from '../utils/validation.js';
import {
  assertCanManageQuiz,
  getOwnStudentId,
  httpError,
  parseUuid,
  rethrowDbError,
} from '../utils/access.js';
import { isAnswerCorrect, type GradableQuestion } from '../utils/quizGrading.js';
import { SUBMIT_GRACE_SECONDS, autoSubmitExpired, cleanAnswers, recordAttempt } from '../utils/quizSessions.js';
import type { AuthUser } from '../types/index.js';

function currentUser(req: Request): AuthUser {
  if (!req.user) throw httpError(401, 'Not authenticated');
  return req.user;
}

/** The quiz a student is allowed to take: published, and in a course they are enrolled in. */
async function loadQuizForStudent(studentId: string, quizId: string) {
  const [quiz] = await sql`
    SELECT id, course_id, is_published, time_limit_minutes, delivery FROM quizzes WHERE id = ${quizId}
  `;
  // An unpublished quiz does not exist as far as students are concerned.
  if (!quiz || quiz.is_published !== true) throw httpError(404, 'Quiz not found');
  // Neither does a quiz of a course the student is not enrolled in.
  const [enrolled] = await sql`
    SELECT 1 AS ok FROM enrollments WHERE course_id = ${quiz.course_id} AND student_id = ${studentId}
  `;
  if (!enrolled) throw httpError(404, 'Quiz not found');
  // Taken face to face: there is nothing to answer online.
  if (quiz.delivery === 'in_person') {
    throw httpError(409, 'This quiz is taken in person, so there is nothing to answer online.');
  }
  return quiz as { id: string; course_id: string; is_published: boolean; time_limit_minutes: number | null };
}

async function studentIdOf(user: AuthUser): Promise<string> {
  if (user.role !== 'student') throw httpError(403, 'Only students can take quizzes');
  const studentId = await getOwnStudentId(user.id);
  if (!studentId) throw httpError(404, 'Student profile not found');
  return studentId;
}

/**
 * A student presses Start. For a timed quiz this is when the SERVER's clock begins: the deadline is
 * fixed on the first call and every later call (a reload, another tab, another phone) gets the same
 * deadline back together with the answers saved so far. Quizzes without a time limit need no
 * session. A student whose time already ran out is told so, and their attempt is on record.
 */
export async function startQuizAttempt(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const studentId = await studentIdOf(user);
  const input = startQuizAttemptSchema.parse(req.body);
  const quiz = await loadQuizForStudent(studentId, input.quiz_id);

  // Time that ran out while the student was away turns into their attempt before anything else.
  await autoSubmitExpired({ quizId: quiz.id, studentId });
  const [done] = await sql`
    SELECT id FROM quiz_attempts WHERE quiz_id = ${quiz.id} AND student_id = ${studentId} LIMIT 1
  `;
  if (done) {
    res.json({ finished: true, attempt_id: done.id });
    return;
  }

  if (!quiz.time_limit_minutes) {
    res.json({ finished: false, timed: false, remaining_seconds: null, answers: {} });
    return;
  }

  const [counted] = await sql`SELECT COUNT(*)::int AS n FROM quiz_questions WHERE quiz_id = ${quiz.id}`;
  if (!counted || counted.n === 0) throw httpError(409, 'This quiz has no questions yet');

  // The first call sets the deadline; ON CONFLICT keeps it for every later one.
  await sql`
    INSERT INTO quiz_sessions (quiz_id, student_id, expires_at)
    VALUES (${quiz.id}, ${studentId}, now() + (${quiz.time_limit_minutes}::int * interval '1 minute'))
    ON CONFLICT (quiz_id, student_id) DO NOTHING
  `;
  const [session] = await sql`
    SELECT started_at, expires_at, answers,
           GREATEST(0, CEIL(EXTRACT(EPOCH FROM (expires_at - now()))))::int AS remaining_seconds
    FROM quiz_sessions
    WHERE quiz_id = ${quiz.id} AND student_id = ${studentId}
  `;
  res.json({
    finished: false,
    timed: true,
    started_at: session.started_at,
    expires_at: session.expires_at,
    remaining_seconds: session.remaining_seconds,
    answers: session.answers ?? {},
  });
}

/**
 * The answers typed so far, saved while the student works. If time runs out while they are away,
 * this is what gets submitted for them. Refused once the time is over or the quiz is submitted.
 */
export async function saveQuizProgress(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const studentId = await studentIdOf(user);
  const input = saveQuizProgressSchema.parse(req.body);
  const quiz = await loadQuizForStudent(studentId, input.quiz_id);

  const questions = await sql`SELECT id FROM quiz_questions WHERE quiz_id = ${quiz.id}`;
  // Saved as typed (not trimmed): this is a working copy, the answers are cleaned when graded.
  const answers = cleanAnswers(questions as Array<{ id: string }>, input.answers, false);

  const [saved] = await sql`
    UPDATE quiz_sessions
    SET answers = ${JSON.stringify(answers)}::jsonb, updated_at = now()
    WHERE quiz_id = ${quiz.id} AND student_id = ${studentId}
      AND expires_at > now()
      AND NOT EXISTS (
        SELECT 1 FROM quiz_attempts a WHERE a.quiz_id = quiz_sessions.quiz_id AND a.student_id = quiz_sessions.student_id
      )
    RETURNING quiz_id
  `;
  if (!saved) throw httpError(409, 'This quiz is no longer open for answers.');
  res.json({ saved: true });
}

/**
 * A student submits their answers. The server grades them; the client never sends a score.
 * For a timed quiz the server's clock decides: a submission that arrives after the deadline (plus a
 * short grace period) is replaced by the answers saved while the student was working.
 */
export async function submitQuizAttempt(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const studentId = await studentIdOf(user);
  const input = submitQuizAttemptSchema.parse(req.body);
  const quiz = await loadQuizForStudent(studentId, input.quiz_id);

  const questions = (await sql`
    SELECT id, type, correct_answer, points FROM quiz_questions WHERE quiz_id = ${quiz.id}
  `) as GradableQuestion[];
  if (questions.length === 0) throw httpError(409, 'This quiz has no questions yet');

  let answers = cleanAnswers(questions, input.answers);
  let autoSubmitted = false;

  if (quiz.time_limit_minutes) {
    const [session] = await sql`
      SELECT answers,
             now() >= expires_at AS ended,
             now() > expires_at + (${SUBMIT_GRACE_SECONDS}::int * interval '1 second') AS past_grace
      FROM quiz_sessions
      WHERE quiz_id = ${quiz.id} AND student_id = ${studentId}
    `;
    // Without a recorded start there is no clock, so nothing to hold the student to: they must start first.
    if (!session) {
      throw httpError(409, 'This quiz has a time limit, so it has to be started first. Open it from the quiz page and try again.');
    }
    if (session.past_grace) {
      // Too late to count what was just sent: the attempt is what the server saved in time.
      answers = cleanAnswers(questions, (session.answers ?? {}) as Record<string, string>);
      autoSubmitted = true;
    } else {
      autoSubmitted = session.ended === true || input.auto === true;
    }
  }

  // One attempt per student, enforced by the insert itself (the table has no unique constraint).
  let attempt;
  try {
    attempt = await recordAttempt({
      quizId: quiz.id,
      courseId: quiz.course_id,
      studentId,
      questions,
      answers,
      autoSubmitted,
    });
  } catch (err) {
    rethrowDbError(err, {});
  }

  if (!attempt) throw httpError(409, 'You have already taken this quiz.');
  res.status(201).json({ attempt });
}

/**
 * One attempt with a per-question breakdown (including correct answers, which the student may
 * now see). Visible to the student who took it and to whoever manages the quiz.
 */
export async function getQuizAttempt(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'attempt id');

  const [attempt] = await sql`
    SELECT a.id, a.quiz_id, a.student_id, a.score::float8 AS score, a.answers, a.submitted_at, a.auto_submitted,
           q.title AS quiz_title, c.code AS course_code, c.name AS course_name,
           p.first_name, p.last_name, st.student_id AS student_number
    FROM quiz_attempts a
    JOIN quizzes q ON q.id = a.quiz_id
    JOIN courses c ON c.id = q.course_id
    JOIN students st ON st.id = a.student_id
    JOIN profiles p ON p.user_id = st.user_id
    WHERE a.id = ${id}
  `;
  if (!attempt) throw httpError(404, 'Attempt not found');

  if (user.role === 'student') {
    const ownId = await getOwnStudentId(user.id);
    if (!ownId || ownId !== attempt.student_id) {
      throw httpError(403, 'Forbidden: you can only view your own results');
    }
  } else {
    await assertCanManageQuiz(user, attempt.quiz_id as string);
  }

  const questions = await sql`
    SELECT id, question_text, type, options, correct_answer, points, image_url
    FROM quiz_questions WHERE quiz_id = ${attempt.quiz_id} ORDER BY id ASC
  `;
  const given = (attempt.answers ?? {}) as Record<string, string>;

  let earned = 0;
  let total = 0;
  const results = questions.map((question) => {
    const yourAnswer = given[question.id as string] ?? '';
    const correct = isAnswerCorrect(question as unknown as GradableQuestion, yourAnswer);
    total += question.points as number;
    if (correct) earned += question.points as number;
    return {
      question_id: question.id,
      question_text: question.question_text,
      image_url: question.image_url,
      type: question.type,
      options: question.options,
      points: question.points,
      your_answer: yourAnswer,
      correct_answer: question.correct_answer,
      is_correct: correct,
      points_earned: correct ? question.points : 0,
    };
  });

  res.json({
    attempt: {
      id: attempt.id,
      quiz_id: attempt.quiz_id,
      quiz_title: attempt.quiz_title,
      course_code: attempt.course_code,
      course_name: attempt.course_name,
      score: attempt.score,
      earned_points: earned,
      total_points: total,
      submitted_at: attempt.submitted_at,
      // True when the time limit ended and the server submitted what the student had.
      auto_submitted: attempt.auto_submitted === true,
      // Only managers need to know whose attempt it is.
      student_name:
        user.role === 'student'
          ? null
          : `${attempt.first_name ?? ''} ${attempt.last_name ?? ''}`.trim() || attempt.student_number,
    },
    results,
  });
}

/**
 * Teacher view of one quiz: every active student enrolled in the course, with their score or "not
 * taken". Someone who took it and has since left the course still shows, so their result is never hidden.
 */
export async function listQuizAttempts(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  if (user.role !== 'admin' && user.role !== 'teacher') {
    throw httpError(403, 'Forbidden: insufficient permissions');
  }
  const quizId = parseUuid((req.query as { quiz_id?: string }).quiz_id, 'quiz id');

  const quiz = await assertCanManageQuiz(user, quizId);

  // Students whose time ran out without submitting are closed first, so the list is complete.
  await autoSubmitExpired({ quizId });

  const attempts = await sql`
    SELECT st.id AS student_id, st.student_id AS student_number, p.first_name, p.last_name,
           att.id AS attempt_id, att.score, att.submitted_at, att.auto_submitted
    FROM students st
    JOIN users u ON u.id = st.user_id
    JOIN profiles p ON p.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT a.id, a.score::float8 AS score, a.submitted_at, a.auto_submitted
      FROM quiz_attempts a
      WHERE a.quiz_id = ${quizId} AND a.student_id = st.id
      ORDER BY a.submitted_at DESC
      LIMIT 1
    ) att ON TRUE
    WHERE (
            u.is_active = TRUE
            AND EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = st.id AND e.course_id = ${quiz.course_id})
          )
       OR att.id IS NOT NULL
    ORDER BY p.last_name ASC, p.first_name ASC
  `;

  res.json({ quiz: { id: quiz.id, title: quiz.title }, attempts });
}
