const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const resultController = require('../controllers/result.controller');

const router = Router();

router.use(requireAuth);

router.get('/', resultController.list);       // my gacha pull history
router.get('/:id', resultController.getOne);
router.delete('/:id', resultController.remove);

module.exports = router;
