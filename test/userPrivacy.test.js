if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('public user reads omit private account fields while owner and admin reads retain them', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const prisma = require('../src/config/prisma');
  const app = require('../index');
  const { signToken } = require('../src/utils/jwt');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const userIds = [];
  const previousAdminKey = process.env.ADMIN_API_KEY;
  async function request(path, token, headers = {}) {
    const response = await fetch(base + path, { headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers,
    } });
    return { status: response.status, body: await response.json() };
  }
  const publicKeys = ['avatarUrl', 'frameColor', 'frameId', 'frameUrl', 'id', 'username'];
  try {
    const tag = `${Date.now()}-${process.pid}`;
    for (const label of ['owner', 'viewer']) {
      const user = await prisma.user.create({ data: {
        email: `privacy-${label}-${tag}@example.com`, username: `privacy-${label}-${tag}`,
        phoneNo: '0000000000', password: 'private-test-hash', avatarUrl: 'https://example.com/avatar.png',
      } });
      userIds.push(user.id);
    }
    const [ownerId, viewerId] = userIds;
    const ownerToken = signToken({ id: ownerId });
    const viewerToken = signToken({ id: viewerId });
    assert.equal((await request('/users')).status, 401);
    assert.equal((await request(`/users/${ownerId}`)).status, 401);
    const other = await request(`/users/${ownerId}`, viewerToken);
    assert.equal(other.status, 200);
    assert.deepEqual(Object.keys(other.body).sort(), publicKeys);
    assert.equal(other.body.avatarUrl, 'https://example.com/avatar.png');
    const list = await request('/users?take=100', viewerToken);
    assert.equal(list.status, 200);
    assert.ok(list.body.length > 0);
    for (const user of list.body) assert.deepEqual(Object.keys(user).sort(), publicKeys);
    for (const path of [`/users/${ownerId}`, '/auth/me']) {
      const own = await request(path, ownerToken);
      assert.equal(own.status, 200);
      assert.equal(own.body.email, `privacy-owner-${tag}@example.com`);
      assert.equal(own.body.phoneNo, '0000000000');
      assert.equal(own.body.password, undefined);
      assert.equal(own.body.googleId, undefined);
    }
    assert.equal((await request('/wallet', ownerToken)).body.coins, 20);
    const missing = await request('/users/2147483647', viewerToken);
    assert.equal(missing.status, 404);
    process.env.ADMIN_API_KEY = `privacy-admin-${tag}`;
    assert.equal((await request('/admin/data/users', viewerToken)).status, 401);
    const admin = await request('/admin/data/users?take=100', null, { 'X-Admin-Key': process.env.ADMIN_API_KEY });
    assert.equal(admin.status, 200);
    assert.ok(admin.body.rows.every(user => typeof user.email === 'string'));
    assert.ok(admin.body.rows.every(user => !('password' in user) && !('googleId' in user)));
  } finally {
    if (previousAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousAdminKey;
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await prisma.$disconnect();
  }
});
