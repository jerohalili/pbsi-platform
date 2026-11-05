import { Request, Response } from 'express';
import { sql } from '../config/db.js';
import { z } from 'zod';
import { gradeSubmissionSchema, submitAssignmentSchema } from '../utils/validation.js';
import {
  assertCanManageAssignment,
  assertHttpUrl,
  assertStudentCanHandIn,
  getOwnStudentId,
  httpError,
  parseUuid,
} from '../utils/access.js';
import { schoolYearTerm, toPercent } from '../utils/gradeTerm.js';
import { recordAudit } from '../utils/audit.js';
import { notifyUsers } from '../utils/notify.js';
import {
  deleteFromCloudinary,
  signedDownloadUrl,
  uniqueFileName,
  safeFileName,
  uploadToCloudinary,
} from '../utils/upload.js';
import type { AuthUser } from '../types/index.js';

function currentUser(req: Request): AuthUser {
  if (!req.user) throw httpError(401, 'Not authenticated');
  return req.user;
}

/**
 * Tells the course teacher that work is waiting for them: the one notification that asks someone
 * to act. Best effort: a notification problem must never undo or block a hand-in.
 */
async function notifyTeacherOfHandIn(studentUserId: string, assignmentId: string, isUpdate: boolean): Promise<void> {
  try {
    const [row] = await sql`
      SELECT a.title, te.user_id AS teacher_user_id,
             COALESCE(NULLIF(TRIM(CONCAT(p.first_name, ' ', p.last_name)), ''), 'A student') AS student_name
      FROM assignments a
      JOIN modules m ON m.id = a.module_id
      JOIN courses c ON c.id = m.course_id
      JOIN teachers te ON te.id = c.teacher_id
      LEFT JOIN profiles p ON p.user_id = ${studentUserId}
      WHERE a.id = ${assignmentId}
    `;
    if (!row || row.teacher_user_id === studentUserId) return;
    await notifyUsers([row.teacher_user_id as string], {
      type: 'assignment',
      title: isUpdate ? 'Submission updated' : 'New submission',
      message: `${row.student_name} ${isUpdate ? 'updated their hand-in for' : 'submitted'} “${row.title}”`,
      link: `/assignments/${assignmentId}`,
    });
  } catch (err) {
    console.error('[submissions] could not notify the teacher:', err);
  }
}

/**
 * Teacher view of one assignment: every active student enrolled in the course, with their
 * submission if they made one ("missing" otherwise). Someone who handed in work still shows up
 * after being deactivated or removed from the course, so their work is never hidden.
 */
export async function listSubmissions(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  if (user.role !== 'admin' && user.role !== 'teacher') {
    throw httpError(403, 'Forbidden: insufficient permissions');
  }
  const assignmentId = parseUuid((req.query as { assignment_id?: string }).assignment_id, 'assignment id');

  const assignment = await assertCanManageAssignment(user, assignmentId);
  // An in-person assignment has no hand-ins: its scores are typed on the score sheet instead.
  if (assignment.delivery === 'in_person') {
    throw httpError(409, 'This assignment is checked in person. Enter its scores on the score sheet.');
  }

  const submissions = await sql`
    SELECT st.id AS student_id, st.student_id AS student_number,
           p.first_name, p.last_name,
           sub.id AS submission_id, sub.file_url, sub.file_name,
           (sub.file_public_id IS NOT NULL) AS is_file, sub.submitted_at,
           sub.grade::float8 AS grade, sub.feedback, sub.graded_at,
           (sub.id IS NOT NULL AND sub.submitted_at > ${assignment.due_date}::timestamptz) AS is_late
    FROM students st
    JOIN users u ON u.id = st.user_id
    JOIN profiles p ON p.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT s.id, s.file_url, s.file_name, s.file_public_id, s.submitted_at, s.grade, s.feedback, s.graded_at
      FROM submissions s
      WHERE s.assignment_id = ${assignmentId} AND s.student_id = st.id
      ORDER BY s.submitted_at DESC
      LIMIT 1
    ) sub ON TRUE
    WHERE (
            u.is_active = TRUE
            AND EXISTS (
              SELECT 1 FROM enrollments e WHERE e.student_id = st.id AND e.course_id = ${assignment.course_id}
            )
          )
       OR sub.id IS NOT NULL
    ORDER BY p.last_name ASC, p.first_name ASC
  `;

  res.json({
    assignment: {
      id: assignment.id,
      title: assignment.title,
      max_score: assignment.max_score,
      due_date: assignment.due_date,
    },
    submissions,
  });
}

/** Loads one submission after checking the caller may see it: its owner, or the course's teacher/admin. */
async function loadViewableSubmission(user: AuthUser, id: string) {
  const [submission] = await sql`
    SELECT s.id, s.assignment_id, s.student_id, s.file_url, s.file_name, s.file_public_id,
           (s.file_public_id IS NOT NULL) AS is_file, s.submitted_at,
           s.grade::float8 AS grade, s.feedback, s.graded_at,
           (s.submitted_at > a.due_date) AS is_late
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    WHERE s.id = ${id}
  `;
  if (!submission) throw httpError(404, 'Submission not found');

  if (user.role === 'student') {
    const ownId = await getOwnStudentId(user.id);
    if (!ownId || ownId !== submission.student_id) {
      throw httpError(403, 'Forbidden: you can only view your own submissions');
    }
  } else {
    await assertCanManageAssignment(user, submission.assignment_id as string);
  }
  return submission;
}

