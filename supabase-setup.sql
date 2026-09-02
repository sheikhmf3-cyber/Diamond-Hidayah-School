-- ============================================================
-- Diamond School System — Supabase Cloud Tables
-- Paste this entire file into Supabase → SQL Editor → Run
-- ============================================================

-- Teachers (synced from your local users table)
CREATE TABLE IF NOT EXISTS cloud_users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher',
  status TEXT NOT NULL DEFAULT 'approved',
  allowed_sections TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Teacher class assignments (so teacher sees only their class)
CREATE TABLE IF NOT EXISTS cloud_teacher_classes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  school TEXT NOT NULL,
  class_name TEXT NOT NULL,
  UNIQUE(user_id, school, class_name)
);

-- Students (synced from local — read-only in cloud, used for dropdowns)
CREATE TABLE IF NOT EXISTS cloud_students (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  school TEXT NOT NULL,
  class_name TEXT NOT NULL,
  division TEXT DEFAULT '',
  roll_no TEXT DEFAULT '',
  guardian_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Report Cards (entered by teachers online, synced to local)
CREATE TABLE IF NOT EXISTS cloud_report_cards (
  id SERIAL PRIMARY KEY,
  local_id INTEGER DEFAULT NULL,        -- set after sync to local
  student_id INTEGER NOT NULL,
  term TEXT NOT NULL,
  academic_year TEXT NOT NULL DEFAULT '2025-26',
  attendance_present INTEGER DEFAULT 0,
  attendance_total INTEGER DEFAULT 0,
  conduct TEXT DEFAULT '',
  remarks TEXT DEFAULT '',
  activity TEXT DEFAULT '',
  arts TEXT DEFAULT '',
  communication TEXT DEFAULT '',
  discipline TEXT DEFAULT '',
  homework TEXT DEFAULT '',
  participation TEXT DEFAULT '',
  respect TEXT DEFAULT '',
  teamwork TEXT DEFAULT '',
  punctuality TEXT DEFAULT '',
  improvement TEXT DEFAULT '',
  daily_activity TEXT DEFAULT '',
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  synced_at TIMESTAMPTZ DEFAULT NULL,
  UNIQUE(student_id, term, academic_year)
);

-- Report Card Marks
CREATE TABLE IF NOT EXISTS cloud_report_card_marks (
  id SERIAL PRIMARY KEY,
  cloud_report_card_id INTEGER NOT NULL REFERENCES cloud_report_cards(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  marks_obtained REAL,
  marks_total REAL
);

-- Daily Diary (entered by teachers online, synced to local)
CREATE TABLE IF NOT EXISTS cloud_daily_diary (
  id SERIAL PRIMARY KEY,
  local_id INTEGER DEFAULT NULL,        -- set after sync to local
  student_id INTEGER NOT NULL,
  entry_date TEXT NOT NULL,
  activity TEXT DEFAULT '',
  behaviour TEXT DEFAULT '',
  homework TEXT DEFAULT '',
  classwork TEXT DEFAULT '',
  remarks TEXT DEFAULT '',
  recorded_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  synced_at TIMESTAMPTZ DEFAULT NULL,
  UNIQUE(student_id, entry_date)
);

-- Sync log (for monitoring)
CREATE TABLE IF NOT EXISTS sync_log (
  id SERIAL PRIMARY KEY,
  synced_at TIMESTAMPTZ DEFAULT now(),
  report_cards_synced INTEGER DEFAULT 0,
  diary_entries_synced INTEGER DEFAULT 0,
  notes TEXT DEFAULT ''
);

-- ============================================================
-- Done! Now go back to Claude and share your URL + anon key.
-- ============================================================

-- ============================================================
-- Unit Test Marks (cloud)
-- ============================================================
CREATE TABLE IF NOT EXISTS cloud_unit_test_marks (
  id SERIAL PRIMARY KEY,
  local_id INTEGER DEFAULT NULL,
  student_id INTEGER NOT NULL,
  academic_year TEXT NOT NULL DEFAULT '2026-27',
  test_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  total_marks TEXT DEFAULT '',
  obtained_marks TEXT DEFAULT '',
  part1_marks TEXT DEFAULT '',
  part2_marks TEXT DEFAULT '',
  part3_marks TEXT DEFAULT '',
  part4_marks TEXT DEFAULT '',
  part5_marks TEXT DEFAULT '',
  recorded_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  synced_at TIMESTAMPTZ DEFAULT NULL,
  UNIQUE(student_id, academic_year, test_name, subject)
);

-- ============================================================
-- Unit Test Report Remarks (Academic / Islamic classwise report)
-- ============================================================
CREATE TABLE IF NOT EXISTS cloud_unit_test_remarks (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL,
  academic_year TEXT NOT NULL,
  test_name TEXT NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'academic',
  remarks TEXT DEFAULT '',
  recorded_by INTEGER,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, academic_year, test_name, report_type)
);

-- ============================================================
-- New-teacher registrations submitted from the online portal — staged
-- here (NOT written straight into cloud_users, which uses local-assigned
-- ids) until the local sync agent pulls them into the local `users` table
-- for the admin's usual local approval flow.
-- ============================================================
CREATE TABLE IF NOT EXISTS cloud_teacher_registrations (
  id SERIAL PRIMARY KEY,
  local_id INTEGER DEFAULT NULL,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  classes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  synced_at TIMESTAMPTZ DEFAULT NULL
);
