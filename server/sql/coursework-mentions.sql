-- Teacher mentions: a short note from a teacher to a specific student about an assignment, quiz or
-- exam. A comment on the student's coursework, a reminder that a deadline was missed, or a request
-- to correct something.
--
-- RUN THIS IN THE NEON SQL EDITOR *BEFORE* DEPLOYING THE SERVER PATCH. The server checks for the
-- table when it starts and refuses to start (naming this file) if it is missing.
--
-- Safe to run more than once. Nothing that exists today changes.
--
-- A student sees only the notes addressed to them. The student can mark a note "seen"
-- (acknowledged_at); the teacher marks it resolved when the matter is settled (resolved_at).
-- item_id points at assignments / quizzes / exams depending on item_type, so there is no foreign
-- key on it: the server removes a deleted item's notes itself. Deleting a course or a student
-- removes their notes through the foreign keys below.

CREATE TABLE IF NOT EXISTS coursework_mentions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type       text        NOT NULL CHECK (item_type IN ('assignment', 'quiz', 'exam')),
  item_id         uuid        NOT NULL,
  student_id      uuid        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id       uuid        NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
  reason          text        NOT NULL CHECK (reason IN ('comment', 'missed_deadline', 'correction')),
  message         text        NOT NULL,
  created_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at     timestamptz
);

-- "Which notes does this student still have open?" and "which notes are on this item?"
CREATE INDEX IF NOT EXISTS coursework_mentions_student_idx ON coursework_mentions (student_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS coursework_mentions_item_idx    ON coursework_mentions (item_type, item_id);
CREATE INDEX IF NOT EXISTS coursework_mentions_course_idx  ON coursework_mentions (course_id);

-- Check:
--   SELECT to_regclass('coursework_mentions');
