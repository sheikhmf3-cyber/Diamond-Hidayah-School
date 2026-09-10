-- ============================================================
-- Diamond School — fix missing local_id unique constraints
-- Paste into Supabase → SQL Editor → Run
-- ============================================================

-- sync-agent.js's pushReportCards() upserts cloud_report_cards on
-- local_id, and pushDiaryEntries() upserts cloud_daily_diary on
-- local_id — but neither table has ever had a unique constraint on
-- that column (only on student_id+term+academic_year / student_id+
-- entry_date respectively), so every such upsert fails with:
--   "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification"
-- A unique index works the same as a unique constraint for ON
-- CONFLICT purposes, and multiple NULLs (rows never pulled back
-- from a local edit, e.g. entered directly on the online portal)
-- are allowed under a unique index without conflicting with each
-- other.
CREATE UNIQUE INDEX IF NOT EXISTS cloud_report_cards_local_id_idx ON cloud_report_cards(local_id);
CREATE UNIQUE INDEX IF NOT EXISTS cloud_daily_diary_local_id_idx ON cloud_daily_diary(local_id);

-- ============================================================
-- Done. No redeploy needed — sync-agent.js's next push will just
-- start succeeding.
-- ============================================================
