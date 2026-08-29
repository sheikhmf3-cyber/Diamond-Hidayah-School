require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'diamond-cloud-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const authRoutes = require('./routes/auth');
const reportCardRoutes = require('./routes/reportcards');
const diaryRoutes = require('./routes/diary');
const studentRoutes = require('./routes/students');

app.use('/api/auth', authRoutes);
app.use('/api/reportcards', reportCardRoutes);
app.use('/api/diary', diaryRoutes);
app.use('/api/students', studentRoutes);

// Serve the main SPA for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Diamond School Cloud Portal running on port ${PORT}`);
});
