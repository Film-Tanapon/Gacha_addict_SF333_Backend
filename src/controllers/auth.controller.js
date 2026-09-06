const { asyncHandler } = require('../middleware/error.middleware');
const authService = require('../services/auth.service');

const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  res.status(201).json(result);
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  res.json(result);
});

const googleLogin = asyncHandler(async (req, res) => {
  const result = await authService.googleLogin(req.body);
  res.json(result);
});

const me = asyncHandler(async (req, res) => {
  const profile = await authService.getProfile(req.user.id);
  res.json(profile);
});

module.exports = { register, login, googleLogin, me };
