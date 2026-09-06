const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const cardController = require('../controllers/card.controller');
const resultController = require('../controllers/result.controller');
const cardItemRoutes = require('./cardItem.routes');

const router = Router();

router.get('/', cardController.list);
router.get('/:id', cardController.getOne);
router.post('/', requireAuth, cardController.create);
router.put('/:id', requireAuth, cardController.update);
router.delete('/:id', requireAuth, cardController.remove);

// Gacha pull on a specific card
router.post('/:cardId/pull', requireAuth, resultController.pull);

// Nested card items CRUD: /api/cards/:cardId/items
router.use('/:cardId/items', cardItemRoutes);

module.exports = router;
