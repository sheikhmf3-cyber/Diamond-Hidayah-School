function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not logged in.' });
    }
    return res.redirect('/');
  }
  next();
}

module.exports = { requireLogin };
