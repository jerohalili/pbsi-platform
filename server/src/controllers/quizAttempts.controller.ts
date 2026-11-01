import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import { submitQuizAttemptSchema } from '../utils/validation.js';
import {
  assertCanManageQuiz,
  getOwnStudentId,
  httpError,
  parseUuid,
  rethrowDbError,
} from '../utils/access.js';
import { gradeQuiz, isAnswerCorrect, type GradableQuestion } from '../utils/quizGrading.js';
import { schoolYearTerm } from '../utils/gradeTerm.js';
import type { AuthUser } from '../types/index.js';

function currentUser(req: Request): AuthUser {
  if (!req.user) throw httpError(401, 'Not authenticated');
  return req.user;
}

/** A student submits their answers. The server grades them; the client never sends a score. */
export async function submitQuizAttempt(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  if (user.role !== 'student') throw httpError(403, 'Only students can take quizzes');

  const input = submitQuizAttemptSchema.parse(req.body);

  const studentId = await getOwnStudentId(user.id);
  if (!studentId) throw httpError(404, 'Student profile not found');

  const [quiz] = await sql`SELECT id, course_id, is_published FROM quizzes WHERE id = ${input.quiz_id}`;
  // An unpublished quiz does not exist as far as students are concerned.
  if (!quiz || quiz.is_published !== true) throw httpError(404, 'Quiz not found');
  // Neither does a quiz of a course the student is not enrolled in.
  const [enrolled] = await sql`
    SELECT 1 AS ok FROM enrollments WHERE course_id = ${quiz.course_id} AND student_id = ${studentId}
  `;
  if (!enrolled) throw httpError(404, 'Quiz not found');

  const questions = (await sql`
    SELECT id, type, correct_answer, points FROM quiz_questions WHERE quiz_id = ${input.quiz_id}
  `) as GradableQuestion[];
  if (questions.length === 0) throw httpError(409, 'This quiz has no questions yet');

  // Keep only answers to real questions of this quiz.
  const known = new Set(questions.map((q) => q.id));
  const answers: Record<string, string> = {};
  for (const [questionId, answer] of Object.entries(input.answers)) {
    if (known.has(questionId)) answers[questionId] = answer.trim();
  }

  const grade = gradeQuiz(questions, answers);

  // One attempt per student: insert only if this student has none yet. A single statement, so it
  // does not rely on a unique constraint (the table has none). The same statement records the
  // result in grades, so an attempt and its grade always appear together.
  let attempt;
  try {
    [attempt] = await sql`
      WITH ins AS (
        INSERT INTO quiz_attempts (quiz_id, student_id, score, answers)
        SELECT ${input.quiz_id}::uuid, ${studentId}::uuid, ${grade.score}::numeric, ${JSON.stringify(answers)}::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM quiz_attempts
          WHERE quiz_id = ${input.quiz_id}::uuid AND student_id = ${studentId}::uuid
        )
        RETURNING id, quiz_id, student_id, score, submitted_at
      ),
      g AS (
        INSERT INTO grades (student_id, course_id, assessment_type, assessment_id, score, term)
        SELECT ins.student_id, ${quiz.course_id}::uuid, 'quiz', ins.quiz_id, ins.score, ${schoolYearTerm()}::text
        FROM ins
        WHERE NOT EXISTS (
          SELECT 1 FROM grades
          WHERE student_id = ins.student_id AND assessment_type = 'quiz' AND assessment_id = ins.quiz_id
        )
        RETURNING id
      )
      SELECT id, quiz_id, student_id, score::float8 AS score, submitted_at FROM ins
    `;
  } catch (err) {
    rethrowDbError(err, {});
  }

  if (!attempt) throw httpError(409, 'You have already taken this quiz.');
  res.status(201).json({
    attempt: { ...attempt, earned_points: grade.earned_points, total_points: grade.total_points },
  });
}

/**
 * One attempt with a per-question breakdown (including correct answers, which the student may
 * now see). Visible to the student who took it and to whoever manages the quiz.
 */
export async function getQuizAttempt(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'attempt id');

  const [attempt] = await sql`
    SELECT a.id, a.quiz_id, a.student_id, a.score::float8 AS score, a.answers, a.submitted_at,
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
      // Only managers need to know whose attempt it is.
      student_name:
        user.role === 'student'
          ? null
          : `${attempt.first_name ?? ''} ${attempt.last_name ?? ''}`.trim() || attempt.student_number,
    },
    results,
  });
}

/** Teacher view of one quiz: every active student, with their score or "not taken". */
export async function listQuizAttempts(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  if (user.role !== 'admin' && user.role !== 'teacher') {
    throw httpError(403, 'Forbidden: insufficient permissions');
  }
  const quizId = parseUuid((req.query as { quiz_id?: string }).quiz_id, 'quiz id');

  const quiz = await assertCanManageQuiz(user, quizId);

  const attempts = await sql`
    SELECT st.id AS student_id, st.student_id AS student_number, p.first_name, p.last_name,
           att.id AS attempt_id, att.score, att.submitted_at
    FROM students st
    JOIN users u ON u.id = st.user_id
    JOIN profiles p ON p.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT a.id, a.score::float8 AS score, a.submitted_at
      FROM quiz_attempts a
      WHERE a.quiz_id = ${quizId} AND a.student_id = st.id
      ORDER BY a.submitted_at DESC
      LIMIT 1
    ) att ON TRUE
    WHERE u.is_active = TRUE OR att.id IS NOT NULL
    ORDER BY p.last_name ASC, p.first_name ASC
  `;

  res.json({ quiz: { id: quiz.id, title: quiz.title }, attempts });
}
