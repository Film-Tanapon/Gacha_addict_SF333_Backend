const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../middleware/error.middleware');
const { normalizeBackup, normalizeHistory } = require('../utils/backup');
const { syncLocalCards, getCardIds } = require('../services/cardSync.service');
const prisma = require('../config/prisma');
const historySync = require('../services/historySync.service');
const input = require('../utils/input');
const router = Router();
router.use(requireAuth);
router.get('/', asyncHandler(async (req, res) => {
  const backup = await prisma.userBackup.findUnique({ where: { userId: req.user.id } });
  const cardIds = backup ? await getCardIds(prisma, req.user.id, backup.data.gachas) : {};
  if (req.query.historyMode === 'paged') {
    return res.json({ revision: backup?.revision ?? 0,
      data: backup ? { ...backup.data, history: [] } : null, updatedAt: backup?.updatedAt, cardIds,
      historySync: { version: 1, head: await historySync.head(req.user.id), pageSize: 100 } });
  }
  const rows = await prisma.backupHistory.findMany({ where: { userId: req.user.id },
    orderBy: [{ pulledAt: 'desc' }, { sequence: 'desc' }], take: 10001 });
  const entries = new Map((backup?.data.history ?? []).map(h => [h.id, h]));
  for (const row of rows) entries.set(row.clientId, historySync.toHistory(row));
  if (entries.size > 10000) input.fail('Update the app to download this history in pages.', 426);
  const data = backup || entries.size ? { ...(backup?.data ?? { version: 1, gachas: [] }),
    history: [...entries.values()].sort((a, b) => b.pulledAt.localeCompare(a.pulledAt)) } : null;
  res.json({ revision: backup?.revision ?? 0, data, updatedAt: backup?.updatedAt, cardIds });
}));
router.get('/history', asyncHandler(async (req, res) => {
  res.json(await historySync.page(req.user.id, req.query));
}));
router.post('/history', asyncHandler(async (req, res) => {
  if (!Array.isArray(req.body?.entries) || req.body.entries.length > 100)
    input.fail('Send at most 100 history entries per batch', 413);
  const entries = [], rejected = [], ids = new Set();
  req.body.entries.forEach((entry, index) => {
    try {
      const normalized = normalizeHistory(entry);
      if (!ids.has(normalized.id)) { entries.push(normalized); ids.add(normalized.id); }
    } catch (error) {
      rejected.push({ index, id: typeof entry?.id === 'string' ? entry.id.slice(0, 500) : null, message: error.message });
    }
  });
  const coins = await prisma.$transaction(async tx => {
    await historySync.lockHistoryUser(tx, req.user.id);
    await historySync.appendHistory(tx, req.user.id, entries);
    return (await tx.user.findUniqueOrThrow({ where: { id: req.user.id } })).coins;
  });
  res.json({ acceptedIds: entries.map(h => h.id), rejected, coins, head: await historySync.head(req.user.id) });
}));
router.put('/', asyncHandler(async (req, res) => {
  const { expectedRevision, data } = normalizeBackup(req.body);
  const paged = req.body.historyMode === 'paged';
  const userId = req.user.id;
  let result;
  try {
    result = await prisma.$transaction(async tx => {
      await historySync.lockHistoryUser(tx, userId);
      let snapshot = data;
      if (paged) {
        const previous = await tx.userBackup.findUnique({ where: { userId } });
        const merged = new Map((previous?.data.gachas ?? []).map(g => [g.id, g]));
        for (const gacha of data.gachas) {
          const current = merged.get(gacha.id);
          if (!current || (gacha.localUpdatedAt ?? '') >= (current.localUpdatedAt ?? '')) merged.set(gacha.id, gacha);
        }
        if (merged.size > 1000) input.fail('Backup has too many gachas', 413);
        snapshot = { version: 1, gachas: [...merged.values()], history: previous?.data.history ?? [] };
      }
      let backup;
      if (expectedRevision === 0) backup = await tx.userBackup.create({ data: { userId, data: snapshot } });
      else {
        const changed = await tx.userBackup.updateMany({ where: { userId, revision: expectedRevision }, data: { data: snapshot, revision: { increment: 1 } } });
        if (changed.count !== 1) {
          const error = new Error('Backup changed on another device; reload and merge before retrying');
          error.status = 409;
          throw error;
        }
        backup = await tx.userBackup.findUniqueOrThrow({ where: { userId } });
      }
      // Snapshot and Card rows commit together; stale requests cannot create duplicates.
      const changedIds = await syncLocalCards(tx, userId, data.gachas);
      const cardIds = paged ? await getCardIds(tx, userId, snapshot.gachas) : changedIds;
      // Count each local draw once, including across retries and multiple devices.
      if (!paged) await historySync.appendHistory(tx, userId, data.history);
      return { revision: backup.revision, ...(paged ? {} : { data: backup.data }), updatedAt: backup.updatedAt,
        cardIds, coins: (await tx.user.findUniqueOrThrow({where:{id:userId}})).coins };
    }, { timeout: 30000 });
  } catch (error) {
    if (error.code === 'P2002') { error.status = 409; error.message = 'Backup or card already exists; reload and merge before retrying'; }
    throw error;
  }
  res.json(result);
}));
module.exports = router;
