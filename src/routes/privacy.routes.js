const { Router } = require('express');
const { privacyPage, deletionPage } = require('../views/privacy');
const router = Router();
router.use(['/privacy', '/account-deletion'], (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  next();
});
router.get('/privacy', (req, res) => res.type('html').send(privacyPage()));
router.get('/account-deletion', (req, res) => res.type('html').send(deletionPage()));
module.exports = router;
