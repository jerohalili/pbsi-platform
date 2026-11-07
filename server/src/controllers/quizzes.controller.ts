import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import {
  createQuizSchema,
  questionInputSchema,
  updateQuizSchema,
  type QuestionInput,
} from '../utils/validation.js';
import {
  assertCanManageCourse,
  assertCanManageQuiz,
  assertQuizQuestionsEditable,
  getOwnStudentId,
  httpError,
  optionalUuid,
  parseUuid,
} from '../utils/access.js';
import { newTimeOrderedUuid } from '../utils/ids.js';
import { recordAudit, diffValues } from '../utils/audit.js';
import { notifyCourseStudents } from '../utils/notify.js';
import { autoSubmitExpired } from '../utils/quizSessions.js';
import { deleteScoresOf } from '../utils/manualScoring.js';
import { deleteMentionsOf } from '../utils/mentions.js';
import { formatRoom, formatManila } from '../utils/notify.js';
import { toPercent } from '../utils/gradeTerm.js';
import {
  deleteFromCloudinary,
  deleteManyFromCloudinary,
  sniffImage,
  uniqueFileName,
  uploadToCloudinary,
} from '../utils/upload.js';
import type { AuthUser } from '../types/index.js';

function currentUser(req: Request): AuthUser {
  if (!req.user) throw httpError(401, 'Not authenticated');
  return req.user;
}

interface QuizFilters {
  id?: string;
  courseId?: string;
}

/**
 * Quizzes as seen by the signed-in person. Drafts are visible only to the teacher who owns
 * the course (and admins), and students see only the courses they are enrolled in.
 * Students also get their own attempt; managers get class-wide numbers.
 */