/** One submission: its owner, or a teacher/admin who manages the course. */
export async function getSubmission(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { file_public_id: _private, ...submission } = await loadViewableSubmission(
    user,
    parseUuid(req.params.id, 'submission id'),
  );
  res.json({ submission });
}

/** GET /api/submissions/:id/download — a short-lived signed link to the uploaded file. */
export async function downloadSubmission(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const submission = await loadViewableSubmission(user, parseUuid(req.params.id, 'submission id'));
  if (!submission.file_public_id) throw httpError(404, 'This submission has no uploaded file');

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    url: signedDownloadUrl(submission.file_public_id as string, 'raw'),
    file_name: submission.file_name ?? 'submission',
  });
}

interface HandIn {
  fileUrl: string | null;
  publicId: string | null;
  fileName: string | null;
}

/**
 * Saves a hand-in as one statement that does not depend on a unique constraint: it updates the
 * student's ungraded submission, or inserts one only if the student has none yet. Returns
 * undefined when the student's submission was graded in the meantime (and so is locked).
 */
async function saveHandIn(assignmentId: string, studentId: string, handIn: HandIn) {
  const [submission] = await sql`
    WITH upd AS (
      UPDATE submissions
      SET file_url = ${handIn.fileUrl}::text, file_public_id = ${handIn.publicId}::text,
          file_name = ${handIn.fileName}::text, submitted_at = now()
      WHERE assignment_id = ${assignmentId}::uuid
        AND student_id = ${studentId}::uuid
        AND grade IS NULL
      RETURNING id, assignment_id, student_id, file_url, file_name, file_public_id, submitted_at, grade, feedback, graded_at
    ),
    ins AS (
      INSERT INTO submissions (assignment_id, student_id, file_url, file_public_id, file_name)
      SELECT ${assignmentId}::uuid, ${studentId}::uuid, ${handIn.fileUrl}::text,
             ${handIn.publicId}::text, ${handIn.fileName}::text
      WHERE NOT EXISTS (
        SELECT 1 FROM submissions
        WHERE assignment_id = ${assignmentId}::uuid AND student_id = ${studentId}::uuid
      )
      RETURNING id, assignment_id, student_id, file_url, file_name, file_public_id, submitted_at, grade, feedback, graded_at
    )
    SELECT r.id, r.assignment_id, r.student_id, r.file_url, r.file_name,
           (r.file_public_id IS NOT NULL) AS is_file, r.submitted_at,
           r.grade::float8 AS grade, r.feedback, r.graded_at,
           (r.submitted_at > a.due_date) AS is_late
    FROM (SELECT * FROM upd UNION ALL SELECT * FROM ins) r
    JOIN assignments a ON a.id = r.assignment_id
  `;
  return submission;
}

const LOCKED_MESSAGE = 'This submission has already been graded and can no longer be changed.';

/** The student's current submission for an assignment, if any (used to clean up a replaced file). */
async function findOwnSubmission(assignmentId: string, studentId: string) {
  const [existing] = await sql`
    SELECT id, grade, file_public_id FROM submissions
    WHERE assignment_id = ${assignmentId} AND student_id = ${studentId}
    ORDER BY submitted_at DESC LIMIT 1
  `;
  return existing as { id: string; grade: number | null; file_public_id: string | null } | undefined;
}

/**
 * A student submits (or resubmits) a link. Resubmitting replaces the previous hand-in (link or file)
 * until a teacher has graded it; after that the submission is locked.
 */
export async function createSubmission(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  if (user.role !== 'student') throw httpError(403, 'Only students can submit assignments');

  const input = submitAssignmentSchema.parse(req.body);
  assertHttpUrl(input.file_url, 'Submission link');

  const studentId = await getOwnStudentId(user.id);
  if (!studentId) throw httpError(404, 'Student profile not found');

  await assertStudentCanHandIn(studentId, input.assignment_id);

  const previous = await findOwnSubmission(input.assignment_id, studentId);
  const submission = await saveHandIn(input.assignment_id, studentId, {
    fileUrl: input.file_url,
    publicId: null,
    fileName: null,
  });
  if (!submission) throw httpError(409, LOCKED_MESSAGE);

  // The link replaced an uploaded file, so that file is no longer needed.
  if (previous?.file_public_id) await deleteFromCloudinary(previous.file_public_id, 'raw', 'authenticated');

  await notifyTeacherOfHandIn(user.id, input.assignment_id, Boolean(previous));
  res.status(201).json({ submission });
}

const submitFileSchema = z.object({ assignment_id: z.string().uuid('Invalid assignment id') });

/**
 * POST /api/submissions/file — multipart: `assignment_id` + `file`.
 * The file is stored privately in Cloudinary; nobody gets a link except through downloadSubmission.
 */
