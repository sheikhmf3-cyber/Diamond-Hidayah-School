-- ============================================================
-- Diamond School — Parent multi-child migration
-- Paste into Supabase → SQL Editor → Run
-- (parent-portal-migration.sql and parent-registration-migration.sql
--  must already have been run)
-- ============================================================

-- Extra children linked to an already-approved parent account, added
-- by the parent themselves from the online portal (no local admin
-- re-approval — the account itself was already approved once, and each
-- added child is still verified against a real cloud_students row by
-- school+class+roll_no, same check as initial registration). The child
-- the parent originally registered with stays on cloud_users.parent_student_id
-- as before; this table holds any *additional* children on top of that.
CREATE TABLE IF NOT EXISTS cloud_parent_children (
  id SERIAL PRIMARY KEY,
  parent_user_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(parent_user_id, student_id)
);

-- ============================================================
-- Done. Redeploy the cloud app so it picks up the new endpoints.
-- ============================================================
