const prisma = require("../config/prisma");
const v = require("../utils/input");
function normalize(data, creating = false) {
  const result = { pullOneCost: 0, pullManyCost: 0 };
  const aliases = {
    title: ["title", "name", "Title"],
    cardImage: ["cardImage", "bannerUri", "Card_Image"],
    frame: ["frame", "frameId", "Frame_ID"],
    animation: ["animation", "Animation"],
    isEqualRate: ["isEqualRate", "is_equal_rate"],
    category: ["category"],
    emoji: ["emoji"],
    pullManyCount: ["pullManyCount"],
  };
  for (const [field, names] of Object.entries(aliases)) {
    const key = names.find((name) => data[name] !== undefined);
    if (!key) continue;
    const value = data[key];
    if (field === "title" || field === "emoji")
      result[field] = v.text(value, field);
    else if (field === "isEqualRate") result[field] = v.boolean(value);
    else if (field.startsWith("pull"))
      result[field] = v.integer(
        value,
        field,
        field === "pullManyCount" ? 2 : 0,
        field === "pullManyCount" ? 100 : 1000000
      );
    else if (field === "category") {
      if (!["Custom", "YesOrNo", "Food"].includes(value))
        v.fail("Invalid category");
      result[field] = value;
    } else result[field] = v.optionalText(value, field);
  }
  if (creating && !result.title) v.fail("title is required");
  const items = data.cardItems ?? data.Items ?? data.randomList;
  if (items !== undefined) {
    if (!Array.isArray(items) || !items.length || items.length > 100)
      v.fail("Provide between 1 and 100 items");
    result.cardItems = { create: items.map(v.item) };
    if (
      result.isEqualRate === false &&
      !result.cardItems.create.some((i) => i.rate > 0)
    )
      v.fail("Weighted items need a positive rate");
  }
  return result;
}
async function createCard(userId, data) {
  return prisma.card.create({
    data: { ...normalize(data, true), createBy: userId },
    include: { cardItems: true },
  });
}
async function listCards(query = {}) {
  return prisma.card.findMany({
    ...v.pagination(query),
    orderBy: { id: "desc" },
    include: { cardItems: true },
  });
}
async function getCardById(id) {
  const card = await prisma.card.findUnique({
    where: { id: v.integer(id, "card id") },
    include: { cardItems: true },
  });
  if (!card) v.fail("Card not found", 404);
  return card;
}
async function updateCard(id, userId, data) {
  const card = await getCardById(id);
  if (card.createBy !== userId) v.fail("You do not own this card", 403);
  const update = normalize(data);
  if (update.cardItems) update.cardItems.deleteMany = {};
  return prisma.card.update({
    where: { id: card.id },
    data: update,
    include: { cardItems: true },
  });
}
async function deleteCard(id, userId) {
  const card = await getCardById(id);
  if (card.createBy !== userId) v.fail("You do not own this card", 403);
  await prisma.card.delete({ where: { id: card.id } });
}
function toGacha(card, isFavorite = false) {
  const total = card.cardItems.reduce((sum, i) => sum + i.rate, 0);
  return {
    id: String(card.id),
    name: card.title,
    category: card.category,
    bannerUri: card.cardImage,
    emoji: card.emoji,
    frameId: card.frame,
    animation: card.animation,
    isEqualRate: card.isEqualRate,
    pullOneCost: 0,
    pullManyCount: card.pullManyCount,
    pullManyCost: 0,
    isFavorite,
    randomList: card.cardItems.map((i) => ({
      id: String(i.id),
      element: i.name,
      rate:
        (card.isEqualRate || total <= 0
          ? 100 / card.cardItems.length
          : (i.rate / total) * 100) + "%",
    })),
  };
}
module.exports = {
  createCard,
  listCards,
  getCardById,
  updateCard,
  deleteCard,
  normalize,
  toGacha,
};
