const { verifyToken } = require('../utils/jwt');

/**
 * Requires a valid "Authorization: Bearer <token>" header.
 * Attaches { id, email, username } to req.user
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  try {
    const payload = verifyToken(token);
    if (!Number.isSafeInteger(payload.id) || payload.id < 1)
      return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = payload;
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  try {
    const user = await require('../config/prisma').user.findUnique({ where: { id: req.user.id }, select: { id: true, createDate: true, authVersion: true } });
    if (!user || await require('../services/deletionLedger.service').isDeletionRequested(user))
      return res.status(401).json({ error: 'Account no longer exists. Please sign in again.' });
    if ((req.user.authVersion ?? 0) !== user.authVersion)
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    next();
  } catch (error) { next(error); }
}

module.exports = { requireAuth };
