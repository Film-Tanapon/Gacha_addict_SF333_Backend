if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { validatePassword } = require('../src/utils/password');

test('new reset passwords reject weak values and bcrypt truncation', () => {
  for (const value of [null, 'Abc123', 'abcdefgh', 'ABCDEFGH1', 'abc12345', 'Aa1' + 'ก'.repeat(24)])
    assert.throws(() => validatePassword(value), { status: 400 });
  assert.equal(validatePassword('NewPassword123'), 'NewPassword123');
});

test('password recovery is one-time, bounded, restart-safe and revokes old sessions',
  { skip: !process.env.TEST_DATABASE_URL }, async t => {
    const prisma = require('../src/config/prisma');
    const { createPasswordResetService } = require('../src/services/passwordReset.service');
    const app = require('../index');
    const { signToken } = require('../src/utils/jwt');
    const mail = require('../src/services/mail.service');
    const originalMail = { ...mail };
    const codes = [];
    const notices = [];
    const mailer = { assertConfigured() {}, async sendResetCode(email, code) { codes.push({ email, code }); },
      async sendPasswordChanged(email) { notices.push(email); } };
    // The real HTTP routes use this transport stub, so tests never send email.
    Object.assign(mail, mailer);
    let now = new Date();
    const options = { clock: () => now, autoDispatch: false, mailer, secret: () => 'reset-test-secret-'.repeat(4) };
    const service = createPasswordResetService(options);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const tag = `${Date.now()}-${process.pid}`;
    const users = [];
    const oldPassword = await bcrypt.hash('OldPassword123', 10);
    async function http(path, method = 'GET', body, token) {
      const response = await fetch(base + path, { method, headers: {
        'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, headers: response.headers, body: await response.json() };
    }
    async function issue(email = users[0].email) {
      const result = await service.requestReset({ email }, 'ip-one');
      await service.deliverPending();
      return { ...result, code: codes.at(-1)?.code };
    }
    try {
      for (const [label, password] of [['owner', oldPassword], ['other', oldPassword], ['google', null]]) {
        users.push(await prisma.user.create({ data: { username: `reset-${label}-${tag}`,
          email: `reset-${label}-${tag}@example.com`, password, isGoogle: label === 'google' } }));
      }
      const owner = users[0];
      t.beforeEach(async () => {
        now = new Date(); codes.length = 0; notices.length = 0;
        await prisma.passwordResetChallenge.deleteMany();
        await prisma.passwordResetRateLimit.deleteMany();
        await prisma.user.update({ where: { id: owner.id }, data: { password: oldPassword, authVersion: 0 } });
      });

      await t.test('queues encrypted mail, returns no OTP, and does not reveal account existence', async () => {
        const existing = await service.requestReset({ email: owner.email }, 'ip-one');
        assert.equal(codes.length, 0);
        const stored = await prisma.passwordResetChallenge.findUniqueOrThrow({ where: { id: existing.challengeId } });
        assert.ok(stored.encryptedCode);
        assert.notEqual(stored.codeHash, stored.encryptedCode);
        assert.equal(JSON.stringify(existing).includes('code'), false);
        const missing = await service.requestReset({ email: `missing-${tag}@example.com` }, 'ip-one');
        const google = await service.requestReset({ email: users[2].email }, 'ip-one');
        assert.equal(missing.message, existing.message);
        assert.equal(google.message, existing.message);
        assert.deepEqual(Object.keys(existing), Object.keys(missing));
        await service.deliverPending();
        assert.equal(codes.length, 1);
        assert.match(codes[0].code, /^\d{6}$/);
        assert.notEqual(stored.codeHash, codes[0].code);
        assert.equal((await prisma.passwordResetChallenge.findUniqueOrThrow({ where: { id: stored.id } })).encryptedCode, null);
      });

      await t.test('resets exactly once, invalidates old JWTs, and accepts the new password', async () => {
        const request = await issue();
        const verified = await service.verifyCode(request, 'ip-one');
        await assert.rejects(service.verifyCode(request, 'ip-one'), { status: 400 });
        const token = signToken({ id: owner.id }); // Compatibility with pre-version JWTs.
        assert.equal((await http('/auth/me', 'GET', undefined, token)).status, 200);
        await service.resetPassword({ resetToken: verified.resetToken, password: 'NewPassword123' }, 'ip-one');
        assert.equal((await http('/auth/me', 'GET', undefined, token)).status, 401);
        await assert.rejects(service.resetPassword({ resetToken: verified.resetToken, password: 'AgainPassword123' }, 'ip-one'), { status: 400 });
        assert.equal((await http('/auth/login', 'POST', { email: owner.email, password: 'OldPassword123' })).status, 401);
        const login = await http('/auth/login', 'POST', { email: owner.email, password: 'NewPassword123' });
        assert.equal(login.status, 200);
        assert.equal((await http('/auth/me', 'GET', undefined, login.body.token)).status, 200);
        const stored = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
        assert.ok(await bcrypt.compare('NewPassword123', stored.password));
        assert.equal(stored.authVersion, 1);
        assert.equal(await prisma.passwordResetChallenge.count({ where: { userId: owner.id } }), 0);
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(notices, [owner.email]);
      });

      await t.test('wrong attempts persist and lock the code after five failures', async () => {
        const request = await issue();
        const wrong = request.code === '000000' ? '111111' : '000000';
        for (let i = 0; i < 5; i++) await assert.rejects(service.verifyCode({ ...request, code: wrong }, 'ip-one'), { status: 400 });
        const stored = await prisma.passwordResetChallenge.findUniqueOrThrow({ where: { id: request.challengeId } });
        assert.equal(stored.attempts, 5);
        await assert.rejects(service.verifyCode(request, 'ip-one'), { status: 400 });
      });

      await t.test('codes and verified tokens expire independently', async () => {
        const request = await issue();
        now = new Date(now.getTime() + 600001);
        await assert.rejects(service.verifyCode(request, 'ip-one'), { status: 400 });
        const next = await issue(users[1].email);
        const verified = await service.verifyCode(next, 'ip-one');
        now = new Date(now.getTime() + 300001);
        await assert.rejects(service.resetPassword({ ...verified, password: 'NewPassword123' }, 'ip-one'), { status: 400 });
      });

      await t.test('resending invalidates the previous challenge and survives a service restart', async () => {
        const previous = await issue();
        await assert.rejects(service.requestReset({ email: owner.email }, 'ip-one'), { status: 429 });
        now = new Date(now.getTime() + 61000);
        const next = await issue();
        await assert.rejects(service.verifyCode(previous, 'ip-one'), { status: 400 });
        const restarted = createPasswordResetService(options);
        assert.ok((await restarted.verifyCode(next, 'ip-one')).resetToken);
      });

      await t.test('concurrent verification and completion each succeed only once', async () => {
        const request = await issue();
        const attempts = await Promise.allSettled([service.verifyCode(request, 'ip-one'), service.verifyCode(request, 'ip-one')]);
        assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
        const verified = attempts.find(result => result.status === 'fulfilled').value;
        const resets = await Promise.allSettled([
          service.resetPassword({ ...verified, password: 'NewPassword123' }, 'ip-one'),
          service.resetPassword({ ...verified, password: 'AnotherPassword123' }, 'ip-one'),
        ]);
        assert.equal(resets.filter(result => result.status === 'fulfilled').length, 1);
      });

      await t.test('a password change after issuance invalidates the outstanding recovery flow', async () => {
        const request = await issue();
        await prisma.user.update({ where: { id: owner.id }, data: { authVersion: { increment: 1 } } });
        await assert.rejects(service.verifyCode(request, 'ip-one'), { status: 400 });
      });

      await t.test('rate limits email requests and brute force across challenge IDs', async () => {
        const request = await issue();
        const wrong = request.code === '000000' ? '111111' : '000000';
        for (let index = 0; index < 60; index++)
          await assert.rejects(service.verifyCode({ ...request, code: wrong }, 'abuse-ip'), { status: 400 });
        await assert.rejects(service.verifyCode(request, 'abuse-ip'), { status: 429 });
        for (let index = 0; index < 4; index++) { now = new Date(now.getTime() + 61000); await issue(); }
        now = new Date(now.getTime() + 61000);
        await assert.rejects(service.requestReset({ email: owner.email }, 'ip-one'), { status: 429 });
      });

      await t.test('HTTP endpoints are public, no-store, and expose no reset credentials before verification', async () => {
        const requested = await http('/auth/password-reset/request', 'POST', { email: owner.email });
        assert.equal(requested.status, 202);
        assert.equal(requested.headers.get('cache-control'), 'no-store');
        await require('../src/services/passwordReset.service').deliverPending();
        const row = await prisma.passwordResetChallenge.findUniqueOrThrow({ where: { id: requested.body.challengeId } });
        assert.equal(row.resetTokenHash, null);
        // Drain a possible asynchronous dispatch before reading the captured message.
        for (let i = 0; codes.length === 0 && i < 20; i++) await new Promise(resolve => setTimeout(resolve, 10));
        const verified = await http('/auth/password-reset/verify', 'POST', { challengeId: row.id, code: codes[0].code });
        assert.equal(verified.status, 200);
        const completed = await http('/auth/password-reset/complete', 'POST', { ...verified.body, password: 'NewPassword123' });
        assert.equal(completed.status, 200);
        assert.equal(completed.body.token, undefined);
        const again = await http('/auth/password-reset/request', 'POST', { email: owner.email });
        assert.equal(again.status, 429);
        assert.ok(Number(again.headers.get('retry-after')) > 0);
      });

      await t.test('SMTP failure stays queued and retries after a restart without storing a plain OTP', async context => {
        context.mock.method(console, 'error', () => {});
        const failing = createPasswordResetService({ ...options, mailer: {
          ...mailer, async sendResetCode() { throw new Error('mock SMTP unavailable'); },
        } });
        const requested = await failing.requestReset({ email: owner.email }, 'ip-one');
        await failing.deliverPending();
        const pending = await prisma.passwordResetChallenge.findUniqueOrThrow({ where: { id: requested.challengeId } });
        assert.equal(pending.deliveryAttempts, 1);
        assert.ok(pending.encryptedCode);
        assert.equal(codes.length, 0);
        now = new Date(now.getTime() + 61000);
        const restarted = createPasswordResetService(options);
        await restarted.deliverPending();
        assert.equal(codes.length, 1);
        assert.ok((await restarted.verifyCode({ challengeId: requested.challengeId, code: codes[0].code }, 'ip-one')).resetToken);
      });

      await t.test('a later password change invalidates an already verified reset token', async () => {
        const request = await issue();
        const verified = await service.verifyCode(request, 'ip-one');
        await prisma.user.update({ where: { id: owner.id }, data: { authVersion: { increment: 1 } } });
        await assert.rejects(service.resetPassword({ ...verified, password: 'NewPassword123' }, 'ip-one'), { status: 400 });
      });

      await t.test('limits request spam from the same IP even for nonexistent addresses', async () => {
        for (let index = 0; index < 30; index++)
          await service.requestReset({ email: `missing-${index}-${tag}@example.com` }, 'request-abuse-ip');
        await assert.rejects(service.requestReset({ email: owner.email }, 'request-abuse-ip'), { status: 429 });
      });

      await t.test('malformed payloads cannot verify or complete a reset', async () => {
        await assert.rejects(service.requestReset(null), { status: 400 });
        await assert.rejects(service.verifyCode({ challengeId: ['a'.repeat(48)], code: '123456' }), { status: 400 });
        await assert.rejects(service.verifyCode({ challengeId: 'a'.repeat(48), code: 123456 }), { status: 400 });
        await assert.rejects(service.resetPassword({ resetToken: [], password: 'NewPassword123' }), { status: 400 });
      });

      await t.test('expired records are removed and deleted users cascade their recovery records', async () => {
        await issue();
        now = new Date(now.getTime() + 3600001);
        await service.cleanup();
        assert.equal(await prisma.passwordResetChallenge.count(), 0);
        assert.equal(await prisma.passwordResetRateLimit.count(), 0);
        await issue(users[1].email);
        await prisma.user.delete({ where: { id: users[1].id } });
        assert.equal(await prisma.passwordResetChallenge.count({ where: { userId: users[1].id } }), 0);
      });
    } finally {
      Object.assign(mail, originalMail);
      await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
      await prisma.passwordResetChallenge.deleteMany();
      await prisma.passwordResetRateLimit.deleteMany();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await prisma.$disconnect();
    }
  });
