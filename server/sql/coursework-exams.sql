-- Exams, and "in person" assignments / quizzes whose scores the teacher enters by hand.
--
-- RUN THIS IN THE NEON SQL EDITOR *BEFORE* DEPLOYING THE SERVER PATCH. The server checks for these
-- objects when it starts and refuses to start (naming this file) if they are missing.
--
-- Safe to run more than once. Nothing that exists today changes: every current assignment and quiz
-- becomes delivery = 'online', which is exactly how it already behaves.
--
-- WHAT IT ADDS
--   * assignments.delivery / quizzes.delivery  'online' (as today) or 'in_person'. An in-person item is
--     only announced on the site (date, time, room, details). Nothing can be submitted or answered
--     online; the teacher checks the work face to face and records each student's score afterwards.
--   * exams            always in person, announced on the site and scored by hand
--   * manual_scores    the raw score the teacher typed for one student on one in-person item
--                      (assignment, quiz or exam). The percentage also goes into `grades`, exactly as
--                      graded online work does, so the Grades pages and averages include it.

-- ---- delivery mode ----------------------------------------------------------------------------
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS delivery text NOT NULL DEFAULT 'online';
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS room     text;

ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS delivery     text        NOT NULL DEFAULT 'online';
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS room         text;
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS details      text;
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS max_score    numeric     NOT NULL DEFAULT 100;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignments_delivery_check') THEN
    ALTER TABLE assignments ADD CONSTRAINT assignments_delivery_check CHECK (delivery IN ('online', 'in_person'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quizzes_delivery_check') THEN
    ALTER TABLE quizzes ADD CONSTRAINT quizzes_delivery_check CHECK (delivery IN ('online', 'in_person'));
  END IF;
  -- An in-person quiz is a scheduled event, so it must have a date. Online quizzes need none.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quizzes_in_person_date_check') THEN
    ALTER TABLE quizzes ADD CONSTRAINT quizzes_in_person_date_check
      CHECK (delivery = 'online' OR scheduled_at IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quizzes_max_score_check') THEN
    ALTER TABLE quizzes ADD CONSTRAINT quizzes_max_score_check CHECK (max_score > 0);
  END IF;
END $$;

-- ---- exams ----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exams (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id        uuid        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title            text        NOT NULL,
  details          text,                           -- coverage, what to bring, reminders
  exam_at          timestamptz NOT NULL,
  duration_minutes integer     CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  room             text,
  max_score        numeric     NOT NULL DEFAULT 100 CHECK (max_score > 0),
  is_published     boolean     NOT NULL DEFAULT false,   -- drafts are visible only to the teacher / admins
  created_by       uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exams_course_idx ON exams (course_id, exam_at);

-- ---- manual scores --------------------------------------------------------------------------------
-- item_id points at assignments / quizzes / exams depending on item_type, so there is no foreign key
-- on it: the server removes a deleted item's scores itself. Deleting a course or a student removes
-- their rows through the foreign keys below.
CREATE TABLE IF NOT EXISTS manual_scores (
  item_type  text        NOT NULL CHECK (item_type IN ('assignment', 'quiz', 'exam')),
  item_id    uuid        NOT NULL,
  student_id uuid        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id  uuid        NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
  score      numeric     NOT NULL CHECK (score >= 0),   -- raw points; the item's max_score is the ceiling
  feedback   text,
  graded_by  uuid        REFERENCES users(id) ON DELETE SET NULL,
  graded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_type, item_id, student_id)
);
CREATE INDEX IF NOT EXISTS manual_scores_student_idx ON manual_scores (student_id);
CREATE INDEX IF NOT EXISTS manual_scores_course_idx  ON manual_scores (course_id);

-- Check:
--   SELECT delivery, COUNT(*) FROM assignments GROUP BY 1;     -- everything 'online'
--   SELECT delivery, COUNT(*) FROM quizzes GROUP BY 1;         -- everything 'online'
--   SELECT to_regclass('exams'), to_regclass('manual_scores');