async function queryQuizzes(user: AuthUser, filters: QuizFilters) {
  const isStudent = user.role === 'student';
  const ownStudentId = isStudent ? await getOwnStudentId(user.id) : null;

  // Timed attempts whose time ran out while the student was away are closed first, so the scores,
  // counts and "completed" status below are already up to date.
  await autoSubmitExpired({ quizId: filters.id, studentId: ownStudentId ?? undefined });

  const rows = await sql`
    SELECT q.id, q.course_id, q.title, q.time_limit_minutes, q.is_published, q.created_at,
           q.delivery, q.scheduled_at, q.room, q.details, q.max_score::float8 AS max_score,
           c.code AS course_code, c.name AS course_name,
           (te.user_id = ${user.id}) AS is_mine,
           (SELECT COUNT(*) FROM quiz_questions x WHERE x.quiz_id = q.id)::int AS question_count,
           (SELECT COALESCE(SUM(x.points), 0) FROM quiz_questions x WHERE x.quiz_id = q.id)::int AS total_points,
           (SELECT COUNT(*) FROM quiz_attempts a WHERE a.quiz_id = q.id)::int AS attempt_count,
           (SELECT COUNT(*) FROM manual_scores x WHERE x.item_type = 'quiz' AND x.item_id = q.id)::int AS scored_count,
           (SELECT COUNT(*) FROM enrollments en WHERE en.course_id = q.course_id)::int AS enrolled_count,
           -- Open notes: a student's own that they have not seen yet; for the course's teacher, all unresolved.
           (CASE
              WHEN ${isStudent}::boolean THEN (
                SELECT COUNT(*) FROM coursework_mentions cm
                WHERE cm.item_type = 'quiz' AND cm.item_id = q.id AND cm.student_id = ${ownStudentId}::uuid
                  AND cm.resolved_at IS NULL AND cm.acknowledged_at IS NULL)
              WHEN (te.user_id = ${user.id} OR ${user.role === 'admin'}::boolean) THEN (
                SELECT COUNT(*) FROM coursework_mentions cm
                WHERE cm.item_type = 'quiz' AND cm.item_id = q.id AND cm.resolved_at IS NULL)
              ELSE NULL
            END)::int AS mention_count,
           CASE WHEN q.delivery = 'in_person'
                THEN (SELECT ROUND(AVG(x.score / q.max_score * 100), 2)::float8 FROM manual_scores x
                      WHERE x.item_type = 'quiz' AND x.item_id = q.id)
                ELSE (SELECT ROUND(AVG(a.score), 2)::float8 FROM quiz_attempts a WHERE a.quiz_id = q.id)
           END AS average_score,
           ms.score::float8 AS manual_score, ms.feedback AS manual_feedback, ms.graded_at AS manual_graded_at,
           att.id AS attempt_id, att.score AS my_score, att.submitted_at AS my_submitted_at
    FROM quizzes q
    JOIN courses c ON c.id = q.course_id
    JOIN teachers te ON te.id = c.teacher_id
    LEFT JOIN LATERAL (
      SELECT a.id, a.score::float8 AS score, a.submitted_at
      FROM quiz_attempts a
      WHERE a.quiz_id = q.id AND a.student_id = ${ownStudentId}::uuid
      ORDER BY a.submitted_at DESC
      LIMIT 1
    ) att ON TRUE
    LEFT JOIN manual_scores ms
           ON ms.item_type = 'quiz' AND ms.item_id = q.id AND ms.student_id = ${ownStudentId}::uuid
    WHERE (${filters.id ?? ''}::text = '' OR q.id = NULLIF(${filters.id ?? ''}::text, '')::uuid)
      AND (${filters.courseId ?? ''}::text = '' OR q.course_id = NULLIF(${filters.courseId ?? ''}::text, '')::uuid)
      AND (q.is_published = TRUE OR te.user_id = ${user.id} OR ${user.role === 'admin'}::boolean)
      AND (${!isStudent}::boolean OR EXISTS (
            SELECT 1 FROM enrollments en WHERE en.course_id = q.course_id AND en.student_id = ${ownStudentId}::uuid
          ))
    ORDER BY q.created_at DESC
  `;

  return rows.map((row) => {
    const canManage = user.role === 'admin' || (user.role === 'teacher' && row.is_mine === true);
    const base = { ...row, can_manage: canManage };
    if (isStudent) {
      if (row.delivery === 'in_person') {
        // Taken face to face: no attempt to make, only a score the teacher types in later.
        const scored = row.manual_score !== null;
        const when = row.scheduled_at ? new Date(row.scheduled_at as string).getTime() : 0;
        return {
          ...base,
          status: scored ? 'scored' : when < Date.now() ? 'awaiting_score' : 'upcoming',
          manual_percent: scored ? toPercent(row.manual_score as number, row.max_score as number) : null,
          attempt_count: null,
          average_score: null,
          scored_count: null,
          enrolled_count: null,
        };
      }
      return {
        ...base,
        status: row.attempt_id ? 'completed' : 'not_taken',
        attempt_count: null,
        average_score: null,
        scored_count: null,
        enrolled_count: null,
      };
    }
    // Teachers who don't run the course see the quiz exists, not how the class did.
    return canManage
      ? { ...base, status: null }
      : { ...base, status: null, attempt_count: null, average_score: null, scored_count: null, enrolled_count: null };
  });
}

export async function listQuizzes(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const query = req.query as { course_id?: string };
  const quizzes = await queryQuizzes(user, {
    courseId: optionalUuid(query.course_id, 'course id') || undefined,
  });
  res.json({ quizzes });
}

/** The quiz and its questions. `correct_answer` is only ever sent to people who manage the quiz. */
export async function getQuiz(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'quiz id');

  const [quiz] = await queryQuizzes(user, { id });
  if (!quiz) throw httpError(404, 'Quiz not found');

  const questions = await sql`
    SELECT id, quiz_id, question_text, type, options, points, image_url,
           CASE WHEN ${quiz.can_manage}::boolean THEN correct_answer END AS correct_answer
    FROM quiz_questions
    WHERE quiz_id = ${id}
    ORDER BY id ASC
  `;

  // A timed quiz keeps its questions back until the student presses Start, otherwise they could read
  // them at leisure and only start the clock once they know the answers.
  let visible = questions;
  const { time_limit_minutes: timeLimit, attempt_id: attemptId } = quiz as unknown as {
    time_limit_minutes: number | null;
    attempt_id: string | null;
  };
  if (user.role === 'student' && timeLimit && !attemptId) {
    const [started] = await sql`
      SELECT 1 AS ok
      FROM quiz_sessions s
      JOIN students st ON st.id = s.student_id
      WHERE s.quiz_id = ${id} AND st.user_id = ${user.id}
    `;
    if (!started) visible = [];
  }

  res.json({
    quiz,
    questions: quiz.can_manage
      ? visible
      : visible.map(({ correct_answer: _hidden, ...safe }) => safe),
  });
}

