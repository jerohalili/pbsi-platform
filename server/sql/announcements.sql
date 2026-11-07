-- Announcements: a message from an admin or a teacher to everyone, all teachers, all students, or
-- the students of one course. Shown on the dashboards (an urgent one also as a banner until it
-- expires) and sent as a bell notification when it is posted.
--
-- RUN THIS IN THE NEON SQL EDITOR *BEFORE* DEPLOYING THE SERVER PATCH. The server checks for the
-- table when it starts and refuses to start (naming this file) if it is missing.
--
-- Safe to run more than once. Nothing that exists today changes.
--
-- audience:   'all' (every active account), 'teachers', 'students', or 'course' (the students
--             enrolled in course_id, and that course's teacher).
-- expires_at: optional. After it passes the announcement leaves the dashboards and banners but
--             stays in the history list of its author and of admins.
-- deleted_at: a delete is soft, so an announcement that was already sent never vanishes from the
--             audit trail. Deleting a course removes its announcements; deleting an author keeps
--             theirs (created_by becomes NULL).

CREATE TABLE IF NOT EXISTS announcements (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL,
  message     text        NOT NULL,
  audience    text        NOT NULL CHECK (audience IN ('all', 'teachers', 'students', 'course')),
  course_id   uuid        REFERENCES courses(id) ON DELETE CASCADE,
  is_urgent   boolean     NOT NULL DEFAULT FALSE,
  expires_at  timestamptz,
  created_by  uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  -- A course announcement names its course; the other audiences never do.
  CONSTRAINT announcements_course_matches_audience CHECK ((audience = 'course') = (course_id IS NOT NULL))
);

-- "What is live right now?" (dashboards, banner): only rows that are not deleted.
CREATE INDEX IF NOT EXISTS announcements_live_idx
  ON announcements (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS announcements_course_idx ON announcements (course_id);
CREATE INDEX IF NOT EXISTS announcements_author_idx ON announcements (created_by);

-- Check:
--   SELECT to_regclass('announcements');
