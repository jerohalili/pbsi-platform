-- server/sql/demo-seed.sql
-- Fills an EMPTY database (after demo-reset.sql) with demo data:
--   3 test accounts kept as-is + 3 demo teachers + 29 demo students,
--   6 courses, modules, assignments, quizzes, exams, 4 weeks of attendance,
--   submissions, quiz attempts, grades, announcements, discussions, audit entries.
--
-- HOW TO RUN (Neon SQL editor):
--   1. Run demo-reset.sql first (this seed refuses to run on a non-empty database).
--   2. Run this file. It commits.
--   (To preview without changing anything, set dry_run to true.)
--
-- DESIGN NOTES
--   * Everything is relative to the moment you run it (Asia/Manila), so deadlines,
--     "recent grades" and the 4 weeks of attendance always look current.
--   * All demo accounts get the SAME password hash as student@pbsi.edu,
--     so every demo user logs in with Password123!. Demo-only database!
--   * Ids are fixed (uuid v5) and "randomness" is hash-based, so the result is
--     reproducible. Student scores follow a bell-shaped spread around the low 80s.
--   * Cloudinary columns are left NULL on purpose (no fake remote files).
--
-- UNVERIFIED ASSUMPTIONS (the database cannot tell me these; I could not read the
-- app code). They are isolated in the variables below, so fixing one is a one-line edit:
--   A. grades.assessment_type values and assessment_id = the assignment / quiz / exam id.
--   B. notifications.type values: grade / announcement / mention (link left NULL).
--   C. quiz_questions.correct_answer: the option TEXT for mcq, 'true'/'false' for true_false.
--   D. Manual scores (in-person items) also produce a grades row.
-- If the Grades or Notifications screens look wrong after seeding, run
--   TRUNCATE grades, notifications;
-- and tell me what the app expects (or set the two seed_* switches to false).

DO $$
DECLARE
  dry_run            boolean := false;    -- set to true to preview only (rolls back)
  seed_grades        boolean := true;     -- assumption A / D
  seed_notifications boolean := true;     -- assumption B
  g_assignment text := 'assignment';      -- assumption A
  g_quiz       text := 'quiz';
  g_exam       text := 'exam';
  n_grade        text := 'grade';         -- assumption B
  n_announcement text := 'announcement';
  n_mention      text := 'mention';
  v_now   timestamptz := now();
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_monday date;
  v_term  text;
  v_admin uuid; v_t_user uuid; v_s_user uuid; v_t_pk uuid; v_s_pk uuid;
  v_hash  text;
  msg     text;
