if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

test('login attempts are persistent, atomic and bounded to 15 checks per three-hour window',
  { skip: !process.env.TEST_DATABASE_URL }, async t => {
    const db = require('../src/config/prisma');
    const { createLoginAttemptLimiter, MAX_ATTEMPTS, WINDOW_MS } = require('../src/services/loginAttempts.service');
    let now = new Date('2035-01-01T00:00:00.000Z');
    const options = { db, clock: () => now };
    let limiter = createLoginAttemptLimiter(options);
    const tag = `${Date.now()}-${process.pid}`;
    const keys = new Set();
    const email = label => `${label}-${tag}@example.invalid`;
    const keyFor = address => `email-login:${crypto.createHash('sha256').update(address.trim().toLowerCase()).digest('hex')}`;
    async function attempt(address) {
      keys.add(keyFor(address));
      return limiter.reserve(address);
    }
    const ids = [];
    let server;
    const bcrypt = require('bcryptjs');
    const originalCompare = bcrypt.compare;
    try {
      await t.test('the 15th failure locks the account and restarts/case/IP changes do not reset it', async () => {
        const address = email('window');
        let last;
        for (let i = 1; i <= MAX_ATTEMPTS; i++) {
          last = await attempt(i % 2 ? address : ` ${address.toUpperCase()} `);
          assert.equal(last.count, i);
          if (i < MAX_ATTEMPTS) assert.doesNotThrow(() => limiter.failed(last));
          else assert.throws(() => limiter.failed(last), { status: 429, publicCode: 'LOGIN_RATE_LIMITED', retryAfter: 10800 });
        }
        const expiry = last.expiresAt.getTime();
        limiter = createLoginAttemptLimiter(options);
        now = new Date(now.getTime() + WINDOW_MS - 1);
        await assert.rejects(attempt(address), { status: 429, retryAfter: 1 });
        assert.equal((await db.passwordResetRateLimit.findUnique({ where: { key: last.key } })).expiresAt.getTime(), expiry);
        now = new Date(now.getTime() + 1);
        const reset = await attempt(address);
        assert.equal(reset.count, 1);
        assert.equal(reset.expiresAt.getTime(), now.getTime() + WINDOW_MS);
        assert.ok(!reset.key.includes(address));
      });

      await t.test('parallel submissions reserve exactly 15 checks and other emails have separate counters', async () => {
        const address = email('parallel');
        const results = await Promise.allSettled(Array.from({ length: 40 }, () => attempt(address)));
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 15);
        const rejected = results.filter(result => result.status === 'rejected');
        assert.equal(rejected.length, 25);
        assert.ok(rejected.every(result => result.reason.status === 429));
        assert.equal((await db.passwordResetRateLimit.findUnique({ where: { key: keyFor(address) } })).count, 15);
        assert.equal((await attempt(email('another'))).count, 1);
      });

      await t.test('successful login clears failures and server errors/stale requests do not spend a later window', async () => {
        const address = email('release');
        const first = await attempt(address);
        await limiter.release(first);
        const second = await attempt(address);
        assert.equal(second.count, 1);
        await limiter.succeeded(second);
        assert.equal(await db.passwordResetRateLimit.findUnique({ where: { key: second.key } }), null);
        const old = await attempt(address);
        now = new Date(now.getTime() + WINDOW_MS);
        const fresh = await attempt(address);
        await limiter.release(old);
        await limiter.succeeded(old);
        assert.equal((await db.passwordResetRateLimit.findUnique({ where: { key: fresh.key } })).count, 1);
      });

      const app = require('../index');
      server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const base = `http://127.0.0.1:${server.address().port}/api`;
      const password = 'LoginPassword123';
      const hash = await bcrypt.hash(password, 10);
      async function account(label) {
        const user = await db.user.create({ data: { email: email(label), username: `${label}-${tag}`, password: hash } });
        ids.push(user.id); keys.add(keyFor(user.email)); return user;
      }
      async function login(address, value, ip = '198.51.100.1') {
        keys.add(keyFor(address));
        const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
          body: JSON.stringify({ email: address, password: value }) });
        return { status: response.status, body: await response.json(), retryAfter: response.headers.get('retry-after') };
      }
      await t.test('real login returns Retry-After, blocks correct passwords during lockout and preserves issued sessions', async () => {
        const user = await account('http');
        const signedIn = await login(user.email, password);
        assert.equal(signedIn.status, 200);
        let checks = 0;
        bcrypt.compare = async (...args) => { checks++; return originalCompare(...args); };
        for (let i = 1; i <= 15; i++) {
          const result = await login(` ${user.email.toUpperCase()} `, 'wrong-password', `198.51.100.${i}`);
          assert.equal(result.status, i < 15 ? 401 : 429);
          assert.equal(result.body.token, undefined);
        }
        const locked = await login(user.email, password);
        assert.equal(locked.status, 429);
        assert.equal(locked.body.code, 'LOGIN_RATE_LIMITED');
        assert.ok(Number(locked.retryAfter) > 0 && Number(locked.retryAfter) <= 10800);
        assert.equal(checks, 15);
        bcrypt.compare = originalCompare;
        const profile = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${signedIn.body.token}` } });
        assert.equal(profile.status, 200);
        const other = await account('separate');
        assert.equal((await login(other.email, password)).status, 200);
        await db.passwordResetRateLimit.update({ where: { key: keyFor(user.email) }, data: { expiresAt: new Date(Date.now() - 1) } });
        assert.equal((await login(user.email, password)).status, 200);
        assert.equal(await db.passwordResetRateLimit.findUnique({ where: { key: keyFor(user.email) } }), null);
      });

      await t.test('unknown accounts have the same failure and lockout responses', async () => {
        const address = email('unknown');
        for (let i = 1; i <= 15; i++) assert.equal((await login(address, 'wrong-password')).status, i < 15 ? 401 : 429);
        assert.equal((await login(address, 'wrong-password')).status, 429);
      });

      await t.test('an infrastructure failure refunds its password-check reservation', async () => {
        const user = await account('server-error');
        bcrypt.compare = async () => { throw new Error('Simulated infrastructure failure'); };
        await assert.rejects(require('../src/services/auth.service').login({ email: user.email, password }), /Simulated infrastructure failure/);
        bcrypt.compare = originalCompare;
        assert.equal((await db.passwordResetRateLimit.findUnique({ where: { key: keyFor(user.email) } })).count, 0);
        assert.equal((await login(user.email, password)).status, 200);
      });
    } finally {
      bcrypt.compare = originalCompare;
      if (server) await new Promise(resolve => server.close(resolve));
      await db.passwordResetRateLimit.deleteMany({ where: { key: { in: [...keys] } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      await db.$disconnect();
    }
  });
