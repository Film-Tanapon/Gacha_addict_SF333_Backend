if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('card sync creates visible Card rows, maps IDs, retries without duplicates and isolates owners', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const prisma = require('../src/config/prisma');
  const app = require('../index');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const users = [];
  async function request(path, method = 'GET', body, token) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  async function register(suffix) {
    const tag = `${Date.now()}-${suffix}`;
    const result = await request('/auth/register', 'POST', { username: `sync-${tag}`, email: `sync-${tag}@example.com`, password: 'SyncTest123' });
    assert.equal(result.status, 201); users.push(result.body.user.id); return result.body;
  }
  const record = { id: 'local-card-stable', name: 'Offline Dinner', category: 'Custom', isEqualRate: false, isFavorite: false, pullManyCount: 5, randomList: [{ id: 'local-item', element: 'Pizza', rate: '100%' }], localUpdatedAt: '2026-10-08T10:00:00.000Z' };
  const builtin = { ...record, id: 'builtin-food', localUpdatedAt: undefined };
  const snapshot = { version: 1, gachas: [record, builtin], history: [] };
  try {
    const owner = await register('owner');
    const other = await register('other');
    const created = await request('/backup', 'PUT', { expectedRevision: 0, data: snapshot }, owner.token);
    assert.equal(created.status, 200);
    const serverId = created.body.cardIds[record.id];
    assert.ok(Number(serverId) > 0);
    assert.equal(created.body.cardIds[builtin.id], undefined);
    const stored = await prisma.card.findUnique({ where: { id: Number(serverId) }, include: { cardItems: true } });
    assert.equal(stored.title, record.name);
    assert.equal(stored.clientId, record.id);
    assert.equal(stored.createBy, owner.user.id);
    const itemIds = stored.cardItems.map(item => item.id);
    assert.ok((await request('/cards')).body.some(card => card.id === Number(serverId)));
    const retry = await request('/backup', 'PUT', { expectedRevision: 1, data: snapshot }, owner.token);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.cardIds[record.id], serverId);
    assert.equal(await prisma.card.count({ where: { createBy: owner.user.id, clientId: record.id } }), 1);
    assert.deepEqual((await prisma.cardItem.findMany({ where: { cardId: Number(serverId) } })).map(item => item.id), itemIds);
    const concurrent = await Promise.all([
      request('/backup', 'PUT', { expectedRevision: 2, data: snapshot }, owner.token),
      request('/backup', 'PUT', { expectedRevision: 2, data: snapshot }, owner.token),
    ]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
    assert.equal(await prisma.card.count({ where: { createBy: owner.user.id, clientId: record.id } }), 1);
    const edited = { ...record, name: 'Edited offline', localUpdatedAt: '2026-10-08T11:00:00.000Z', randomList: [{ id: 'rice', element: 'Rice', rate: '60%' }, { id: 'noodle', element: 'Noodles', rate: '40%' }] };
    const update = await request('/backup', 'PUT', { expectedRevision: 3, data: { ...snapshot, gachas: [edited] } }, owner.token);
    assert.equal(update.status, 200); assert.equal(update.body.cardIds[record.id], serverId);
    const visible = (await request(`/cards/${serverId}`)).body;
    assert.equal(visible.title, 'Edited offline'); assert.deepEqual(visible.cardItems.map(item => item.name).sort(), ['Noodles', 'Rice']);
    assert.equal((await request('/backup', 'GET', undefined, owner.token)).body.cardIds[record.id], serverId);
    assert.equal((await request('/backup', 'GET', undefined, other.token)).body.cardIds[record.id], undefined);
    const otherSync = await request('/backup', 'PUT', { expectedRevision: 0, data: snapshot }, other.token);
    assert.equal(otherSync.status, 200); assert.notEqual(otherSync.body.cardIds[record.id], serverId);
    assert.equal((await request('/backup')).status, 401);
    // A newer snapshot revision with older card content cannot roll back Card fields.
    const staleContent = await request('/backup', 'PUT', { expectedRevision: 4, data: snapshot }, owner.token);
    assert.equal(staleContent.status, 200);
    assert.equal((await request(`/cards/${serverId}`)).body.title, 'Edited offline');
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await new Promise(resolve => server.close(resolve));
    await prisma.$disconnect();
  }
});
