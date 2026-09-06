const { asyncHandler } = require('../middleware/error.middleware');
const cardService = require('../services/card.service');

const create = asyncHandler(async (req, res) => {
  const card = await cardService.createCard(req.user.id, req.body);
  res.status(201).json(card);
});

const list = asyncHandler(async (req, res) => {
  const cards = await cardService.listCards(req.query);
  res.json(cards);
});

const getOne = asyncHandler(async (req, res) => {
  const card = await cardService.getCardById(req.params.id);
  res.json(card);
});

const update = asyncHandler(async (req, res) => {
  const card = await cardService.updateCard(req.params.id, req.user.id, req.body);
  res.json(card);
});

const remove = asyncHandler(async (req, res) => {
  await cardService.deleteCard(req.params.id, req.user.id);
  res.status(204).send();
});

module.exports = { create, list, getOne, update, remove };
