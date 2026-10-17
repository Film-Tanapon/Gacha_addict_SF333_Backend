if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

test('Google linking requires both identities and rejects legacy, stale and raced credentials',
  { skip: !process.env.TEST_DATABASE_URL }, async t => {
    const prisma = require('../src/config/prisma');
    const firebase = require('../src/config/firebase');
    const originalFirebase = firebase.initFirebase;
    const originalCompare = bcrypt.compare;
    const credentials = new Map();
    firebase.initFirebase = () => ({ auth: () => ({ verifyIdToken: async (token, revoked) => {
      assert.equal(revoked, true);
      if (!credentials.has(token)) throw new Error('Invalid test token');
      return credentials.get(token);
    } }) });
    const app = require('../index');
    const { signToken } = require('../src/utils/jwt');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const tag = `${Date.now()}-${process.pid}`;
    const ids = [];
    const password = 'ExistingPassword123';
    const passwordHash = await bcrypt.hash(password, 10);
    function google(email, label, overrides = {}) {
      const token = `test-google-${label}-${tag}`;
      credentials.set(token, { uid: `uid-${label}-${tag}`, email, email_verified: true,
        firebase: { sign_in_provider: 'google.com' }, auth_time: Math.floor(Date.now() / 1000), ...overrides });
      return token;
    }
    async function account(label, extra = {}) {
      const user = await prisma.user.create({ data: { email: `link-${label}-${tag}@example.invalid`,
        username: `link-${label}-${tag}`, password: passwordHash, ...extra } });
      ids.push(user.id);
      return user;
    }
    async function request(route, body, token) {
      const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json(), retryAfter: response.headers.get('retry-after') };
    }
    const snapshot = id => prisma.user.findUniqueOrThrow({ where: { id } });
    const login = user => request('/auth/login', { email: user.email, password });
    try {
      await t.test('new Google accounts and subsequent UID logins still work without a password', async () => {
        const email = `link-new-${tag}@example.invalid`;
        const idToken = google(email, 'new');
        const first = await request('/auth/google', { idToken });
        assert.equal(first.status, 200);
        ids.push(first.body.user.id);
        const user = await snapshot(first.body.user.id);
        assert.equal(user.googleLinkVerified, true);
        assert.equal(user.password, null);
        for (const key of ['password', 'googleId', 'googleLinkVerified', 'authVersion'])
          assert.equal(key in first.body.user, false);
        const again = await request('/auth/google', { idToken });
        assert.equal(again.status, 200);
        assert.equal(again.body.user.id, user.id);
      });

      await t.test('email collision does not auto-link, issue a token or trust a body flag', async () => {
        const user = await account('collision');
        const idToken = google(user.email.toUpperCase(), 'collision');
        for (const body of [{ idToken }, { idToken, password, allowLink: true, linkExisting: true }]) {
          const result = await request('/auth/google', body);
          assert.equal(result.status, 409);
          assert.equal(result.body.code, 'GOOGLE_LINK_REQUIRED');
          assert.equal(result.body.token, undefined);
          assert.equal(result.body.user, undefined);
        }
        assert.equal((await snapshot(user.id)).googleId, null);
        assert.equal((await snapshot(user.id)).authVersion, user.authVersion);
      });

      await t.test('missing/wrong passwords cannot link; confirmation revokes existing sessions', async () => {
        const user = await account('confirmed');
        const idToken = google(user.email, 'confirmed');
        const oldSession = await login(user);
        assert.equal(oldSession.status, 200);
        for (const value of [undefined, 'wrong-password', { invalid: true }]) {
          assert.equal((await request('/auth/google/link', { idToken, password: value })).status, 401);
          assert.equal((await snapshot(user.id)).googleId, null);
        }
        const linked = await request('/auth/google/link', { idToken, password });
        assert.equal(linked.status, 200);
        const stored = await snapshot(user.id);
        assert.equal(stored.googleId, credentials.get(idToken).uid);
        assert.equal(stored.googleLinkVerified, true);
        assert.equal(stored.password, user.password);
        assert.equal(stored.authVersion, user.authVersion + 1);
        assert.equal((await request('/auth/me', undefined, oldSession.body.token)).status, 401);
        assert.equal((await request('/auth/me', undefined, linked.body.token)).status, 200);
        assert.equal((await request('/auth/google', { idToken })).body.user.id, user.id);
        assert.equal((await login(user)).status, 200);
        assert.equal((await request('/auth/google/link', { idToken, password: 'wrong-again' })).status, 401);
      });

      await t.test('invalid, unverified and non-Google tokens never mutate an existing account', async () => {
        const user = await account('unverified');
        const tokens = ['invalid-token', google(user.email, 'unverified', { email_verified: false }),
          google(user.email, 'provider', { firebase: { sign_in_provider: 'password' } })];
        for (const idToken of tokens) {
          assert.equal((await request('/auth/google/link', { idToken, password })).status, 401);
          assert.equal((await snapshot(user.id)).googleId, null);
        }
      });

      await t.test('an existing Google UID cannot be replaced using a matching email/password', async () => {
        const user = await account('different', { googleId: `original-${tag}`, isGoogle: true, googleLinkVerified: true });
        const idToken = google(user.email, 'different');
        for (const route of ['/auth/google', '/auth/google/link'])
          assert.equal((await request(route, { idToken, password })).status, 409);
        assert.equal((await snapshot(user.id)).googleId, user.googleId);
      });

      await t.test('legacy automatic links cannot reuse passwords/sessions until both identities are confirmed', async () => {
        const user = await account('legacy', { googleId: `legacy-${tag}`, isGoogle: true });
        const idToken = google(user.email, 'legacy', { uid: user.googleId });
        const oldToken = signToken({ id: user.id, authVersion: user.authVersion });
        assert.equal((await login(user)).status, 401);
        assert.equal((await request('/auth/me', undefined, oldToken)).status, 401);
        const blocked = await request('/auth/google', { idToken });
        assert.equal(blocked.status, 409);
        assert.equal(blocked.body.code, 'GOOGLE_LINK_REQUIRED');
        const linked = await request('/auth/google/link', { idToken, password });
        assert.equal(linked.status, 200);
        assert.equal((await request('/auth/me', undefined, oldToken)).status, 401);
        assert.equal((await request('/auth/me', undefined, linked.body.token)).status, 200);
      });

      for (const legacy of [false, true]) {
        await t.test(`email OTP removes a squatter password before confirmation (legacy=${legacy})`, async () => {
          const label = legacy ? 'recover-legacy' : 'recover-new';
          const user = await account(label, legacy ? { googleId: `recover-${tag}`, isGoogle: true } : {});
          const oldToken = signToken({ id: user.id, authVersion: user.authVersion });
          const idToken = google(user.email, label, legacy ? { uid: user.googleId } : {});
          assert.equal((await request('/auth/google', { idToken })).status, 409);
          const { createPasswordResetService } = require('../src/services/passwordReset.service');
          let code;
          const recovery = createPasswordResetService({ autoDispatch: false,
            secret: () => `google-link-recovery-${tag}`, mailer: {
              assertConfigured() {}, async sendResetCode(_email, value) { code = value; }, async sendPasswordChanged() {},
            } });
          const challenge = await recovery.requestReset({ email: user.email }, label);
          await recovery.deliverPending();
          const verified = await recovery.verifyCode({ challengeId: challenge.challengeId, code }, label);
          const replacement = 'EmailOwnerNewPassword123';
          await recovery.resetPassword({ resetToken: verified.resetToken, password: replacement }, label);
          assert.equal((await request('/auth/me', undefined, oldToken)).status, 401);
          assert.equal((await request('/auth/google/link', { idToken, password })).status, 401);
          const result = await request('/auth/google/link', { idToken, password: replacement });
          assert.equal(result.status, 200);
          assert.equal(result.body.user.id, user.id);
          assert.equal((await request('/auth/me', undefined, result.body.token)).status, 200);
          assert.equal((await login(user)).status, 401);
        });
      }

      await t.test('legacy Google-only users are not locked out', async () => {
        const user = await account('googleonly', { googleId: `googleonly-${tag}`, isGoogle: true, password: null });
        const idToken = google(user.email, 'googleonly', { uid: user.googleId });
        const result = await request('/auth/google', { idToken });
        assert.equal(result.status, 200);
        assert.equal((await request('/auth/me', undefined, result.body.token)).status, 200);
        assert.equal((await request('/auth/google/link', { idToken, password })).status, 409);
      });

      await t.test('link confirmation requires recent Google authentication', async () => {
        const user = await account('stale');
        for (const auth_time of [undefined, Math.floor(Date.now() / 1000) - 600, Math.floor(Date.now() / 1000) + 120]) {
          const idToken = google(user.email, `stale-${auth_time}`, { auth_time });
          assert.equal((await request('/auth/google/link', { idToken, password })).status, 401);
        }
        assert.equal((await snapshot(user.id)).googleId, null);
      });

      await t.test('the link endpoint never creates a new user as a side effect', async () => {
        const email = `link-missing-${tag}@example.invalid`;
        const result = await request('/auth/google/link', { idToken: google(email, 'missing'), password });
        assert.equal(result.status, 409);
        assert.equal(await prisma.user.count({ where: { email } }), 0);
      });

      await t.test('password confirmation rate limits persist in the database and expire', async () => {
        const user = await account('limited');
        const idToken = google(user.email, 'limited');
        for (let i = 0; i < 5; i++)
          assert.equal((await request('/auth/google/link', { idToken, password: 'incorrect' })).status, 401);
        const blocked = await request('/auth/google/link', { idToken, password });
        assert.equal(blocked.status, 429);
        assert.ok(Number(blocked.retryAfter) > 0);
        assert.equal((await snapshot(user.id)).googleId, null);
        await prisma.passwordResetRateLimit.update({ where: { key: `google-link:${user.id}` }, data: { expiresAt: new Date(0) } });
        assert.equal((await request('/auth/google/link', { idToken, password })).status, 200);
      });

      await t.test('a concurrent password reset cannot be bypassed by a link checked against the old password', async () => {
        const user = await account('raced');
        const idToken = google(user.email, 'raced');
        const replacement = await bcrypt.hash('ReplacementPassword123', 10);
        bcrypt.compare = async (...args) => {
          const matches = await originalCompare(...args);
          await prisma.user.update({ where: { id: user.id }, data: { password: replacement, authVersion: { increment: 1 } } });
          return matches;
        };
        try {
          assert.equal((await request('/auth/google/link', { idToken, password })).status, 401);
          const stored = await snapshot(user.id);
          assert.equal(stored.googleId, null);
          assert.equal(stored.password, replacement);
        } finally { bcrypt.compare = originalCompare; }
      });
    } finally {
      bcrypt.compare = originalCompare;
      firebase.initFirebase = originalFirebase;
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      await prisma.passwordResetRateLimit.deleteMany({ where: { key: { in: ids.map(id => `google-link:${id}`) } } });
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await prisma.$disconnect();
    }
  });
