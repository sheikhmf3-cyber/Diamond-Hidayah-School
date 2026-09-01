// routes/unittests.js — Cloud version for online teacher portal
const express = require('express');
const supabase = require('../db/supabase');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();
router.use(requireLogin);

// ── Same subject/parts config as local system ─────────────────
function wo(name, writingMax, oralMax) {
  return { name, parts: [{ key: 'part1', label: 'Writing', max: writingMax }, { key: 'part2', label: 'Oral', max: oralMax }] };
}

const UNIT_TEST_GROUPS = {
  grp12: {
    classes: ['1st', '2nd'],
    subjects: [
      wo('ENG', 20, 5), wo('HINDI', 20, 5), wo('MARATHI', 20, 5), wo('MATHS', 20, 5), wo('EVS', 20, 5),
      wo('COMPUTER', 20, 5), wo('DRAWING', 20, 5), wo('CRAFT', 20, 5), wo('ISLAMIC', 20, 5), wo('ARABIC WRITING', 20, 5),
      { name: 'ARABIC ORAL', parts: [{ key: 'part1', label: 'Qaida', max: 5 }, { key: 'part2', label: 'Dua', max: 10 }, { key: 'part3', label: 'Surah', max: 10 }] },
    ],
  },
  grp35: {
    classes: ['3rd', '4th', '5th'],
    subjects: [
      wo('ENG', 20, 10), wo('HINDI', 20, 10), wo('MARATHI', 20, 10), wo('MATHS', 20, 10),
      wo('EVS-1', 20, 10), wo('EVS-2', 20, 10), wo('COMPUTER', 20, 10), wo('DRAWING', 20, 10),
      wo('CRAFT', 20, 10), wo('ISLAMIC', 20, 10), wo('ARABIC WRITING', 20, 10),
      { name: 'ARABIC ORAL', parts: [{ key: 'part1', label: 'Qaida', max: 10 }, { key: 'part2', label: 'Dua', max: 10 }, { key: 'part3', label: 'Surah', max: 10 }] },
    ],
  },
  grp6: {
    classes: ['6th'],
    subjects: [
      wo('ENG', 20, 10), wo('HINDI', 20, 10), wo('MARATHI', 20, 10), wo('MATHS', 20, 10),
      wo('SCIENCE', 20, 10), wo('SST', 20, 10), wo('COMPUTER', 20, 10), wo('ISLAMIC', 20, 10), wo('ARABIC WRITING', 20, 10),
      { name: 'DRAWING & CRAFT', parts: [{ key: 'part1', label: 'Drawing', max: 20 }, { key: 'part2', label: 'Craft', max: 10 }] },
      { name: 'ARABIC ORAL', parts: [{ key: 'part1', label: 'Surah', max: 10 }, { key: 'part2', label: 'Nazera', max: 5 }, { key: 'part3', label: 'Dua', max: 5 }, { key: 'part4', label: 'Hadith', max: 5 }] },
    ],
  },
  grp78: {
    classes: ['7th', '8th'],
    subjects: [
      wo('ENG', 20, 10), wo('HINDI', 20, 10), wo('MARATHI', 20, 10), wo('MATHS', 20, 10),
      wo('SCIENCE', 20, 10), wo('SST', 20, 10), wo('COMPUTER', 20, 10), wo('ISLAMIC', 20, 10), wo('ARABIC WRITING', 20, 10),
      { name: 'DRAWING & CRAFT', parts: [{ key: 'part1', label: 'Drawing', max: 20 }, { key: 'part2', label: 'Craft', max: 10 }] },
      { name: 'ARABIC ORAL', parts: [{ key: 'part1', label: 'Surah', max: 10 }, { key: 'part2', label: 'Nazera', max: 5 }, { key: 'part3', label: 'Tajweed', max: 5 }, { key: 'part4', label: 'Dua', max: 5 }, { key: 'part5', label: 'Hadith', max: 5 }] },
    ],
  },
  grp910: {
    classes: ['9th', '10th'],
    subjects: ['ENG', 'HINDI', 'MARATHI', 'M1', 'M2', 'S1', 'S2', 'GEOGRAPHY', 'HISTORY & POLITICAL SCIENCE'].map(n => wo(n, 20, 10)),
  },
};

function groupForClass(cls) {
  if (!cls) return null;
  const c = String(cls).trim();
  for (const key of Object.keys(UNIT_TEST_GROUPS)) {
    if (UNIT_TEST_GROUPS[key].classes.includes(c)) return UNIT_TEST_GROUPS[key];
  }
  return null;
}

function clampMark(val, max) {
  if (val === '' || val === null || val === undefined) return '';
  const n = parseFloat(val);
  if (isNaN(n)) return '';
  return String(Math.min(Math.max(n, 0), max));
}

const ALL_PART_KEYS = ['part1', 'part2', 'part3', 'part4', 'part5'];