export async function createFileSubmission(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  if (user.role !== 'student') throw httpError(403, 'Only students can submit assignments');

  const { assignment_id: assignmentId } = submitFileSchema.parse(req.body);
  const file = req.file;
  if (!file) throw httpError(400, 'Choose a file to upload');

  const studentId = await getOwnStudentId(user.id);
  if (!studentId) throw httpError(404, 'Student profile not found');

  await assertStudentCanHandIn(studentId, assignmentId);

  // Refuse before uploading anything when the work is already graded.
  const previous = await findOwnSubmission(assignmentId, studentId);
  if (previous && previous.grade !== null) throw httpError(409, LOCKED_MESSAGE);

  const uploaded = await uploadToCloudinary(
    file.buffer,
    uniqueFileName(file.originalname),
    `pbsi/submissions/${assignmentId}`,
    'raw',
    { type: 'authenticated' },
  );

  let submission;
  try {
    submission = await saveHandIn(assignmentId, studentId, {
      fileUrl: null,
      publicId: uploaded.public_id,
      fileName: safeFileName(file.originalname),
    });
  } catch (err) {
    await deleteFromCloudinary(uploaded.public_id, 'raw', 'authenticated');
    throw err;
  }
  if (!submission) {
    // Graded while the upload was in flight: drop the file we just stored.
    await deleteFromCloudinary(uploaded.public_id, 'raw', 'authenticated');
    throw httpError(409, LOCKED_MESSAGE);
  }

  if (previous?.file_public_id && previous.file_public_id !== uploaded.public_id) {
    await deleteFromCloudinary(previous.file_public_id, 'raw', 'authenticated');
  }

  await notifyTeacherOfHandIn(user.id, assignmentId, Boolean(previous));
  res.status(201).json({ submission });
}

/** A teacher/admin who manages the course grades (or re-grades) a submission. */
export async function gradeSubmission(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const id = parseUuid(req.params.id, 'submission id');
  const input = gradeSubmissionSchema.parse(req.body);

  const [existing] = await sql`
    SELECT s.id, s.assignment_id, st.user_id AS student_user_id,
           s.grade::float8 AS previous_grade, s.feedback AS previous_feedback
    FROM submissions s
    JOIN students st ON st.id = s.student_id
    WHERE s.id = ${id}
  `;
  if (!existing) throw httpError(404, 'Submission not found');

  const assignment = await assertCanManageAssignment(user, existing.assignment_id as string);

  if (input.score > assignment.max_score) {
    throw httpError(400, `Score can’t be higher than the maximum of ${assignment.max_score}`);
  }

  const feedbackProvided = input.feedback !== undefined;
  const percent = toPercent(input.score, assignment.max_score);

  // One statement, so the submission and its grades row can never disagree. A re-grade updates the
  // existing grades row (matched by student + assessment); the first grade inserts it.
  const [submission] = await sql`
    WITH sub AS (
      UPDATE submissions
      SET grade = ${input.score},
          feedback = CASE WHEN ${feedbackProvided}::boolean THEN ${input.feedback || null} ELSE feedback END,
          graded_by = ${user.id},
          graded_at = now()
      WHERE id = ${id}
      RETURNING id, assignment_id, student_id, file_url, file_name, file_public_id, submitted_at, grade, feedback, graded_at
    ),
    upd AS (
      UPDATE grades g
      SET score = ${percent}::numeric, feedback = sub.feedback
      FROM sub
      WHERE g.student_id = sub.student_id
        AND g.assessment_type = 'assignment'
        AND g.assessment_id = sub.assignment_id
      RETURNING g.id
    ),
    ins AS (
      INSERT INTO grades (student_id, course_id, assessment_type, assessment_id, score, feedback, term)
      SELECT sub.student_id, ${assignment.course_id}::uuid, 'assignment', sub.assignment_id,
             ${percent}::numeric, sub.feedback, ${schoolYearTerm()}::text
      FROM sub
      WHERE NOT EXISTS (
        SELECT 1 FROM grades g
        WHERE g.student_id = sub.student_id
          AND g.assessment_type = 'assignment'
          AND g.assessment_id = sub.assignment_id
      )
      RETURNING id
    )
    SELECT id, assignment_id, student_id, file_url, file_name,
           (file_public_id IS NOT NULL) AS is_file, submitted_at,
           grade::float8 AS grade, feedback, graded_at
    FROM sub
  `;

  await recordAudit(
    req,
    'submission.grade',
    'submission',
    id,
    existing.previous_grade === null ? null : { grade: existing.previous_grade, feedback: existing.previous_feedback },
    { grade: input.score, max_score: assignment.max_score, feedback: submission?.feedback ?? null },
  );

  // Let the student know. Best effort: a notification problem must never undo or block a grade.
  await notifyUsers([existing.student_user_id as string], {
    type: 'grade',
    title: 'Assignment graded',
    message: `${assignment.title}: ${input.score}/${assignment.max_score}`,
    link: `/assignments/${assignment.id}`,
  });

  res.json({ submission });
}
