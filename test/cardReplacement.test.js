if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('direct card updates replace items atomically without losing history',
  { skip: !process.env.TEST_DATABASE_URL }, async t => {
    const app = require('../index');
    const prisma = require('../src/config/prisma');
    const { signToken } = require('../src/utils/jwt');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const tag = `${Date.now()}-${process.pid}`;
    const users = [];
    async function account(label) {
      const user = await prisma.user.create({ data: {
        username: `replace-${label}-${tag}`, email: `replace-${label}-${tag}@example.invalid`,
      } });
      users.push(user.id);
      return { ...user, token: signToken({ id: user.id, authVersion: user.authVersion }) };
    }
    async function request(user, route, method = 'GET', body) {
      const response = await fetch(base + route, { method, headers: {
        'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    }
    const stored = id => prisma.card.findUniqueOrThrow({
      where: { id: Number(id) }, include: { cardItems: { orderBy: { id: 'asc' } } },
    });
    try {
      const owner = await account('owner'), other = await account('other');
      async function createDeck() {
        const created = await request(owner, '/cards', 'POST', {
          title: 'Before replacement', isEqualRate: true,
          cardItems: [{ name: 'Old prize', rate: 1, imageUrl: 'https://example.invalid/old.png' }],
        });
        assert.equal(created.status, 201);
        return created.body;
      }
      for (const resource of ['gachas', 'cards']) {
        await t.test(`PUT /${resource}/:id`, async group => {
          await group.test('keeps replacement names, rates and images in the response and database; old history and favorites survive', async () => {
            const deck = await createDeck();
            await request(owner, `/favorites/${deck.id}`, 'PUT');
            const pulled = await request(owner, `/gachas/${deck.id}/pull`, 'POST', { count: 1 });
            assert.equal(pulled.status, 201);
            const history = pulled.body.history[0];
            const field = resource === 'gachas' ? 'randomList' : 'Items';
            const replacements = [
              { element: 'New rice', rate: '60%', imageUrl: 'https://example.invalid/rice.png' },
              { element: 'New noodles', rate: '40%', imageUrl: null },
            ];
            const edited = await request(owner, `/${resource}/${deck.id}`, 'PUT', {
              name: 'After replacement', isEqualRate: false, [field]: replacements,
            });
            assert.equal(edited.status, 200);
            const responseNames = resource === 'gachas'
              ? edited.body.randomList.map(item => item.element)
              : edited.body.cardItems.map(item => item.name);
            assert.deepEqual(responseNames.sort(), ['New noodles', 'New rice']);
            const card = await stored(deck.id);
            assert.equal(card.title, 'After replacement');
            assert.equal(card.isEqualRate, false);
            assert.deepEqual(card.cardItems.map(({ name, rate, imageUrl }) => ({ name, rate, imageUrl })), [
              { name: 'New rice', rate: 60, imageUrl: replacements[0].imageUrl },
              { name: 'New noodles', rate: 40, imageUrl: null },
            ]);
            assert.ok(card.cardItems.every(item => item.id !== deck.cardItems[0].id));
            const reloaded = await request(owner, `/${resource}/${deck.id}`);
            assert.equal(reloaded.status, 200);
            assert.deepEqual(reloaded.body, edited.body);
            assert.ok(await prisma.favorite.findUnique({ where: { userId_cardId: { userId: owner.id, cardId: deck.id } } }));
            const savedHistory = await request(owner, '/history');
            assert.deepEqual(savedHistory.body.find(row => row.id === history.id), history);
            const historicalResult = await prisma.result.findUniqueOrThrow({ where: { id: Number(history.id) } });
            assert.equal(historicalResult.cardItemId, null);
            assert.equal(historicalResult.gachaId, String(deck.id));
            assert.equal(historicalResult.resultElement, 'Old prize');
            const nextPull = await request(owner, `/gachas/${deck.id}/pull`, 'POST', { count: 5 });
            assert.equal(nextPull.status, 201);
            assert.equal(nextPull.body.resultElements.length, 5);
            assert.ok(nextPull.body.resultElements.every(name => responseNames.includes(name)));
            assert.equal((await request(other, '/history')).body.length, 0);
          });

          await group.test('a title-only edit keeps the current item IDs and history relation', async () => {
            const deck = await createDeck();
            const drawn = await request(owner, `/gachas/${deck.id}/pull`, 'POST', { count: 1 });
            const edited = await request(owner, `/${resource}/${deck.id}`, 'PUT', { title: 'Title only' });
            assert.equal(edited.status, 200);
            const card = await stored(deck.id);
            assert.equal(card.title, 'Title only');
            assert.deepEqual(card.cardItems, deck.cardItems);
            const result = await prisma.result.findUniqueOrThrow({ where: { id: Number(drawn.body.history[0].id) } });
            assert.equal(result.cardItemId, deck.cardItems[0].id);
          });

          await group.test('invalid replacements do not change the title or old items', async () => {
            const deck = await createDeck();
            const before = await stored(deck.id);
            for (const items of [[], [{ name: ' ', rate: 1 }], [{ name: 'Invalid weight', rate: -1 }]]) {
              const rejected = await request(owner, `/${resource}/${deck.id}`, 'PUT', {
                title: 'Must not commit', cardItems: items,
              });
              assert.equal(rejected.status, 400);
              assert.deepEqual(await stored(deck.id), before);
            }
          });

          await group.test('a database insertion failure rolls back deletion, metadata and history links', async context => {
            const deck = await createDeck();
            const drawn = await request(owner, `/gachas/${deck.id}/pull`, 'POST', { count: 1 });
            const resultId = Number(drawn.body.history[0].id);
            const before = await stored(deck.id);
            const resultBefore = await prisma.result.findUniqueOrThrow({ where: { id: resultId } });
            const errors = context.mock.method(console, 'error', () => {});
            // PostgreSQL text cannot contain NUL. This passes the normal JS
            // string validation but fails the actual insert, after deletion.
            const rejected = await request(owner, `/${resource}/${deck.id}`, 'PUT', {
              title: 'Must roll back', cardItems: [{ name: 'Broken\u0000prize', rate: 1 }],
            });
            assert.equal(rejected.status, 500);
            assert.ok(errors.mock.callCount() > 0);
            assert.deepEqual(await stored(deck.id), before);
            assert.deepEqual(await prisma.result.findUniqueOrThrow({ where: { id: resultId } }), resultBefore);
          });

          await group.test('concurrent replacements leave one complete version, never a mixture', async () => {
            const deck = await createDeck();
            const versions = ['Version A', 'Version B'];
            const edits = await Promise.all(versions.map(title => request(owner, `/${resource}/${deck.id}`, 'PUT', {
              title, cardItems: [{ name: `${title} one`, rate: 1 }, { name: `${title} two`, rate: 1 }],
            })));
            assert.deepEqual(edits.map(edit => edit.status), [200, 200]);
            const card = await stored(deck.id);
            assert.ok(versions.includes(card.title));
            assert.deepEqual(card.cardItems.map(item => item.name).sort(), [`${card.title} one`, `${card.title} two`]);
          });

          await group.test('another account and anonymous callers cannot replace items; missing decks return 404', async () => {
            const deck = await createDeck();
            const before = await stored(deck.id);
            const body = { title: 'Unauthorized edit', cardItems: [{ name: 'Other prize', rate: 1 }] };
            assert.equal((await request(other, `/${resource}/${deck.id}`, 'PUT', body)).status, 403);
            assert.equal((await request(null, `/${resource}/${deck.id}`, 'PUT', body)).status, 401);
            assert.deepEqual(await stored(deck.id), before);
            assert.equal((await request(owner, `/${resource}/2147483647`, 'PUT', body)).status, 404);
          });
        });
      }
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await prisma.$disconnect();
    }
  });
