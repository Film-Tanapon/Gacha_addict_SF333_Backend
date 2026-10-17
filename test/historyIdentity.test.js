if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeHistory } = require('../src/utils/backup');
const entry = (id, gachaId, gachaName = 'Same name') => ({ id, ...(gachaId == null ? {} : { gachaId }),
  gachaName, resultElement: id, pulledAt: '2026-10-17T00:00:00.000Z' });

test('backup history validates optional deck identity while keeping legacy entries', () => {
  assert.deepEqual(normalizeHistory(entry('h', 'local-deck')), entry('h', 'local-deck'));
  assert.deepEqual(normalizeHistory(entry('h')), entry('h'));
  assert.equal(normalizeHistory({ ...entry('h'), gachaId: null }).gachaId, undefined);
  assert.equal(normalizeHistory(entry('h', 'a'.repeat(500))).gachaId.length, 500);
  for (const gachaId of ['', ' ', 12, {}, 'a'.repeat(501)])
    assert.throws(() => normalizeHistory({ ...entry('h'), gachaId }));
});

test('history identities survive backup retries, server pulls, rename, item replacement and migration',
  { skip: !process.env.TEST_DATABASE_URL }, async t => {
    const app = require('../index');
    const prisma = require('../src/config/prisma');
    const { signToken } = require('../src/utils/jwt');
    const results = require('../src/services/result.service');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const tag = `${Date.now()}-${process.pid}`;
    const ids = [];
    async function account(label) {
      const user = await prisma.user.create({ data: { username: `history-id-${label}-${tag}`, email: `history-id-${label}-${tag}@example.invalid` } });
      ids.push(user.id); return { ...user, token: signToken({ id: user.id, authVersion: user.authVersion }) };
    }
    async function request(user, route, method = 'GET', body) {
      const response = await fetch(base + route, { method,
        headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    }
    try {
      const owner = await account('owner'), other = await account('other');
      const entries = [entry('a-old', 'local-a', 'Old name'), entry('a-new', 'local-a'), entry('b', 'local-b'), entry('legacy')];
      await t.test('paged and legacy backups preserve IDs and an old client cannot erase an accepted ID', async () => {
        const upload = await request(owner, '/backup/history', 'POST', { entries });
        assert.equal(upload.status, 200); assert.deepEqual(upload.body.acceptedIds, entries.map(row => row.id));
        let page = await request(owner, '/backup/history');
        assert.deepEqual(page.body.entries, entries);
        assert.equal((await request(other, '/backup/history')).body.entries.length, 0);
        const legacyEntries = entries.map(({ gachaId, ...row }) => row);
        const legacy = await request(owner, '/backup', 'PUT', { expectedRevision: 0, data: { version: 1, gachas: [], history: legacyEntries } });
        assert.equal(legacy.status, 200);
        page = await request(owner, '/backup/history'); assert.deepEqual(page.body.entries, entries);
        const snapshot = await request(owner, '/backup');
        for (const row of entries) assert.deepEqual(snapshot.body.data.history.find(h => h.id === row.id), row);
        const retry = await request(owner, '/backup/history', 'POST', { entries: [entry('a-old', 'different-deck')] });
        assert.equal(retry.status, 200);
        assert.equal((await prisma.backupHistory.findUniqueOrThrow({ where: { userId_clientId: { userId: owner.id, clientId: 'a-old' } } })).gachaId, 'local-a');
      });
      await t.test('an invalid deck ID rejects only that record', async () => {
        const uploaded = await request(owner, '/backup/history', 'POST', { entries: [entry('bad', 'x'.repeat(501)), entry('valid', 'local-valid')] });
        assert.equal(uploaded.status, 200); assert.deepEqual(uploaded.body.acceptedIds, ['valid']);
        assert.equal(uploaded.body.rejected.length, 1);
        assert.equal(await prisma.backupHistory.count({ where: { userId: owner.id, clientId: 'bad' } }), 0);
      });
      const first = await request(owner, '/gachas', 'POST', { title: 'Same name', isEqualRate: true, cardItems: [{ name: 'Prize A', rate: 1 }] });
      const second = await request(owner, '/gachas', 'POST', { title: 'Same name', isEqualRate: true, cardItems: [{ name: 'Prize B', rate: 1 }] });
      assert.equal(first.status, 201); assert.equal(second.status, 201);
      await t.test('server draws save the actual API deck ID before it is renamed or its items are deleted', async () => {
        const a = await request(owner, `/gachas/${first.body.id}/pull`, 'POST', { count: 1 });
        const b = await request(owner, `/gachas/${second.body.id}/pull`, 'POST', { count: 1 });
        assert.equal(a.status, 201); assert.equal(b.status, 201);
        assert.equal(a.body.history[0].gachaId, first.body.id);
        assert.equal(b.body.history[0].gachaId, second.body.id);
        assert.notEqual(a.body.history[0].gachaId, b.body.history[0].gachaId);
        const updated = await request(owner, `/gachas/${first.body.id}`, 'PUT', { title: 'Renamed' });
        assert.equal(updated.status, 200);
        const renamed = await request(owner, `/gachas/${first.body.id}/pull`, 'POST', { count: 1 });
        assert.equal(renamed.status, 201, JSON.stringify(renamed.body));
        assert.equal(renamed.body.history[0].gachaId, first.body.id);
        assert.equal(renamed.body.history[0].gachaName, 'Renamed');
        // Identity must survive item deletion, without relying on the live
        // cardItem relation or guessing from a deck's current title.
        await prisma.cardItem.deleteMany({ where: { cardId: Number(first.body.id) } });
        const old = await prisma.result.findUniqueOrThrow({ where: { id: Number(a.body.history[0].id) } });
        assert.equal(old.cardItemId, null); assert.equal(old.gachaId, first.body.id); assert.equal(old.gachaName, 'Same name');
        await request(owner, `/gachas/${first.body.id}`, 'DELETE');
        const persisted = (await request(owner, '/history')).body;
        assert.equal(persisted.filter(row => row.gachaId === first.body.id).length, 2);
        assert.equal((await request(other, '/history')).body.length, 0);
      });
      await t.test('migration backfills only surviving relational evidence and never guesses from a name', async () => {
        const item = await prisma.cardItem.findFirstOrThrow({ where: { cardId: Number(second.body.id) } });
        const known = await prisma.result.create({ data: { createBy: owner.id, cardItemId: item.id, gachaName: 'Same name', resultElement: 'Known' } });
        const unknown = await prisma.result.create({ data: { createBy: owner.id, gachaName: 'Same name', resultElement: 'Unknown' } });
        const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261017180000_history_deck_id/migration.sql'), 'utf8');
        await prisma.$executeRawUnsafe(sql.slice(sql.indexOf('UPDATE')));
        const restored = await prisma.result.findUniqueOrThrow({ where: { id: known.id } });
        assert.equal(restored.gachaId, second.body.id);
        const legacy = await prisma.result.findUniqueOrThrow({ where: { id: unknown.id } });
        assert.equal(legacy.gachaId, null); assert.equal(results.toHistory(legacy).gachaId, undefined);
        const backupLegacy = await prisma.backupHistory.findUniqueOrThrow({ where: { userId_clientId: { userId: owner.id, clientId: 'legacy' } } });
        assert.equal(backupLegacy.gachaId, null);
        assert.equal(await prisma.backupHistory.count({ where: { userId: owner.id } }), 5);
      });
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      await prisma.$disconnect();
    }
  });
