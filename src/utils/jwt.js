const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const unsafeDefaults = new Set([
  'dev_secret_change_me', 'change_me', 'changeme', 'secret', 'jwt_secret',
  'your_jwt_secret', 'your_jwt_secret_here', 'replace_me',
  'change_me_to_a_long_random_secret',
]);
if (typeof SECRET !== 'string' || !SECRET.trim() || unsafeDefaults.has(SECRET.trim().toLowerCase())) {
  // Do not include the configured value in errors or silently replace the key.
  throw new Error('JWT_SECRET must be configured with a non-default secret before starting the backend.');
}
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { signToken, verifyToken };
