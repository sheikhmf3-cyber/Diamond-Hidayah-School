const express = require('express');
const supabase = require('../db/supabase');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();
router.use(requireLogin);

// Get diary entries
router.get('/', async (req, res) => {
  const { student_id, date, school, class_name, from, to } = req.query;
  if (!student_id && !school && !date && !from) return res.json([]);

  let query = supabase
    .from('cloud_daily_diary')
    .select(`*, cloud_students(name, roll_no, class_name, division, school)`)
    .order('entry_date', { ascending: false });

  if (student_id) query = query.eq('student_id', student_id);
  if (date) query = query.eq('entry_date', date);
  if (from) query = query.gte('entry_date', from);
  if (to) query = query.lte('entry_date', to);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Filter by school/class via joined student data
  let rows = data || [];
  if (school) rows = rows.filter(r => r.cloud_students?.school === school);
  if (class_name) rows = rows.filter(r => r.cloud_students?.class_name === class_name);

  // Flatten for compatibility with local format
  const flat = rows.map(r => ({
    ...r,
    student_id: String(r.student_id),
    student_name: r.cloud_students?.name,
    roll_no: r.cloud_students?.roll_no,
    class_name: r.cloud_students?.class_name,
    division: r.cloud_students?.division,
    school: r.cloud_students?.school,
    cloud_students: undefined
  }));

  res.json(flat);
});

// Save / update single diary entry
router.post('/', async (req, res) => {
  const { student_id, entry_date, activity, behaviour, homework, classwork, remarks } = req.body;
  if (!student_id || !entry_date) return res.status(400).json({ error: 'student_id and entry_date required.' });

  const user = req.session.user;

  // Auth check for teachers
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

  const entryData = {
    student_id, entry_date,
    activity: activity || '',
    behaviour: behaviour || '',
    homework: homework || '',
    classwork: classwork || '',
    remarks: remarks || '',
    recorded_by: user.id,
    updated_at: new Date().toISOString(),
    synced_at: null
  };

  const { data, error } = await supabase
    .from('cloud_daily_diary')
    .upsert(entryData, { onConflict: 'student_id,entry_date' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, id: data.id });
});

// Bulk save (whole class at once)
router.post('/bulk', async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0)
    return res.status(400).json({ error: 'entries array required.' });

  const user = req.session.user;
  let saved = 0;
  let skipped = 0;

  for (const en of entries) {
    if (!en || !en.student_id || !en.entry_date) { skipped++; continue; }

    if (user.role !== 'admin') {
      const { data: student } = await supabase
        .from('cloud_students')
        .select('school, class_name')
        .eq('id', en.student_id)
        .single();
      if (!student) { skipped++; continue; }
      const allowed = user.classes.some(c => c.school === student.school && c.class_name === student.class_name);
      if (!allowed) { skipped++; continue; }
    }

    const { error } = await supabase
      .from('cloud_daily_diary')
      .upsert({
        student_id: en.student_id,
        entry_date: en.entry_date,
        activity: en.activity || '',
        behaviour: en.behaviour || '',
        homework: en.homework || '',
        classwork: en.classwork || '',
        remarks: en.remarks || '',
        recorded_by: user.id,
        updated_at: new Date().toISOString(),
        synced_at: null
      }, { onConflict: 'student_id,entry_date' });

    if (!error) saved++; else skipped++;
  }

  res.json({ ok: true, saved, skipped });
});

module.exports = router;
