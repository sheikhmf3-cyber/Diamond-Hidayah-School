-- ============================================================
-- Diamond School — Parent Portal migration
-- Paste this into Supabase → SQL Editor → Run (after the base
-- supabase-setup.sql has already been run once).
-- ============================================================

-- Link a 'parent' role cloud_users row to the one student they
-- registered against locally (registration + admin approval both
-- happen on the local system; approved parents get synced here).
ALTER TABLE cloud_users ADD COLUMN IF NOT EXISTS parent_student_id INTEGER;
ALTER TABLE cloud_users ADD COLUMN IF NOT EXISTS parent_school TEXT DEFAULT '';
ALTER TABLE cloud_users ADD COLUMN IF NOT EXISTS parent_class_name TEXT DEFAULT '';
ALTER TABLE cloud_users ADD COLUMN IF NOT EXISTS parent_roll_no TEXT DEFAULT '';

-- Term 1 / Term 2 formal mark sheet (mirrors local `results` +
-- `result_subjects` — pushed one-way, local → cloud, since term
-- marks are only ever entered on the local system).
CREATE TABLE IF NOT EXISTS cloud_results (
  id SERIAL PRIMARY KEY,
  local_id INTEGER DEFAULT NULL,
  student_id INTEGER NOT NULL,
  academic_year TEXT NOT NULL DEFAULT '2025-26',
  format TEXT DEFAULT 'grade48',
  attendance_present INTEGER DEFAULT 0,
  attendance_total INTEGER DEFAULT 0,
  conduct TEXT DEFAULT '',
  remarks TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  synced_at TIMESTAMPTZ DEFAULT NULL,
  UNIQUE(student_id, academic_year)
);

CREATE TABLE IF NOT EXISTS cloud_result_subjects (
  id SERIAL PRIMARY KEY,
  cloud_result_id INTEGER NOT NULL REFERENCES cloud_results(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  max1 TEXT DEFAULT '', min1 TEXT DEFAULT '', obtained1 TEXT DEFAULT '',
  max2 TEXT DEFAULT '', min2 TEXT DEFAULT '', obtained2 TEXT DEFAULT '',
  remark TEXT DEFAULT ''
);

-- ============================================================
-- Done. Now redeploy the diamond-cloud app (git push, or however
-- you deploy to Render) and restart sync-agent.js on the local PC
-- so it starts pushing parent accounts and results to the cloud.
-- ============================================================
