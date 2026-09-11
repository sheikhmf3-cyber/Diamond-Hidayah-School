-- ============================================================
-- Diamond School — fee-exempt student category migration
-- Paste into Supabase → SQL Editor → Run
-- ============================================================

-- cloud_students never carried the local students.category column
-- (RTE / Poor / Scholarship / General etc.) — needed so the parent
-- portal can skip the Term 1 fee gate entirely for RTE, Poor, and
-- Scholarship students, in any school/class, regardless of payment
-- status.
ALTER TABLE cloud_students ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';

-- ============================================================
-- Done. Also update sync-agent.js on the school PC (already sent) so
-- it starts pushing this column, then restart it.
-- ============================================================
