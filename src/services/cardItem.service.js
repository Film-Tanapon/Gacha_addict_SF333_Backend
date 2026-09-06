const prisma = require('../config/prisma');

async function assertCardOwnership(cardId, userId) {
  const card = await prisma.card.findUnique({ where: { id: Number(cardId) } });
  if (!card) {
    const err = new Error('Card not found');
    err.status = 404;
    throw err;
  }
  if (card.createBy !== userId) {
    const err = new Error('You do not own this card');
    err.status = 403;
    throw err;
  }
  return card;
}

async function createCardItem(cardId, userId, data) {
  await assertCardOwnership(cardId, userId);

  const { name, imageUrl, rate } = data;
  if (!name) {
    const err = new Error('name is required');
    err.status = 400;
    throw err;
  }

  return prisma.cardItem.create({
    data: {
      cardId: Number(cardId),
      name,
      imageUrl,
      rate: rate !== undefined ? Number(rate) : 0,
    },
  });
}

async function listCardItems(cardId) {
  return prisma.cardItem.findMany({
    where: { cardId: Number(cardId) },
    orderBy: { id: 'asc' },
  });
}

async function getCardItemById(cardId, itemId) {
  const item = await prisma.cardItem.findFirst({
    where: { id: Number(itemId), cardId: Number(cardId) },
  });
  if (!item) {
    const err = new Error('Card item not found');
    err.status = 404;
    throw err;
  }
  return item;
}

async function updateCardItem(cardId, itemId, userId, data) {
  await assertCardOwnership(cardId, userId);
  await getCardItemById(cardId, itemId);

  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
  if (data.rate !== undefined) updateData.rate = Number(data.rate);

  return prisma.cardItem.update({
    where: { id: Number(itemId) },
    data: updateData,
  });
}

async function deleteCardItem(cardId, itemId, userId) {
  await assertCardOwnership(cardId, userId);
  await getCardItemById(cardId, itemId);

  await prisma.cardItem.delete({ where: { id: Number(itemId) } });
}

module.exports = {
  createCardItem,
  listCardItems,
  getCardItemById,
  updateCardItem,
  deleteCardItem,
  assertCardOwnership,
};
