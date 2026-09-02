const express = require('express');
const bcrypt = require('bcryptjs');
const supabase = require('../db/supabase');
const router = express.Router();

// New-teacher registration submitted from the online portal. Approval must
// stay a LOCAL admin action — this only stages the request in
// cloud_teacher_registrations; sync-agent.js on the school PC pulls it into
// the local `users` table (status='pending') so it shows up in the usual
// local approval screen. Once approved locally, the existing users push
// carries it back up to cloud_users so the teacher can log in here too.
router.post('/register', async (req, res) => {
  const { name, username, password, classes } = req.body;
  if (!name || !username || !password)
    return res.status(400).json({ error: 'Name, username, and password are required.' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });

  const uname = username.trim();
  const { data: existingUser } = await supabase.from('cloud_users').select('id').eq('username', uname).limit(1);
  if (existingUser && existingUser.length) return res.status(400).json({ error: 'Username already taken.' });
  const { data: existingReg } = await supabase.from('cloud_teacher_registrations').select('id').eq('username', uname).is('local_id', null).limit(1);
  if (existingReg && existingReg.length) return res.status(400).json({ error: 'That username already has a pending registration.' });

  const password_hash = await bcrypt.hash(password, 10);
  const { error } = await supabase.from('cloud_teacher_registrations').insert({
    name: name.trim(), username: uname, password_hash, classes: classes || ''
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, message: 'Registered. Pending admin approval.' });
});

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
