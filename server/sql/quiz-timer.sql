-- Server-side quiz timer.
--
-- RUN THIS IN THE NEON SQL EDITOR *BEFORE* DEPLOYING THE SERVER PATCH. The server checks for these
-- objects when it starts and refuses to start (with this file's name in the message) if they are
-- missing, so a forgotten script shows up at deploy time instead of as broken quiz pages.
--
-- Safe to run more than once.
--
-- Until now the countdown lived only in the student's browser: refreshing the page restarted the
-- clock and the server never knew when anyone began. A timed quiz now has a "session" per student:
--   * started_at / expires_at are decided by the SERVER when the student presses Start, and never
--     move again (reloading, closing the tab or switching device does not buy more time);
--   * answers is a copy of what the student has typed so far, saved every few seconds, so that if
--     time runs out while they are away the server can still submit what they had.
-- Quizzes without a time limit do not use sessions.

CREATE TABLE IF NOT EXISTS quiz_sessions (
  quiz_id    uuid        NOT NULL REFERENCES quizzes(id)  ON DELETE CASCADE,
  student_id uuid        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  answers    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (quiz_id, student_id)
);

-- The "who ran out of time?" sweep looks at expired sessions only.
CREATE INDEX IF NOT EXISTS quiz_sessions_expires_idx ON quiz_sessions (expires_at);

-- True when the server submitted the attempt because the time limit ended (the student is told so).
ALTER TABLE quiz_attempts
  ADD COLUMN IF NOT EXISTS auto_submitted boolean NOT NULL DEFAULT false;

-- Check:
--   SELECT to_regclass('quiz_sessions');
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'quiz_attempts' AND column_name = 'auto_submitted';
