-- Per-course unread notifications: every notification about one course now remembers which course.
-- The student dashboard uses it for the "unread per course" numbers on the course cards.
--
-- RUN THIS IN THE NEON SQL EDITOR *BEFORE* DEPLOYING THE SERVER PATCH. The server checks for the
-- column when it starts and refuses to start (naming this file) if it is missing.
--
-- Safe to run more than once. The new column is optional, so the server you run today keeps
-- working after this script (it just does not fill the column yet).
--
-- 1. notifications.course_id: NULL means "not about one course" (a grade adjustment from before,
--    an absence alert, an announcement to everyone, a "removed from a course" notice, a message
--    an admin typed by hand). Deleting a course keeps its notifications and clears the column.
-- 2. A tiny index of the unread course rows, for the per-course unread counts.
-- 3. A backfill for old rows, taken from the in-app link they carry:
--      /assignments/<id>   /quizzes/<id>   /exams/<id>   /quiz-results/<attempt id>
--      /discussions/<id>   /courses/<id>
--    A row whose link is something else (/grades, /attendance, /dashboard, no link) or points to
--    something that no longer exists stays NULL. Only rows still NULL are touched, so re-running
--    changes nothing.

BEGIN;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES courses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS notifications_user_course_unread_idx
  ON notifications (user_id, course_id)
  WHERE is_read = FALSE AND course_id IS NOT NULL;

UPDATE notifications n
SET course_id = CASE p.kind
  WHEN 'assignments'  THEN (SELECT m.course_id FROM assignments a JOIN modules m ON m.id = a.module_id WHERE a.id = p.ref)
  WHEN 'quizzes'      THEN (SELECT q.course_id FROM quizzes q WHERE q.id = p.ref)
  WHEN 'exams'        THEN (SELECT e.course_id FROM exams e WHERE e.id = p.ref)
  WHEN 'quiz-results' THEN (SELECT q.course_id FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id WHERE qa.id = p.ref)
  WHEN 'discussions'  THEN (SELECT t.course_id FROM discussion_threads t WHERE t.id = p.ref)
  WHEN 'courses'      THEN (SELECT c.id FROM courses c WHERE c.id = p.ref)
END
FROM (
  SELECT id,
         substring(link FROM '^/(assignments|quizzes|exams|quiz-results|discussions|courses)/') AS kind,
         substring(link FROM '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::uuid AS ref
  FROM notifications
  WHERE course_id IS NULL
    AND link ~ '^/(assignments|quizzes|exams|quiz-results|discussions|courses)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
) p
WHERE n.id = p.id;

COMMIT;

-- Checks:
--   SELECT COUNT(*) FILTER (WHERE course_id IS NOT NULL) AS with_course, COUNT(*) AS total FROM notifications;
--   SELECT type, COUNT(*) FROM notifications WHERE course_id IS NULL AND link ~ '^/(assignments|quizzes|exams|quiz-results|discussions|courses)/' GROUP BY 1;
--     (the second one lists links that point to things that were deleted since)
