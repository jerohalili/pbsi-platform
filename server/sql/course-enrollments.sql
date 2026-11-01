-- Course enrollments: which students belong to which course.
--
-- RUN THIS IN THE NEON SQL EDITOR *BEFORE* DEPLOYING THE SERVER PATCH. The new server code reads
-- this table on almost every student request, so deploying first would break the student pages.
--
-- Safe to run more than once. Everything, including the backfill, happens only the first time
-- (when the table does not exist yet), so running the script again can never re-enroll a student
-- that a teacher has removed since.
--
-- BACKFILL: every existing student is enrolled in every existing course. That is exactly what the
-- app did before enrollments existed (every student saw every course), so nothing changes for
-- anyone the day this goes live. From then on, teachers and admins remove students from courses
-- (and add them back) on each course page. The backfilled rows have enrolled_by = NULL.
--
-- Deleting a course or a student deletes their enrollment rows (ON DELETE CASCADE). Deleting the
-- teacher/admin who enrolled someone keeps the enrollment (ON DELETE SET NULL).

DO $$
BEGIN
  IF to_regclass('public.enrollments') IS NULL THEN
    CREATE TABLE enrollments (
      course_id   uuid        NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
      student_id  uuid        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      enrolled_at timestamptz NOT NULL DEFAULT now(),
      enrolled_by uuid                 REFERENCES users(id)    ON DELETE SET NULL,
      PRIMARY KEY (course_id, student_id)
    );

    -- "Which courses is this student in?" is asked on every student page load.
    CREATE INDEX enrollments_student_idx ON enrollments (student_id);

    INSERT INTO enrollments (course_id, student_id)
    SELECT c.id, s.id
    FROM courses c
    CROSS JOIN students s;
  END IF;
END $$;

-- Check (students x courses should match, right after the first run):
--   SELECT (SELECT COUNT(*) FROM enrollments) AS enrollments,
--          (SELECT COUNT(*) FROM students) * (SELECT COUNT(*) FROM courses) AS students_times_courses;
--
-- Enrollment count per course:
--   SELECT c.code, COUNT(e.student_id) AS students
--   FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id
--   GROUP BY c.code ORDER BY c.code;