export async function createQuiz(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const input = createQuizSchema.parse(req.body);

  await assertCanManageCourse(user, input.course_id);

  // New quizzes start as drafts; publishing needs at least one question.
  const [created] = await sql`
    INSERT INTO quizzes (course_id, title, time_limit_minutes, is_published, delivery, scheduled_at, room, details, max_score)
    VALUES (${input.course_id}, ${input.title}, ${input.time_limit_minutes ?? null}, FALSE,
            ${input.delivery}, ${input.scheduled_at ?? null}, ${input.room || null}, ${input.details || null},
            ${input.max_score})
    RETURNING id
  `;
  await recordAudit(req, 'quiz.create', 'quiz', created.id as string, null, {
    title: input.title,
    course_id: input.course_id,
    time_limit_minutes: input.time_limit_minutes ?? null,
    delivery: input.delivery,
  });
  const [quiz] = await queryQuizzes(user, { id: created.id as string });
  res.status(201).json({ quiz });
}

export async function updateQuiz(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'quiz id');
  const input = updateQuizSchema.parse(req.body);

  const before = await assertCanManageQuiz(user, id);
  const inPerson = before.delivery === 'in_person';

  // The date, room and maximum score belong to in-person quizzes only.
  if (!inPerson && (input.scheduled_at !== undefined || input.room !== undefined || input.max_score !== undefined)) {
    throw httpError(400, 'Only in-person quizzes have a date, a room and a maximum score.');
  }

  // An in-person quiz has no online questions, so there is nothing to wait for before publishing.
  if (input.is_published === true && !inPerson) {
    const [row] = await sql`SELECT COUNT(*)::int AS n FROM quiz_questions WHERE quiz_id = ${id}`;
    if (!row || row.n < 1) {
      throw httpError(409, 'Add at least one question before publishing this quiz.');
    }
  }

  if (inPerson) {
    // Taking it back to draft would hide scores students have already been given.
    if (input.is_published === false && before.is_published) {
      const [scored] = await sql`SELECT COUNT(*)::int AS n FROM manual_scores WHERE item_type = 'quiz' AND item_id = ${id}`;
      if (scored && scored.n > 0) {
        throw httpError(409, 'Scores have already been recorded, so this quiz can no longer be unpublished.');
      }
    }
    // The maximum cannot drop below a score that was already typed in.
    if (input.max_score !== undefined) {
      const [over] = await sql`
        SELECT COUNT(*)::int AS n FROM manual_scores
        WHERE item_type = 'quiz' AND item_id = ${id} AND score > ${input.max_score}::numeric
      `;
      if (over && over.n > 0) {
        throw httpError(409, 'Some students already have a score higher than that maximum. Adjust those scores first.');
      }
    }
  }

  const timeProvided = input.time_limit_minutes !== undefined;
  await sql`
    UPDATE quizzes
    SET title = COALESCE(${input.title ?? null}, title),
        time_limit_minutes = CASE WHEN ${timeProvided}::boolean THEN ${input.time_limit_minutes ?? null}::int ELSE time_limit_minutes END,
        is_published = COALESCE(${input.is_published ?? null}::boolean, is_published),
        details = CASE WHEN ${input.details !== undefined}::boolean THEN NULLIF(${input.details ?? ''}::text, '') ELSE details END,
        scheduled_at = COALESCE(${input.scheduled_at ?? null}::timestamptz, scheduled_at),
        room = CASE WHEN ${input.room !== undefined}::boolean THEN NULLIF(${input.room ?? ''}::text, '') ELSE room END,
        max_score = COALESCE(${input.max_score ?? null}::numeric, max_score)
    WHERE id = ${id}
  `;

  const changes = diffValues(
    { title: before.title, is_published: before.is_published, time_limit_minutes: before.time_limit_minutes },
    {
      title: input.title,
      is_published: input.is_published,
      time_limit_minutes: timeProvided ? (input.time_limit_minutes ?? null) : undefined,
    },
  );
  if (changes) await recordAudit(req, 'quiz.update', 'quiz', id, changes.old, changes.new);

  // A quiz that has just been opened is news for students (not every later edit of it).
  if (before.is_published === false && input.is_published === true) {
    try {
      const [course] = await sql`SELECT code FROM courses WHERE id = ${before.course_id}`;
      const [fresh] = await sql`SELECT title, scheduled_at, room FROM quizzes WHERE id = ${id}`;
      const label = `${fresh?.title ?? before.title}${course?.code ? ` (${course.code})` : ''}`;
      await notifyCourseStudents(before.course_id, {
        type: 'quiz',
        title: inPerson ? 'Quiz announced' : 'Quiz available',
        message: inPerson
          ? `${label} · in person · ${formatManila(fresh?.scheduled_at as string)}${fresh?.room ? ` · ${formatRoom(fresh.room as string)}` : ''}`
          : `${label} is now open`,
        link: `/quizzes/${id}`,
      });
    } catch (err) {
      console.error('[quizzes] could not notify students:', err);
    }
  }

  const [quiz] = await queryQuizzes(user, { id });
  res.json({ quiz });
}

