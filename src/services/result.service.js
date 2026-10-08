const prisma = require("../config/prisma");
const { pullGacha } = require("../utils/gacha");
const { progress } = require("./economy.service");
const v = require("../utils/input");
const MAX_PULLS_PER_REQUEST = 100;
async function pullCard(cardId, userId, count = 1) {
  const id = v.integer(cardId, "card id");
  const n = v.integer(count, "count", 1, MAX_PULLS_PER_REQUEST);
  return prisma.$transaction(async (tx) => {
    const card = await tx.card.findUnique({
      where: { id },
      include: { cardItems: true },
    });
    if (!card) v.fail("Card not found", 404);
    if (!card.cardItems.length) v.fail("This card has no items");
    // Pulls are free; coins are used only by the shop.
    const results = [];
    for (const item of pullGacha(card.cardItems, card.isEqualRate, n))
      results.push(
        await tx.result.create({
          data: {
            cardItemId: item.id,
            createBy: userId,
            gachaName: card.title,
            resultElement: item.name,
          },
          include: { cardItem: true },
        })
      );
    await progress(tx, userId, "pull", n);
    return results;
  });
}
async function listResults(userId, query = {}) {
  return prisma.result.findMany({
    where: { createBy: userId },
    include: { cardItem: { include: { card: true } } },
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    ...v.pagination(query),
  });
}
async function getResultById(id, userId) {
  const result = await prisma.result.findFirst({
    where: { id: v.integer(id, "result id"), createBy: userId },
    include: { cardItem: { include: { card: true } } },
  });
  if (!result) v.fail("Result not found", 404);
  return result;
}
async function deleteResult(id, userId) {
  const result = await getResultById(id, userId);
  await prisma.result.delete({ where: { id: result.id } });
}
function toHistory(result) {
  return {
    id: String(result.id),
    gachaName: result.gachaName,
    resultElement: result.resultElement,
    pulledAt: result.timestamp.toISOString(),
  };
}
module.exports = {
  pullCard,
  listResults,
  getResultById,
  deleteResult,
  toHistory,
  MAX_PULLS_PER_REQUEST,
};
