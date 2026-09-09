-- ============================================================
-- Diamond School — Parent additional-child APPROVAL migration
-- Paste into Supabase → SQL Editor → Run
-- (parent-multi-child-migration.sql must already have been run)
-- ============================================================

-- Supersedes the earlier self-service behaviour: adding a second (or
-- further) child to an already-approved parent account is now staged
-- here as 'pending' first. A school admin approves/rejects it from the
-- online portal itself (Parent Requests tab, admin login) — no separate
-- local-system change needed. Only once approved does a row get added
-- to cloud_parent_children, which is the table that actually grants
-- access to that child's data.
CREATE TABLE IF NOT EXISTS cloud_parent_child_requests (
  id SERIAL PRIMARY KEY,
  parent_user_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at TIMESTAMPTZ DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by INTEGER,
  UNIQUE(parent_user_id, student_id)
);

-- ============================================================
-- Done. Redeploy the cloud app so it picks up the new endpoints.
-- ============================================================
