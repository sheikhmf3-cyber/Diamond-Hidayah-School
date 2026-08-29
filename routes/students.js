const express = require('express');
const supabase = require('../db/supabase');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();
router.use(requireLogin);

// Get students filtered by school and class — sorted by roll_no numerically
router.get('/', async (req, res) => {
  const { school, class_name } = req.query;
  const user = req.session.user;

  let query = supabase.from('cloud_students').select('id,name,roll_no,class_name,division,school');

  if (user.role !== 'admin') {
    if (!school || !class_name) return res.json([]);
    const allowed = user.classes.some(c => c.school === school && c.class_name === class_name);
    if (!allowed) return res.status(403).json({ error: 'Not authorized for this class.' });
  }

  if (school) query = query.eq('school', school);
  if (class_name) query = query.eq('class_name', class_name);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Sort numerically by roll_no (Supabase text sort gives 1,10,11,2... so we sort in JS)
  const sorted = (data || []).sort((a, b) => {
    const an = parseInt(a.roll_no) || 0;
    const bn = parseInt(b.roll_no) || 0;
    return an - bn;
  });

  res.json(sorted);
});

// Get distinct schools and classes for dropdowns
router.get('/classes', async (req, res) => {
  const user = req.session.user;

  if (user.role === 'admin') {
    const { data, error } = await supabase
      .from('cloud_students')
      .select('school, class_name')
      .order('school')
      .order('class_name');
    if (error) return res.status(500).json({ error: error.message });
    const seen = new Set();
    const unique = (data || []).filter(r => {
      const key = r.school + '||' + r.class_name;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    return res.json(unique);
  }

  res.json(user.classes || []);
});

module.exports = router;
