const prisma = require('../config/prisma');
const { pullGacha } = require('../utils/gacha');

const MAX_PULLS_PER_REQUEST = 10;

async function pullCard(cardId, userId, count = 1) {
  const pullCount = Math.min(Math.max(Number(count) || 1, 1), MAX_PULLS_PER_REQUEST);

  const card = await prisma.card.findUnique({
    where: { id: Number(cardId) },
    include: { cardItems: true },
  });
  if (!card) {
    const err = new Error('Card not found');
    err.status = 404;
    throw err;
  }
  if (card.cardItems.length === 0) {
    const err = new Error('This card has no items configured yet');
    err.status = 400;
    throw err;
  }

  const drawnItems = pullGacha(card.cardItems, card.isEqualRate, pullCount);

  // Persist one Result row per draw, then return them with item details
  const created = await prisma.$transaction(
    drawnItems.map((item) =>
      prisma.result.create({
        data: {
          cardItemId: item.id,
          createBy: userId,
        },
        include: { cardItem: true },
      })
    )
  );

  return created;
}

async function listResults(userId, { skip = 0, take = 20 } = {}) {
  return prisma.result.findMany({
    where: { createBy: userId },
    include: { cardItem: { include: { card: true } } },
    orderBy: { timestamp: 'desc' },
    skip: Number(skip),
    take: Number(take),
  });
}

async function getResultById(id, userId) {
  const result = await prisma.result.findUnique({
    where: { id: Number(id) },
    include: { cardItem: { include: { card: true } } },
  });
  if (!result) {
    const err = new Error('Result not found');
    err.status = 404;
    throw err;
  }
  if (result.createBy !== userId) {
    const err = new Error('You do not own this result');
    err.status = 403;
    throw err;
  }
  return result;
}

async function deleteResult(id, userId) {
  const result = await prisma.result.findUnique({ where: { id: Number(id) } });
  if (!result) {
    const err = new Error('Result not found');
    err.status = 404;
    throw err;
  }
  if (result.createBy !== userId) {
    const err = new Error('You do not own this result');
    err.status = 403;
    throw err;
  }
  await prisma.result.delete({ where: { id: Number(id) } });
}

module.exports = { pullCard, listResults, getResultById, deleteResult, MAX_PULLS_PER_REQUEST };