export async function deleteQuiz(req: Request, res: Response): Promise<void> {
  const id = parseUuid(req.params.id, 'quiz id');
  const user = currentUser(req);
  const before = await assertCanManageQuiz(user, id);

  const pictures = await sql`
    SELECT image_public_id FROM quiz_questions WHERE quiz_id = ${id} AND image_public_id IS NOT NULL
  `;

  // Cascade delete attempts before removing the quiz (questions go with ON DELETE CASCADE).
  await sql`DELETE FROM quiz_attempts WHERE quiz_id = ${id}`;
  await sql`DELETE FROM quiz_sessions WHERE quiz_id = ${id}`;
  // The scores typed in for an in-person quiz go with it (online quizzes keep their grades, as before).
  if (before.delivery === 'in_person') await deleteScoresOf('quiz', [id]);
  await deleteMentionsOf('quiz', [id]);
  const [quiz] = await sql`DELETE FROM quizzes WHERE id = ${id} RETURNING id`;
  if (!quiz) throw httpError(404, 'Quiz not found');
  await deleteManyFromCloudinary(pictures.map((row) => row.image_public_id as string), 'image');
  await recordAudit(req, 'quiz.delete', 'quiz', id, { title: before.title, course_id: before.course_id }, null);
  res.json({ message: 'Quiz deleted' });
}

// ---- Questions ---------------------------------------------------------------

/** Store questions in one canonical form so grading never has to guess. */
function normalizeQuestion(input: QuestionInput) {
  if (input.type === 'mcq') {
    const options = input.options ?? [];
    const match = options.find((o) => o.toLowerCase() === input.correct_answer.toLowerCase());
    return { options, correct_answer: match ?? input.correct_answer };
  }
  if (input.type === 'true_false') {
    return { options: null, correct_answer: input.correct_answer.toLowerCase() };
  }
  return {
    options: null,
    correct_answer: input.correct_answer
      .split('|')
      .map((alt) => alt.trim())
      .join('|'),
  };
}

export async function createQuestion(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const quizId = parseUuid(req.params.id, 'quiz id');
  const input = questionInputSchema.parse(req.body);

  await assertCanManageQuiz(user, quizId);
  await assertQuizQuestionsEditable(quizId);

  const { options, correct_answer } = normalizeQuestion(input);
  const [question] = await sql`
    INSERT INTO quiz_questions (id, quiz_id, question_text, type, options, correct_answer, points)
    VALUES (${newTimeOrderedUuid()}, ${quizId}, ${input.question_text}, ${input.type},
            ${options}::text[], ${correct_answer}, ${input.points})
    RETURNING id, quiz_id, question_text, type, options, correct_answer, points, image_url
  `;
  res.status(201).json({ question });
}

export async function updateQuestion(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const quizId = parseUuid(req.params.id, 'quiz id');
  const questionId = parseUuid(req.params.question_id, 'question id');
  const input = questionInputSchema.parse(req.body);

  await assertCanManageQuiz(user, quizId);
  await assertQuizQuestionsEditable(quizId);

  const { options, correct_answer } = normalizeQuestion(input);
  const [question] = await sql`
    UPDATE quiz_questions
    SET question_text = ${input.question_text}, type = ${input.type},
        options = ${options}::text[], correct_answer = ${correct_answer}, points = ${input.points}
    WHERE id = ${questionId} AND quiz_id = ${quizId}
    RETURNING id, quiz_id, question_text, type, options, correct_answer, points, image_url
  `;
  if (!question) throw httpError(404, 'Question not found');
  res.json({ question });
}

