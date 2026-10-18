const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const mail = require('./mail.service');
const { fail } = require('../utils/input');
const { validatePassword } = require('../utils/password');
const { isDeletionRequested } = require('./deletionLedger.service');

const REQUEST_MESSAGE = 'หากอีเมลนี้มีบัญชีที่ตั้งรหัสผ่านไว้ ระบบจะส่ง OTP ให้ กรุณาตรวจกล่องจดหมายและสแปม';
const INVALID_CODE = 'รหัส OTP ไม่ถูกต้อง หมดอายุ หรือใช้ไปแล้ว กรุณาลองใหม่หรือขอรหัสใหม่';
const INVALID_TOKEN = 'สิทธิ์เปลี่ยนรหัสผ่านหมดอายุหรือใช้ไปแล้ว กรุณาขอ OTP ใหม่';

function createPasswordResetService({ db = prisma, mailer = mail, clock = () => new Date(), autoDispatch = true,
  secret = () => process.env.PASSWORD_RESET_SECRET || process.env.JWT_SECRET } = {}) {
  function key(purpose) {
    const value = secret();
    if (typeof value !== 'string' || value.length < 32) fail('ระบบรีเซ็ตรหัสผ่านยังไม่พร้อม กรุณาติดต่อผู้ดูแล', 503);
    return crypto.createHmac('sha256', value).update(`password-reset:${purpose}`).digest();
  }
  const hash = (purpose, value) => crypto.createHmac('sha256', key('hash')).update(`${purpose}:${value}`).digest('hex');
  function seal(code, id) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key('mail'), iv);
    cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }
  function unseal(value, id) {
    const data = Buffer.from(value, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key('mail'), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    decipher.setAAD(Buffer.from(id));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  }
  async function limit(scope, identity, maximum, seconds) {
    const rateKey = hash('rate', `${scope}:${identity}`);
    const now = clock();
    const expiry = new Date(now.getTime() + seconds * 1000);
    const stamp = now.toISOString();
    const expiryStamp = expiry.toISOString();
    const [rate] = await db.$queryRaw`INSERT INTO "password_reset_rate_limit" ("key", "count", "expires_at")
      VALUES (${rateKey}, 1, ${expiryStamp}::timestamp) ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "password_reset_rate_limit"."expires_at" <= ${stamp}::timestamp THEN 1 ELSE "password_reset_rate_limit"."count" + 1 END,
      "expires_at" = CASE WHEN "password_reset_rate_limit"."expires_at" <= ${stamp}::timestamp THEN ${expiryStamp}::timestamp ELSE "password_reset_rate_limit"."expires_at" END
      RETURNING "count", "expires_at" AS "expiresAt"`;
    if (rate.count > maximum) {
      const error = new Error('ดำเนินการบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
      error.status = 429;
      error.retryAfter = Math.max(1, Math.ceil((rate.expiresAt - now) / 1000));
      throw error;
    }
  }
  const eligible = async user => !!user?.password && !await isDeletionRequested(user);
  const safeDeliveryError = () => console.error('Password reset email delivery failed; queued retry will be attempted.');
  function wake() {
    if (autoDispatch) setImmediate(() => deliverPending().catch(safeDeliveryError));
  }
  async function requestReset(data = {}, ip = 'unknown') {
    const { email } = data || {};
    mailer.assertConfigured();
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) fail('กรุณากรอกอีเมลให้ถูกต้อง');
    await limit('request-ip', ip, 30, 3600);
    await limit('request-email-minute', normalized, 1, 60);
    await limit('request-email-hour', normalized, 5, 3600);
    const user = await db.user.findUnique({ where: { email: normalized } });
    const canReset = await eligible(user);
    const id = crypto.randomBytes(24).toString('hex');
    const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    const now = clock();
    const emailKey = hash('email', normalized);
    await db.$transaction(async tx => {
      await tx.passwordResetChallenge.deleteMany({ where: { emailKey } });
      await tx.passwordResetChallenge.create({ data: {
        id, emailKey, userId: canReset ? user.id : null, authVersion: canReset ? user.authVersion : null,
        codeHash: hash('otp', `${id}:${code}`), expiresAt: new Date(now.getTime() + 600000),
        encryptedCode: canReset ? seal(code, id) : null, nextDeliveryAt: canReset ? now : null,
      } });
    });
    // SMTP runs after the response, so account existence is not exposed by mail latency.
    wake();
    return { message: REQUEST_MESSAGE, challengeId: id, resendAfter: 60, expiresIn: 600 };
  }
  async function verifyCode(data = {}, ip = 'unknown') {
    const { challengeId, code } = data || {};
    await limit('verify-ip', ip, 60, 900);
    if (typeof challengeId !== 'string' || !/^[a-f0-9]{48}$/.test(challengeId) ||
        typeof code !== 'string' || !/^\d{6}$/.test(code)) fail(INVALID_CODE);
    const now = clock();
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "password_reset_challenge" WHERE "id" = ${challengeId} FOR UPDATE`;
      const challenge = await tx.passwordResetChallenge.findUnique({ where: { id: challengeId }, include: { user: true } });
      if (!challenge || challenge.expiresAt <= now || challenge.verifiedAt || challenge.attempts >= 5) return null;
      const matches = crypto.timingSafeEqual(Buffer.from(challenge.codeHash, 'hex'), Buffer.from(hash('otp', `${challengeId}:${code}`), 'hex'));
      if (!matches || !await eligible(challenge.user) || challenge.user.authVersion !== challenge.authVersion) {
        const attempts = challenge.attempts + 1;
        await tx.passwordResetChallenge.update({ where: { id: challengeId }, data: {
          attempts, ...(attempts >= 5 ? { encryptedCode: null, nextDeliveryAt: null } : {}),
        } });
        return null; // Commit the attempt counter before returning the generic error.
      }
      const resetToken = crypto.randomBytes(32).toString('base64url');
      await tx.passwordResetChallenge.update({ where: { id: challengeId }, data: {
        verifiedAt: now, resetTokenHash: hash('token', resetToken), expiresAt: new Date(now.getTime() + 300000),
        encryptedCode: null, nextDeliveryAt: null,
      } });
      return { resetToken, expiresIn: 300 };
    });
    if (!result) fail(INVALID_CODE);
    return result;
  }
  async function resetPassword(data = {}, ip = 'unknown') {
    const { resetToken, password } = data || {};
    await limit('reset-ip', ip, 30, 900);
    if (typeof resetToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(resetToken)) fail(INVALID_TOKEN);
    validatePassword(password);
    const tokenHash = hash('token', resetToken);
    const initial = await db.passwordResetChallenge.findUnique({ where: { resetTokenHash: tokenHash } });
    if (!initial?.userId || !initial.verifiedAt || initial.expiresAt <= clock()) fail(INVALID_TOKEN);
    const passwordHash = await bcrypt.hash(password, 10);
    const notification = await db.$transaction(async tx => {
      // Lock the account first, matching account deletion's lock order.
      await tx.$queryRaw`SELECT "user_id" FROM "user" WHERE "user_id" = ${initial.userId} FOR UPDATE`;
      const challenge = await tx.passwordResetChallenge.findUnique({ where: { resetTokenHash: tokenHash }, include: { user: true } });
      if (!challenge?.verifiedAt || challenge.expiresAt <= clock() || !await eligible(challenge.user) ||
          challenge.user.authVersion !== challenge.authVersion) return null;
      const updated = await tx.user.update({ where: { id: challenge.userId }, data: { password: passwordHash, authVersion: { increment: 1 } } });
      await tx.passwordResetChallenge.deleteMany({ where: { userId: challenge.userId } });
      return { email: updated.email, username: updated.username, changedAt: updated.updateDate };
    });
    if (!notification) fail(INVALID_TOKEN);
    setImmediate(() => mailer.sendPasswordChanged(notification.email, {
      username: notification.username, changedAt: notification.changedAt,
    }).catch(() => console.error('Password changed notification could not be sent.')));
    return { message: 'เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่' };
  }

  let delivering = false;
  async function deliverPending() {
    if (delivering) return;
    delivering = true;
    try {
      for (let index = 0; index < 10; index++) {
        const now = clock();
        const stamp = now.toISOString();
        const challenge = await db.$transaction(async tx => {
          const [row] = await tx.$queryRaw`SELECT "id" FROM "password_reset_challenge"
            WHERE "encrypted_code" IS NOT NULL AND "next_delivery_at" <= ${stamp}::timestamp AND "expires_at" > ${stamp}::timestamp
            AND "verified_at" IS NULL AND "delivery_attempts" < 3 ORDER BY "created_at" FOR UPDATE SKIP LOCKED LIMIT 1`;
          if (!row) return null;
          return tx.passwordResetChallenge.update({ where: { id: row.id }, data: {
            deliveryAttempts: { increment: 1 }, nextDeliveryAt: new Date(now.getTime() + 60000),
          }, include: { user: true } });
        });
        if (!challenge) break;
        if (!await eligible(challenge.user) || challenge.user.authVersion !== challenge.authVersion) {
          await db.passwordResetChallenge.updateMany({ where: { id: challenge.id }, data: { encryptedCode: null, nextDeliveryAt: null } });
          continue;
        }
        try {
          await mailer.sendResetCode(challenge.user.email, unseal(challenge.encryptedCode, challenge.id), { username: challenge.user.username });
          await db.passwordResetChallenge.updateMany({ where: { id: challenge.id }, data: { encryptedCode: null, nextDeliveryAt: null } });
        } catch {
          safeDeliveryError();
          if (challenge.deliveryAttempts >= 3)
            await db.passwordResetChallenge.updateMany({ where: { id: challenge.id }, data: { encryptedCode: null, nextDeliveryAt: null } });
        }
      }
    } finally { delivering = false; }
  }
  async function cleanup() {
    const now = clock();
    await db.passwordResetChallenge.deleteMany({ where: { expiresAt: { lte: now } } });
    await db.passwordResetRateLimit.deleteMany({ where: { expiresAt: { lte: now } } });
  }
  function startWorker() {
    const run = () => cleanup().then(deliverPending).catch(safeDeliveryError);
    run();
    const timer = setInterval(run, 15000);
    timer.unref();
    return () => clearInterval(timer);
  }
  return { requestReset, verifyCode, resetPassword, deliverPending, cleanup, startWorker };
}
module.exports = { createPasswordResetService, ...createPasswordResetService() };
