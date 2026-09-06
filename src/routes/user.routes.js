const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const userController = require('../controllers/user.controller');

const router = Router();

router.use(requireAuth);

router.get('/', userController.list);
router.get('/:id', userController.getOne);
router.put('/:id', userController.update);
router.delete('/:id', userController.remove);

module.exports = router;
