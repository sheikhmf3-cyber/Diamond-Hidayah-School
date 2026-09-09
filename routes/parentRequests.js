// routes/parentRequests.js — admin-only approval queue for parents asking
// to add a 2nd/3rd/etc. child to their already-approved account. Kept
// separate from routes/parent.js (which is parent-only) since this needs
// the opposite role check.
const express = require('express');
const supabase = require('../db/supabase');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin access only.' });
  next();
}

router.use(requireLogin, requireAdmin);

// List pending requests with enough context for an admin to decide:
// which parent, which child they're asking to add, and their existing child.
router.get('/', async (req, res) => {
  const { data: requests, error } = await supabase
    .from('cloud_parent_child_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  if (!requests || !requests.length) return res.json([]);

  const parentIds = [...new Set(requests.map(r => r.parent_user_id))];
  const studentIds = [...new Set(requests.map(r => r.student_id))];

  const [{ data: parents }, { data: students }] = await Promise.all([
    supabase.from('cloud_users').select('id,name,username,parent_student_id').in('id', parentIds),
    supabase.from('cloud_students').select('id,name,school,class_name,division,roll_no').in('id', studentIds),
  ]);

  const parentMap = {}; (parents || []).forEach(p => { parentMap[p.id] = p; });
  const studentMap = {}; (students || []).forEach(s => { studentMap[s.id] = s; });

  // Also fetch each parent's existing (already-approved) child for context
  const existingIds = [...new Set((parents || []).map(p => p.parent_student_id).filter(Boolean))];
  const { data: existingStudents } = existingIds.length
    ? await supabase.from('cloud_students').select('id,name').in('id', existingIds)
    : { data: [] };
  const existingMap = {}; (existingStudents || []).forEach(s => { existingMap[s.id] = s; });

  res.json(requests.map(r => {
    const parent = parentMap[r.parent_user_id];
    return {
      request_id: r.id,
      created_at: r.created_at,
      parent_name: parent?.name,
      parent_username: parent?.username,
      existing_child_name: parent ? existingMap[parent.parent_student_id]?.name : undefined,
      requested_child: studentMap[r.student_id],
    };
  }));
});

router.post('/:id/approve', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { data: request, error: fetchErr } = await supabase
    .from('cloud_parent_child_requests').select('*').eq('id', id).single();
  if (fetchErr || !request) return res.status(404).json({ error: 'Request not found.' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'Request already decided.' });

  const { error: linkErr } = await supabase
    .from('cloud_parent_children')
    .upsert({ parent_user_id: request.parent_user_id, student_id: request.student_id }, { onConflict: 'parent_user_id,student_id' });
  if (linkErr) return res.status(500).json({ error: linkErr.message });

  const { error } = await supabase
    .from('cloud_parent_child_requests')
    .update({ status: 'approved', decided_at: new Date().toISOString(), decided_by: req.session.user.id })
    .eq('id', id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

router.post('/:id/reject', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { data: request, error: fetchErr } = await supabase
    .from('cloud_parent_child_requests').select('*').eq('id', id).single();
  if (fetchErr || !request) return res.status(404).json({ error: 'Request not found.' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'Request already decided.' });

  const { error } = await supabase
    .from('cloud_parent_child_requests')
    .update({ status: 'rejected', decided_at: new Date().toISOString(), decided_by: req.session.user.id })
    .eq('id', id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

module.exports = router;
