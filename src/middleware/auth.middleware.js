const { verifyToken } = require('../utils/jwt');

/**
 * Requires a valid "Authorization: Bearer <token>" header.
 * Attaches { id, email, username } to req.user
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  try {
    const payload = verifyToken(token);
    req.user = payload; // { id, email, username }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };
