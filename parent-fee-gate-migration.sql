-- ============================================================
-- Diamond School — Parent portal Term 1 fee-gate migration
-- Paste into Supabase → SQL Editor → Run
-- ============================================================

-- Just a yes/no flag per student, computed and pushed by sync-agent.js
-- (required = 50% of tuition_fee + term_fee, compared against the sum of
-- that student's non-deleted payments this academic year). No fee
-- amounts or payment history are synced to the cloud — only this flag —
-- consistent with fee payments staying local-only everywhere else.
CREATE TABLE IF NOT EXISTS cloud_student_fee_status (
  student_id INTEGER PRIMARY KEY,
  academic_year TEXT NOT NULL,
  term1_cleared BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Done. Restart sync-agent.js on the school PC so it starts pushing
-- fee status, and redeploy the cloud app so it starts enforcing it.
-- ============================================================
