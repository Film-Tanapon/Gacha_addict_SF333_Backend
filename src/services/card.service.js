const prisma = require('../config/prisma');

// Helper สำหรับสร้าง Error พร้อม HTTP Status
function createError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function createCard(userId, data) {
  const { title, cardImage, frame, isEqualRate, animation } = data;
  
  if (!title || !title.trim()) {
    throw createError('title is required', 400);
  }

  return prisma.card.create({
    data: {
      title: title.trim(),
      cardImage: cardImage || null,
      frame: frame || null,
      isEqualRate: Boolean(isEqualRate),
      animation: animation || null,
      createBy: userId,
    },
  });
}

async function listCards({ skip = 0, take = 20 } = {}) {
  // ป้องกัน skip ติดลบ และจำกัด take สูงสุดไม่เกิน 100 รายการ
  const parsedSkip = Math.max(0, Number(skip) || 0);
  const parsedTake = Math.min(100, Math.max(1, Number(take) || 20));

  return prisma.card.findMany({
    skip: parsedSkip,
    take: parsedTake,
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
    throw createError('Card not found', 404);
  }
  
  return card;
}

async function updateCard(id, userId, data) {
  const card = await prisma.card.findUnique({ where: { id: Number(id) } });
  
  if (!card) {
    throw createError('Card not found', 404);
  }
  
  if (card.createBy !== userId) {
    throw createError('You do not own this card', 403);
  }

  const updateData = {};
  if (data.title !== undefined) updateData.title = data.title.trim();
  if (data.cardImage !== undefined) updateData.cardImage = data.cardImage;
  if (data.frame !== undefined) updateData.frame = data.frame;
  
  // แปลง isEqualRate เป็น Boolean ให้ถูกต้องเมื่อมีการส่งค่ามาอัปเดต
  if (data.isEqualRate !== undefined) updateData.isEqualRate = Boolean(data.isEqualRate);
  if (data.animation !== undefined) updateData.animation = data.animation;

  return prisma.card.update({
    where: { id: Number(id) },
    data: updateData,
    include: { cardItems: true },
  });
}

async function deleteCard(id, userId) {
  const card = await prisma.card.findUnique({ where: { id: Number(id) } });
  
  if (!card) {
    throw createError('Card not found', 404);
  }
  
  if (card.createBy !== userId) {
    throw createError('You do not own this card', 403);
  }

  await prisma.card.delete({ where: { id: Number(id) } });
}

module.exports = { createCard, listCards, getCardById, updateCard, deleteCard };