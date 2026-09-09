// routes/parent.js — Cloud version. Same privacy rule as the local system:
// the student is always taken from req.session.user.parent_student_id,
// never from a query/body param, so a parent can never request another
// family's records.
const express = require('express');
const supabase = require('../db/supabase');
const { requireLogin, requireParent } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin, requireParent);

function academicYear() {
  const now = new Date();
  const m = now.getMonth();
  const y = now.getFullYear();
  const start = m >= 5 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

const TERM_GRADE_SCALE = [
  [91, 100, 'A1'], [81, 90, 'A2'], [71, 80, 'B1'], [61, 70, 'B2'],
  [51, 60, 'C1'], [41, 50, 'C2'], [33, 40, 'D'], [21, 32, 'E1'], [0, 20, 'E2'],
];
const TERM_GRADE_REMARK = { A1: 'Excellent', A2: 'Excellent', B1: 'Very Good', B2: 'Very Good', C1: 'Good', C2: 'Good', D: 'Satisfactory', E1: 'Needs Improvement', E2: 'Needs Improvement' };
function termGrade(pct) {
  if (pct === null || pct === undefined || isNaN(pct)) return '';
  for (const [lo, hi, g] of TERM_GRADE_SCALE) if (pct >= lo && pct <= hi) return g;
  return '';
}

const UT_GRADE_REMARKS = {
  A1: 'Outstanding performance', A2: 'Excellent performance', B1: 'Very good performance',
  B2: 'Good performance', C1: 'Above average performance', C2: 'Average performance',
  D: 'Marginal/Passing grade', E: 'Needs improvement (Failed)',
};
function utGrade(pct) {
  if (pct === null || pct === undefined || isNaN(pct)) return '';
  if (pct >= 91) return 'A1';
  if (pct >= 81) return 'A2';
  if (pct >= 71) return 'B1';
  if (pct >= 61) return 'B2';
  if (pct >= 51) return 'C1';
  if (pct >= 41) return 'C2';
  if (pct >= 33) return 'D';
  return 'E';
}

const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

async function myStudent(req) {
  const id = req.session.user.parent_student_id;
  if (!id) return null;
  const { data } = await supabase.from('cloud_students').select('*').eq('id', id).single();
  return data || null;
}

router.get('/me', async (req, res) => {
  const s = await myStudent(req);
  if (!s) return res.status(404).json({ error: 'No linked student found for this account. Please contact the school office.' });
  res.json({ student: s, extra: null });
});

router.get('/result', async (req, res) => {
  const s = await myStudent(req);
  if (!s) return res.status(404).json({ error: 'No linked student found for this account. Please contact the school office.' });
  const exam = req.query.exam;
  const academic_year = req.query.academic_year || academicYear();
  const validExams = ['unit_test_1', 'unit_test_2', 'term_1', 'term_2'];
  if (!validExams.includes(exam)) return res.status(400).json({ error: 'exam must be one of: ' + validExams.join(', ') });

  try {
    if (exam === 'unit_test_1' || exam === 'unit_test_2') {
      const testName = exam === 'unit_test_1' ? 'Unit Test 1' : 'Unit Test 2';
      const { data: rows, error } = await supabase
        .from('cloud_unit_test_marks')
        .select('subject, total_marks, obtained_marks')
        .eq('student_id', s.id).eq('academic_year', academic_year).eq('test_name', testName)
        .order('id');
      if (error) throw error;
      const subjects = (rows || []).map(r => ({ subject: r.subject, total: num(r.total_marks), obtained: num(r.obtained_marks) }));
      const grand_total = subjects.reduce((a, r) => a + r.total, 0);
      const obtained_total = subjects.reduce((a, r) => a + r.obtained, 0);
      const percentage = grand_total > 0 ? Math.round((obtained_total / grand_total) * 10000) / 100 : 0;
      const { data: remarkRows } = await supabase
        .from('cloud_unit_test_remarks')
        .select('remarks, report_type')
        .eq('student_id', s.id).eq('academic_year', academic_year).eq('test_name', testName);
      const remarkRow = (remarkRows || []).sort((a, b) => (b.report_type === 'combined') - (a.report_type === 'combined'))[0];
      return res.json({
        exam, exam_label: testName, academic_year, subjects,
        grand_total, obtained_total, percentage,
        grade: utGrade(percentage),
        remarks: (remarkRow && remarkRow.remarks) || UT_GRADE_REMARKS[utGrade(percentage)] || '',
      });
    }

    const termNum = exam === 'term_1' ? 1 : 2;
    const col = termNum === 1 ? ['max1', 'obtained1'] : ['max2', 'obtained2'];
    const { data: result } = await supabase
      .from('cloud_results').select('*')
      .eq('student_id', s.id).eq('academic_year', academic_year).maybeSingle();
    let subjects = [];
    if (result) {
      const { data: subjRows } = await supabase
        .from('cloud_result_subjects')
        .select(`subject, ${col[0]}, ${col[1]}`)
        .eq('cloud_result_id', result.id).order('id');
      subjects = (subjRows || []).map(r => ({ subject: r.subject, total: num(r[col[0]]), obtained: num(r[col[1]]) }));
    }
    const grand_total = subjects.reduce((a, r) => a + r.total, 0);
    const obtained_total = subjects.reduce((a, r) => a + r.obtained, 0);
    const percentage = grand_total > 0 ? Math.round((obtained_total / grand_total) * 10000) / 100 : 0;
    return res.json({
      exam, exam_label: termNum === 1 ? 'Term 1' : 'Term 2', academic_year, subjects,
      grand_total, obtained_total, percentage,
      grade: termGrade(percentage),
      remarks: (result && result.remarks) || TERM_GRADE_REMARK[termGrade(percentage)] || '',
    });
  } catch (e) {
    console.error('GET /parent/result error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/diary', async (req, res) => {
  const s = await myStudent(req);
  if (!s) return res.status(404).json({ error: 'No linked student found for this account. Please contact the school office.' });
  const { from, to } = req.query;
  let q = supabase.from('cloud_daily_diary').select('*').eq('student_id', s.id);
  if (from) q = q.gte('entry_date', from);
  if (to) q = q.lte('entry_date', to);
  const { data, error } = await q.order('entry_date', { ascending: false }).limit(60);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

module.exports = router;
