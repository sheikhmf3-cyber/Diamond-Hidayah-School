const express = require('express');
const supabase = require('../db/supabase');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();
router.use(requireLogin);

// Get report card for a student+term
router.get('/', async (req, res) => {
  const { student_id, term, academic_year } = req.query;
  if (!student_id || !term) return res.status(400).json({ error: 'student_id and term required.' });

  const ay = academic_year || '2025-26';
  const { data: cards, error } = await supabase
    .from('cloud_report_cards')
    .select('*')
    .eq('student_id', student_id)
    .eq('term', term)
    .eq('academic_year', ay)
    .limit(1);

  if (error) return res.status(500).json({ error: error.message });
  const card = cards && cards[0] ? cards[0] : null;

  let marks = [];
  if (card) {
    const { data: m } = await supabase
      .from('cloud_report_card_marks')
      .select('*')
      .eq('cloud_report_card_id', card.id)
      .order('id');
    marks = m || [];
  }

  res.json({ card, marks });
});

// Save / update report card
router.post('/', async (req, res) => {
  const {
    student_id, term, academic_year,
    attendance_present, attendance_total,
    conduct, remarks, activity, arts, communication,
    discipline, homework, participation, respect,
    teamwork, punctuality, improvement, daily_activity,
    subjects
  } = req.body;

  if (!student_id || !term) return res.status(400).json({ error: 'student_id and term required.' });

  const user = req.session.user;
  const ay = academic_year || '2025-26';

  // Check authorization for non-admin
  if (user.role !== 'admin') {
    const { data: student } = await supabase
      .from('cloud_students')
      .select('school, class_name')
      .eq('id', student_id)
      .single();
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    const allowed = user.classes.some(c => c.school === student.school && c.class_name === student.class_name);
    if (!allowed) return res.status(403).json({ error: 'Not authorized for this student.' });
  }

  const cardData = {
    student_id, term, academic_year: ay,
    attendance_present: attendance_present || 0,
    attendance_total: attendance_total || 0,
    conduct: conduct || '',
    remarks: remarks || '',
    activity: activity || '',
    arts: arts || '',
    communication: communication || '',
    discipline: discipline || '',
    homework: homework || '',
    participation: participation || '',
    respect: respect || '',
    teamwork: teamwork || '',
    punctuality: punctuality || '',
    improvement: improvement || '',
    daily_activity: daily_activity || '',
    created_by: user.id,
    updated_at: new Date().toISOString(),
    synced_at: null  // mark as unsynced so sync agent picks it up
  };

  // Upsert the card
  const { data: upserted, error: upsertErr } = await supabase
    .from('cloud_report_cards')
    .upsert(cardData, { onConflict: 'student_id,term,academic_year' })
    .select()
    .single();

  if (upsertErr) return res.status(500).json({ error: upsertErr.message });

  // Delete old marks and re-insert
  await supabase.from('cloud_report_card_marks').delete().eq('cloud_report_card_id', upserted.id);

  if (Array.isArray(subjects) && subjects.length > 0) {
    const markRows = subjects
      .filter(s => s.subject)
      .map(s => ({
        cloud_report_card_id: upserted.id,
        subject: s.subject,
        marks_obtained: s.marks_obtained ?? null,
        marks_total: s.marks_total ?? null
      }));
    if (markRows.length > 0) {
      await supabase.from('cloud_report_card_marks').insert(markRows);
    }
  }

  res.json({ ok: true, id: upserted.id });
});

module.exports = router;
