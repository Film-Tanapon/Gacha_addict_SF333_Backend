const crypto = require('node:crypto');
const prisma = require('../config/prisma');

const MAX_ATTEMPTS = 15;
const WINDOW_MS = 3 * 60 * 60 * 1000;

function createLoginAttemptLimiter({ db = prisma, clock = () => new Date() } = {}) {
  function blocked(expiresAt) {
    const error = new Error(`กรอกรหัสผ่านผิดครบ ${MAX_ATTEMPTS} ครั้ง กรุณาลองใหม่อีก ${Math.max(1, Math.ceil((expiresAt - clock()) / 60000))} นาที`);
    error.status = 429;
    error.publicCode = 'LOGIN_RATE_LIMITED';
    error.retryAfter = Math.max(1, Math.ceil((expiresAt - clock()) / 1000));
    return error;
  }

  async function reserve(email) {
    const key = `email-login:${crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;
    // Reserve before bcrypt, atomically across requests and backend instances.
    // Blocked requests neither increment the count nor extend the fixed window.
    for (let retry = 0; retry < 2; retry++) {
      const now = clock();
      const stamp = now.toISOString();
      const expiry = new Date(now.getTime() + WINDOW_MS).toISOString();
      const [attempt] = await db.$queryRaw`INSERT INTO "password_reset_rate_limit" ("key", "count", "expires_at")
        VALUES (${key}, 1, ${expiry}::timestamp) ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "password_reset_rate_limit"."expires_at" <= ${stamp}::timestamp THEN 1 ELSE "password_reset_rate_limit"."count" + 1 END,
        "expires_at" = CASE WHEN "password_reset_rate_limit"."expires_at" <= ${stamp}::timestamp THEN ${expiry}::timestamp ELSE "password_reset_rate_limit"."expires_at" END
        WHERE "password_reset_rate_limit"."expires_at" <= ${stamp}::timestamp OR "password_reset_rate_limit"."count" < ${MAX_ATTEMPTS}
        RETURNING "count", "expires_at" AS "expiresAt"`;
      if (attempt) return { key, ...attempt };
      const current = await db.passwordResetRateLimit.findUnique({ where: { key } });
      if (current && current.expiresAt > clock()) throw blocked(current.expiresAt);
      // A successful concurrent login may have just cleared the row.
    }
    const error = new Error('กรุณาลองเข้าสู่ระบบใหม่อีกครั้ง');
    error.status = 503;
    throw error;
  }

  function failed(attempt) {
    if (attempt.count >= MAX_ATTEMPTS) throw blocked(attempt.expiresAt);
  }

  async function succeeded(attempt) {
    await db.passwordResetRateLimit.deleteMany({ where: { key: attempt.key, expiresAt: attempt.expiresAt } });
  }

  async function release(attempt) {
    // Infrastructure errors are not wrong passwords. An old request must not
    // change the counter belonging to a later three-hour window.
    await db.passwordResetRateLimit.updateMany({
      where: { key: attempt.key, expiresAt: attempt.expiresAt, count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    });
  }

  return { reserve, failed, succeeded, release };
}

module.exports = { createLoginAttemptLimiter, MAX_ATTEMPTS, WINDOW_MS, ...createLoginAttemptLimiter() };
