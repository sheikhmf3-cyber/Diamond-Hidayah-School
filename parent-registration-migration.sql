-- ============================================================
-- Diamond School — Online parent registration migration
-- Paste into Supabase → SQL Editor → Run
-- (parent-portal-migration.sql must already have been run)
-- ============================================================

-- New parents registering from the online portal are staged here first
-- (validated against cloud_students at submit time), then pulled into
-- the local `users` table as status='pending' by sync-agent.js so they
-- show up in the normal local Parent Accounts approval screen. Once
-- approved locally, the existing pushUsers() carries them back up to
-- cloud_users so they can log into the online portal too.
CREATE TABLE IF NOT EXISTS cloud_parent_registrations (
  id SERIAL PRIMARY KEY,
  local_id INTEGER DEFAULT NULL,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  parent_student_id INTEGER NOT NULL,
  parent_school TEXT DEFAULT '',
  parent_class_name TEXT DEFAULT '',
  parent_roll_no TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  synced_at TIMESTAMPTZ DEFAULT NULL
);
