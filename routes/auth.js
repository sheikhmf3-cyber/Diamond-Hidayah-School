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
  const { name, username, password, classes, phone } = req.body;
  if (!name || !username || !password || !phone)
    return res.status(400).json({ error: 'Name, username, password, and phone number are required.' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });

  const uname = username.trim();
  const { data: existingUser } = await supabase.from('cloud_users').select('id').eq('username', uname).limit(1);
  if (existingUser && existingUser.length) return res.status(400).json({ error: 'Username already taken.' });
  const { data: existingReg } = await supabase.from('cloud_teacher_registrations').select('id').eq('username', uname).is('local_id', null).limit(1);
  if (existingReg && existingReg.length) return res.status(400).json({ error: 'That username already has a pending registration.' });

  const password_hash = await bcrypt.hash(password, 10);
  const { error } = await supabase.from('cloud_teacher_registrations').insert({
    name: name.trim(), username: uname, password_hash, classes: classes || '', phone: phone.trim()
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, message: 'Registered. Pending admin approval.' });
});

// Parent self-registration submitted from the online portal — verified
// against a real cloud_students record (school+class_name+roll_no) at
// signup time, same as the local registration form, so a parent can't
// claim just any child. Staged in cloud_parent_registrations; sync-agent.js
// pulls it into the local `users` table (status='pending') so it shows up
// in the usual local Parent Accounts approval screen.
router.post('/register-parent', async (req, res) => {
  const { name, username, password, school, class_name, roll_no } = req.body;
  if (!name || !username || !password || !school || !class_name || !roll_no)
    return res.status(400).json({ error: 'Name, username, password, school, class and roll number are all required.' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });

  const uname = username.trim();
  const { data: existingUser } = await supabase.from('cloud_users').select('id').eq('username', uname).limit(1);
  if (existingUser && existingUser.length) return res.status(400).json({ error: 'Username already taken.' });
  const { data: existingReg } = await supabase.from('cloud_parent_registrations').select('id').eq('username', uname).is('local_id', null).limit(1);
  if (existingReg && existingReg.length) return res.status(400).json({ error: 'That username already has a pending registration.' });

  const { data: students, error: studentErr } = await supabase
    .from('cloud_students')
    .select('id, name')
    .eq('school', school).eq('class_name', class_name).eq('roll_no', String(roll_no).trim())
    .limit(1);
  if (studentErr) return res.status(500).json({ error: studentErr.message });
  if (!students || !students.length)
    return res.status(400).json({ error: 'No student found with that roll number in that class. Please check the class and roll number, or contact the school office.' });
  const student = students[0];

  const password_hash = await bcrypt.hash(password, 10);
  const { error } = await supabase.from('cloud_parent_registrations').insert({
    name: name.trim(), username: uname, password_hash,
    parent_student_id: student.id, parent_school: school, parent_class_name: class_name, parent_roll_no: String(roll_no).trim()
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, message: `Registered for ${student.name}. Pending admin approval.` });
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
    classes: classes || [],
    parent_student_id: user.parent_student_id || null
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
