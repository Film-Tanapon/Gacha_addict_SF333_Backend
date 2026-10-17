if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('profile frame URLs enforce catalog ownership on every user-facing entry point',
  { skip: !process.env.TEST_DATABASE_URL }, async t => {
    const prisma = require('../src/config/prisma');
    const app = require('../index');
    const { signToken } = require('../src/utils/jwt');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const tag = `frame-url-${Date.now()}-${process.pid}`;
    const frames = [
      { id: `${tag}-free`, name: 'Free', price: 0, color: '#3b82f6', imageUrl: `/api/uploads/${tag}-free.webp`, decoration: '' },
      { id: `${tag}-paid`, name: 'Paid', price: 25, color: '#ec4899', imageUrl: `/api/uploads/${tag}-paid.webp`, decoration: '' },
      { id: `${tag}-other`, name: 'Other', price: 50, color: '#8b5cf6', imageUrl: `/api/uploads/${tag}-other.webp`, decoration: '' },
    ];
    const [free, paid, other] = frames;
    const frameIds = frames.map(frame => frame.id);
    const userIds = [];
    let token;
    async function request(path, method = 'GET', body, auth = token) {
      const response = await fetch(base + path, { method, headers: {
        'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    }
    async function register(fields) {
      const name = `${tag}-${userIds.length}`;
      const result = await request('/auth/register', 'POST', {
        email: `${name}@example.com`, username: name, password: 'TestPassword123', ...fields,
      }, null);
      if (result.status === 201) userIds.push(result.body.user.id);
      return result;
    }
    function assertFrame(user, frame) {
      assert.equal(user.frameId, frame.id);
      assert.equal(user.frameUrl, frame.imageUrl);
      assert.equal(user.frameColor, frame.color);
    }
    try {
      await prisma.frame.createMany({ data: frames });
      const owner = await prisma.user.create({ data: {
        username: `${tag}-owner`, email: `${tag}-owner@example.com`, coins: 100,
      } });
      userIds.push(owner.id);
      const outsider = await prisma.user.create({ data: {
        username: `${tag}-outsider`, email: `${tag}-outsider@example.com`,
      } });
      userIds.push(outsider.id);
      await prisma.userFrame.create({ data: { userId: outsider.id, frameId: paid.id } });
      token = signToken({ id: owner.id });
      t.beforeEach(async () => {
        await prisma.userFrame.deleteMany({ where: { userId: owner.id } });
        await prisma.user.update({ where: { id: owner.id }, data: {
          frameId: null, frameUrl: null, frameColor: '#d1d5db', coins: 100,
        } });
      });

      await t.test('requires authentication and keeps updates owner-only', async () => {
        assert.equal((await request('/profile', 'PUT', { frameUrl: free.imageUrl }, null)).status, 401);
        assert.equal((await request(`/users/${outsider.id}`, 'PUT', { frameUrl: free.imageUrl })).status, 403);
      });

      await t.test('rejects unpurchased URLs even when another user owns that frame', async () => {
        for (const path of ['/profile', `/users/${owner.id}`]) {
          assert.equal((await request(path, 'PUT', { frameUrl: paid.imageUrl, username: 'must-not-save' })).status, 403);
          assert.equal((await request(path, 'PUT', { frameId: null, frameUrl: paid.imageUrl })).status, 403);
        }
        assert.equal((await request(`/frames/${paid.id}/select`, 'PUT')).status, 403);
        const stored = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
        assert.equal(stored.frameUrl, null);
        assert.equal(stored.username, owner.username);
        assert.equal(stored.coins, 100);
      });

      await t.test('selects a free URL and derives all frame fields from the catalog', async () => {
        const result = await request('/profile', 'PUT', { frameUrl: ` ${free.imageUrl} `, frameColor: '#000000' });
        assert.equal(result.status, 200);
        assertFrame(result.body, free);
        assertFrame((await request('/auth/me')).body, free);
        assert.equal((await request('/wallet')).body.coins, 100);
      });

      await t.test('accepts purchased URLs through both profile endpoints without charging again', async () => {
        assert.equal((await request(`/frames/${paid.id}/purchase`, 'POST')).status, 200);
        for (const path of ['/profile', `/users/${owner.id}`]) {
          const result = await request(path, 'PUT', { frameUrl: paid.imageUrl });
          assert.equal(result.status, 200);
          assertFrame(result.body, paid);
        }
        assertFrame(await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }), paid);
        assert.equal((await request('/wallet')).body.coins, 75);
      });

      await t.test('rejects mismatched IDs and URLs instead of combining free and paid frames', async () => {
        for (const fields of [
          { frameId: free.id, frameUrl: paid.imageUrl },
          { frameId: free.id, frameUrl: 'https://other.example/frame.png' },
        ]) assert.equal((await request('/profile', 'PUT', fields)).status, 400);
        assert.equal((await request('/auth/me')).body.frameUrl, null);
      });

      await t.test('rejects unknown selectors, other hosts, and invalid field types', async () => {
        for (const fields of [
          { frameId: `${tag}-missing` },
          { frameUrl: '/api/uploads/not-a-catalog-frame.webp' },
          { frameUrl: `https://other.example${free.imageUrl}` },
        ]) assert.equal((await request('/profile', 'PUT', fields)).status, 404);
        for (const fields of [{ frameId: 1 }, { frameUrl: 1 }, { frameUrl: {} }, { frameUrl: [] }])
          assert.equal((await request('/profile', 'PUT', fields)).status, 400);
      });

      await t.test('selecting by ID also fills canonical URL and color', async () => {
        const result = await request('/profile', 'PUT', { frameId: free.id });
        assert.equal(result.status, 200);
        assertFrame(result.body, free);
        const selected = await request(`/frames/${free.id}/select`, 'PUT');
        assert.equal(selected.status, 200);
        assertFrame(selected.body, free);
      });

      await t.test('clears both selectors while preserving the requested fallback color', async () => {
        await request(`/frames/${free.id}/select`, 'PUT');
        const result = await request('/profile', 'PUT', { frameUrl: null, frameColor: '#8b5cf6' });
        assert.equal(result.status, 200);
        assert.equal(result.body.frameId, null);
        assert.equal(result.body.frameUrl, null);
        assert.equal(result.body.frameColor, '#8b5cf6');
        await request(`/frames/${free.id}/select`, 'PUT');
        const clearedId = await request('/profile', 'PUT', { frameId: null });
        assert.equal(clearedId.body.frameId, null);
        assert.equal(clearedId.body.frameUrl, null);
      });

      await t.test('color-only updates do not clear an existing frame', async () => {
        await request(`/frames/${free.id}/select`, 'PUT');
        const result = await request('/profile', 'PUT', { frameColor: '#8b5cf6' });
        assert.equal(result.status, 200);
        assert.equal(result.body.frameColor, '#8b5cf6');
        assert.equal(result.body.frameId, free.id);
        assert.equal(result.body.frameUrl, free.imageUrl);
      });

      await t.test('signup accepts free URLs and color-only frames but rejects paid URLs and unknown IDs', async () => {
        const freeSignup = await register({ frameUrl: free.imageUrl });
        assert.equal(freeSignup.status, 201);
        assertFrame(freeSignup.body.user, free);
        const colorSignup = await register({ frameColor: '#8b5cf6', frameId: null });
        assert.equal(colorSignup.status, 201);
        assert.equal(colorSignup.body.user.frameColor, '#8b5cf6');
        assert.equal(colorSignup.body.user.frameUrl, null);
        assert.equal((await register({ frameUrl: paid.imageUrl })).status, 403);
        assert.equal((await register({ frameId: paid.id, frameUrl: paid.imageUrl })).status, 403);
        assert.equal((await register({ frameId: free.id, frameUrl: paid.imageUrl })).status, 400);
        assert.equal((await register({ frameId: `${tag}-missing` })).status, 404);
        assert.equal((await register({ frameUrl: '/api/uploads/missing.webp' })).status, 404);
        const rejectedName = `${tag}-${userIds.length}`;
        assert.equal(await prisma.user.count({ where: { username: rejectedName } }), 0);
      });

      await t.test('requires an explicit frame ID for shared URLs and checks ownership of that ID', async () => {
        const duplicate = { ...paid, id: `${tag}-duplicate` };
        frameIds.push(duplicate.id);
        await prisma.frame.create({ data: duplicate });
        await request(`/frames/${paid.id}/purchase`, 'POST');
        assert.equal((await request('/profile', 'PUT', { frameUrl: paid.imageUrl })).status, 400);
        const selected = await request('/profile', 'PUT', { frameId: paid.id, frameUrl: paid.imageUrl });
        assert.equal(selected.status, 200);
        assertFrame(selected.body, paid);
        assert.equal((await request('/profile', 'PUT', { frameId: duplicate.id, frameUrl: duplicate.imageUrl })).status, 403);
        assert.equal((await request('/profile', 'PUT', { frameId: other.id })).status, 403);
      });
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.frame.deleteMany({ where: { id: { in: frameIds } } });
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await prisma.$disconnect();
    }
  });
