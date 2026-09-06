const prisma = require('../config/prisma');

async function createCard(userId, data) {
  const { title, cardImage, frame, isEqualRate, animation } = data;
  if (!title) {
    const err = new Error('title is required');
    err.status = 400;
    throw err;
  }

  return prisma.card.create({
    data: {
      title,
      cardImage,
      frame,
      isEqualRate: !!isEqualRate,
      animation,
      createBy: userId,
    },
  });
}

async function listCards({ skip = 0, take = 20 } = {}) {
  return prisma.card.findMany({
    skip: Number(skip),
    take: Number(take),
    orderBy: { id: 'desc' },
    include: { cardItems: true },
  });
}

async function getCardById(id) {
  const card = await prisma.card.findUnique({
    where: { id: Number(id) },
    include: { cardItems: true },
  });
  if (!card) {
    const err = new Error('Card not found');
    err.status = 404;
    throw err;
  }
  return card;
}

async function updateCard(id, userId, data) {
  const card = await prisma.card.findUnique({ where: { id: Number(id) } });
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

  const updateData = {};
  ['title', 'cardImage', 'frame', 'isEqualRate', 'animation'].forEach((field) => {
    if (data[field] !== undefined) updateData[field] = data[field];
  });

  return prisma.card.update({
    where: { id: Number(id) },
    data: updateData,
    include: { cardItems: true },
  });
}

async function deleteCard(id, userId) {
  const card = await prisma.card.findUnique({ where: { id: Number(id) } });
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

  await prisma.card.delete({ where: { id: Number(id) } });
}

module.exports = { createCard, listCards, getCardById, updateCard, deleteCard };
