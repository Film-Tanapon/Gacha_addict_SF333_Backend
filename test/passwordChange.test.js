if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

test('password changes require fresh owner proof and revoke every old session atomically',
  { skip: !process.env.TEST_DATABASE_URL }, async t => {
    const prisma = require('../src/config/prisma');
    const firebase = require('../src/config/firebase');
    const originalFirebase = firebase.initFirebase;
    const originalHash = bcrypt.hash;
    const proofs = new Map();
    firebase.initFirebase = () => ({ auth: () => ({ verifyIdToken: async (token, revoked) => {
      assert.equal(revoked, true);
      if (!proofs.has(token)) throw new Error('Invalid test Google token');
      return proofs.get(token);
    } }) });
    const mail = require('../src/services/mail.service');
    const originalNotice = mail.sendPasswordChanged;
    const notices = [];
    mail.sendPasswordChanged = async email => { notices.push(email); };
    const app = require('../index');
    const { signToken } = require('../src/utils/jwt');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const tag = `${Date.now()}-${process.pid}`;
    const ids = [];
    const oldPassword = 'OriginalPassword123';
    const newPassword = 'ReplacementPassword123';
    const oldHash = await bcrypt.hash(oldPassword, 10);
    const read = id => prisma.user.findUniqueOrThrow({ where: { id } });
    async function account(label, extra = {}) {
      const user = await prisma.user.create({ data: { email: `change-${label}-${tag}@example.invalid`,
        username: `change-${label}-${tag}`, password: oldHash, ...extra } });
      ids.push(user.id);
      return { ...user, token: signToken({ id: user.id, authVersion: user.authVersion }) };
    }
    function google(user, label, overrides = {}) {
      const token = `google-change-${label}-${tag}`;
      proofs.set(token, { uid: user.googleId, email: user.email, email_verified: true,
        firebase: { sign_in_provider: 'google.com' }, auth_time: Math.floor(Date.now() / 1000), ...overrides });
      return token;
    }
    async function request(route, method = 'POST', body, token) {
      const response = await fetch(base + route, { method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json(), retryAfter: response.headers.get('retry-after') };
    }
    const change = (user, body) => request('/auth/password/change', 'POST', body, user.token);
    const login = (user, password) => request('/auth/login', 'POST', { email: user.email, password });
    try {
      await t.test('a session alone cannot change a password and profile routes reject even valid proofs', async () => {
        const user = await account('blocked');
        const body = { newPassword, currentPassword: oldPassword };
        assert.equal((await request('/auth/password/change', 'POST', body)).status, 401);
        for (const route of ['/profile', `/users/${user.id}`]) {
          for (const password of ['x', null, newPassword]) {
            assert.equal((await request(route, 'PUT', { password, currentPassword: oldPassword, username: 'should-not-save' }, user.token)).status, 400);
          }
        }
        assert.equal((await change(user, { newPassword })).status, 401);
        assert.equal((await change(user, { currentPassword: 'wrong', newPassword })).status, 401);
        const stored = await read(user.id);
        assert.equal(stored.username, user.username);
        assert.equal(stored.password, user.password);
        assert.equal(stored.authVersion, user.authVersion);
      });

      await t.test('signup and change reject the same weak, short and oversized UTF-8 passwords', async () => {
        const user = await account('policy');
        for (const password of ['Ab1', 'abcdefgh', 'ABCDEFGH1', 'abc12345', 'Aa1' + 'ก'.repeat(24)]) {
          assert.equal((await request('/auth/register', 'POST', { email: `weak-${tag}@example.invalid`, username: `weak-${tag}`, password })).status, 400);
          assert.equal((await change(user, { currentPassword: oldPassword, newPassword: password })).status, 400);
        }
        assert.equal(await prisma.user.count({ where: { email: `weak-${tag}@example.invalid` } }), 0);
        assert.equal((await read(user.id)).password, user.password);
      });

      await t.test('correct current password changes only its owner, removes OTP challenges and revokes both sessions', async () => {
        const user = await account('owner');
        const other = await account('other');
        const secondSession = await login(user, oldPassword);
        assert.equal(secondSession.status, 200);
        await prisma.passwordResetChallenge.create({ data: {
          id: `change-challenge-${tag}`, emailKey: `change-email-${tag}`, userId: user.id,
          authVersion: user.authVersion, codeHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 600000),
        } });
        const result = await change(user, { currentPassword: oldPassword, newPassword, userId: other.id });
        assert.equal(result.status, 200);
        assert.equal(result.body.token, undefined);
        assert.equal((await request('/auth/me', 'GET', undefined, user.token)).status, 401);
        assert.equal((await request('/auth/me', 'GET', undefined, secondSession.body.token)).status, 401);
        assert.equal((await login(user, oldPassword)).status, 401);
        assert.equal((await login(user, newPassword)).status, 200);
        assert.equal((await read(other.id)).password, other.password);
        assert.equal(await prisma.passwordResetChallenge.count({ where: { userId: user.id } }), 0);
        await new Promise(resolve => setImmediate(resolve));
        assert.ok(notices.includes(user.email));
      });

      await t.test('old accounts can prove an existing weak password without applying new-password rules to it', async () => {
        const user = await account('oldweak', { password: await bcrypt.hash('x', 10) });
        assert.equal((await change(user, { currentPassword: 'x', newPassword })).status, 200);
        assert.equal((await login(user, newPassword)).status, 200);
      });

      await t.test('Google-only users can set an app password with fresh proof of the same Google identity', async () => {
        const user = await account('google', { password: null, googleId: `change-google-${tag}`, isGoogle: true, googleLinkVerified: true });
        assert.equal((await change(user, { currentPassword: oldPassword, newPassword })).status, 401);
        const firebaseIdToken = google(user, 'valid');
        const result = await change(user, { firebaseIdToken, newPassword });
        assert.equal(result.status, 200);
        assert.equal((await request('/auth/me', 'GET', undefined, user.token)).status, 401);
        assert.equal((await login(user, newPassword)).status, 200);
        assert.equal((await read(user.id)).googleId, user.googleId);
        assert.equal((await read(user.id)).googleLinkVerified, true);
      });

      await t.test('invalid, stale, future, unverified and different Google proofs cannot change a password', async () => {
        const user = await account('proofs', { googleId: `change-proofs-${tag}`, isGoogle: true, googleLinkVerified: true });
        const variants = [null, 'invalid-token', google(user, 'different', { uid: 'different-user' }),
          google(user, 'expired', { auth_time: Math.floor(Date.now() / 1000) - 600 }),
          google(user, 'future', { auth_time: Math.floor(Date.now() / 1000) + 120 })];
        for (const firebaseIdToken of variants) assert.equal((await change(user, { firebaseIdToken, newPassword })).status, 401);
        await prisma.passwordResetRateLimit.deleteMany({ where: { key: `password-change:${user.id}` } });
        for (const overrides of [{ email_verified: false }, { firebase: { sign_in_provider: 'password' } }, { auth_time: undefined }])
          assert.equal((await change(user, { firebaseIdToken: google(user, JSON.stringify(overrides), overrides), newPassword })).status, 401);
        assert.equal((await read(user.id)).password, user.password);
      });

      await t.test('a Google token cannot change an email-only account or supply both confirmation methods', async () => {
        const user = await account('emailonly');
        const firebaseIdToken = google(user, 'unlinked', { uid: 'not-linked' });
        assert.equal((await change(user, { firebaseIdToken, newPassword })).status, 401);
        assert.equal((await change(user, { currentPassword: oldPassword, firebaseIdToken, newPassword })).status, 400);
      });

      await t.test('linked Google accounts can also use their existing app password', async () => {
        const user = await account('linked', { googleId: `change-linked-${tag}`, isGoogle: true, googleLinkVerified: true });
        assert.equal((await change(user, { currentPassword: oldPassword, newPassword })).status, 200);
      });

      await t.test('incorrect confirmation is bounded and rate limits survive until their expiry', async () => {
        const user = await account('limited');
        for (let i = 0; i < 5; i++) assert.equal((await change(user, { currentPassword: 'wrong', newPassword })).status, 401);
        const blocked = await change(user, { currentPassword: oldPassword, newPassword });
        assert.equal(blocked.status, 429);
        assert.ok(Number(blocked.retryAfter) > 0);
        await prisma.passwordResetRateLimit.update({ where: { key: `password-change:${user.id}` }, data: { expiresAt: new Date(0) } });
        assert.equal((await change(user, { currentPassword: oldPassword, newPassword })).status, 200);
      });

      await t.test('a password reset during verification invalidates the in-flight change', async () => {
        const user = await account('race');
        const replacementHash = await bcrypt.hash('OtherResetPassword123', 10);
        bcrypt.hash = async (...args) => {
          const hashed = await originalHash(...args);
          await prisma.user.update({ where: { id: user.id }, data: { password: replacementHash, authVersion: { increment: 1 } } });
          return hashed;
        };
        try {
          assert.equal((await change(user, { currentPassword: oldPassword, newPassword })).status, 401);
          assert.equal((await read(user.id)).password, replacementHash);
        } finally { bcrypt.hash = originalHash; }
      });

      await t.test('two simultaneous changes cannot both consume the same old session', async () => {
        const user = await account('concurrent');
        const replacements = ['ConcurrentPassword123', 'AnotherPassword123'];
        const results = await Promise.all(replacements.map(value => change(user, { currentPassword: oldPassword, newPassword: value })));
        assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
        assert.equal((await login(user, replacements[results.findIndex(result => result.status === 200)])).status, 200);
      });
    } finally {
      bcrypt.hash = originalHash;
      await new Promise(resolve => setImmediate(resolve));
      mail.sendPasswordChanged = originalNotice;
      firebase.initFirebase = originalFirebase;
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      await prisma.passwordResetRateLimit.deleteMany({ where: { key: { in: ids.map(id => `password-change:${id}`) } } });
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await prisma.$disconnect();
    }
  });
