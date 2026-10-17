const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const authController = require('../controllers/auth.controller');

const router = Router();
const { asyncHandler } = require('../middleware/error.middleware');
const reset = require('../services/passwordReset.service');
router.post('/password-reset/request', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store').status(202).json(await reset.requestReset(req.body, req.ip));
}));
router.post('/password-reset/verify', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await reset.verifyCode(req.body, req.ip));
}));
router.post('/password-reset/complete', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await reset.resetPassword(req.body, req.ip));
}));

router.post('/register', authController.register);      // email+password signup
router.post('/login', authController.login);             // email+password login
router.post('/google', authController.googleLogin);      // firebase idToken login
router.get('/me', requireAuth, authController.me);       // current user profile

module.exports = router;
