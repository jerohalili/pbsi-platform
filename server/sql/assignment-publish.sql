-- Draft / publish for assignments (same idea as quizzes).
--
-- RUN THIS IN THE NEON SQL EDITOR *BEFORE* DEPLOYING THE SERVER PATCH. The new server code reads
-- and writes assignments.is_published, so deploying first makes the Assignments pages fail until
-- the column exists.
--
-- Safe to run more than once.
--
-- How it works: the column is added with DEFAULT TRUE, so every assignment that already exists is
-- published and nothing disappears from students' screens. The default is then switched to FALSE,
-- so assignments created from now on start as drafts (the server also sets FALSE explicitly).
-- Running the script again changes no row: the column already exists, so no existing assignment
-- is republished or hidden, and only the default is set again.

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT TRUE;

ALTER TABLE assignments
  ALTER COLUMN is_published SET DEFAULT FALSE;

-- Check (every existing assignment should be published, new ones will be drafts):
--   SELECT is_published, COUNT(*) FROM assignments GROUP BY 1;
--   SELECT column_default FROM information_schema.columns
--   WHERE table_name = 'assignments' AND column_name = 'is_published';   -- expect: false
