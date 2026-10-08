const prisma = require("../config/prisma");
const v = require("../utils/input");

// Helper สำหรับสร้าง Error พร้อม HTTP Status Code
function createError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function assertCardOwnership(cardId, userId) {
  const card = await prisma.card.findUnique({
    where: { id: v.integer(cardId, "card id") },
  });
  if (!card) {
    throw createError("Card not found", 404);
  }
  if (card.createBy !== userId) {
    throw createError("You do not own this card", 403);
  }
  return card;
}

async function createCardItem(cardId, userId, data) {
  await assertCardOwnership(cardId, userId);

  const { name, imageUrl, rate } = v.item(data);
  if (!name || !name.trim()) {
    throw createError("name is required", 400);
  }

  // แปลง rate และป้องกันค่าติดลบ
  const parsedRate = rate !== undefined ? rate : 0;

  return prisma.cardItem.create({
    data: {
      cardId: v.integer(cardId, "card id"),
      name: name.trim(),
      imageUrl: imageUrl || null,
      rate: parsedRate,
    },
  });
}

async function listCardItems(cardId) {
  return prisma.cardItem.findMany({
    where: { cardId: v.integer(cardId, "card id") },
    orderBy: { id: "asc" },
  });
}

async function getCardItemById(cardId, itemId) {
  const item = await prisma.cardItem.findFirst({
    where: {
      id: v.integer(itemId, "item id"),
      cardId: v.integer(cardId, "card id"),
    },
  });
  if (!item) {
    throw createError("Card item not found", 404);
  }
  return item;
}

async function updateCardItem(cardId, itemId, userId, data) {
  await assertCardOwnership(cardId, userId);
  await getCardItemById(cardId, itemId);

  const updateData = {};
  if (data.name !== undefined) {
    if (typeof data.name !== "string" || !data.name.trim()) {
      throw createError("name cannot be empty", 400);
    }
    updateData.name = data.name.trim();
  }
  if (data.imageUrl !== undefined) {
    updateData.imageUrl = v.optionalText(data.imageUrl, "imageUrl");
  }
  if (data.rate !== undefined) {
    updateData.rate = v.item({ name: "validation", rate: data.rate }).rate;
  }

  return prisma.cardItem.update({
    where: { id: v.integer(itemId, "item id") },
    data: updateData,
  });
}

async function deleteCardItem(cardId, itemId, userId) {
  await assertCardOwnership(cardId, userId);
  await getCardItemById(cardId, itemId);

  await prisma.cardItem.delete({ where: { id: v.integer(itemId, "item id") } });
}

module.exports = {
  createCardItem,
  listCardItems,
  getCardItemById,
  updateCardItem,
  deleteCardItem,
  assertCardOwnership,
};
