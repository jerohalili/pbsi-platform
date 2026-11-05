import { sql } from './db.js';

const SCRIPT = 'server/sql/cloudinary-uploads.sql';

// Columns added by the Cloudinary upload feature. The queries for assignments, submissions and
// quizzes read them, so a database without them would fail page by page with confusing 500s.
const REQUIRED_COLUMNS: Array<[table: string, column: string]> = [
  ['submissions', 'file_public_id'],
  ['submissions', 'file_name'],
  ['assignments', 'attachment_public_id'],
  ['assignments', 'attachment_name'],
  ['quiz_questions', 'image_url'],
  ['quiz_questions', 'image_public_id'],
];

interface ColumnRow {
  table_name: string;
  column_name: string;
  is_nullable: string;
}

/** What is missing or wrong, given the columns the database reports. Empty when the schema is ready. */
export function schemaProblems(rows: ColumnRow[]): string[] {
  const has = (table: string, column: string) =>
    rows.some((r) => r.table_name === table && r.column_name === column);

  const problems = REQUIRED_COLUMNS.filter(([t, c]) => !has(t, c)).map(([t, c]) => `missing column ${t}.${c}`);

  // A file hand-in has no link, so the link column must allow NULL.
  const fileUrl = rows.find((r) => r.table_name === 'submissions' && r.column_name === 'file_url');
  if (fileUrl && fileUrl.is_nullable !== 'YES') problems.push('submissions.file_url must allow NULL');
  return problems;
}

const COURSEWORK_SCRIPT = 'server/sql/coursework-exams.sql';

/** Stops the server at startup, with instructions, when exams / in-person scoring are not set up yet. */
export async function assertCourseworkSchema(): Promise<void> {
  const [row] = await sql`
    SELECT to_regclass('exams') IS NOT NULL AS has_exams,
           to_regclass('manual_scores') IS NOT NULL AS has_scores,
           EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'assignments' AND column_name = 'delivery'
           ) AS has_assignment_delivery,
           EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'quizzes' AND column_name = 'delivery'
           ) AS has_quiz_delivery
  `;
  const missing = [
    row?.has_exams ? null : 'table exams',
    row?.has_scores ? null : 'table manual_scores',
    row?.has_assignment_delivery ? null : 'column assignments.delivery',
    row?.has_quiz_delivery ? null : 'column quizzes.delivery',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `The database is not ready for exams and in-person scoring (missing ${missing.join(', ')}). ` +
        `Run ${COURSEWORK_SCRIPT} in the Neon SQL editor (safe to run more than once), then restart the server.`,
    );
  }
}

const TIMER_SCRIPT = 'server/sql/quiz-timer.sql';

/** Stops the server at startup, with instructions, when the quiz timer table and column are missing. */
export async function assertQuizTimerSchema(): Promise<void> {
  const [row] = await sql`
    SELECT to_regclass('quiz_sessions') IS NOT NULL AS has_sessions,
           EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'quiz_attempts' AND column_name = 'auto_submitted'
           ) AS has_flag
  `;
  const missing = [
    row?.has_sessions ? null : 'table quiz_sessions',
    row?.has_flag ? null : 'column quiz_attempts.auto_submitted',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `The database is not ready for the quiz timer (missing ${missing.join(' and ')}). ` +
        `Run ${TIMER_SCRIPT} in the Neon SQL editor (safe to run more than once), then restart the server.`,
    );
  }
}

/** Stops the server at startup, with instructions, when the upload columns have not been added yet. */
export async function assertUploadSchema(): Promise<void> {
  const rows = (await sql`
    SELECT table_name, column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN ('submissions', 'assignments', 'quiz_questions')
  `) as ColumnRow[];

  const problems = schemaProblems(rows);
  if (problems.length > 0) {
    throw new Error(
      `The database is not ready for file uploads (${problems.join('; ')}). ` +
        `Run ${SCRIPT} in the Neon SQL editor (safe to run more than once), then restart the server.`,
    );
  }
}
