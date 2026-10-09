const { timingSafeEqual } = require('node:crypto');
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return res.status(503).json({ error: 'Set ADMIN_API_KEY on the server to enable administration' });
  const supplied = req.get('X-Admin-Key') || '';
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: 'Invalid admin key' });
  next();
}
module.exports = { requireAdmin };
