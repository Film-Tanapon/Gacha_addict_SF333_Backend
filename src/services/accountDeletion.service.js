const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { initFirebase } = require('../config/firebase');
const { uploadedFilename, removeUpload } = require('./uploadStorage.service');
const input = require('../utils/input');
const { recordDeletion, readDeletionLedger } = require('./deletionLedger.service');

function imageReferences(user) {
  const found = new Set();
  const add = value => { const filename = uploadedFilename(value); if (filename) found.add(filename); };
  add(user.avatarUrl);
  for (const card of user.cards ?? []) {
    add(card.cardImage);
    for (const item of card.cardItems ?? []) add(item.imageUrl);
  }
  for (const gacha of user.backup?.data?.gachas ?? []) add(gacha.bannerUri);
  return found;
}

// Before upload ownership was recorded, only delete legacy files exclusively
// referenced by this account. Never infer ownership of another user's or catalog art.
async function accountFilenames(tx, user) {
  const owned = await tx.uploadedImage.findMany({ where: { ownerId: user.id } });
  const result = new Set(owned.map(image => image.filename));
  const referenced = imageReferences(user);
  const known = await tx.uploadedImage.findMany({ where: { filename: { in: [...referenced] } } });
  for (const image of known) referenced.delete(image.filename);
  if (!referenced.size) return [...result];
  const others = await tx.user.findMany({ where: { id: { not: user.id } }, select: {
    avatarUrl: true, backup: { select: { data: true } },
    cards: { select: { cardImage: true, cardItems: { select: { imageUrl: true } } } },
  } });
  for (const other of others) for (const filename of imageReferences(other)) referenced.delete(filename);
  const frames = await tx.frame.findMany({ select: { imageUrl: true } });
  for (const frame of frames) referenced.delete(uploadedFilename(frame.imageUrl));
  for (const filename of referenced) result.add(filename);
  return [...result];
}

async function verifyDeletion(user, credentials, firebase = initFirebase) {
  if (credentials?.confirmation !== 'DELETE') input.fail('Confirm permanent account deletion', 400);
  if (credentials.firebaseIdToken && user.googleId) {
    const admin = firebase();
    if (!admin) input.fail('Google authentication is temporarily unavailable', 503);
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(credentials.firebaseIdToken, true); }
    catch { input.fail('Please verify your Google account again', 401); }
    const age = Date.now() / 1000 - decoded.auth_time;
    if (decoded.uid !== user.googleId || !Number.isFinite(age) || age < -60 || age > 300)
      input.fail('Please verify the same Google account again', 401);
    return;
  }
  if (!user.password || typeof credentials.password !== 'string' ||
      !(await bcrypt.compare(credentials.password, user.password)))
    input.fail(user.googleId ? 'Verify your Google account to delete it' : 'Password is incorrect', 401);
}

async function deleteAccount(userId, credentials, options = {}) {
  const id = input.integer(userId, 'user id');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) input.fail('User not found', 404);
  await verifyDeletion(user, credentials, options.firebase);
  await enqueueAccountDeletion(id, { expectedIdentity: user, recordIntent: true });
  if (options.scheduleCleanup !== false)
    setImmediate(() => processDeletionJobs().catch(() => console.error('[privacy] Account cleanup will be retried by the worker')));
  return { deleted: true, cleanupPending: true };
}

