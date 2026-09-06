const { asyncHandler } = require('../middleware/error.middleware');
const userService = require('../services/user.service');

const list = asyncHandler(async (req, res) => {
  const users = await userService.listUsers(req.query);
  res.json(users);
});

const getOne = asyncHandler(async (req, res) => {
  const user = await userService.getUserById(req.params.id);
  res.json(user);
});

const update = asyncHandler(async (req, res) => {
  // Users may only edit their own profile
  if (Number(req.params.id) !== req.user.id) {
    return res.status(403).json({ error: 'You can only edit your own profile' });
  }
  const user = await userService.updateUser(req.params.id, req.body);
  res.json(user);
});

const remove = asyncHandler(async (req, res) => {
  if (Number(req.params.id) !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own account' });
  }
  await userService.deleteUser(req.params.id);
  res.status(204).send();
});

module.exports = { list, getOne, update, remove };
