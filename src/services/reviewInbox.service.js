const crypto = require('node:crypto');

const MESSAGE_TTL = 10 * 60 * 1000;
const SESSION_TTL = 30 * 60 * 1000;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

// Ephemeral copies of app-generated mail only. Never connects to a mailbox,
// reads other recipients' messages, changes OTP validation, or writes mail to disk.
function createReviewInbox({ env = () => process.env, clock = Date.now } = {}) {
  let signature;
  let recipientDeleted = false;
  const messages = [];
  const sessions = new Map();
  const attempts = new Map();
  function settings() {
    const values = env();
    const enabled = values.REVIEW_INBOX_ENABLED === 'true';
    const email = normalizeEmail(values.REVIEW_INBOX_EMAIL);
    const password = values.REVIEW_INBOX_PASSWORD || '';
    const originText = (values.REVIEW_INBOX_ORIGIN || '').trim();
    const nextSignature = digest(JSON.stringify([enabled, email, password, originText]));
    if (signature !== nextSignature) {
      messages.length = 0;
      sessions.clear();
      attempts.clear();
      signature = nextSignature;
      recipientDeleted = false;
    }
    if (!enabled) return null;
    let origin;
    if (originText) {
      try {
        const url = new URL(originText);
        if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' ||
            url.search || url.hash || url.hostname.includes('*')) throw new Error('Invalid origin');
        origin = url.origin;
      } catch {
        const error = new Error('Review inbox public origin must be an HTTPS origin without a path.');
        error.status = 503;
        throw error;
      }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
        password.length < 24 || password.length > 256 ||
        email === normalizeEmail(values.SMTP_USER)) {
      const error = new Error('Review inbox configuration is incomplete.');
      error.status = 503;
      throw error;
    }
    return { email, password, origin };
  }
  function prune() {
    const now = clock();
    for (let i = messages.length - 1; i >= 0; i--)
      if (messages[i].expiresAt <= now) messages.splice(i, 1);
    for (const [key, value] of sessions) if (value.expiresAt <= now) sessions.delete(key);
    for (const [key, value] of attempts) if (value.expiresAt <= now) attempts.delete(key);
  }
  function record(message, kind) {
    let config;
    try { config = settings(); } catch { return false; }
    if (!config || recipientDeleted || normalizeEmail(message.to) !== config.email ||
        !['reset-code', 'password-changed'].includes(kind)) return false;
    prune();
    // A resend supersedes older codes for this one test account.
    if (kind === 'reset-code') {
      for (let i = messages.length - 1; i >= 0; i--)
        if (messages[i].kind === kind) messages.splice(i, 1);
    }
    messages.unshift({ kind, to: config.email, subject: String(message.subject).slice(0, 300),
      text: String(message.text).slice(0, 12000), receivedAt: clock(), expiresAt: clock() + MESSAGE_TTL });
    messages.splice(10);
    return true;
  }
  function login(email, password, ip) {
    const config = settings();
    if (!config || recipientDeleted) return null;
    prune();
    const keys = ['global', `ip:${digest(String(ip))}`];
    for (const key of keys) {
      const limit = key === 'global' ? 100 : 10;
      const bucket = attempts.get(key);
      if (bucket && bucket.count >= limit) {
        const error = new Error('Too many sign-in attempts. Please try again later.');
        error.status = 429;
        error.retryAfter = Math.max(1, Math.ceil((bucket.expiresAt - clock()) / 1000));
        throw error;
      }
    }
    for (const key of keys) {
      // The global bucket bounds storage even when IPs change.
      const bucket = attempts.get(key) || { count: 0, expiresAt: clock() + 15 * 60 * 1000 };
      bucket.count++;
      attempts.set(key, bucket);
    }
    const supplied = typeof password === 'string' && password.length <= 256 ? password : '';
    const matches = crypto.timingSafeEqual(Buffer.from(digest(supplied), 'hex'), Buffer.from(digest(config.password), 'hex'));
    if (!matches || normalizeEmail(email) !== config.email) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(24).toString('base64url');
    if (sessions.size >= 20) sessions.delete(sessions.keys().next().value);
    sessions.set(digest(token), { csrf, expiresAt: clock() + SESSION_TTL });
    return token;
  }
  function session(token) {
    const config = settings();
    if (!config || typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) return null;
    prune();
    const found = sessions.get(digest(token));
    return found ? { email: config.email, csrf: found.csrf } : null;
  }
  function list(token) { return session(token) ? messages.map(message => ({ ...message })) : null; }
  function logout(token) { if (typeof token === 'string') sessions.delete(digest(token)); }
  function clearForRecipient(email) {
    let config;
    try { config = settings(); } catch { return; }
    if (config && normalizeEmail(email) === config.email) {
      messages.length = 0;
      sessions.clear();
      // Also reject an SMTP send that was already in flight when deletion committed.
      recipientDeleted = true;
    }
  }
  const timer = setInterval(prune, 30000);
  timer.unref();
  return { settings, record, login, session, list, logout, clearForRecipient, stop: () => clearInterval(timer) };
}

module.exports = { createReviewInbox, ...createReviewInbox() };
