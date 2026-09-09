function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not logged in.' });
    }
    return res.redirect('/');
  }
  next();
}

function requireParent(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'parent') {
    return res.status(403).json({ error: 'Parent access only' });
  }
  next();
}

module.exports = { requireLogin, requireParent };
