const { Router } = require('express');
const { privacyPage, deletionPage } = require('../views/privacy');
const router = Router();
router.use(['/privacy', '/account-deletion'], (req, res, next) => {
  // These public contact pages must remain usable without Cloudflare's decode script.
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  next();
});
router.get('/privacy', (req, res) => res.type('html').send(privacyPage()));
router.get('/account-deletion', (req, res) => res.type('html').send(deletionPage()));
module.exports = router;
