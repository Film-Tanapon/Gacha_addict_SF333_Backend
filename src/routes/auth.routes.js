const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const authController = require('../controllers/auth.controller');

const router = Router();

router.post('/register', authController.register);      // email+password signup
router.post('/login', authController.login);             // email+password login
router.post('/google', authController.googleLogin);      // firebase idToken login
router.get('/me', requireAuth, authController.me);       // current user profile

module.exports = router;