async function enqueueAccountDeletion(id, { expectedIdentity, recordIntent = false, createdAt } = {}) {
  let deletedEmail;
  await prisma.$transaction(async tx => {
    // Serialize against uploads and other writes that reference the account.
    const locked = await tx.$queryRaw`SELECT "user_id" FROM "user" WHERE "user_id" = ${id} FOR UPDATE`;
    if (!locked.length) return;
    const current = await tx.user.findUniqueOrThrow({ where: { id }, include: {
      backup: true, cards: { include: { cardItems: true } },
    } });
    if (createdAt && current.createDate.toISOString() !== createdAt) return;
    if (expectedIdentity && (current.password !== expectedIdentity.password || current.googleId !== expectedIdentity.googleId ||
        current.createDate.toISOString() !== expectedIdentity.createDate.toISOString()))
      input.fail('Account credentials changed. Please verify again.', 401);
    if (recordIntent) await recordDeletion(current);
    const existing = await tx.accountDeletionJob.findUnique({ where: { userId: id } });
    const filenames = [...new Set([...(existing?.filenames ?? []), ...await accountFilenames(tx, current)])];
    await tx.accountDeletionJob.upsert({ where: { userId: id },
      create: { userId: id, firebaseUid: current.googleId, filenames, nextAttemptAt: new Date(0) },
      update: { filenames, firebaseUid: current.googleId, nextAttemptAt: new Date(0) },
    });
    await tx.user.delete({ where: { id } });
    deletedEmail = current.email;
  }, { timeout: 30000 });
  if (deletedEmail) require('./reviewInbox.service').clearForRecipient(deletedEmail);
}

async function reconcileDeletionLedger() {
  for (const row of await readDeletionLedger()) {
    const restored = await prisma.user.findUnique({ where: { id: row.userId }, select: { createDate: true } });
    if (restored?.createDate.toISOString() === row.createdAt) await enqueueAccountDeletion(row.userId, { createdAt: row.createdAt });
  }
}

// This function is for the server operator's CLI after verifying a support request.
// It is never exposed through an HTTP route.
async function deleteAccountByVerifiedSupport(userId) {
  const user = await prisma.user.findUnique({ where: { id: input.integer(userId, 'user id') } });
  if (!user) input.fail('User not found', 404);
  await enqueueAccountDeletion(user.id, { expectedIdentity: user, recordIntent: true });
  await processDeletionJobs();
}

async function processDeletionJobs({ firebase = initFirebase, removeFile = removeUpload, now = new Date() } = {}) {
  await reconcileDeletionLedger();
  const jobs = await prisma.accountDeletionJob.findMany({ where: { nextAttemptAt: { lte: now } }, orderBy: { createdAt: 'asc' }, take: 20 });
  for (const job of jobs) {
    const claimed = await prisma.accountDeletionJob.updateMany({
      where: { userId: job.userId, nextAttemptAt: job.nextAttemptAt },
      data: { nextAttemptAt: new Date(now.getTime() + 5 * 60 * 1000), attempts: { increment: 1 } },
    });
    if (!claimed.count) continue;
    let failureCode = null;
    for (const filename of job.filenames) {
      try { await removeFile(filename); }
      catch { failureCode = 'UPLOAD_DELETE_FAILED'; }
    }
    if (job.firebaseUid) {
      try {
        const admin = firebase();
        if (!admin) throw new Error('Firebase unavailable');
        await admin.auth().deleteUser(job.firebaseUid);
      } catch (error) {
        if (error.code !== 'auth/user-not-found') failureCode = 'FIREBASE_DELETE_FAILED';
      }
    }
    if (!failureCode) await prisma.accountDeletionJob.delete({ where: { userId: job.userId } });
    else {
      await prisma.accountDeletionJob.update({ where: { userId: job.userId }, data: {
        lastErrorCode: failureCode,
        nextAttemptAt: new Date(now.getTime() + Math.min(60 * 60 * 1000, 60000 * 2 ** Math.min(job.attempts, 6))),
      } });
      console.warn(`[privacy] Account cleanup pending: ${failureCode}`);
    }
  }
}

function startDeletionWorker() {
  const run = () => processDeletionJobs().catch(() => console.error('[privacy] Account cleanup worker failed; retrying later'));
  run();
  const timer = setInterval(run, 60000);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { deleteAccount, verifyDeletion, processDeletionJobs, startDeletionWorker, reconcileDeletionLedger, deleteAccountByVerifiedSupport };
