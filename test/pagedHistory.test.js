if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('paged history preserves large accounts, retries, isolation and legacy migration',
  { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async t => {
    const app = require('../index');
    const prisma = require('../src/config/prisma');
    const { signToken } = require('../src/utils/jwt');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/backup`;
    const ids = [];
    const tag = `${Date.now()}-${process.pid}`;
    async function account(label) {
      const user = await prisma.user.create({ data: { username: `paged-${label}-${tag}`, email: `paged-${label}-${tag}@example.invalid`, coins: 17 } });
      ids.push(user.id);
      return { ...user, token: signToken({ id: user.id, authVersion: user.authVersion }) };
    }
    async function request(user, route = '', method = 'GET', body) {
      const response = await fetch(base + route, { method,
        headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    }
    const history = i => ({ id: `history-${i}`, gachaName: 'อาหารไทย', resultElement: `เมนู ${i}`,
      pulledAt: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString() });
    const deck = i => ({ id: `local-deck-${i}`, name: `กอง ${i}`, category: 'Custom',
      isEqualRate: true, isFavorite: false, pullManyCount: 5,
      randomList: [{ id: `item-${i}`, element: 'รางวัล', rate: '100%' }], localUpdatedAt: '2026-10-17T00:00:00.000Z' });
    try {
      const owner = await account('large');
      const other = await account('other');
      await t.test('uploads and downloads 10,050 records without truncation; a frozen page fence excludes later writes', async () => {
        for (let start = 0; start < 10050; start += 100) {
          const entries = Array.from({ length: Math.min(100, 10050 - start) }, (_, n) => history(start + n));
          const result = await request(owner, '/history', 'POST', { entries });
          assert.equal(result.status, 200);
          assert.equal(result.body.acceptedIds.length, entries.length);
        }
        const snapshot = await request(owner, '?historyMode=paged');
        assert.equal(snapshot.status, 200);
        assert.equal(snapshot.body.data, null);
        const fence = snapshot.body.historySync.head;
        assert.equal((await request(owner, '/history', 'POST', { entries: [history(10050)] })).status, 200);
        let cursor = '0'; const found = new Set();
        do {
          const result = await request(owner, `/history?after=${cursor}&until=${fence}&take=100`);
          assert.equal(result.status, 200); assert.ok(result.body.entries.length <= 100);
          assert.ok(BigInt(result.body.nextCursor) > BigInt(cursor));
          cursor = result.body.nextCursor;
          result.body.entries.forEach(entry => { assert.ok(!found.has(entry.id)); found.add(entry.id); });
          if (!result.body.hasMore) break;
        } while (true);
        assert.equal(found.size, 10050); assert.equal(cursor, fence);
        assert.ok(found.has('history-0')); assert.ok(found.has('history-10049'));
        const next = await request(owner, `/history?after=${cursor}`);
        assert.deepEqual(next.body.entries, [history(10050)]);
        assert.equal((await request(owner)).status, 426);
        assert.equal((await request(other, `/history?until=${next.body.nextCursor}`)).body.entries.length, 0);
      });
      await t.test('duplicate retries are idempotent and invalid records do not block valid ones', async () => {
        const before = await prisma.backupHistory.count({ where: { userId: owner.id } });
        const entries = [history(0), history(0), { ...history(10051), gachaName: 'x'.repeat(501) }, history(10052)];
        const result = await request(owner, '/history', 'POST', { entries });
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.acceptedIds, ['history-0', 'history-10052']);
        assert.equal(result.body.rejected.length, 1); assert.equal(result.body.rejected[0].index, 2);
        await request(owner, '/history', 'POST', { entries });
        assert.equal(await prisma.backupHistory.count({ where: { userId: owner.id } }), before + 1);
        assert.equal((await request(owner, '/history', 'POST', { entries: Array(101).fill(history(0)) })).status, 413);
        for (const cursor of ['-1', 'wat', '9223372036854775808'])
          assert.equal((await request(owner, `/history?after=${cursor}`)).status, 400);
        assert.equal((await request(owner, '/history?after=10&until=0')).status, 409);
        assert.equal((await request(owner, '/history?take=101')).status, 400);
        assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).coins, 17);
      });
      await t.test('deck chunks merge atomically, reject stale revisions and retain all history', async () => {
        const put = (expectedRevision, gachas) => request(owner, '', 'PUT', { historyMode: 'paged', expectedRevision,
          data: { version: 1, gachas, history: [] } });
        const first = await put(0, [deck(1)]);
        assert.equal(first.status, 200); assert.ok(first.body.cardIds['local-deck-1']);
        const second = await put(first.body.revision, [deck(2)]);
        assert.equal(second.status, 200); assert.equal(Object.keys(second.body.cardIds).length, 2);
        assert.equal((await put(first.body.revision, [deck(3)])).status, 409);
        const snapshot = await request(owner, '?historyMode=paged');
        assert.equal(snapshot.body.data.gachas.length, 2); assert.deepEqual(snapshot.body.data.history, []);
        assert.equal(await prisma.backupHistory.count({ where: { userId: owner.id } }), 10052);
        for (const field of ['name', 'element']) {
          const invalid = deck(4);
          if (field === 'name') invalid.name = 'x'.repeat(501); else invalid.randomList[0].element = 'x'.repeat(501);
          assert.equal((await put(second.body.revision, [invalid])).status, 400);
        }
        const boundary = deck(4); boundary.name = 'ก'.repeat(500); boundary.randomList[0].element = 'ก'.repeat(500);
        assert.equal((await put(second.body.revision, [boundary])).status, 200);
      });
      await t.test('legacy snapshots are backfilled idempotently without repeating mission rewards', async () => {
        const legacy = await account('legacy');
        const entries = [history(1), history(2)];
        await prisma.userBackup.create({ data: { userId: legacy.id, data: { version: 1, gachas: [], history: entries } } });
        const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261017170000_paged_backup_history/migration.sql'), 'utf8');
        const insert = sql.slice(sql.indexOf('INSERT INTO'));
        await prisma.$executeRawUnsafe(insert); await prisma.$executeRawUnsafe(insert);
        assert.equal(await prisma.backupHistory.count({ where: { userId: legacy.id } }), 2);
        assert.equal(await prisma.syncedPull.count({ where: { userId: legacy.id } }), 0);
        assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } })).coins, 17);
        assert.equal((await request(legacy)).body.data.history.length, 2);
        assert.equal((await request(legacy, '/history')).body.entries.length, 2);
        await prisma.user.delete({ where: { id: legacy.id } });
        assert.equal(await prisma.backupHistory.count({ where: { userId: legacy.id } }), 0);
      });
      await t.test('history writes hold the account lock until commit and preserve cursor order', async () => {
        const service = require('../src/services/historySync.service');
        let unlock, started;
        const hold = new Promise(resolve => { unlock = resolve; });
        const ready = new Promise(resolve => { started = resolve; });
        const first = prisma.$transaction(async tx => {
          await service.lockHistoryUser(tx, other.id);
          await service.appendHistory(tx, other.id, [history(1)]);
          started(); await hold;
        });
        await ready;
        let second;
        try {
          assert.equal(await service.head(other.id), '0');
          await assert.rejects(prisma.$transaction(tx => tx.$queryRaw`
            SELECT "user_id" FROM "user" WHERE "user_id" = ${other.id} FOR NO KEY UPDATE NOWAIT`),
          error => error.meta?.code === '55P03');
          second = request(other, '/history', 'POST', { entries: [history(2)] });
        } finally { unlock(); }
        await first; assert.equal((await second).status, 200);
        const rows = await prisma.backupHistory.findMany({ where: { userId: other.id }, orderBy: { sequence: 'asc' } });
        assert.deepEqual(rows.map(row => row.clientId), ['history-1', 'history-2']);
      });
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      await prisma.$disconnect();
    }
  });
