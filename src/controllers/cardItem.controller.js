const { asyncHandler } = require('../middleware/error.middleware');
const cardItemService = require('../services/cardItem.service');

const create = asyncHandler(async (req, res) => {
  const item = await cardItemService.createCardItem(req.params.cardId, req.user.id, req.body);
  res.status(201).json(item);
});

const list = asyncHandler(async (req, res) => {
  const items = await cardItemService.listCardItems(req.params.cardId);
  res.json(items);
});

const getOne = asyncHandler(async (req, res) => {
  const item = await cardItemService.getCardItemById(req.params.cardId, req.params.itemId);
  res.json(item);
});

const update = asyncHandler(async (req, res) => {
  const item = await cardItemService.updateCardItem(req.params.cardId, req.params.itemId, req.user.id, req.body);
  res.json(item);
});

const remove = asyncHandler(async (req, res) => {
  await cardItemService.deleteCardItem(req.params.cardId, req.params.itemId, req.user.id);
  res.status(204).send();
});

module.exports = { create, list, getOne, update, remove };
