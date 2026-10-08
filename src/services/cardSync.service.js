const { normalize } = require('./card.service');

function isSyncableCard(gacha) {
  return !gacha.id.startsWith('builtin-') || !!gacha.localUpdatedAt;
}
function sameItems(current, next) {
  return current.length === next.length && current.every((item, index) =>
    item.name === next[index].name && item.rate === next[index].rate &&
    (item.imageUrl ?? null) === (next[index].imageUrl ?? null));
}
async function syncLocalCards(tx, userId, gachas) {
  const cardIds = {};
  for (const gacha of gachas.filter(isSyncableCard)) {
    const clientId = gacha.id;
    const where = { createBy_clientId: { createBy: userId, clientId } };
    const incomingDate = gacha.localUpdatedAt ? new Date(gacha.localUpdatedAt) : null;
    const fields = normalize({
      title: gacha.name, cardImage: gacha.bannerUri ?? null, frame: gacha.frameId ?? null,
      animation: gacha.animation ?? null, isEqualRate: gacha.isEqualRate,
      category: gacha.category, emoji: gacha.emoji, pullManyCount: gacha.pullManyCount,
      randomList: gacha.randomList,
    }, true);
    const current = await tx.card.findUnique({ where, include: { cardItems: { orderBy: { id: 'asc' } } } });
    let card = current;
    if (!current) {
      card = await tx.card.create({ data: { ...fields, createBy: userId, clientId, clientUpdatedAt: incomingDate } });
    } else if (!current.clientUpdatedAt || (incomingDate && incomingDate > current.clientUpdatedAt)) {
      // Keep item IDs stable for identical retries and favorite-only changes.
      const { cardItems, ...scalarFields } = fields;
      const replaceItems = !sameItems(current.cardItems, cardItems.create);
      card = await tx.card.update({ where: { id: current.id }, data: {
        ...scalarFields, clientUpdatedAt: incomingDate,
        ...(replaceItems ? { cardItems: { deleteMany: {}, create: cardItems.create } } : {}),
      } });
    }
    cardIds[clientId] = String(card.id);
  }
  return cardIds;
}
async function getCardIds(client, userId, gachas) {
  const records = await client.card.findMany({
    where: { createBy: userId, clientId: { in: gachas.filter(isSyncableCard).map(g => g.id) } },
    select: { id: true, clientId: true },
  });
  return Object.fromEntries(records.map(card => [card.clientId, String(card.id)]));
}
module.exports = { syncLocalCards, getCardIds, isSyncableCard };