// ── GET /api/unittests — fetch marks for a class+test ─────────
router.get('/', async (req, res) => {
  const { school, class_name, test_name, academic_year } = req.query;
  if (!test_name || !academic_year) return res.status(400).json({ error: 'test_name and academic_year required.' });

  let query = supabase
    .from('cloud_unit_test_marks')
    .select('*, cloud_students(name, roll_no, class_name, school)')
    .eq('test_name', test_name)
    .eq('academic_year', academic_year);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  let rows = data || [];
  if (school) rows = rows.filter(r => r.cloud_students?.school === school);
  if (class_name) rows = rows.filter(r => r.cloud_students?.class_name === class_name);

  // Flatten
  const flat = rows.map(r => ({
    ...r,
    student_name: r.cloud_students?.name,
    roll_no: r.cloud_students?.roll_no,
    class_name: r.cloud_students?.class_name,
    school: r.cloud_students?.school,
    cloud_students: undefined
  }));

  res.json(flat);
});

// ── GET /api/unittests/config — return subject/parts config for a class ──
router.get('/config', (req, res) => {
  const { class_name } = req.query;
  const grp = groupForClass(class_name);
  if (!grp) return res.json({ subjects: [] });
  res.json({ subjects: grp.subjects });
});

// ── POST /api/unittests/bulk — save whole class marks ─────────
router.post('/bulk', async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || !entries.length)
    return res.status(400).json({ error: 'entries array required.' });

  const user = req.session.user;
  let saved = 0, skipped = 0;

  for (const en of entries) {
    if (!en.student_id || !en.test_name || !en.subject || !en.academic_year) { skipped++; continue; }

    // Auth check for teachers
    if (user.role !== 'admin') {
      const { data: student } = await supabase.from('cloud_students').select('school,class_name').eq('id', en.student_id).single();
      if (!student) { skipped++; continue; }
      const allowed = user.classes.some(c => c.school === student.school && c.class_name === student.class_name);
      if (!allowed) { skipped++; continue; }
    }

    // Get class for clamping
    const { data: student } = await supabase.from('cloud_students').select('class_name').eq('id', en.student_id).single();
    const grp = student ? groupForClass(student.class_name) : null;
    const subjDef = grp ? grp.subjects.find(s => s.name === en.subject) : null;

    const parts = {};
    ALL_PART_KEYS.forEach(key => { parts[key] = ''; });

    if (subjDef) {
      subjDef.parts.forEach(p => { parts[p.key] = clampMark(en[`${p.key}_marks`], p.max); });
    } else {
      ALL_PART_KEYS.forEach(key => { parts[key] = en[`${key}_marks`] || ''; });
    }

    // Compute obtained from parts
    const obtained = String(ALL_PART_KEYS.reduce((a, key) => a + (parseFloat(parts[key]) || 0), 0));
    const total = subjDef ? String(subjDef.parts.reduce((a, p) => a + p.max, 0)) : (en.total_marks || '');

    const row = {
      student_id: en.student_id,
      academic_year: en.academic_year,
      test_name: en.test_name,
      subject: en.subject,
      total_marks: total,
      obtained_marks: obtained,
      part1_marks: parts.part1,
      part2_marks: parts.part2,
      part3_marks: parts.part3,
      part4_marks: parts.part4,
      part5_marks: parts.part5,
      recorded_by: user.id,
      updated_at: new Date().toISOString(),
      synced_at: null
    };

    const { error } = await supabase
      .from('cloud_unit_test_marks')
      .upsert(row, { onConflict: 'student_id,academic_year,test_name,subject' });

    if (!error) saved++; else { console.error('UT upsert error:', error.message); skipped++; }
  }

  res.json({ ok: true, saved, skipped });
});

// GET /api/unittests/remarks — list saved remarks for a class's test+report-type
router.get('/remarks', async (req, res) => {
  const { school, class_name, academic_year, test_name, report_type } = req.query;
  if (!academic_year || !test_name || !report_type) return res.status(400).json({ error: 'academic_year, test_name and report_type required.' });

  const { data: remarks, error } = await supabase
    .from('cloud_unit_test_remarks')
    .select('*, cloud_students(school, class_name)')
    .eq('academic_year', academic_year)
    .eq('test_name', test_name)
    .eq('report_type', report_type);
  if (error) return res.status(500).json({ error: error.message });

  let rows = remarks || [];
  if (school) rows = rows.filter(r => r.cloud_students?.school === school);
  if (class_name) rows = rows.filter(r => r.cloud_students?.class_name === class_name);
  res.json(rows.map(r => ({ student_id: r.student_id, remarks: r.remarks })));
});

// POST /api/unittests/remarks — save (create or update) one student's remark
router.post('/remarks', async (req, res) => {
  const { student_id, academic_year, test_name, report_type, remarks } = req.body;
  if (!student_id || !academic_year || !test_name || !report_type)
    return res.status(400).json({ error: 'student_id, academic_year, test_name and report_type required.' });

  const user = req.session.user;
  if (user.role !== 'admin') {
    const { data: student } = await supabase.from('cloud_students').select('school,class_name').eq('id', student_id).single();
    if (!student) return res.status(404).json({ error: 'Student not found.' });
    const allowed = user.classes.some(c => c.school === student.school && c.class_name === student.class_name);
    if (!allowed) return res.status(403).json({ error: "Not authorized for this student's class." });
  }

  const { error } = await supabase
    .from('cloud_unit_test_remarks')
    .upsert({
      student_id, academic_year, test_name, report_type,
      remarks: remarks || '', recorded_by: user.id, updated_at: new Date().toISOString()
    }, { onConflict: 'student_id,academic_year,test_name,report_type' });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
