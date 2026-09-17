-- ============================================================
-- Diamond School — Teacher registration phone number migration
-- Paste into Supabase → SQL Editor → Run
-- ============================================================

-- Phone number collected at signup — shown to the local admin on the
-- Teacher Accounts approval screen so a registration can be verified by
-- calling the number before approving it, not just trusted on the name
-- typed into the form.
ALTER TABLE cloud_teacher_registrations ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE cloud_users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
