const express = require('express');
const supabase = require('../db/supabase');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();
router.use(requireLogin);

// Get students filtered by school and class (for dropdowns)
router.get('/', async (req, res) => {
  const { school, class_name } = req.query;
  const user = req.session.user;

  let query = supabase.from('cloud_students').select('id,name,roll_no,class_name,division,school');

  // Admin sees all, teacher sees only their assigned classes
  if (user.role !== 'admin') {
    if (!school || !class_name) return res.json([]);
    // Verify teacher is assigned to this school+class
    const allowed = user.classes.some(c => c.school === school && c.class_name === class_name);
    if (!allowed) return res.status(403).json({ error: 'Not authorized for this class.' });
  }

  if (school) query = query.eq('school', school);
  if (class_name) query = query.eq('class_name', class_name);
  query = query.order('roll_no');

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Get distinct schools and classes (for filter dropdowns)
router.get('/classes', async (req, res) => {
  const user = req.session.user;

  if (user.role === 'admin') {
    const { data, error } = await supabase
      .from('cloud_students')
      .select('school, class_name')
      .order('school')
      .order('class_name');
    if (error) return res.status(500).json({ error: error.message });
    // Deduplicate
    const seen = new Set();
    const unique = (data || []).filter(r => {
      const key = r.school + '||' + r.class_name;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    return res.json(unique);
  }

  // Teacher: return only their assigned classes
  res.json(user.classes || []);
});

module.exports = router;