export async function deleteQuestion(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const quizId = parseUuid(req.params.id, 'quiz id');
  const questionId = parseUuid(req.params.question_id, 'question id');

  const quiz = await assertCanManageQuiz(user, quizId);
  await assertQuizQuestionsEditable(quizId);

  if (quiz.is_published) {
    const [row] = await sql`SELECT COUNT(*)::int AS n FROM quiz_questions WHERE quiz_id = ${quizId}`;
    if (row && row.n <= 1) {
      throw httpError(409, 'A published quiz needs at least one question. Unpublish it first.');
    }
  }

  const [deleted] = await sql`
    DELETE FROM quiz_questions WHERE id = ${questionId} AND quiz_id = ${quizId}
    RETURNING id, image_public_id
  `;
  if (!deleted) throw httpError(404, 'Question not found');
  if (deleted.image_public_id) await deleteFromCloudinary(deleted.image_public_id as string, 'image');
  res.json({ message: 'Question deleted' });
}

// ---- Question pictures ---------------------------------------------------------------------

/**
 * PUT /api/quizzes/:id/questions/:question_id/image — multipart field "file".
 * Public on purpose (it is a diagram or photo, never an answer), and it follows the same rule as
 * the question itself: frozen once a student has taken the quiz.
 */
export async function setQuestionImage(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const quizId = parseUuid(req.params.id, 'quiz id');
  const questionId = parseUuid(req.params.question_id, 'question id');

  await assertCanManageQuiz(user, quizId);
  await assertQuizQuestionsEditable(quizId);

  const file = req.file;
  if (!file) throw httpError(400, 'Choose an image to upload');
  if (!sniffImage(file.buffer)) throw httpError(400, 'That file isn’t a valid JPG, PNG or WebP image.');

  const [existing] = await sql`
    SELECT image_public_id FROM quiz_questions WHERE id = ${questionId} AND quiz_id = ${quizId}
  `;
  if (!existing) throw httpError(404, 'Question not found');

  const uploaded = await uploadToCloudinary(
    file.buffer,
    uniqueFileName(file.originalname),
    `pbsi/quizzes/${quizId}`,
    'image',
    { transformation: [{ width: 1200, crop: 'limit', quality: 'auto' }] },
  );

  let question;
  try {
    [question] = await sql`
      UPDATE quiz_questions SET image_url = ${uploaded.url}, image_public_id = ${uploaded.public_id}
      WHERE id = ${questionId} AND quiz_id = ${quizId}
      RETURNING id, quiz_id, question_text, type, options, correct_answer, points, image_url
    `;
  } catch (err) {
    await deleteFromCloudinary(uploaded.public_id, 'image');
    throw err;
  }
  if (!question) {
    await deleteFromCloudinary(uploaded.public_id, 'image');
    throw httpError(404, 'Question not found');
  }

  const old = existing.image_public_id as string | null;
  if (old && old !== uploaded.public_id) await deleteFromCloudinary(old, 'image');
  res.json({ question });
}

/** DELETE /api/quizzes/:id/questions/:question_id/image */
export async function removeQuestionImage(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const quizId = parseUuid(req.params.id, 'quiz id');
  const questionId = parseUuid(req.params.question_id, 'question id');

  await assertCanManageQuiz(user, quizId);
  await assertQuizQuestionsEditable(quizId);

  const [existing] = await sql`
    SELECT image_public_id FROM quiz_questions WHERE id = ${questionId} AND quiz_id = ${quizId}
  `;
  if (!existing) throw httpError(404, 'Question not found');

  const [question] = await sql`
    UPDATE quiz_questions SET image_url = NULL, image_public_id = NULL
    WHERE id = ${questionId} AND quiz_id = ${quizId}
    RETURNING id, quiz_id, question_text, type, options, correct_answer, points, image_url
  `;
  if (existing.image_public_id) await deleteFromCloudinary(existing.image_public_id as string, 'image');
  res.json({ question });
}