BEGIN
  v_monday := v_today - (extract(isodow FROM v_today)::int - 1);
  -- school year label: June starts a new year (Manila), e.g. Nov 2026 -> '2026', Mar 2027 -> '2026'
  v_term := extract(year FROM ((now() AT TIME ZONE 'Asia/Manila') - interval '5 months'))::int::text;

  -- Guards ------------------------------------------------------------------
  IF (SELECT count(*) FROM users WHERE lower(email) IN ('admin@pbsi.edu','teacher@pbsi.edu','student@pbsi.edu')) <> 3 THEN
    RAISE EXCEPTION 'The 3 keeper accounts must exist. Nothing was changed.';
  END IF;
  IF (SELECT count(*) FROM users) <> 3
     OR EXISTS (SELECT 1 FROM courses) OR EXISTS (SELECT 1 FROM enrollments)
     OR EXISTS (SELECT 1 FROM grades)  OR EXISTS (SELECT 1 FROM audit_logs) THEN
    RAISE EXCEPTION 'Database is not empty. Run demo-reset.sql first. Nothing was changed.';
  END IF;

  SELECT id INTO v_admin  FROM users WHERE lower(email) = 'admin@pbsi.edu';
  SELECT id INTO v_t_user FROM users WHERE lower(email) = 'teacher@pbsi.edu';
  SELECT id INTO v_s_user FROM users WHERE lower(email) = 'student@pbsi.edu';
  SELECT id INTO v_t_pk   FROM teachers WHERE user_id = v_t_user;
  SELECT id INTO v_s_pk   FROM students WHERE user_id = v_s_user;
  SELECT password_hash INTO v_hash FROM users WHERE id = v_s_user;

  -- Users, profiles, teachers, students -------------------------------------
  INSERT INTO users (id, email, password_hash, role, created_by, created_at) VALUES
  ('94ceae50-c492-5045-8d88-c8b5d2d7b7fe', 'maricel.domingo@pbsi.edu', v_hash, 'teacher', v_admin, v_now - interval '140 days'),
  ('60232eef-026d-5448-9ce9-ae74893784de', 'ramon.villanueva@pbsi.edu', v_hash, 'teacher', v_admin, v_now - interval '140 days'),
  ('a27b1b90-8262-52a7-8a93-4d6ef3c33b02', 'teresita.pascual@pbsi.edu', v_hash, 'teacher', v_admin, v_now - interval '140 days'),
  ('331b5d03-233b-5068-b238-e8de1a9cae12', 'miguel.ramos@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('c0dbc4f1-804c-5415-acbe-33d8ce181504', 'patricia.tolentino@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('09f1e574-ec63-593b-80fe-55add55c4e9a', 'jocelyn.rivera@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('12fe99c8-244d-59c6-9f3d-08539700e491', 'kristine.perez@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('a30b6fd4-8cd4-5f7a-bda5-600012967cba', 'dominic.santos@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('24b39309-a1f3-56a4-be71-9866e3f0330b', 'miguel.villanueva@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('14a676bc-3d20-5611-8dd9-b89ccda17d9a', 'angelica.mercado@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('10f425e8-2fc3-508a-810c-3a60a4adcf12', 'louise.mendoza@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('b39b81f6-8940-5dc1-8ea1-e0b96f286720', 'mikaela.evangelista@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('91a19e1e-7f2f-5197-aa30-284185694ba9', 'joaquin.manalo@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('61125295-0258-5b2d-8bdc-ce93725d4790', 'nathan.domingo@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('c71f240c-5211-5ea6-bc0b-49b2971dadca', 'denise.navarro@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('80da8d45-6801-57eb-a01e-771400ff7fed', 'francis.santos@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('a94a065a-9afb-523a-8797-63291e2f7777', 'adrian.navarro@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('4a17c4a4-8ce1-5776-988c-2a3c7b027430', 'lance.tolentino@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('d9a74d8b-7da8-5b4c-aa87-f4848b62b346', 'kristine.fernandez@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('0973e6fe-62c1-5db9-81f7-433af6f9ecc0', 'joaquin.rivera@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('13f11eaa-b381-5e64-a977-5dfc0d442051', 'lance.evangelista@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('c0621d03-d782-5e77-96b7-5fb6cbf18645', 'jocelyn.soriano@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('4354d237-1d4e-5e87-b6dd-837f8d333489', 'mark.soriano@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('eb8a9225-fa2f-54d1-a586-ca02ccf168e1', 'carlo.macaraeg@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('d96dcc53-8063-555a-bf82-ab0017f490e4', 'patricia.tan@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('e72bf791-9f3e-50f0-9360-f800334640fc', 'ysabel.ocampo@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('3473fda6-ef26-54b9-8bc1-d962196c1826', 'miguel.manalo@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('cc14d4fd-c5bf-5a8d-9cf9-51ea94e0bf2a', 'ysabel.tan@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('87a439a6-dd0e-5a75-a4c7-5f90f141e5c0', 'lance.lim@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('8b445718-7698-5979-a56e-e8f65372727c', 'joaquin.tan@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('a50cb821-a13b-5fed-98e6-dfb95ec359da', 'enzo.mendoza@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days'),
  ('dd27b9de-6397-5727-a505-376476d91f92', 'angelica.reyes@pbsi.edu', v_hash, 'student', v_admin, v_now - interval '140 days');
  INSERT INTO profiles (user_id, first_name, last_name, date_of_birth, address) VALUES
  ('94ceae50-c492-5045-8d88-c8b5d2d7b7fe', 'Maricel', 'Domingo', NULL, NULL),
  ('60232eef-026d-5448-9ce9-ae74893784de', 'Ramon', 'Villanueva', NULL, NULL),
  ('a27b1b90-8262-52a7-8a93-4d6ef3c33b02', 'Teresita', 'Pascual', NULL, NULL),
  ('331b5d03-233b-5068-b238-e8de1a9cae12', 'Miguel', 'Ramos', DATE '2005-10-26', 'Brgy. Mandalagan, Bacolod City'),
  ('c0dbc4f1-804c-5415-acbe-33d8ce181504', 'Patricia', 'Tolentino', DATE '2004-04-02', 'Brgy. Pinagbuhatan, Pasig City'),
  ('09f1e574-ec63-593b-80fe-55add55c4e9a', 'Jocelyn', 'Rivera', DATE '2006-03-18', 'Brgy. Mandalagan, Bacolod City'),
  ('12fe99c8-244d-59c6-9f3d-08539700e491', 'Kristine', 'Perez', DATE '2006-04-16', 'Brgy. Carmen, Cagayan de Oro City'),
  ('a30b6fd4-8cd4-5f7a-bda5-600012967cba', 'Dominic', 'Santos', DATE '2006-06-11', 'Brgy. Poblacion, Makati City'),
  ('24b39309-a1f3-56a4-be71-9866e3f0330b', 'Miguel', 'Villanueva', DATE '2003-07-20', 'Brgy. Carmen, Cagayan de Oro City'),
  ('14a676bc-3d20-5611-8dd9-b89ccda17d9a', 'Angelica', 'Mercado', DATE '2006-11-04', 'Brgy. Carmen, Cagayan de Oro City'),
  ('10f425e8-2fc3-508a-810c-3a60a4adcf12', 'Louise', 'Mendoza', DATE '2005-03-24', 'Brgy. Mandurriao, Iloilo City'),
  ('b39b81f6-8940-5dc1-8ea1-e0b96f286720', 'Mikaela', 'Evangelista', DATE '2004-12-31', 'Brgy. Ususan, Taguig City'),
  ('91a19e1e-7f2f-5197-aa30-284185694ba9', 'Joaquin', 'Manalo', DATE '2003-06-06', 'Brgy. Session Road Area, Baguio City'),
  ('61125295-0258-5b2d-8bdc-ce93725d4790', 'Nathan', 'Domingo', DATE '2006-01-06', 'Brgy. Mandurriao, Iloilo City'),
  ('c71f240c-5211-5ea6-bc0b-49b2971dadca', 'Denise', 'Navarro', DATE '2003-10-16', 'Brgy. Pinagbuhatan, Pasig City'),
  ('80da8d45-6801-57eb-a01e-771400ff7fed', 'Francis', 'Santos', DATE '2006-12-26', 'Brgy. Session Road Area, Baguio City'),
  ('a94a065a-9afb-523a-8797-63291e2f7777', 'Adrian', 'Navarro', DATE '2005-05-14', 'Brgy. Poblacion, Makati City'),
  ('4a17c4a4-8ce1-5776-988c-2a3c7b027430', 'Lance', 'Tolentino', DATE '2006-04-14', 'Brgy. Mandalagan, Bacolod City'),
  ('d9a74d8b-7da8-5b4c-aa87-f4848b62b346', 'Kristine', 'Fernandez', DATE '2003-08-27', 'Brgy. Ususan, Taguig City'),
  ('0973e6fe-62c1-5db9-81f7-433af6f9ecc0', 'Joaquin', 'Rivera', DATE '2006-05-14', 'Brgy. Carmen, Cagayan de Oro City'),
  ('13f11eaa-b381-5e64-a977-5dfc0d442051', 'Lance', 'Evangelista', DATE '2005-12-10', 'Brgy. Mandurriao, Iloilo City'),
  ('c0621d03-d782-5e77-96b7-5fb6cbf18645', 'Jocelyn', 'Soriano', DATE '2005-09-08', 'Brgy. Mandalagan, Bacolod City'),
  ('4354d237-1d4e-5e87-b6dd-837f8d333489', 'Mark', 'Soriano', DATE '2004-04-04', 'Brgy. Lahug, Cebu City'),
  ('eb8a9225-fa2f-54d1-a586-ca02ccf168e1', 'Carlo', 'Macaraeg', DATE '2006-12-14', 'Brgy. Mandalagan, Bacolod City'),
  ('d96dcc53-8063-555a-bf82-ab0017f490e4', 'Patricia', 'Tan', DATE '2006-06-28', 'Brgy. Ususan, Taguig City'),
  ('e72bf791-9f3e-50f0-9360-f800334640fc', 'Ysabel', 'Ocampo', DATE '2005-09-14', 'Brgy. Buhangin, Davao City'),
  ('3473fda6-ef26-54b9-8bc1-d962196c1826', 'Miguel', 'Manalo', DATE '2006-12-06', 'Brgy. Carmen, Cagayan de Oro City'),
  ('cc14d4fd-c5bf-5a8d-9cf9-51ea94e0bf2a', 'Ysabel', 'Tan', DATE '2006-01-22', 'Brgy. Mandurriao, Iloilo City'),
  ('87a439a6-dd0e-5a75-a4c7-5f90f141e5c0', 'Lance', 'Lim', DATE '2004-09-22', 'Brgy. Mandalagan, Bacolod City'),
  ('8b445718-7698-5979-a56e-e8f65372727c', 'Joaquin', 'Tan', DATE '2005-09-07', 'Brgy. Ususan, Taguig City'),
  ('a50cb821-a13b-5fed-98e6-dfb95ec359da', 'Enzo', 'Mendoza', DATE '2004-08-25', 'Brgy. Mandurriao, Iloilo City'),
  ('dd27b9de-6397-5727-a505-376476d91f92', 'Angelica', 'Reyes', DATE '2003-11-03', 'Brgy. Pinagbuhatan, Pasig City');
  INSERT INTO teachers (id, user_id, employee_id, department, hire_date) VALUES
  ('05846875-2d58-5baa-9839-f914debd47ca', '94ceae50-c492-5045-8d88-c8b5d2d7b7fe', 'EMP-2026-101', 'Mathematics', DATE '2019-06-03'),
  ('e5c4a371-324f-51c5-a5d4-dc564a475dc9', '60232eef-026d-5448-9ce9-ae74893784de', 'EMP-2026-102', 'English', DATE '2019-06-04'),
  ('a9dd4e4b-697b-5e19-b2a3-e1abe8fdaf77', 'a27b1b90-8262-52a7-8a93-4d6ef3c33b02', 'EMP-2026-103', 'Filipino and Social Sciences', DATE '2019-06-05');
  INSERT INTO students (id, user_id, student_id, enrollment_date) VALUES
  ('e851f1dc-b0a9-54c1-9355-7a51c9fe0546', '331b5d03-233b-5068-b238-e8de1a9cae12', '2026-1001', make_date(v_term::int, 6, 1)),
  ('e8500b67-c2ae-5933-8a3d-f68faa157f0d', 'c0dbc4f1-804c-5415-acbe-33d8ce181504', '2026-1002', make_date(v_term::int, 6, 1)),
  ('af2e711a-5e14-5c09-a8b3-16be388c1eaa', '09f1e574-ec63-593b-80fe-55add55c4e9a', '2026-1003', make_date(v_term::int, 6, 1)),
  ('f5b9a424-c39e-5a72-94ea-bb8aeb529f7d', '12fe99c8-244d-59c6-9f3d-08539700e491', '2026-1004', make_date(v_term::int, 6, 1)),
  ('ced96cb7-bce6-5db5-927d-7980246092b7', 'a30b6fd4-8cd4-5f7a-bda5-600012967cba', '2026-1005', make_date(v_term::int, 6, 1)),
  ('d57efddd-b2ae-56ac-be23-3d8afffcb52f', '24b39309-a1f3-56a4-be71-9866e3f0330b', '2026-1006', make_date(v_term::int, 6, 1)),
  ('fb2da062-869c-5cb8-976f-bacbf56bc267', '14a676bc-3d20-5611-8dd9-b89ccda17d9a', '2026-1007', make_date(v_term::int, 6, 1)),
  ('facb1608-5a41-51ab-8e9c-46e80b6ab172', '10f425e8-2fc3-508a-810c-3a60a4adcf12', '2026-1008', make_date(v_term::int, 6, 1)),
  ('70aa7cc5-8aa7-5656-b9d6-4ec4d9e54959', 'b39b81f6-8940-5dc1-8ea1-e0b96f286720', '2026-1009', make_date(v_term::int, 6, 1)),
  ('337ebe96-07e0-58d3-8552-95faed6d3075', '91a19e1e-7f2f-5197-aa30-284185694ba9', '2026-1010', make_date(v_term::int, 6, 1)),
  ('7618b484-3fb2-5900-ae89-6578f500082f', '61125295-0258-5b2d-8bdc-ce93725d4790', '2026-1011', make_date(v_term::int, 6, 1)),
  ('e5234ec0-a5c4-5a7a-93f5-7aaafd59eac2', 'c71f240c-5211-5ea6-bc0b-49b2971dadca', '2026-1012', make_date(v_term::int, 6, 1)),
  ('9b412cdc-44b0-58d1-ad24-bdf697201fb9', '80da8d45-6801-57eb-a01e-771400ff7fed', '2026-1013', make_date(v_term::int, 6, 1)),
  ('aa53e7e8-77f8-58ff-bd44-ac462da3b3ec', 'a94a065a-9afb-523a-8797-63291e2f7777', '2026-1014', make_date(v_term::int, 6, 1)),
  ('4564fad6-375c-52dd-a56b-91d09ebd0d8b', '4a17c4a4-8ce1-5776-988c-2a3c7b027430', '2026-1015', make_date(v_term::int, 6, 1)),
  ('ac951740-fa3c-5425-84c5-c3e2cfeb0167', 'd9a74d8b-7da8-5b4c-aa87-f4848b62b346', '2026-1016', make_date(v_term::int, 6, 1)),
  ('4f8ffc48-2556-5a31-838e-f29f09d3812e', '0973e6fe-62c1-5db9-81f7-433af6f9ecc0', '2026-1017', make_date(v_term::int, 6, 1)),
  ('f6f17b76-b0be-5287-97dd-d16c0cacc9e1', '13f11eaa-b381-5e64-a977-5dfc0d442051', '2026-1018', make_date(v_term::int, 6, 1)),
  ('5a418a76-8823-53f7-9480-15b649370ca3', 'c0621d03-d782-5e77-96b7-5fb6cbf18645', '2026-1019', make_date(v_term::int, 6, 1)),
  ('9e9f4f78-c49e-5dd3-9428-ac5512a75c44', '4354d237-1d4e-5e87-b6dd-837f8d333489', '2026-1020', make_date(v_term::int, 6, 1)),
  ('9e1ba97f-772f-54cb-850d-b5ded8c1d475', 'eb8a9225-fa2f-54d1-a586-ca02ccf168e1', '2026-1021', make_date(v_term::int, 6, 1)),
  ('d5588de7-ec12-5653-9647-14fa33f53a51', 'd96dcc53-8063-555a-bf82-ab0017f490e4', '2026-1022', make_date(v_term::int, 6, 1)),
  ('de42f576-37ce-5560-9bd4-91a11278644f', 'e72bf791-9f3e-50f0-9360-f800334640fc', '2026-1023', make_date(v_term::int, 6, 1)),
  ('057f6c64-a543-53f8-b101-0fbd1b5cef03', '3473fda6-ef26-54b9-8bc1-d962196c1826', '2026-1024', make_date(v_term::int, 6, 1)),
  ('c643d7ce-693f-5d71-be0a-a4992a65e2f1', 'cc14d4fd-c5bf-5a8d-9cf9-51ea94e0bf2a', '2026-1025', make_date(v_term::int, 6, 1)),
  ('a7b38576-136d-51c3-99f6-f57a5c9583a1', '87a439a6-dd0e-5a75-a4c7-5f90f141e5c0', '2026-1026', make_date(v_term::int, 6, 1)),
  ('c8f498ff-6103-536e-8102-d35db6ce9984', '8b445718-7698-5979-a56e-e8f65372727c', '2026-1027', make_date(v_term::int, 6, 1)),
  ('ba22b27f-3da0-527f-84e9-950defda4059', 'a50cb821-a13b-5fed-98e6-dfb95ec359da', '2026-1028', make_date(v_term::int, 6, 1)),
  ('c780d93c-f5ab-587d-84fc-fbdb23e25de7', 'dd27b9de-6397-5727-a505-376476d91f92', '2026-1029', make_date(v_term::int, 6, 1));

  -- Courses, modules, module contents -----------------------------------------
  INSERT INTO courses (id, code, name, description, credits, teacher_id, created_at) VALUES
  ('2de990a1-9f8f-5087-8d42-d2571694978c'::uuid, 'IT101', 'Introduction to Computing', 'Foundations of computer systems, software and networks for first-year students.', 3, v_t_pk, v_now - interval '140 days'),
  ('26388f0a-2613-5fb1-8264-b130df4d7f1b'::uuid, 'IT102', 'Programming Fundamentals', 'Learn to think like a programmer using Python: variables, control flow and functions.', 3, v_t_pk, v_now - interval '140 days'),
  ('089eaffd-607e-5f0e-a7b5-073f2c68f5bb'::uuid, 'MATH101', 'College Algebra', 'Equations, functions and graphs with real-life applications.', 3, '05846875-2d58-5baa-9839-f914debd47ca'::uuid, v_now - interval '140 days'),
  ('f60fd226-bc4f-5839-881e-874499d80703'::uuid, 'ENG101', 'Purposive Communication', 'Effective written and spoken communication for academic and professional settings.', 3, 'e5c4a371-324f-51c5-a5d4-dc564a475dc9'::uuid, v_now - interval '140 days'),
  ('50c5c8c6-811d-5c2f-9661-6d24da31a9c6'::uuid, 'FIL101', 'Kontekstwalisadong Komunikasyon sa Filipino', 'Pag-aaral ng wika at komunikasyon sa konteksto ng lipunang Pilipino.', 3, 'a9dd4e4b-697b-5e19-b2a3-e1abe8fdaf77'::uuid, v_now - interval '140 days'),
  ('760667bb-b4fd-5743-aec5-69f47d7d6ab2'::uuid, 'RIZAL101', 'Life and Works of Jose Rizal', 'Rizal''s life, writings and relevance to modern Filipino citizenship.', 3, 'a9dd4e4b-697b-5e19-b2a3-e1abe8fdaf77'::uuid, v_now - interval '140 days');
  INSERT INTO modules (id, course_id, title, rich_description, order_index, created_at) VALUES
  ('104670cc-3e5f-5eff-b1b0-32b6cd513e70'::uuid, '2de990a1-9f8f-5087-8d42-d2571694978c'::uuid, 'Computer Systems and Hardware', 'How the CPU, memory and storage work together.', 0, v_now - interval '135 days'),
  ('4a7ed5ae-6eef-52a5-a45f-e9764d6adcce'::uuid, '2de990a1-9f8f-5087-8d42-d2571694978c'::uuid, 'Operating Systems and Software', 'What an operating system does and how software is organized.', 1, v_now - interval '135 days'),
  ('9c6249d7-dc27-5e3b-8e13-3647ed26baf2'::uuid, '2de990a1-9f8f-5087-8d42-d2571694978c'::uuid, 'Networks and the Internet', 'How devices connect and share data safely.', 2, v_now - interval '135 days'),
  ('83f2e811-bf6e-5766-817d-eb90762809da'::uuid, '26388f0a-2613-5fb1-8264-b130df4d7f1b'::uuid, 'Variables and Data Types', 'Store and manipulate numbers, text and booleans.', 0, v_now - interval '135 days'),
  ('3e2ebe0e-2349-5523-8abe-6d313a721c90'::uuid, '26388f0a-2613-5fb1-8264-b130df4d7f1b'::uuid, 'Control Structures', 'Make decisions and repeat actions with if statements and loops.', 1, v_now - interval '135 days'),
  ('46e049f4-5664-5823-bc2b-6474dfe8e70c'::uuid, '26388f0a-2613-5fb1-8264-b130df4d7f1b'::uuid, 'Functions and Debugging', 'Break problems into functions and find bugs systematically.', 2, v_now - interval '135 days'),
  ('7888efdd-da8e-5c53-8aad-b1fa4d71ed6c'::uuid, '089eaffd-607e-5f0e-a7b5-073f2c68f5bb'::uuid, 'Linear Equations', 'Solve and graph equations of one and two variables.', 0, v_now - interval '135 days'),
  ('da25d62d-7238-5c7c-b010-6a6912d6bccd'::uuid, '089eaffd-607e-5f0e-a7b5-073f2c68f5bb'::uuid, 'Quadratic Equations', 'Factoring, completing the square and the quadratic formula.', 1, v_now - interval '135 days'),
  ('fd710e18-16c3-5350-9105-fbd5f34380e5'::uuid, '089eaffd-607e-5f0e-a7b5-073f2c68f5bb'::uuid, 'Functions and Graphs', 'Domain, range and transformations of functions.', 2, v_now - interval '135 days'),
  ('475628ac-dc96-5592-814a-927f387c8095'::uuid, 'f60fd226-bc4f-5839-881e-874499d80703'::uuid, 'Communication Models', 'Sender, message, channel, receiver and noise.', 0, v_now - interval '135 days'),
  ('4e99b39b-cb89-584d-a17b-a87d57ddc8e3'::uuid, 'f60fd226-bc4f-5839-881e-874499d80703'::uuid, 'Writing for Purpose', 'Essays, emails and reports for different audiences.', 1, v_now - interval '135 days'),
  ('e7e01d1a-ef59-5837-a277-300ef52aff2a'::uuid, 'f60fd226-bc4f-5839-881e-874499d80703'::uuid, 'Oral Presentation', 'Structuring and delivering a confident talk.', 2, v_now - interval '135 days'),
  ('483fffaf-e6fe-5524-a8ba-c3454c39487e'::uuid, '50c5c8c6-811d-5c2f-9661-6d24da31a9c6'::uuid, 'Wika at Lipunan', 'Ang papel ng wika sa pagkakakilanlan at pagkakaisa.', 0, v_now - interval '135 days'),
  ('0c4f51d5-f690-5734-a46e-6c34f2bb614c'::uuid, '50c5c8c6-811d-5c2f-9661-6d24da31a9c6'::uuid, 'Varayti at Barayti ng Wika', 'Dayalekto, sosyolek at register.', 1, v_now - interval '135 days'),
  ('344fdb78-549f-5519-af0e-c812e8c10455'::uuid, '50c5c8c6-811d-5c2f-9661-6d24da31a9c6'::uuid, 'Pagsulat ng Posisyong Papel', 'Pagbuo ng matibay na argumento at ebidensya.', 2, v_now - interval '135 days'),
  ('7413c98b-03b1-5a73-8af2-bdaa2f790658'::uuid, '760667bb-b4fd-5743-aec5-69f47d7d6ab2'::uuid, 'Rizal''s Early Life', 'Family, childhood and education.', 0, v_now - interval '135 days'),
  ('872eaa9c-3f4b-523d-babd-3d69bdb6eb4f'::uuid, '760667bb-b4fd-5743-aec5-69f47d7d6ab2'::uuid, 'Noli Me Tangere', 'Themes, characters and historical context.', 1, v_now - interval '135 days'),
  ('f3da03e7-8b0c-5203-a3c8-7643c30ea7eb'::uuid, '760667bb-b4fd-5743-aec5-69f47d7d6ab2'::uuid, 'El Filibusterismo and Legacy', 'The sequel, his exile and lasting influence.', 2, v_now - interval '135 days');
  INSERT INTO module_contents (module_id, type, title, content, url, order_index) VALUES
  ('104670cc-3e5f-5eff-b1b0-32b6cd513e70'::uuid, 'text', 'Lesson Notes: Computer Systems and Hardware', 'How the CPU, memory and storage work together. Read the notes before class and bring your questions.', NULL, 0),
  ('104670cc-3e5f-5eff-b1b0-32b6cd513e70'::uuid, 'link', 'Further reading', NULL, 'https://www.khanacademy.org/computing', 1),
  ('4a7ed5ae-6eef-52a5-a45f-e9764d6adcce'::uuid, 'text', 'Lesson Notes: Operating Systems and Software', 'What an operating system does and how software is organized. Read the notes before class and bring your questions.', NULL, 0),
  ('4a7ed5ae-6eef-52a5-a45f-e9764d6adcce'::uuid, 'link', 'Further reading', NULL, 'https://www.khanacademy.org/computing', 1),
  ('9c6249d7-dc27-5e3b-8e13-3647ed26baf2'::uuid, 'text', 'Lesson Notes: Networks and the Internet', 'How devices connect and share data safely. Read the notes before class and bring your questions.', NULL, 0),
  ('9c6249d7-dc27-5e3b-8e13-3647ed26baf2'::uuid, 'link', 'Further reading', NULL, 'https://www.khanacademy.org/computing', 1),
  ('83f2e811-bf6e-5766-817d-eb90762809da'::uuid, 'text', 'Lesson Notes: Variables and Data Types', 'Store and manipulate numbers, text and booleans. Read the notes before class and bring your questions.', NULL, 0),
  ('83f2e811-bf6e-5766-817d-eb90762809da'::uuid, 'link', 'Further reading', NULL, 'https://developer.mozilla.org/en-US/docs/Learn', 1),
  ('3e2ebe0e-2349-5523-8abe-6d313a721c90'::uuid, 'text', 'Lesson Notes: Control Structures', 'Make decisions and repeat actions with if statements and loops. Read the notes before class and bring your questions.', NULL, 0),
  ('3e2ebe0e-2349-5523-8abe-6d313a721c90'::uuid, 'link', 'Further reading', NULL, 'https://developer.mozilla.org/en-US/docs/Learn', 1),
  ('46e049f4-5664-5823-bc2b-6474dfe8e70c'::uuid, 'text', 'Lesson Notes: Functions and Debugging', 'Break problems into functions and find bugs systematically. Read the notes before class and bring your questions.', NULL, 0),
  ('46e049f4-5664-5823-bc2b-6474dfe8e70c'::uuid, 'link', 'Further reading', NULL, 'https://developer.mozilla.org/en-US/docs/Learn', 1),
  ('7888efdd-da8e-5c53-8aad-b1fa4d71ed6c'::uuid, 'text', 'Lesson Notes: Linear Equations', 'Solve and graph equations of one and two variables. Read the notes before class and bring your questions.', NULL, 0),
  ('7888efdd-da8e-5c53-8aad-b1fa4d71ed6c'::uuid, 'link', 'Further reading', NULL, 'https://www.khanacademy.org/math/algebra', 1),
  ('da25d62d-7238-5c7c-b010-6a6912d6bccd'::uuid, 'text', 'Lesson Notes: Quadratic Equations', 'Factoring, completing the square and the quadratic formula. Read the notes before class and bring your questions.', NULL, 0),
  ('da25d62d-7238-5c7c-b010-6a6912d6bccd'::uuid, 'link', 'Further reading', NULL, 'https://www.khanacademy.org/math/algebra', 1),
  ('fd710e18-16c3-5350-9105-fbd5f34380e5'::uuid, 'text', 'Lesson Notes: Functions and Graphs', 'Domain, range and transformations of functions. Read the notes before class and bring your questions.', NULL, 0),
  ('fd710e18-16c3-5350-9105-fbd5f34380e5'::uuid, 'link', 'Further reading', NULL, 'https://www.khanacademy.org/math/algebra', 1),
  ('475628ac-dc96-5592-814a-927f387c8095'::uuid, 'text', 'Lesson Notes: Communication Models', 'Sender, message, channel, receiver and noise. Read the notes before class and bring your questions.', NULL, 0),
  ('475628ac-dc96-5592-814a-927f387c8095'::uuid, 'link', 'Further reading', NULL, 'https://owl.purdue.edu/owl/general_writing/index.html', 1),
  ('4e99b39b-cb89-584d-a17b-a87d57ddc8e3'::uuid, 'text', 'Lesson Notes: Writing for Purpose', 'Essays, emails and reports for different audiences. Read the notes before class and bring your questions.', NULL, 0),
  ('4e99b39b-cb89-584d-a17b-a87d57ddc8e3'::uuid, 'link', 'Further reading', NULL, 'https://owl.purdue.edu/owl/general_writing/index.html', 1),
  ('e7e01d1a-ef59-5837-a277-300ef52aff2a'::uuid, 'text', 'Lesson Notes: Oral Presentation', 'Structuring and delivering a confident talk. Read the notes before class and bring your questions.', NULL, 0),
  ('e7e01d1a-ef59-5837-a277-300ef52aff2a'::uuid, 'link', 'Further reading', NULL, 'https://owl.purdue.edu/owl/general_writing/index.html', 1),
  ('483fffaf-e6fe-5524-a8ba-c3454c39487e'::uuid, 'text', 'Lesson Notes: Wika at Lipunan', 'Ang papel ng wika sa pagkakakilanlan at pagkakaisa. Read the notes before class and bring your questions.', NULL, 0),
  ('483fffaf-e6fe-5524-a8ba-c3454c39487e'::uuid, 'link', 'Further reading', NULL, 'https://kwf.gov.ph/', 1),
  ('0c4f51d5-f690-5734-a46e-6c34f2bb614c'::uuid, 'text', 'Lesson Notes: Varayti at Barayti ng Wika', 'Dayalekto, sosyolek at register. Read the notes before class and bring your questions.', NULL, 0),
  ('0c4f51d5-f690-5734-a46e-6c34f2bb614c'::uuid, 'link', 'Further reading', NULL, 'https://kwf.gov.ph/', 1),
  ('344fdb78-549f-5519-af0e-c812e8c10455'::uuid, 'text', 'Lesson Notes: Pagsulat ng Posisyong Papel', 'Pagbuo ng matibay na argumento at ebidensya. Read the notes before class and bring your questions.', NULL, 0),
  ('344fdb78-549f-5519-af0e-c812e8c10455'::uuid, 'link', 'Further reading', NULL, 'https://kwf.gov.ph/', 1),
  ('7413c98b-03b1-5a73-8af2-bdaa2f790658'::uuid, 'text', 'Lesson Notes: Rizal''s Early Life', 'Family, childhood and education. Read the notes before class and bring your questions.', NULL, 0),
  ('7413c98b-03b1-5a73-8af2-bdaa2f790658'::uuid, 'link', 'Further reading', NULL, 'https://www.officialgazette.gov.ph/', 1),
  ('872eaa9c-3f4b-523d-babd-3d69bdb6eb4f'::uuid, 'text', 'Lesson Notes: Noli Me Tangere', 'Themes, characters and historical context. Read the notes before class and bring your questions.', NULL, 0),
  ('872eaa9c-3f4b-523d-babd-3d69bdb6eb4f'::uuid, 'link', 'Further reading', NULL, 'https://www.officialgazette.gov.ph/', 1),
  ('f3da03e7-8b0c-5203-a3c8-7643c30ea7eb'::uuid, 'text', 'Lesson Notes: El Filibusterismo and Legacy', 'The sequel, his exile and lasting influence. Read the notes before class and bring your questions.', NULL, 0),
  ('f3da03e7-8b0c-5203-a3c8-7643c30ea7eb'::uuid, 'link', 'Further reading', NULL, 'https://www.officialgazette.gov.ph/', 1);

  -- Assignments -----------------------------------------------------------------
  INSERT INTO assignments (id, module_id, title, instructions, due_date, max_score, created_at, is_published, delivery_mode, delivery, room) VALUES
  ('77c381fe-2660-5bb0-a4ac-68a7cdd463d1'::uuid, '104670cc-3e5f-5eff-b1b0-32b6cd513e70'::uuid, 'Hardware Inventory Report', 'List the hardware components of a computer you use and describe what each does.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-28 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('875825c2-e9ce-5dce-aff7-49ce50f3b8b2'::uuid, '4a7ed5ae-6eef-52a5-a45f-e9764d6adcce'::uuid, 'OS Comparison Matrix', 'Compare two operating systems using at least five criteria.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-14 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('0a4a4b16-30e4-5804-89f5-dc67a23c2257'::uuid, '9c6249d7-dc27-5e3b-8e13-3647ed26baf2'::uuid, 'Network Diagram Activity', 'Draw and label a simple home network diagram.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-3 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('ffd849bc-16b2-5e53-a6c8-119e2f9ddeaf'::uuid, '9c6249d7-dc27-5e3b-8e13-3647ed26baf2'::uuid, 'Digital Safety Reflection', 'Write a one-page reflection on staying safe online.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '6 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('2a253e47-2f49-5ad8-ad66-1d3268b39da2'::uuid, '9c6249d7-dc27-5e3b-8e13-3647ed26baf2'::uuid, 'Capstone Concept Draft', 'Outline your concept for the end-of-term project.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '20 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', false, 'online', 'online', NULL),
  ('913a86a6-35ee-5806-b80c-c56a9d7cc4b8'::uuid, '4a7ed5ae-6eef-52a5-a45f-e9764d6adcce'::uuid, 'Lab Practical: OS Installation', 'Install and configure a virtual machine during the lab session.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-12 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'in_person', 'in_person', 'Lab 1'),
  ('957434c2-2ab5-50f7-851a-a1dd689e01ce'::uuid, '83f2e811-bf6e-5766-817d-eb90762809da'::uuid, 'Hello World to Calculator', 'Build a command-line calculator that handles four operations.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-30 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('e976a193-7001-548d-a4d7-518ff6a81bd9'::uuid, '3e2ebe0e-2349-5523-8abe-6d313a721c90'::uuid, 'Loops Problem Set', 'Solve the ten loop problems and submit your code.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-16 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('5023e53c-bba5-5b72-bfec-d75887982a64'::uuid, '46e049f4-5664-5823-bc2b-6474dfe8e70c'::uuid, 'Debugging Challenge', 'Find and fix the bugs in the provided program and explain each fix.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-2 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('c3769865-4c90-5f49-ab51-157f31d6c0bb'::uuid, '46e049f4-5664-5823-bc2b-6474dfe8e70c'::uuid, 'Mini Project: Grade Calculator', 'Write a program that computes a final grade from component scores.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '9 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('1f75bdfe-8532-5b17-a170-b6951f4d08f9'::uuid, '3e2ebe0e-2349-5523-8abe-6d313a721c90'::uuid, 'Pseudocode Worksheet', 'Convert the given problems into pseudocode.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '15 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', false, 'online', 'online', NULL),
  ('b2ac3582-c38d-5c94-88c4-97644d60401b'::uuid, '7888efdd-da8e-5c53-8aad-b1fa4d71ed6c'::uuid, 'Problem Set 1: Linear Equations', 'Solve the 15 linear equations and show your work.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-25 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('5e84dc01-79d0-5216-bc62-160432a25ae5'::uuid, 'da25d62d-7238-5c7c-b010-6a6912d6bccd'::uuid, 'Problem Set 2: Quadratics', 'Solve using factoring and the quadratic formula.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-9 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('d53d31b0-b20c-568d-abb9-5aa7ade2fce3'::uuid, 'fd710e18-16c3-5350-9105-fbd5f34380e5'::uuid, 'Graphing Activity', 'Graph three functions and identify intercepts.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '4 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('5efcb0af-afb1-5d1a-8995-da66642b8fe2'::uuid, 'fd710e18-16c3-5350-9105-fbd5f34380e5'::uuid, 'Word Problems', 'Translate real-life situations into equations.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '12 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', false, 'online', 'online', NULL),
  ('11ac9b11-5d32-5ebc-83c7-db5233498967'::uuid, '475628ac-dc96-5592-814a-927f387c8095'::uuid, 'Reflective Essay: My Communication Style', 'Write a 500-word essay on how you communicate and how you can improve.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-22 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('00fd00e0-d369-5769-814b-221352b112d5'::uuid, '4e99b39b-cb89-584d-a17b-a87d57ddc8e3'::uuid, 'Business Email Exercise', 'Draft a professional email to a client following the given scenario.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-11 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('bcf9ac12-c8bc-5bca-8666-9f117a383129'::uuid, 'e7e01d1a-ef59-5837-a277-300ef52aff2a'::uuid, 'Speech Outline', 'Submit a one-page outline for your upcoming speech.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-1 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('c5e4d8f6-31ca-5128-a48e-418458bbd1f0'::uuid, 'e7e01d1a-ef59-5837-a277-300ef52aff2a'::uuid, 'Group Presentation Plan', 'Submit your group roles and presentation plan.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '7 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('15a7a048-20b3-5302-a541-03d278d0f04f'::uuid, '483fffaf-e6fe-5524-a8ba-c3454c39487e'::uuid, 'Sanaysay: Wika Ko, Wika Natin', 'Sumulat ng sanaysay tungkol sa kahalagahan ng wika sa iyong komunidad.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-24 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('fd4b5ea6-1e5f-52cd-88de-ec60c93ac98a'::uuid, '0c4f51d5-f690-5734-a46e-6c34f2bb614c'::uuid, 'Panayam sa Komunidad', 'Mag-interbyu ng isang kakilala at iulat ang mga barayti ng wikang napansin.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-10 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('fc796ef3-95bf-5aa7-8f73-55b64f8258f9'::uuid, '344fdb78-549f-5519-af0e-c812e8c10455'::uuid, 'Posisyong Papel (Burador)', 'Isumite ang burador ng iyong posisyong papel.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '8 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('d0af884b-0627-55dc-958a-77bdc980039f'::uuid, '7413c98b-03b1-5a73-8af2-bdaa2f790658'::uuid, 'Timeline of Rizal''s Life', 'Create a timeline of ten key events in the life of Jose Rizal.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-27 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('33d8d5a6-b233-5bf9-9000-e27ad396a475'::uuid, '872eaa9c-3f4b-523d-babd-3d69bdb6eb4f'::uuid, 'Noli Me Tangere Character Map', 'Map the major characters and their relationships.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-13 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL),
  ('430cd8ba-fcac-5881-b90f-cd0f7bc9d8e2'::uuid, '872eaa9c-3f4b-523d-babd-3d69bdb6eb4f'::uuid, 'Reflection Paper (Handwritten)', 'Write a handwritten reflection during class on a chapter of the Noli.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-9 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'in_person', 'in_person', 'Room 203'),
  ('177cd92a-b9d1-5792-a679-56d0580eaec0'::uuid, 'f3da03e7-8b0c-5203-a3c8-7643c30ea7eb'::uuid, 'Essay: Rizal in Today''s Philippines', 'Argue how Rizal''s ideas apply to a present-day issue.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '10 days' + interval '23 hours 59 minutes') AT TIME ZONE 'Asia/Manila'), 100, v_now - interval '40 days', true, 'online', 'online', NULL);

  -- Quizzes and questions ---------------------------------------------------------
  INSERT INTO quizzes (id, course_id, title, time_limit_minutes, is_published, created_at, delivery_mode, delivery, scheduled_at, room, details, max_score) VALUES
  ('25166746-0be8-53e8-85e8-1027119dc77e'::uuid, '2de990a1-9f8f-5087-8d42-d2571694978c'::uuid, 'Quiz 1: Computer Basics', 20, true, v_now - interval '30 days', 'online', 'online', NULL, NULL, 'Covers Modules 1 and 2.', 100),
  ('76f2d3c6-a264-594e-8d29-82ac76dc16d2'::uuid, '2de990a1-9f8f-5087-8d42-d2571694978c'::uuid, 'Quiz 2: Networks (Draft)', 15, false, v_now - interval '30 days', 'online', 'online', NULL, NULL, 'Draft: not yet released.', 100),
  ('0af27f0e-c30c-5b25-8dd0-ec949be825ea'::uuid, '26388f0a-2613-5fb1-8264-b130df4d7f1b'::uuid, 'Quiz 1: Data Types', 15, true, v_now - interval '30 days', 'online', 'online', NULL, NULL, 'Python basics.', 100),
  ('98736573-9c4b-5cce-be2c-c30f9cb0606d'::uuid, '26388f0a-2613-5fb1-8264-b130df4d7f1b'::uuid, 'Quiz 2: Loops and Conditionals', 20, true, v_now - interval '30 days', 'online', 'online', NULL, NULL, 'Loops, ranges and if statements.', 100),
  ('3489726d-d0b2-5e4a-841b-e36b548ee39d'::uuid, '26388f0a-2613-5fb1-8264-b130df4d7f1b'::uuid, 'Quiz 3: Practical Coding Check', NULL, true, v_now - interval '30 days', 'in_person', 'in_person', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '3 days' + interval '9 hours') AT TIME ZONE 'Asia/Manila'), 'Lab 1', 'Written and hands-on, bring your ID.', 100),
  ('01011f64-f8ff-59c3-a331-509d72493a39'::uuid, '089eaffd-607e-5f0e-a7b5-073f2c68f5bb'::uuid, 'Quiz 1: Linear Equations', 25, true, v_now - interval '30 days', 'online', 'online', NULL, NULL, 'Solve and graph.', 100),
  ('88c13398-927b-5f57-b18b-ad9efa27bccc'::uuid, '089eaffd-607e-5f0e-a7b5-073f2c68f5bb'::uuid, 'Quiz 2: Quadratic Equations', NULL, true, v_now - interval '30 days', 'in_person', 'in_person', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-8 days' + interval '9 hours') AT TIME ZONE 'Asia/Manila'), 'Room 201', 'Paper-based quiz.', 100),
  ('9307fc44-5f59-5c95-a3e5-2bf01b902dd5'::uuid, 'f60fd226-bc4f-5839-881e-874499d80703'::uuid, 'Quiz 1: Communication Models', 15, true, v_now - interval '30 days', 'online', 'online', NULL, NULL, 'Basic concepts.', 100),
  ('4f86f0b4-2e2a-5138-98b3-d35f18e28589'::uuid, 'f60fd226-bc4f-5839-881e-874499d80703'::uuid, 'Quiz 2: Impromptu Speaking Prep', NULL, true, v_now - interval '30 days', 'in_person', 'in_person', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '4 days' + interval '9 hours') AT TIME ZONE 'Asia/Manila'), 'Room 202', 'In-class speaking check.', 100),
  ('4fddf12d-7480-55f4-930f-ef0a00e659e3'::uuid, '50c5c8c6-811d-5c2f-9661-6d24da31a9c6'::uuid, 'Pagsusulit 1: Konsepto ng Wika', 15, true, v_now - interval '30 days', 'online', 'online', NULL, NULL, 'Mga batayang konsepto.', 100),
  ('b7d549a2-5c68-503a-b015-978b805c2887'::uuid, '760667bb-b4fd-5743-aec5-69f47d7d6ab2'::uuid, 'Quiz 1: Rizal''s Early Years', 15, true, v_now - interval '30 days', 'online', 'online', NULL, NULL, 'Childhood and education.', 100);
  INSERT INTO quiz_questions (quiz_id, question_text, type, options, correct_answer, points) VALUES
  ('25166746-0be8-53e8-85e8-1027119dc77e'::uuid, 'Which component is considered the ''brain'' of the computer?', 'mcq', ARRAY['CPU','RAM','Hard drive','Power supply']::text[], 'CPU', 1),
  ('25166746-0be8-53e8-85e8-1027119dc77e'::uuid, 'Which of the following is an input device?', 'mcq', ARRAY['Keyboard','Monitor','Printer','Speaker']::text[], 'Keyboard', 1),
  ('25166746-0be8-53e8-85e8-1027119dc77e'::uuid, 'What does RAM stand for?', 'mcq', ARRAY['Random Access Memory','Read Access Module','Rapid Active Memory','Run Allocation Mode']::text[], 'Random Access Memory', 1),
  ('25166746-0be8-53e8-85e8-1027119dc77e'::uuid, 'An SSD has no moving parts.', 'true_false', NULL, 'true', 1),
  ('25166746-0be8-53e8-85e8-1027119dc77e'::uuid, 'Which unit is the largest?', 'mcq', ARRAY['Kilobyte','Megabyte','Gigabyte','Terabyte']::text[], 'Terabyte', 1),
  ('76f2d3c6-a264-594e-8d29-82ac76dc16d2'::uuid, 'What does LAN stand for?', 'mcq', ARRAY['Local Area Network','Large Access Node','Linked Area Network','Logical Address Name']::text[], 'Local Area Network', 1),
  ('76f2d3c6-a264-594e-8d29-82ac76dc16d2'::uuid, 'Which device forwards data between networks?', 'mcq', ARRAY['Router','Keyboard','Monitor','Scanner']::text[], 'Router', 1),
  ('76f2d3c6-a264-594e-8d29-82ac76dc16d2'::uuid, 'HTTPS encrypts data between the browser and the website.', 'true_false', NULL, 'true', 1),
  ('76f2d3c6-a264-594e-8d29-82ac76dc16d2'::uuid, 'Which protocol is used to load web pages?', 'mcq', ARRAY['HTTP','SMTP','FTP','SSH']::text[], 'HTTP', 1),
  ('0af27f0e-c30c-5b25-8dd0-ec949be825ea'::uuid, 'Which data type stores whole numbers?', 'mcq', ARRAY['int','float','string','boolean']::text[], 'int', 1),
  ('0af27f0e-c30c-5b25-8dd0-ec949be825ea'::uuid, 'What is the result of 7 // 2 in Python?', 'mcq', ARRAY['3','3.5','4','2']::text[], '3', 1),
  ('0af27f0e-c30c-5b25-8dd0-ec949be825ea'::uuid, 'Which of these is a string literal?', 'mcq', ARRAY['"hello"','5','True','3.14']::text[], '"hello"', 1),
  ('0af27f0e-c30c-5b25-8dd0-ec949be825ea'::uuid, 'A boolean can hold only True or False.', 'true_false', NULL, 'true', 1),
  ('0af27f0e-c30c-5b25-8dd0-ec949be825ea'::uuid, 'Which function prints output in Python?', 'mcq', ARRAY['print()','echo()','console.write()','output()']::text[], 'print()', 1),
  ('98736573-9c4b-5cce-be2c-c30f9cb0606d'::uuid, 'Which keyword starts a loop that runs a fixed number of times?', 'mcq', ARRAY['for','if','def','return']::text[], 'for', 1),
  ('98736573-9c4b-5cce-be2c-c30f9cb0606d'::uuid, 'What does ''break'' do inside a loop?', 'mcq', ARRAY['Exits the loop','Skips one iteration','Restarts the program','Defines a function']::text[], 'Exits the loop', 1),
  ('98736573-9c4b-5cce-be2c-c30f9cb0606d'::uuid, 'How many times does a loop over range(3) run?', 'mcq', ARRAY['3','2','4','1']::text[], '3', 1),
  ('98736573-9c4b-5cce-be2c-c30f9cb0606d'::uuid, 'An ''else'' block runs when the ''if'' condition is True.', 'true_false', NULL, 'false', 1),
  ('98736573-9c4b-5cce-be2c-c30f9cb0606d'::uuid, 'Which operator checks equality in Python?', 'short_answer', NULL, '==', 2),
  ('01011f64-f8ff-59c3-a331-509d72493a39'::uuid, 'Solve: 2x + 6 = 14', 'mcq', ARRAY['x = 4','x = 3','x = 5','x = 10']::text[], 'x = 4', 1),
  ('01011f64-f8ff-59c3-a331-509d72493a39'::uuid, 'What is the slope of y = 3x + 2?', 'mcq', ARRAY['3','2','5','1']::text[], '3', 1),
  ('01011f64-f8ff-59c3-a331-509d72493a39'::uuid, 'Solve: x/4 = 5', 'mcq', ARRAY['x = 20','x = 9','x = 1.25','x = 5']::text[], 'x = 20', 1),
  ('01011f64-f8ff-59c3-a331-509d72493a39'::uuid, 'The graph of a linear equation is a straight line.', 'true_false', NULL, 'true', 1),
  ('01011f64-f8ff-59c3-a331-509d72493a39'::uuid, 'What is the y-intercept of y = -2x + 7?', 'mcq', ARRAY['7','-2','2','0']::text[], '7', 1),
  ('9307fc44-5f59-5c95-a3e5-2bf01b902dd5'::uuid, 'The person who sends the message is the', 'mcq', ARRAY['sender','receiver','channel','noise']::text[], 'sender', 1),
  ('9307fc44-5f59-5c95-a3e5-2bf01b902dd5'::uuid, 'Anything that interferes with a message is called', 'mcq', ARRAY['noise','feedback','context','code']::text[], 'noise', 1),
  ('9307fc44-5f59-5c95-a3e5-2bf01b902dd5'::uuid, 'Which is a nonverbal cue?', 'mcq', ARRAY['Eye contact','Email','Essay','Report']::text[], 'Eye contact', 1),
  ('9307fc44-5f59-5c95-a3e5-2bf01b902dd5'::uuid, 'Feedback is the receiver''s response to a message.', 'true_false', NULL, 'true', 1),
  ('9307fc44-5f59-5c95-a3e5-2bf01b902dd5'::uuid, 'A formal presentation to an audience is an example of', 'mcq', ARRAY['public communication','intrapersonal communication','interpersonal communication','mass communication']::text[], 'public communication', 1),
  ('4fddf12d-7480-55f4-930f-ef0a00e659e3'::uuid, 'Ano ang pambansang wika ng Pilipinas?', 'mcq', ARRAY['Filipino','Ingles','Espanyol','Cebuano']::text[], 'Filipino', 1),
  ('4fddf12d-7480-55f4-930f-ef0a00e659e3'::uuid, 'Ang wika ay sistema ng mga tunog at simbolong ginagamit sa', 'mcq', ARRAY['komunikasyon','pagluluto','pagtakbo','pagguhit lamang']::text[], 'komunikasyon', 1),
  ('4fddf12d-7480-55f4-930f-ef0a00e659e3'::uuid, 'Alin ang halimbawa ng pormal na antas ng wika?', 'mcq', ARRAY['Pampanitikan','Balbal','Kolokyal','Lalawiganin']::text[], 'Pampanitikan', 1),
  ('4fddf12d-7480-55f4-930f-ef0a00e659e3'::uuid, 'Ang wika ay dinamiko o patuloy na nagbabago.', 'true_false', NULL, 'true', 1),
  ('4fddf12d-7480-55f4-930f-ef0a00e659e3'::uuid, 'Anong buwan ipinagdiriwang ang Buwan ng Wikang Pambansa?', 'mcq', ARRAY['Agosto','Enero','Hunyo','Disyembre']::text[], 'Agosto', 1),
  ('b7d549a2-5c68-503a-b015-978b805c2887'::uuid, 'Where was Jose Rizal born?', 'mcq', ARRAY['Calamba, Laguna','Manila','Dapitan','Binan, Laguna']::text[], 'Calamba, Laguna', 1),
  ('b7d549a2-5c68-503a-b015-978b805c2887'::uuid, 'In what year was Rizal born?', 'mcq', ARRAY['1861','1872','1896','1850']::text[], '1861', 1),
  ('b7d549a2-5c68-503a-b015-978b805c2887'::uuid, 'Who was Rizal''s first teacher?', 'mcq', ARRAY['His mother, Teodora Alonso','His brother Paciano','Padre Burgos','Ferdinand Blumentritt']::text[], 'His mother, Teodora Alonso', 1),
  ('b7d549a2-5c68-503a-b015-978b805c2887'::uuid, 'Rizal studied at the Ateneo Municipal de Manila.', 'true_false', NULL, 'true', 1),
  ('b7d549a2-5c68-503a-b015-978b805c2887'::uuid, 'Which novel was published in 1887?', 'mcq', ARRAY['Noli Me Tangere','El Filibusterismo','Mi Ultimo Adios','Sa Aking Mga Kabata']::text[], 'Noli Me Tangere', 1);

  -- Exams (announced, scored manually by the teacher) ------------------------------
  INSERT INTO exams (id, course_id, title, details, exam_at, duration_minutes, room, max_score, is_published, created_by, created_at) VALUES
  ('4afd8f1b-eb54-56cb-bda9-4977c4f3aa85'::uuid, '2de990a1-9f8f-5087-8d42-d2571694978c'::uuid, 'Midterm Examination', 'Written exam, checked and scored by the teacher.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-20 days' + interval '9 hours') AT TIME ZONE 'Asia/Manila'), 90, 'Lab 1', 100, true, v_t_user, v_now - interval '45 days'),
  ('6b1a6147-8b69-589a-8722-e4050558021a'::uuid, '26388f0a-2613-5fb1-8264-b130df4d7f1b'::uuid, 'Midterm Practical Exam', 'Hands-on coding exam, scored by the teacher after checking.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-2 days' + interval '9 hours') AT TIME ZONE 'Asia/Manila'), 120, 'Lab 1', 100, true, v_t_user, v_now - interval '45 days'),
  ('662a8eb0-df34-57bd-839c-90d9584f87c6'::uuid, '089eaffd-607e-5f0e-a7b5-073f2c68f5bb'::uuid, 'Midterm Exam', 'Bring a scientific calculator.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '9 days' + interval '9 hours') AT TIME ZONE 'Asia/Manila'), 90, 'Room 201', 100, true, '94ceae50-c492-5045-8d88-c8b5d2d7b7fe'::uuid, v_now - interval '45 days'),
  ('c6997d72-eae4-540b-9c77-3b2d0406dbf4'::uuid, 'f60fd226-bc4f-5839-881e-874499d80703'::uuid, 'Midterm Written Exam', 'Covers Modules 1 to 3.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '16 days' + interval '9 hours') AT TIME ZONE 'Asia/Manila'), 90, 'Room 202', 100, true, '60232eef-026d-5448-9ce9-ae74893784de'::uuid, v_now - interval '45 days'),
  ('6ff58f42-4a84-5d91-9256-c820b1d9da2e'::uuid, '50c5c8c6-811d-5c2f-9661-6d24da31a9c6'::uuid, 'Panggitnang Pagsusulit', 'Sasagutan nang nakasulat.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '-6 days' + interval '9 hours') AT TIME ZONE 'Asia/Manila'), 90, 'Room 203', 100, true, 'a27b1b90-8262-52a7-8a93-4d6ef3c33b02'::uuid, v_now - interval '45 days'),
  ('ae35058b-ee02-5c1c-a133-514d063fca04'::uuid, '760667bb-b4fd-5743-aec5-69f47d7d6ab2'::uuid, 'Midterm Exam', 'Draft: schedule to be confirmed.', ((date_trunc('day', v_now AT TIME ZONE 'Asia/Manila') + interval '23 days' + interval '9 hours') AT TIME ZONE 'Asia/Manila'), 90, 'Room 203', 100, false, 'a27b1b90-8262-52a7-8a93-4d6ef3c33b02'::uuid, v_now - interval '45 days');

  -- Timetable ---------------------------------------------------------------------------
  INSERT INTO timetable (day_of_week, period_number, start_time, end_time, room, course_id, teacher_id) VALUES
  (1, 1, TIME '08:00', TIME '09:30', 'Lab 1', '2de990a1-9f8f-5087-8d42-d2571694978c'::uuid, v_t_pk),
  (3, 1, TIME '08:00', TIME '09:30', 'Lab 1', '2de990a1-9f8f-5087-8d42-d2571694978c'::uuid, v_t_pk),
  (2, 1, TIME '08:00', TIME '09:30', 'Lab 1', '26388f0a-2613-5fb1-8264-b130df4d7f1b'::uuid, v_t_pk),
  (4, 1, TIME '08:00', TIME '09:30', 'Lab 1', '26388f0a-2613-5fb1-8264-b130df4d7f1b'::uuid, v_t_pk),
  (1, 2, TIME '09:30', TIME '11:00', 'Room 201', '089eaffd-607e-5f0e-a7b5-073f2c68f5bb'::uuid, '05846875-2d58-5baa-9839-f914debd47ca'::uuid),
  (3, 2, TIME '09:30', TIME '11:00', 'Room 201', '089eaffd-607e-5f0e-a7b5-073f2c68f5bb'::uuid, '05846875-2d58-5baa-9839-f914debd47ca'::uuid),
  (2, 2, TIME '09:30', TIME '11:00', 'Room 202', 'f60fd226-bc4f-5839-881e-874499d80703'::uuid, 'e5c4a371-324f-51c5-a5d4-dc564a475dc9'::uuid),
  (4, 2, TIME '09:30', TIME '11:00', 'Room 202', 'f60fd226-bc4f-5839-881e-874499d80703'::uuid, 'e5c4a371-324f-51c5-a5d4-dc564a475dc9'::uuid),
  (1, 3, TIME '11:00', TIME '12:30', 'Room 203', '50c5c8c6-811d-5c2f-9661-6d24da31a9c6'::uuid, 'a9dd4e4b-697b-5e19-b2a3-e1abe8fdaf77'::uuid),
  (3, 3, TIME '11:00', TIME '12:30', 'Room 203', '50c5c8c6-811d-5c2f-9661-6d24da31a9c6'::uuid, 'a9dd4e4b-697b-5e19-b2a3-e1abe8fdaf77'::uuid),
  (2, 3, TIME '11:00', TIME '12:30', 'Room 203', '760667bb-b4fd-5743-aec5-69f47d7d6ab2'::uuid, 'a9dd4e4b-697b-5e19-b2a3-e1abe8fdaf77'::uuid),
  (4, 3, TIME '11:00', TIME '12:30', 'Room 203', '760667bb-b4fd-5743-aec5-69f47d7d6ab2'::uuid, 'a9dd4e4b-697b-5e19-b2a3-e1abe8fdaf77'::uuid);

  -- Enrollments: the keeper student takes all 6 courses; every demo student gets at least
  -- 4 courses (their 4 highest-ranked by a stable hash) plus about half of the remaining ones.
  INSERT INTO enrollments (course_id, student_id, enrolled_by, enrolled_at)
  SELECT r.course_id, r.student_id, v_admin, make_date(v_term::int, 6, 1)::timestamptz + interval '9 hours'
  FROM (
    SELECT c.id AS course_id, s.id AS student_id, s.user_id,
           row_number() OVER (PARTITION BY s.id ORDER BY (abs(hashtext(s.id::text || 'rk' || c.id::text)) % 100), c.id) AS rk,
           (abs(hashtext(s.id::text || 'ex' || c.id::text)) % 100) AS h
    FROM courses c CROSS JOIN students s
  ) r
  WHERE r.user_id = v_s_user OR r.rk <= 4 OR r.h < 50;

  -- Attendance: 4 weeks of class days up to yesterday (today stays open for taking attendance)
  INSERT INTO attendance (student_id, course_id, date, status, marked_by, marked_at)
  SELECT e.student_id, e.course_id, d.dt,
    CASE WHEN r < 84 THEN 'present' WHEN r < 91 THEN 'late' WHEN r < 96 THEN 'absent' ELSE 'excused' END,
    t.user_id, ((d.dt + TIME '17:00') AT TIME ZONE 'Asia/Manila')
  FROM enrollments e
  JOIN courses c  ON c.id = e.course_id
  JOIN teachers t ON t.id = c.teacher_id
  JOIN (SELECT DISTINCT course_id, day_of_week FROM timetable) tt ON tt.course_id = c.id
  CROSS JOIN LATERAL (SELECT (v_monday - 28) + n AS dt FROM generate_series(0, (v_today - 1) - (v_monday - 28)) AS n) d
  CROSS JOIN LATERAL (SELECT (abs(hashtext(e.student_id::text || 'att' || d.dt::text)) % 100) AS r) x
  WHERE extract(isodow FROM d.dt)::int = tt.day_of_week;

  -- Submissions (online assignments). Graded once the deadline is 4+ days old;
  -- newer ones wait for the teacher. ~10% of students never submit.
  WITH base AS (
    SELECT a.id AS aid, e.student_id AS sid, a.due_date, c.id AS cid, t.user_id AS tuser,
      least(100, greatest(40, (66 + abs(hashtext(e.student_id::text)) % 33) + (abs(hashtext(a.id::text || 'g' || e.student_id::text)) % 17) - 8)) AS g
    FROM assignments a
    JOIN modules m ON m.id = a.module_id
    JOIN courses c ON c.id = m.course_id
    JOIN teachers t ON t.id = c.teacher_id
    JOIN enrollments e ON e.course_id = c.id
    WHERE a.is_published AND a.delivery = 'online' AND a.due_date < v_now
      AND (abs(hashtext(a.id::text || 'sub' || e.student_id::text)) % 100) < 90
  )
  INSERT INTO submissions (assignment_id, student_id, file_url, submitted_at, grade, feedback, graded_by, graded_at)
  SELECT aid, sid,
    'https://example.com/demo-submissions/' || substr(md5(aid::text || sid::text), 1, 10),
    CASE WHEN (abs(hashtext(aid::text || 'late' || sid::text)) % 100) < 8 THEN least(v_now - interval '10 minutes', due_date + make_interval(hours => 3 + (abs(hashtext(aid::text || 'lh' || sid::text)) % 30)))
         ELSE due_date - make_interval(hours => 2 + (abs(hashtext(aid::text || 'oh' || sid::text)) % 70)) END,
    CASE WHEN due_date < v_now - interval '4 days' THEN g END,
    CASE WHEN due_date < v_now - interval '4 days' THEN
      CASE WHEN g >= 90 THEN 'Excellent work. Clear, complete and well organized.'
           WHEN g >= 80 THEN 'Good job. A few details to polish, but the core ideas are solid.'
           WHEN g >= 70 THEN 'Satisfactory. Add more detail and review the lesson notes.'
           WHEN g >= 60 THEN 'Needs improvement. Please revisit the materials and see me during consultation.'
           ELSE 'Below expectations. Please schedule a consultation.' END END,
    CASE WHEN due_date < v_now - interval '4 days' THEN tuser END,
    CASE WHEN due_date < v_now - interval '4 days' THEN due_date + interval '2 days' END
  FROM base;

  -- A few early submissions on assignments that are not due yet (ungraded)
  INSERT INTO submissions (assignment_id, student_id, file_url, submitted_at)
  SELECT a.id, e.student_id, 'https://example.com/demo-submissions/' || substr(md5(a.id::text || e.student_id::text), 1, 10),
         v_now - make_interval(hours => 1 + (abs(hashtext(a.id::text || 'eh' || e.student_id::text)) % 48))
  FROM assignments a
  JOIN modules m ON m.id = a.module_id
  JOIN enrollments e ON e.course_id = m.course_id
  WHERE a.is_published AND a.delivery = 'online' AND a.due_date > v_now
    AND (abs(hashtext(a.id::text || 'early' || e.student_id::text)) % 100) < 12;

  -- Quiz attempts (online, published). Answers are generated per question, and the
  -- score is computed from them, so the stored answers and scores always agree.
  WITH picks AS (
    SELECT q.id AS quiz_id, e.student_id, qq.id AS qid, qq.points, qq.type, qq.options, qq.correct_answer,
           (abs(hashtext(e.student_id::text || qq.id::text)) % 100) < (66 + abs(hashtext(e.student_id::text)) % 33) + 6 AS ok
    FROM quizzes q
    JOIN enrollments e ON e.course_id = q.course_id
    JOIN quiz_questions qq ON qq.quiz_id = q.id
    WHERE q.is_published AND q.delivery = 'online' AND (abs(hashtext(q.id::text || 'att' || e.student_id::text)) % 100) < 93
  ), given AS (
    SELECT quiz_id, student_id, qid, points, ok,
      CASE WHEN ok THEN correct_answer
           WHEN type = 'true_false' THEN CASE WHEN lower(correct_answer) = 'true' THEN 'false' ELSE 'true' END
           WHEN type = 'mcq' THEN (SELECT o FROM unnest(options) AS o WHERE o <> correct_answer ORDER BY o LIMIT 1)
           ELSE 'not sure' END AS answer
    FROM picks
  )
  INSERT INTO quiz_attempts (quiz_id, student_id, score, answers, submitted_at, auto_submitted)
  SELECT quiz_id, student_id,
         round(100.0 * sum(CASE WHEN ok THEN points ELSE 0 END) / sum(points), 2),
         jsonb_object_agg(qid::text, answer),
         v_now - make_interval(days => 1 + (abs(hashtext(quiz_id::text::text || 'qd' || student_id::text::text)) % 25), hours => (abs(hashtext(student_id::text::text || 'qh' || quiz_id::text::text)) % 20)),
         (abs(hashtext(quiz_id::text::text || 'auto' || student_id::text::text)) % 100) < 5
  FROM given GROUP BY quiz_id, student_id;

  -- Manual scores: in-person assignments / quizzes and all published exams.
  -- Items held 3+ days ago are scored (~88% of students); more recent ones stay pending.
  WITH items AS (
      SELECT 'assignment'::text AS item_type, a.id AS item_id, c.id AS course_id, a.due_date AS at, a.max_score
      FROM assignments a JOIN modules m ON m.id = a.module_id JOIN courses c ON c.id = m.course_id
      WHERE a.is_published AND a.delivery = 'in_person'
      UNION ALL SELECT 'quiz', q.id, q.course_id, q.scheduled_at, q.max_score FROM quizzes q WHERE q.is_published AND q.delivery = 'in_person'
      UNION ALL SELECT 'exam', x.id, x.course_id, x.exam_at, x.max_score FROM exams x WHERE x.is_published
  )
  INSERT INTO manual_scores (item_type, item_id, student_id, course_id, score, feedback, graded_by, graded_at)
  SELECT i.item_type, i.item_id, e.student_id, i.course_id,
         round(i.max_score * least(100, greatest(40, (66 + abs(hashtext(e.student_id::text)) % 33) + (abs(hashtext(i.item_id::text || 'm' || e.student_id::text)) % 17) - 8)) / 100.0, 1),
         CASE WHEN least(100, greatest(40, (66 + abs(hashtext(e.student_id::text)) % 33) + (abs(hashtext(i.item_id::text || 'm' || e.student_id::text)) % 17) - 8)) >= 85 THEN 'Very good. Keep it up.' WHEN least(100, greatest(40, (66 + abs(hashtext(e.student_id::text)) % 33) + (abs(hashtext(i.item_id::text || 'm' || e.student_id::text)) % 17) - 8)) >= 70 THEN 'Passed. Review the items you missed.' ELSE 'Please see me for a review session.' END,
         t.user_id, i.at + interval '2 days'
  FROM items i
  JOIN enrollments e ON e.course_id = i.course_id
  JOIN courses c ON c.id = i.course_id
  JOIN teachers t ON t.id = c.teacher_id
  WHERE i.at < v_now - interval '3 days' AND (abs(hashtext(i.item_id::text || 'ms' || e.student_id::text)) % 100) < 88;

  IF seed_grades THEN
    -- Grades mirror the graded submissions, quiz attempts and manual scores (percent 0-100)
    INSERT INTO grades (student_id, course_id, assessment_type, assessment_id, score, feedback, term, created_at)
    SELECT s.student_id, m.course_id, g_assignment, a.id, round(s.grade * 100.0 / a.max_score, 2), s.feedback, v_term, s.graded_at
    FROM submissions s JOIN assignments a ON a.id = s.assignment_id JOIN modules m ON m.id = a.module_id
    WHERE s.grade IS NOT NULL;

    INSERT INTO grades (student_id, course_id, assessment_type, assessment_id, score, feedback, term, created_at)
    SELECT qa.student_id, q.course_id, g_quiz, q.id, qa.score, NULL, v_term, qa.submitted_at
    FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id;

    WITH items AS (
      SELECT 'assignment'::text AS item_type, a.id AS item_id, c.id AS course_id, a.due_date AS at, a.max_score
      FROM assignments a JOIN modules m ON m.id = a.module_id JOIN courses c ON c.id = m.course_id
      WHERE a.is_published AND a.delivery = 'in_person'
      UNION ALL SELECT 'quiz', q.id, q.course_id, q.scheduled_at, q.max_score FROM quizzes q WHERE q.is_published AND q.delivery = 'in_person'
      UNION ALL SELECT 'exam', x.id, x.course_id, x.exam_at, x.max_score FROM exams x WHERE x.is_published
    )
    INSERT INTO grades (student_id, course_id, assessment_type, assessment_id, score, feedback, term, created_at)
    SELECT ms.student_id, ms.course_id,
           CASE ms.item_type WHEN 'assignment' THEN g_assignment WHEN 'quiz' THEN g_quiz ELSE g_exam END,
           ms.item_id, round(ms.score * 100.0 / i.max_score, 2), ms.feedback, v_term, ms.graded_at
    FROM manual_scores ms JOIN items i ON i.item_type = ms.item_type AND i.item_id = ms.item_id;
  END IF;

  -- Teacher mentions: missed deadlines and corrections
  INSERT INTO coursework_mentions (item_type, item_id, student_id, course_id, reason, message, created_by, created_at, acknowledged_at, resolved_at)
  SELECT 'assignment', a.id, e.student_id, c.id, 'missed_deadline',
         'You have not submitted "' || a.title || '" yet. Please submit it or talk to me after class.',
         t.user_id, a.due_date + interval '1 day',
         CASE WHEN (abs(hashtext(a.id::text || 'ack' || e.student_id::text)) % 100) < 50 THEN a.due_date + interval '1 day 6 hours' END,
         CASE WHEN (abs(hashtext(a.id::text || 'res' || e.student_id::text)) % 100) < 15 THEN a.due_date + interval '2 days' END
  FROM assignments a
  JOIN modules m ON m.id = a.module_id JOIN courses c ON c.id = m.course_id
  JOIN teachers t ON t.id = c.teacher_id JOIN enrollments e ON e.course_id = c.id
  WHERE a.is_published AND a.delivery = 'online' AND a.due_date < v_now - interval '1 day 12 hours'
    AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.assignment_id = a.id AND s.student_id = e.student_id)
    AND (abs(hashtext(a.id::text || 'mm' || e.student_id::text)) % 100) < 70;

  INSERT INTO coursework_mentions (item_type, item_id, student_id, course_id, reason, message, created_by, created_at, acknowledged_at)
  SELECT 'assignment', a.id, s.student_id, c.id, 'correction',
         'Please review my feedback on "' || a.title || '" and send a corrected version.',
         t.user_id, s.graded_at + interval '3 hours',
         CASE WHEN (abs(hashtext(a.id::text || 'cack' || s.student_id::text)) % 100) < 40 THEN s.graded_at + interval '1 day' END
  FROM submissions s
  JOIN assignments a ON a.id = s.assignment_id JOIN modules m ON m.id = a.module_id
  JOIN courses c ON c.id = m.course_id JOIN teachers t ON t.id = c.teacher_id
  WHERE s.grade IS NOT NULL AND s.grade < 65 AND (abs(hashtext(a.id::text || 'cm' || s.student_id::text)) % 100) < 60;

  -- Announcements -------------------------------------------------------------------------
  INSERT INTO announcements (audience, course_id, title, message, is_urgent, expires_at, created_by, created_at) VALUES
  ('all', NULL, 'Welcome to the new term', 'Classes are in full swing. Check your timetable and course pages regularly, and reach out to your teachers early if you need help.', false, NULL, v_admin, v_now + interval '-60 days'),
  ('all', NULL, 'Campus advisory: possible weather disruption', 'Watch this space for any class suspension notice. Online coursework deadlines stay as scheduled unless your teacher says otherwise.', true, v_now + interval '1 days', v_admin, v_now + interval '0 days'),
  ('students', NULL, 'Midterm examination week', 'Midterm exams are held over the coming weeks. See each course page for the date, time and room of your exam.', false, NULL, v_admin, v_now + interval '-3 days'),
  ('teachers', NULL, 'Reminder: encode scores before the deadline', 'Please finish scoring pending in-person quizzes and exams so grades are complete before the review meeting.', false, NULL, v_admin, v_now + interval '-2 days'),
  ('all', NULL, 'Enrollment adjustment period (closed)', 'The adjustment period has ended. Contact the registrar for special cases.', false, v_now + interval '-10 days', v_admin, v_now + interval '-30 days'),
  ('course', '2de990a1-9f8f-5087-8d42-d2571694978c'::uuid, 'Lab 1 reminder', 'Please bring your school ID to every lab session and log in with your assigned workstation.', false, NULL, v_t_user, v_now + interval '-5 days'),
  ('course', '26388f0a-2613-5fb1-8264-b130df4d7f1b'::uuid, 'Midterm practical exam venue', 'The midterm practical exam is held in Lab 1. Bring a USB drive in case of network issues.', false, NULL, v_t_user, v_now + interval '-6 days'),
  ('course', '089eaffd-607e-5f0e-a7b5-073f2c68f5bb'::uuid, 'Quiz 2 results posted', 'Quiz 2 results are posted in your scores. Check my comments for review topics.', false, NULL, '94ceae50-c492-5045-8d88-c8b5d2d7b7fe'::uuid, v_now + interval '-4 days'),
  ('course', '760667bb-b4fd-5743-aec5-69f47d7d6ab2'::uuid, 'Reading assignment for next meeting', 'Read the next three chapters of the Noli Me Tangere before class.', false, NULL, 'a27b1b90-8262-52a7-8a93-4d6ef3c33b02'::uuid, v_now + interval '-1 days');

  -- Discussions ---------------------------------------------------------------------------
  INSERT INTO discussion_threads (id, course_id, title, author_id, body, is_pinned, is_locked, created_at) VALUES
  ('93bbfdfe-23b6-56c9-be61-1db6d77041fd'::uuid, '2de990a1-9f8f-5087-8d42-d2571694978c'::uuid, 'Welcome to IT101: course guidelines', v_t_user, 'Read the syllabus, check the timetable and use this thread for general questions. Be respectful and ask early if you are stuck.', true, false, v_now - interval '100 days'),
  ('96d8bf96-452b-5071-88e2-b9d31e9f21a6'::uuid, '2de990a1-9f8f-5087-8d42-d2571694978c'::uuid, 'How is RAM different from storage?', '14a676bc-3d20-5611-8dd9-b89ccda17d9a'::uuid, 'I keep mixing up RAM and storage. Can someone explain the difference in simple terms?', false, false, v_now - interval '12 days'),
  ('94a24c2f-1f3b-5d37-ba7f-6e7881211eac'::uuid, '26388f0a-2613-5fb1-8264-b130df4d7f1b'::uuid, 'Welcome to IT102: course guidelines', v_t_user, 'Read the syllabus, check the timetable and use this thread for general questions. Be respectful and ask early if you are stuck.', true, false, v_now - interval '101 days'),
  ('c3ef01d9-fa25-56a0-bc34-dd969c54fe16'::uuid, '26388f0a-2613-5fb1-8264-b130df4d7f1b'::uuid, 'My while loop never stops. Help!', v_s_user, 'I wrote a while loop but it keeps running forever. What did I miss?', false, false, v_now - interval '13 days'),
  ('a19b904f-79aa-58c7-a89c-8176872b8e48'::uuid, '089eaffd-607e-5f0e-a7b5-073f2c68f5bb'::uuid, 'Welcome to MATH101: course guidelines', '94ceae50-c492-5045-8d88-c8b5d2d7b7fe'::uuid, 'Read the syllabus, check the timetable and use this thread for general questions. Be respectful and ask early if you are stuck.', true, false, v_now - interval '102 days'),
  ('eb0836a9-a12f-5977-b52d-cb13802de409'::uuid, '089eaffd-607e-5f0e-a7b5-073f2c68f5bb'::uuid, 'Is x = 0 a valid solution of 2x = 0?', 'b39b81f6-8940-5dc1-8ea1-e0b96f286720'::uuid, 'Our quiz item made me wonder whether zero counts as a valid answer.', false, false, v_now - interval '14 days'),
  ('f092022f-dad2-5373-913d-690db09e556d'::uuid, 'f60fd226-bc4f-5839-881e-874499d80703'::uuid, 'Welcome to ENG101: course guidelines', '60232eef-026d-5448-9ce9-ae74893784de'::uuid, 'Read the syllabus, check the timetable and use this thread for general questions. Be respectful and ask early if you are stuck.', true, false, v_now - interval '103 days'),
  ('2adcc6e2-9bb2-503a-8aa8-791b3cf2330d'::uuid, 'f60fd226-bc4f-5839-881e-874499d80703'::uuid, 'Tips for overcoming stage fright?', '91a19e1e-7f2f-5197-aa30-284185694ba9'::uuid, 'I get really nervous in speeches. Any tips before our presentation?', false, false, v_now - interval '15 days'),
  ('843621d2-0d7b-564e-b663-5f762068b60b'::uuid, '50c5c8c6-811d-5c2f-9661-6d24da31a9c6'::uuid, 'Welcome to FIL101: course guidelines', 'a27b1b90-8262-52a7-8a93-4d6ef3c33b02'::uuid, 'Read the syllabus, check the timetable and use this thread for general questions. Be respectful and ask early if you are stuck.', true, false, v_now - interval '104 days'),
  ('55226ca2-afc5-5ed9-860f-b8ac5026b382'::uuid, '50c5c8c6-811d-5c2f-9661-6d24da31a9c6'::uuid, 'Paano makikilala ang pormal at impormal na salita?', '61125295-0258-5b2d-8bdc-ce93725d4790'::uuid, 'Minsan nalilito ako kung kailan gagamitin ang balbal at kolokyal. Paano ba ito matutukoy?', false, false, v_now - interval '16 days'),
  ('ec128627-8080-59a3-a05d-ea0612a67a70'::uuid, '760667bb-b4fd-5743-aec5-69f47d7d6ab2'::uuid, 'Welcome to RIZAL101: course guidelines', 'a27b1b90-8262-52a7-8a93-4d6ef3c33b02'::uuid, 'Read the syllabus, check the timetable and use this thread for general questions. Be respectful and ask early if you are stuck.', true, false, v_now - interval '105 days'),
  ('4cfaa342-c4ef-5af7-af29-7725d160fc0e'::uuid, '760667bb-b4fd-5743-aec5-69f47d7d6ab2'::uuid, 'Why did Rizal write novels instead of pamphlets?', 'c71f240c-5211-5ea6-bc0b-49b2971dadca'::uuid, 'Pamphlets seem faster and more direct. Why did he choose the novel form?', false, false, v_now - interval '17 days');
  INSERT INTO discussion_replies (id, thread_id, author_id, parent_reply_id, content, created_at) VALUES
  ('e166f3df-3d08-5ced-9413-42446c2b0663'::uuid, '93bbfdfe-23b6-56c9-be61-1db6d77041fd'::uuid, '331b5d03-233b-5068-b238-e8de1a9cae12'::uuid, NULL, 'Thank you! Looking forward to the course.', v_now - interval '99 days'),
  ('16e9a3e1-0b8e-5c3b-ab40-b58eed95e34e'::uuid, '96d8bf96-452b-5071-88e2-b9d31e9f21a6'::uuid, '331b5d03-233b-5068-b238-e8de1a9cae12'::uuid, NULL, 'RAM is short-term memory for programs that are running. Storage keeps your files even when the computer is off.', v_now - interval '11 days' + interval '1 hours'),
  ('b7cf4e79-fe65-5561-8d61-8136e013381d'::uuid, '96d8bf96-452b-5071-88e2-b9d31e9f21a6'::uuid, v_t_user, NULL, 'Exactly. Think of RAM as your desk and storage as your filing cabinet.', v_now - interval '11 days' + interval '2 hours'),
  ('5db1ff02-e04a-5cd1-b8dd-c269ee7b2594'::uuid, '94a24c2f-1f3b-5d37-ba7f-6e7881211eac'::uuid, 'c0dbc4f1-804c-5415-acbe-33d8ce181504'::uuid, NULL, 'Thank you! Looking forward to the course.', v_now - interval '100 days'),
  ('78705dfa-6adc-5a84-a196-5c3316abcf4b'::uuid, 'c3ef01d9-fa25-56a0-bc34-dd969c54fe16'::uuid, 'c0dbc4f1-804c-5415-acbe-33d8ce181504'::uuid, NULL, 'Check if you change the counter inside the loop.', v_now - interval '12 days' + interval '1 hours'),
  ('4c8ef1fc-8732-564f-87db-1707584f2dae'::uuid, 'c3ef01d9-fa25-56a0-bc34-dd969c54fe16'::uuid, v_t_user, NULL, 'Right. If the condition never becomes False, the loop never ends. Add counter += 1 at the end of the loop body.', v_now - interval '12 days' + interval '2 hours'),
  ('ab5bd6a6-2cc2-5546-9a0a-53014f2f3bdd'::uuid, 'a19b904f-79aa-58c7-a89c-8176872b8e48'::uuid, '09f1e574-ec63-593b-80fe-55add55c4e9a'::uuid, NULL, 'Thank you! Looking forward to the course.', v_now - interval '101 days'),
  ('da8bdd66-b872-5a78-a13f-23b106e8fc86'::uuid, 'eb0836a9-a12f-5977-b52d-cb13802de409'::uuid, '09f1e574-ec63-593b-80fe-55add55c4e9a'::uuid, NULL, 'Yes. Substitute x = 0: 2(0) = 0, so it works.', v_now - interval '13 days' + interval '1 hours'),
  ('79f80c3f-92eb-5dec-abea-0daad0d3de21'::uuid, 'eb0836a9-a12f-5977-b52d-cb13802de409'::uuid, '94ceae50-c492-5045-8d88-c8b5d2d7b7fe'::uuid, NULL, 'Correct. Zero is a perfectly valid solution. Always verify by substitution.', v_now - interval '13 days' + interval '2 hours'),
  ('cf286513-ef03-508c-a8f8-f6f151fb454f'::uuid, 'f092022f-dad2-5373-913d-690db09e556d'::uuid, '12fe99c8-244d-59c6-9f3d-08539700e491'::uuid, NULL, 'Thank you! Looking forward to the course.', v_now - interval '102 days'),
  ('bf51a7e1-fdfa-5886-8dd9-38dfe1ed600d'::uuid, '2adcc6e2-9bb2-503a-8aa8-791b3cf2330d'::uuid, '12fe99c8-244d-59c6-9f3d-08539700e491'::uuid, NULL, 'Practice in front of a mirror and record yourself.', v_now - interval '14 days' + interval '1 hours'),
  ('4d663e45-85bb-54d3-9769-41af451cd3ad'::uuid, '2adcc6e2-9bb2-503a-8aa8-791b3cf2330d'::uuid, '60232eef-026d-5448-9ce9-ae74893784de'::uuid, NULL, 'Good advice. Also, breathe slowly before you begin and focus on one friendly face.', v_now - interval '14 days' + interval '2 hours'),
  ('1e7dbba9-3318-5ad8-a36a-4be00188ef7a'::uuid, '843621d2-0d7b-564e-b663-5f762068b60b'::uuid, 'a30b6fd4-8cd4-5f7a-bda5-600012967cba'::uuid, NULL, 'Thank you! Looking forward to the course.', v_now - interval '103 days'),
  ('14bb73a9-7ceb-5ddf-8e02-d29d826135b5'::uuid, '55226ca2-afc5-5ed9-860f-b8ac5026b382'::uuid, 'a30b6fd4-8cd4-5f7a-bda5-600012967cba'::uuid, NULL, 'Tingnan ang kausap at ang sitwasyon. Sa paaralan at trabaho, mas pormal ang gamit.', v_now - interval '15 days' + interval '1 hours'),
  ('6b47b873-4b53-5be3-a65f-4b1089a38e1d'::uuid, '55226ca2-afc5-5ed9-860f-b8ac5026b382'::uuid, 'a27b1b90-8262-52a7-8a93-4d6ef3c33b02'::uuid, NULL, 'Tama. Ang konteksto ang batayan: kausap, lugar at layunin.', v_now - interval '15 days' + interval '2 hours'),
  ('870d96ce-6930-55e5-bd52-3de8c016f7ea'::uuid, 'ec128627-8080-59a3-a05d-ea0612a67a70'::uuid, '24b39309-a1f3-56a4-be71-9866e3f0330b'::uuid, NULL, 'Thank you! Looking forward to the course.', v_now - interval '104 days'),
  ('bc3e6d8e-cec7-5409-b299-ec92d343501e'::uuid, '4cfaa342-c4ef-5af7-af29-7725d160fc0e'::uuid, '24b39309-a1f3-56a4-be71-9866e3f0330b'::uuid, NULL, 'Novels can reach more readers and show society through characters.', v_now - interval '16 days' + interval '1 hours'),
  ('23fc1582-c2de-55fc-abb0-89807c506e25'::uuid, '4cfaa342-c4ef-5af7-af29-7725d160fc0e'::uuid, 'a27b1b90-8262-52a7-8a93-4d6ef3c33b02'::uuid, NULL, 'Yes. Fiction let him criticize colonial abuses in a way that readers could feel, not just read.', v_now - interval '16 days' + interval '2 hours');
  UPDATE discussion_threads SET answer_reply_id = 'b7cf4e79-fe65-5561-8d61-8136e013381d'::uuid WHERE id = '96d8bf96-452b-5071-88e2-b9d31e9f21a6'::uuid;
  UPDATE discussion_threads SET answer_reply_id = '4c8ef1fc-8732-564f-87db-1707584f2dae'::uuid WHERE id = 'c3ef01d9-fa25-56a0-bc34-dd969c54fe16'::uuid;
  UPDATE discussion_threads SET answer_reply_id = '79f80c3f-92eb-5dec-abea-0daad0d3de21'::uuid WHERE id = 'eb0836a9-a12f-5977-b52d-cb13802de409'::uuid;
  UPDATE discussion_threads SET answer_reply_id = '4d663e45-85bb-54d3-9769-41af451cd3ad'::uuid WHERE id = '2adcc6e2-9bb2-503a-8aa8-791b3cf2330d'::uuid;
  UPDATE discussion_threads SET answer_reply_id = '6b47b873-4b53-5be3-a65f-4b1089a38e1d'::uuid WHERE id = '55226ca2-afc5-5ed9-860f-b8ac5026b382'::uuid;
  UPDATE discussion_threads SET answer_reply_id = '23fc1582-c2de-55fc-abb0-89807c506e25'::uuid WHERE id = '4cfaa342-c4ef-5af7-af29-7725d160fc0e'::uuid;
  INSERT INTO discussion_reports (reply_id, reporter_id, reason, created_at) VALUES ('78705dfa-6adc-5a84-a196-5c3316abcf4b'::uuid, 'b39b81f6-8940-5dc1-8ea1-e0b96f286720'::uuid, 'Possible off-topic reply (demo report for the moderation queue).', v_now - interval '2 days');

  -- Audit entries (same action / entity_type strings the app writes). audit_logs is append-only, so be sure before committing.
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_values, ip_address, created_at) VALUES
  (v_admin, 'course.create', 'course', '2de990a1-9f8f-5087-8d42-d2571694978c'::uuid, jsonb_build_object('code', 'IT101', 'name', 'Introduction to Computing'), '203.0.113.10', v_now + interval '-139 days'),
  (v_admin, 'course.create', 'course', '26388f0a-2613-5fb1-8264-b130df4d7f1b'::uuid, jsonb_build_object('code', 'IT102', 'name', 'Programming Fundamentals'), '203.0.113.10', v_now + interval '-138 days'),
  (v_admin, 'course.create', 'course', '089eaffd-607e-5f0e-a7b5-073f2c68f5bb'::uuid, jsonb_build_object('code', 'MATH101', 'name', 'College Algebra'), '203.0.113.10', v_now + interval '-137 days'),
  (v_admin, 'course.create', 'course', 'f60fd226-bc4f-5839-881e-874499d80703'::uuid, jsonb_build_object('code', 'ENG101', 'name', 'Purposive Communication'), '203.0.113.10', v_now + interval '-136 days'),
  (v_admin, 'course.create', 'course', '50c5c8c6-811d-5c2f-9661-6d24da31a9c6'::uuid, jsonb_build_object('code', 'FIL101', 'name', 'Kontekstwalisadong Komunikasyon sa Filipino'), '203.0.113.10', v_now + interval '-135 days'),
  (v_admin, 'course.create', 'course', '760667bb-b4fd-5743-aec5-69f47d7d6ab2'::uuid, jsonb_build_object('code', 'RIZAL101', 'name', 'Life and Works of Jose Rizal'), '203.0.113.10', v_now + interval '-134 days'),
  (v_t_user, 'assignment.create', 'assignment', 'c3769865-4c90-5f49-ab51-157f31d6c0bb'::uuid, jsonb_build_object('title', 'Mini Project: Grade Calculator'), '203.0.113.21', v_now + interval '-35 days'),
  (v_t_user, 'quiz.create', 'quiz', '98736573-9c4b-5cce-be2c-c30f9cb0606d'::uuid, jsonb_build_object('title', 'Quiz 2: Loops and Conditionals'), '203.0.113.21', v_now + interval '-30 days'),
  (v_t_user, 'quiz.update', 'quiz', '98736573-9c4b-5cce-be2c-c30f9cb0606d'::uuid, jsonb_build_object('is_published', true), '203.0.113.21', v_now + interval '-29 days'),
  (v_t_user, 'quiz.create', 'quiz', '76f2d3c6-a264-594e-8d29-82ac76dc16d2'::uuid, jsonb_build_object('title', 'Quiz 2: Networks (Draft)'), '203.0.113.21', v_now + interval '-8 days'),
  (v_t_user, 'quiz.delete', 'quiz', '9b05099d-ba4c-5f3f-9faa-f028e642ceea'::uuid, jsonb_build_object('title', 'Old practice quiz'), '203.0.113.21', v_now + interval '-7 days'),
  (v_t_user, 'discussion.moderate', 'discussion_threads', 'c3ef01d9-fa25-56a0-bc34-dd969c54fe16'::uuid, jsonb_build_object('action', 'reviewed report'), '203.0.113.21', v_now + interval '-2 days'),
  (v_t_user, 'discussion.thread.delete', 'discussion_threads', '8790e2b3-c11c-528c-b7cd-a6744bc7cb1b'::uuid, jsonb_build_object('reason', 'duplicate thread'), '203.0.113.21', v_now + interval '-6 days'),
  (v_admin, 'login', 'user', v_admin, NULL, '203.0.113.10', v_now + interval '-9 days'),
  (v_admin, 'login', 'user', v_admin, NULL, '203.0.113.10', v_now + interval '-3 days'),
  (v_admin, 'login', 'user', v_admin, NULL, '203.0.113.10', v_now + interval '-1 days'),
  (v_t_user, 'login', 'user', v_t_user, NULL, '203.0.113.21', v_now + interval '-4 days'),
  (v_t_user, 'login', 'user', v_t_user, NULL, '203.0.113.21', v_now + interval '-1 days 2 hours'),
  (v_s_user, 'login', 'user', v_s_user, NULL, '203.0.113.44', v_now + interval '-5 days'),
  (v_s_user, 'login', 'user', v_s_user, NULL, '203.0.113.44', v_now + interval '-2 days'),
  ('331b5d03-233b-5068-b238-e8de1a9cae12'::uuid, 'login', 'user', '331b5d03-233b-5068-b238-e8de1a9cae12'::uuid, NULL, '203.0.113.45', v_now + interval '-3 days'),
  ('94ceae50-c492-5045-8d88-c8b5d2d7b7fe'::uuid, 'login', 'user', '94ceae50-c492-5045-8d88-c8b5d2d7b7fe'::uuid, NULL, '203.0.113.22', v_now + interval '-2 days');

  IF seed_notifications THEN
    -- Newly graded work (last 14 days)
    INSERT INTO notifications (user_id, type, title, message, is_read, created_at, course_id)
    SELECT st.user_id, n_grade, 'Assignment graded',
           'Your submission for "' || a.title || '" was graded: ' || round(s.grade)::text || '/' || round(a.max_score)::text || '.',
           (abs(hashtext(s.id::text || 'nr')) % 100) < 55, s.graded_at, m.course_id
    FROM submissions s JOIN assignments a ON a.id = s.assignment_id JOIN modules m ON m.id = a.module_id
    JOIN students st ON st.id = s.student_id
    WHERE s.graded_at IS NOT NULL AND s.graded_at > v_now - interval '14 days';

    -- Active announcements (last 30 days) to their audience
    INSERT INTO notifications (user_id, type, title, message, is_read, created_at, course_id)
    SELECT u.id, n_announcement, an.title, left(an.message, 140),
           (abs(hashtext(u.id::text || 'ar' || an.id::text)) % 100) < 50, an.created_at, an.course_id
    FROM announcements an
    JOIN users u ON (an.audience = 'all' AND u.role IN ('teacher','student'))
                 OR (an.audience = 'students' AND u.role = 'student')
                 OR (an.audience = 'teachers' AND u.role = 'teacher')
                 OR (an.audience = 'course' AND EXISTS (SELECT 1 FROM enrollments e JOIN students s ON s.id = e.student_id
                                                        WHERE e.course_id = an.course_id AND s.user_id = u.id))
    WHERE an.created_at > v_now - interval '30 days' AND (an.expires_at IS NULL OR an.expires_at > v_now);

    -- Teacher mentions
    INSERT INTO notifications (user_id, type, title, message, is_read, created_at, course_id)
    SELECT st.user_id, n_mention, 'Your teacher mentioned you', cm.message, cm.acknowledged_at IS NOT NULL, cm.created_at, cm.course_id
    FROM coursework_mentions cm JOIN students st ON st.id = cm.student_id;
  END IF;

  -- Keep the legacy subject arrays in sync with the real enrollments / courses
  UPDATE students SET subjects_assigned = coalesce((SELECT array_agg(c.name ORDER BY c.code) FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.student_id = students.id), '{}');
  UPDATE teachers SET subjects_taught   = coalesce((SELECT array_agg(c.name ORDER BY c.code) FROM courses c WHERE c.teacher_id = teachers.id), '{}');

  msg := format('users=%s students=%s teachers=%s courses=%s enrollments=%s attendance=%s assignments=%s submissions=%s (graded %s) quizzes=%s attempts=%s exams=%s manual_scores=%s grades=%s mentions=%s announcements=%s threads=%s replies=%s notifications=%s audit_logs=%s',
    (SELECT count(*) FROM users), (SELECT count(*) FROM students), (SELECT count(*) FROM teachers), (SELECT count(*) FROM courses),
    (SELECT count(*) FROM enrollments), (SELECT count(*) FROM attendance), (SELECT count(*) FROM assignments),
    (SELECT count(*) FROM submissions), (SELECT count(*) FROM submissions WHERE grade IS NOT NULL), (SELECT count(*) FROM quizzes),
    (SELECT count(*) FROM quiz_attempts), (SELECT count(*) FROM exams), (SELECT count(*) FROM manual_scores), (SELECT count(*) FROM grades),
    (SELECT count(*) FROM coursework_mentions), (SELECT count(*) FROM announcements), (SELECT count(*) FROM discussion_threads),
    (SELECT count(*) FROM discussion_replies), (SELECT count(*) FROM notifications), (SELECT count(*) FROM audit_logs));

  IF dry_run THEN
    RAISE EXCEPTION 'DRY RUN, rolled back (this is expected). Would have inserted: %', msg;
  END IF;
  RAISE NOTICE 'SEED COMMITTED. %', msg;
END $$;
