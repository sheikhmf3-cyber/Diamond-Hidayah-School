const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../db/supabase');
const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });

  const { data: users, error } = await supabase
    .from('cloud_users')
    .select('*')
    .eq('username', username.trim())
    .eq('status', 'approved')
    .limit(1);

  if (error || !users || users.length === 0)
    return res.status(401).json({ error: 'Invalid username or password.' });

  const user = users[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid username or password.' });

  // Get teacher's assigned classes
  const { data: classes } = await supabase
    .from('cloud_teacher_classes')
    .select('school, class_name')
    .eq('user_id', user.id);

  req.session.user = {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    allowed_sections: user.allowed_sections || '',
    classes: classes || []
  };

  res.json({ ok: true, user: req.session.user });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ user: req.session.user });
});

module.exports = router;
