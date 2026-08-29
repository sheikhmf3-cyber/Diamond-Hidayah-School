-- Run this in Supabase SQL Editor
-- Adds local_id unique indexes so local→cloud push works correctly

ALTER TABLE cloud_report_cards ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE cloud_daily_diary ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE cloud_unit_test_marks ADD COLUMN IF NOT EXISTS local_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_report_cards_local_id ON cloud_report_cards(local_id) WHERE local_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_daily_diary_local_id ON cloud_daily_diary(local_id) WHERE local_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_unit_test_marks_local_id ON cloud_unit_test_marks(local_id) WHERE local_id IS NOT NULL;
