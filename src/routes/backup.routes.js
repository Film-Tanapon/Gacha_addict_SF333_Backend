const { Router } = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../middleware/error.middleware');
const { normalizeBackup } = require('../utils/backup');
const prisma = require('../config/prisma');
const router = Router();
router.use(requireAuth);
router.get('/', asyncHandler(async (req, res) => {
  const backup = await prisma.userBackup.findUnique({ where: { userId: req.user.id } });
  res.json(backup ? { revision: backup.revision, data: backup.data, updatedAt: backup.updatedAt } : { revision: 0, data: null });
}));
router.put('/', asyncHandler(async (req, res) => {
  const { expectedRevision, data } = normalizeBackup(req.body);
  const userId = req.user.id;
  let backup;
  try {
    backup = await prisma.$transaction(async tx => {
      if (expectedRevision === 0) return tx.userBackup.create({ data: { userId, data } });
      const changed = await tx.userBackup.updateMany({ where: { userId, revision: expectedRevision }, data: { data, revision: { increment: 1 } } });
      if (changed.count !== 1) {
        const error = new Error('Backup changed on another device; reload and merge before retrying');
        error.status = 409;
        throw error;
      }
      return tx.userBackup.findUniqueOrThrow({ where: { userId } });
    });
  } catch (error) {
    if (error.code === 'P2002') { error.status = 409; error.message = 'Backup already exists; reload and merge before retrying'; }
    throw error;
  }
  res.json({ revision: backup.revision, data: backup.data, updatedAt: backup.updatedAt });
}));
module.exports = router;
