const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../middleware/error.middleware');
const { normalizeBackup } = require('../utils/backup');
const { syncLocalCards, getCardIds } = require('../services/cardSync.service');
const prisma = require('../config/prisma');
const economy = require('../services/economy.service');
const router = Router();
router.use(requireAuth);
router.get('/', asyncHandler(async (req, res) => {
  const backup = await prisma.userBackup.findUnique({ where: { userId: req.user.id } });
  const cardIds = backup ? await getCardIds(prisma, req.user.id, backup.data.gachas) : {};
  res.json(backup ? { revision: backup.revision, data: backup.data, updatedAt: backup.updatedAt, cardIds } : { revision: 0, data: null, cardIds });
}));
router.put('/', asyncHandler(async (req, res) => {
  const { expectedRevision, data } = normalizeBackup(req.body);
  const userId = req.user.id;
  let result;
  try {
    result = await prisma.$transaction(async tx => {
      let backup;
      if (expectedRevision === 0) backup = await tx.userBackup.create({ data: { userId, data } });
      else {
        const changed = await tx.userBackup.updateMany({ where: { userId, revision: expectedRevision }, data: { data, revision: { increment: 1 } } });
        if (changed.count !== 1) {
          const error = new Error('Backup changed on another device; reload and merge before retrying');
          error.status = 409;
          throw error;
        }
        backup = await tx.userBackup.findUniqueOrThrow({ where: { userId } });
      }
      // Snapshot and Card rows commit together; stale requests cannot create duplicates.
      const cardIds = await syncLocalCards(tx, userId, data.gachas);
      // Count each local draw once, including across retries and multiple devices.
      const pulls = data.history.filter(h => h.id.startsWith('local-'));
      if (pulls.length) {
        const inserted = await tx.syncedPull.createMany({data:pulls.map(h=>({userId,clientId:h.id})),skipDuplicates:true});
        if (inserted.count) await economy.progress(tx,userId,'pull',inserted.count);
      }
      return { revision: backup.revision, data: backup.data, updatedAt: backup.updatedAt, cardIds };
    }, { timeout: 30000 });
  } catch (error) {
    if (error.code === 'P2002') { error.status = 409; error.message = 'Backup or card already exists; reload and merge before retrying'; }
    throw error;
  }
  res.json(result);
}));
module.exports = router;
