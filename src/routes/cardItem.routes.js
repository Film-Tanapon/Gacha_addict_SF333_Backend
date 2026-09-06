const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const cardItemController = require('../controllers/cardItem.controller');

// mergeParams so we can read :cardId from the parent router
const router = Router({ mergeParams: true });

router.get('/', cardItemController.list);
router.get('/:itemId', cardItemController.getOne);
router.post('/', requireAuth, cardItemController.create);
router.put('/:itemId', requireAuth, cardItemController.update);
router.delete('/:itemId', requireAuth, cardItemController.remove);

module.exports = router;
