const prisma = require('../config/prisma');
const v = require('../utils/input');
const economy = require('./economy.service');

async function lockHistoryUser(tx, userId) {
  // Serialize sequence allocation and commit order per account. Otherwise a
  // later committed sequence could hide an earlier, still uncommitted row.
  const users = await tx.$queryRaw`SELECT "user_id" FROM "user" WHERE "user_id" = ${userId} FOR NO KEY UPDATE`;
  if (!users.length) v.fail('User not found', 404);
}
async function appendHistory(tx, userId, history) {
  if (!history.length) return;
  const inserted = await tx.backupHistory.createManyAndReturn({
    data: history.map(h => ({ userId, clientId: h.id, gachaId: h.gachaId ?? null, gachaName: h.gachaName,
      resultElement: h.resultElement, pulledAt: new Date(h.pulledAt) })),
    skipDuplicates: true, select: { clientId: true },
  });
  const ids = new Set(inserted.map(row => row.clientId));
  const pulls = history.filter(h => ids.has(h.id) && h.id.startsWith('local-'));
  if (pulls.length) {
    const counted = await tx.syncedPull.createManyAndReturn({
      data: pulls.map(h => ({ userId, clientId: h.id })), skipDuplicates: true, select: { clientId: true },
    });
    const countedIds = new Set(counted.map(row => row.clientId));
    if (counted.length) await economy.progress(tx, userId, 'pull', counted.length,
      { eventTimes: pulls.filter(h => countedIds.has(h.id)).map(h => h.pulledAt) });
  }
}
const toHistory = row => ({ id: row.clientId, gachaName: row.gachaName,
  ...(row.gachaId == null ? {} : { gachaId: row.gachaId }),
  resultElement: row.resultElement, pulledAt: row.pulledAt.toISOString() });
async function head(userId) {
  return String((await prisma.backupHistory.aggregate({ where: { userId }, _max: { sequence: true } }))._max.sequence ?? 0);
}
function cursor(value = '0') {
  if (typeof value !== 'string' || !/^\d{1,19}$/.test(value) || BigInt(value) > 9223372036854775807n)
    v.fail('Invalid history cursor');
  return BigInt(value);
}
async function page(userId, query = {}) {
  const after = cursor(query.after);
  const until = query.until === undefined ? BigInt(await head(userId)) : cursor(query.until);
  const take = v.integer(query.take ?? 100, 'take', 1, 100);
  if (after > until) v.fail('History cursor is ahead of this backup; restart history download', 409);
  const rows = await prisma.backupHistory.findMany({ where: { userId, sequence: { gt: after, lte: until } },
    orderBy: { sequence: 'asc' }, take: take + 1 });
  const entries = rows.slice(0, take);
  const hasMore = rows.length > take;
  return { entries: entries.map(toHistory), nextCursor: hasMore ? String(entries.at(-1).sequence) : String(until), hasMore };
}
module.exports = { lockHistoryUser, appendHistory, head, page, toHistory };
