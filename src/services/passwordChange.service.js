const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { initFirebase } = require('../config/firebase');
const { validatePassword } = require('../utils/password');
const { fail } = require('../utils/input');
const { isDeletionRequested } = require('./deletionLedger.service');

async function limitAttempts(userId) {
  const now = new Date();
  const expires = new Date(now.getTime() + 15 * 60 * 1000);
  const key = `password-change:${userId}`;
  const [rate] = await prisma.$queryRaw`INSERT INTO "password_reset_rate_limit" ("key", "count", "expires_at")
    VALUES (${key}, 1, ${expires}) ON CONFLICT ("key") DO UPDATE SET
    "count" = CASE WHEN "password_reset_rate_limit"."expires_at" <= ${now} THEN 1 ELSE "password_reset_rate_limit"."count" + 1 END,
    "expires_at" = CASE WHEN "password_reset_rate_limit"."expires_at" <= ${now} THEN ${expires} ELSE "password_reset_rate_limit"."expires_at" END
    RETURNING "count", "expires_at"`;
  if (rate.count > 5) {
    const error = new Error('ยืนยันตัวตนบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่');
    error.status = 429;
    error.retryAfter = Math.max(1, Math.ceil((rate.expires_at.getTime() - now.getTime()) / 1000));
    throw error;
  }
}

async function changePassword(userId, sessionVersion, data = {}) {
  const { currentPassword, firebaseIdToken, newPassword } = data || {};
  validatePassword(newPassword);
  const original = await prisma.user.findUnique({ where: { id: userId } });
  if (!original || original.authVersion !== sessionVersion || await isDeletionRequested(original) ||
      (original.googleId && original.password && !original.googleLinkVerified))
    fail('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 401);
  await limitAttempts(userId);

  const useGoogle = firebaseIdToken !== undefined;
  if (useGoogle && currentPassword !== undefined) fail('เลือกวิธียืนยันตัวตนเพียงวิธีเดียว');
  if (useGoogle) {
    if (!original.googleId || typeof firebaseIdToken !== 'string' || !firebaseIdToken)
      fail('กรุณายืนยันบัญชี Google เดิมอีกครั้ง', 401);
    const admin = initFirebase();
    if (!admin) fail('การยืนยัน Google ยังไม่พร้อม กรุณาลองใหม่ภายหลัง', 503);
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(firebaseIdToken, true); }
    catch { fail('กรุณายืนยันบัญชี Google เดิมอีกครั้ง', 401); }
    const age = Date.now() / 1000 - decoded.auth_time;
    if (decoded.uid !== original.googleId || decoded.firebase?.sign_in_provider !== 'google.com' ||
        !decoded.email_verified || !Number.isFinite(age) || age < -60 || age > 300)
      fail('กรุณายืนยันบัญชี Google เดิมอีกครั้ง', 401);
  } else if (!original.password || typeof currentPassword !== 'string' || !currentPassword ||
      !(await bcrypt.compare(currentPassword, original.password))) {
    fail('รหัสผ่านเดิมไม่ถูกต้อง', 401);
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  const notification = await prisma.$transaction(async tx => {
    // Serialize against password resets, Google linking and account deletion.
    await tx.$queryRaw`SELECT "user_id" FROM "user" WHERE "user_id" = ${userId} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: userId } });
    if (!current || current.authVersion !== original.authVersion || current.password !== original.password ||
        current.googleId !== original.googleId || await isDeletionRequested(current))
      fail('ข้อมูลบัญชีเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่และยืนยันอีกครั้ง', 401);
    const updated = await tx.user.update({ where: { id: userId }, data: {
      password: hashed, authVersion: { increment: 1 },
      ...(useGoogle ? { googleLinkVerified: true } : {}),
    } });
    await tx.passwordResetChallenge.deleteMany({ where: { userId } });
    return { email: updated.email, username: updated.username, changedAt: updated.updateDate };
  });
  setImmediate(() => require('./mail.service').sendPasswordChanged(notification.email, {
    username: notification.username, changedAt: notification.changedAt,
  })
    .catch(() => console.error('Password changed notification could not be sent.')));
  return { message: 'เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่ทุกอุปกรณ์' };
}

module.exports = { changePassword };
