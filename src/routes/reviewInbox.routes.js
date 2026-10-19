const express = require('express');
const inbox = require('../services/reviewInbox.service');
const { reviewInboxPage } = require('../views/reviewInbox');
const COOKIE = '__Host-gacha_review';
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' };

function createReviewInboxRouter(service = inbox) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store, no-transform', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
    let config;
    try {
      config = service.settings();
      if (!config) return res.sendStatus(404);
    } catch { return res.status(503).type('text').send('Review inbox configuration is incomplete. Contact the developer.'); }
    // Never accept cross-site submissions, including login CSRF.
    if (req.method === 'POST') {
      const origin = req.get('origin');
      if (req.get('sec-fetch-site') === 'cross-site')
        return res.status(403).type('text').send('Forbidden: cross-site submission. Open the review inbox directly and sign in again.');
      // An explicit public origin survives proxy scheme/Host rewriting. Never
      // derive this allowlist from the submitted Origin or an untrusted header.
      const expectedOrigin = config.origin || `${req.protocol}://${req.get('host')}`;
      if (origin && origin !== expectedOrigin)
        return res.status(403).type('text').send('Forbidden: request origin mismatch. Check REVIEW_INBOX_ORIGIN and reverse-proxy headers.');
    }
    next();
  });
  router.use(express.urlencoded({ extended: false, limit: '2kb' }));
  function token(req) {
    const cookies = (req.get('cookie') || '').split(';').map(value => value.trim());
    return cookies.find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  }
  router.get('/', (req, res) => {
    const session = service.session(token(req));
    res.type('html').send(reviewInboxPage({ session, messages: session ? service.list(token(req)) : [] }));
  });
  router.post('/login', (req, res) => {
    const issued = service.login(req.body?.email, req.body?.password, req.ip);
    if (!issued) return res.status(401).type('html').send(reviewInboxPage({ error: 'Incorrect email or inbox password.' }));
    res.cookie(COOKIE, issued, { ...cookieOptions, maxAge: 30 * 60 * 1000 });
    res.redirect(303, '/review-inbox');
  });
  router.post('/logout', (req, res) => {
    const session = service.session(token(req));
    if (!session || typeof req.body?.csrf !== 'string' || req.body.csrf !== session.csrf) return res.sendStatus(403);
    service.logout(token(req));
    res.clearCookie(COOKIE, cookieOptions);
    res.redirect(303, '/review-inbox');
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.status === 429) res.set('Retry-After', String(error.retryAfter));
    const status = [400, 413, 429].includes(error.status) ? error.status : 503;
    res.status(status).type('text').send(status === 429 ? 'Too many sign-in attempts. Please try again later.' : 'Review inbox request could not be completed.');
  });
  return router;
}
module.exports = { createReviewInboxRouter };
