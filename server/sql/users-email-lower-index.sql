-- One account per email, whatever the capitalization ("Juan@x.com" and "juan@x.com" are the same).
--
-- Recommended, not required: the server already matches emails with lower(email) and refuses to
-- create a second account whose email differs only in capitalization. This index makes the DATABASE
-- enforce that too (so two simultaneous sign-ups cannot slip past the check) and lets the
-- lower(email) lookup at login use an index instead of reading every user.
--
-- Safe to run more than once. It can run before or after deploying the server patch.
--
-- If two existing accounts differ only in capitalization, the script stops with a message listing
-- them and changes nothing. Deactivate or rename one of each pair, then run it again.

DO $$
DECLARE
  duplicates text;
BEGIN
  SELECT string_agg(e, ', ') INTO duplicates
  FROM (
    SELECT lower(email) AS e FROM users GROUP BY lower(email) HAVING COUNT(*) > 1
  ) d;

  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'These emails exist more than once when capitalization is ignored: %. Fix them, then run this script again.', duplicates;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

-- Check:
--   SELECT indexname FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_email_lower_key';
