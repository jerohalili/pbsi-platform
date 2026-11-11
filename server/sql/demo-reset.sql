-- server/sql/demo-reset.sql
-- Wipes ALL application data from the Neon database except the 3 test accounts
-- (and their users / profiles / students / teachers rows), ready for demo seeding.
--
-- HOW TO RUN (Neon SQL editor):
--   1. (Recommended) create a backup branch first: Neon console -> Branches -> "pre-demo-wipe".
--   2. Run this file. It commits. Then run demo-seed.sql.
--   (To preview without changing anything, set dry_run to true.)
--
-- WHY ONE DO BLOCK: a DO block is a single statement, so it is atomic whether
-- or not the SQL editor wraps your script in a transaction. Any failure rolls
-- back everything, including TRUNCATE (Postgres TRUNCATE is transactional).
--
-- WHY NO "CASCADE": every table that references a truncated table is already in
-- the list. Without CASCADE, a table I missed makes Postgres ERROR (fail loud)
-- instead of silently wiping it (fail silent).

DO $$
DECLARE
  dry_run       boolean := false;  -- set to true to preview only (rolls back)
  keep_ids      uuid[];
  deleted_users integer;
  msg           text;
  trg           record;
  disabled_trgs text[] := '{}';
  i             integer;
BEGIN
  -- Guard 1: exactly the 3 keeper accounts must exist.
  SELECT array_agg(id) INTO keep_ids
  FROM users
  WHERE lower(email) IN ('admin@pbsi.edu', 'teacher@pbsi.edu', 'student@pbsi.edu');

  IF coalesce(cardinality(keep_ids), 0) <> 3 THEN
    RAISE EXCEPTION 'Expected 3 keeper accounts, found %. Nothing was changed.',
      coalesce(cardinality(keep_ids), 0);
  END IF;

  -- Guard 2: one account per role.
  IF (SELECT count(DISTINCT role) FROM users
      WHERE id = ANY (keep_ids) AND role IN ('admin', 'teacher', 'student')) <> 3 THEN
    RAISE EXCEPTION 'Keeper accounts must be one admin, one teacher, one student. Nothing was changed.';
  END IF;

  -- Guard 3: the teacher and student accounts must have their linked rows,
  -- because courses/enrollments in the seed will point at them.
  IF NOT EXISTS (SELECT 1 FROM teachers WHERE user_id = ANY (keep_ids)) THEN
    RAISE EXCEPTION 'The teacher keeper has no row in teachers. Nothing was changed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM students WHERE user_id = ANY (keep_ids)) THEN
    RAISE EXCEPTION 'The student keeper has no row in students. Nothing was changed.';
  END IF;

  -- audit_logs is protected by an "append-only" trigger that blocks TRUNCATE
  -- (SQLSTATE 42501). For a DEMO reset we pause exactly the user triggers that
  -- are currently enabled on that one table, and restore exactly those below.
  -- ALTER TABLE is transactional, so a dry run or any failure rolls this back
  -- too, and the protection can never be left switched off.
  -- Requires being the owner of audit_logs.
  FOR trg IN
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid = 'public.audit_logs'::regclass
      AND NOT tgisinternal
      AND tgenabled = 'O'
  LOOP
    EXECUTE format('ALTER TABLE public.audit_logs DISABLE TRIGGER %I', trg.tgname);
    disabled_trgs := disabled_trgs || trg.tgname::text;
  END LOOP;

  -- Wipe the 22 data tables in ONE statement. Order does not matter inside a
  -- single TRUNCATE, which also handles the circular link between
  -- discussion_threads.answer_reply_id and discussion_replies.thread_id.
  -- This must happen BEFORE deleting users: audit_logs.actor_id is
  -- ON DELETE RESTRICT, and submissions.graded_by / attendance.marked_by have
  -- no delete rule, so they would block the user delete.
  TRUNCATE TABLE
    announcements,
    assignments,
    attendance,
    audit_logs,
    courses,
    coursework_mentions,
    discussion_replies,
    discussion_reports,
    discussion_threads,
    enrollments,
    exams,
    grades,
    manual_scores,
    module_contents,
    modules,
    notifications,
    quiz_attempts,
    quiz_questions,
    quiz_sessions,
    quizzes,
    submissions,
    timetable;

  -- Remove every other account. profiles, students and teachers rows go with
  -- them via ON DELETE CASCADE; users.created_by is ON DELETE SET NULL.
  DELETE FROM users WHERE id <> ALL (keep_ids);
  GET DIAGNOSTICS deleted_users = ROW_COUNT;

  -- Restore the audit_logs protection exactly as it was.
  FOR i IN 1 .. coalesce(cardinality(disabled_trgs), 0) LOOP
    EXECUTE format('ALTER TABLE public.audit_logs ENABLE TRIGGER %I', disabled_trgs[i]);
  END LOOP;

  msg := format(
    'deleted_users=%s | remaining users=%s, profiles=%s, students=%s, teachers=%s | courses=%s, grades=%s, audit_logs=%s',
    deleted_users,
    (SELECT count(*) FROM users),
    (SELECT count(*) FROM profiles),
    (SELECT count(*) FROM students),
    (SELECT count(*) FROM teachers),
    (SELECT count(*) FROM courses),
    (SELECT count(*) FROM grades),
    (SELECT count(*) FROM audit_logs)
  ) || format(' | audit triggers paused then restored: %s',
              coalesce(nullif(array_to_string(disabled_trgs, ', '), ''), 'none'));

  IF dry_run THEN
    RAISE EXCEPTION 'DRY RUN, rolled back (this is expected). Would have: %', msg;
  END IF;

  RAISE NOTICE 'WIPE COMMITTED. %', msg;
END $$;
