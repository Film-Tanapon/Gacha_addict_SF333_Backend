const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBackup } = require('../src/utils/backup');
const data = () => ({ version: 1, gachas: [{ id: 'local-1', name: 'Food', category: 'Custom', isEqualRate: false, isFavorite: true, pullManyCount: 5, pullOneCost: 999, randomList: [{ id: 'i1', element: 'Pizza', rate: '100%' }], localUpdatedAt: '2026-10-08T10:00:00.000Z' }], history: [{ id: 'h1', gachaName: 'Food', resultElement: 'Pizza', pulledAt: '2026-10-08T10:00:00.000Z' }], coins: 999999, userId: 100 });
test('backup preserves local identifiers and results and cannot change economy or account identity', () => {
  const result = normalizeBackup({ expectedRevision: 0, data: data(), userId: 123 });
  assert.equal(result.expectedRevision, 0);
  assert.equal(result.data.gachas[0].id, 'local-1');
  assert.equal(result.data.history[0].resultElement, 'Pizza');
  assert.equal(result.data.gachas[0].pullOneCost, 0);
  assert.equal(result.data.coins, undefined);
  assert.equal(result.data.userId, undefined);
  assert.equal(result.userId, undefined);
});
test('backup rejects malformed, duplicate and oversized records', () => {
  for (const invalid of [null, {}, { expectedRevision: -1, data: data() }, { expectedRevision: 0, data: { ...data(), version: 2 } }, { expectedRevision: 0, data: { ...data(), history: [data().history[0], data().history[0]] } }, { expectedRevision: 0, data: { ...data(), history: [{ ...data().history[0], pulledAt: 'invalid' }] } }]) assert.throws(() => normalizeBackup(invalid));
  const invalid = data(); invalid.gachas[0].randomList[0].rate = '-1%';
  assert.throws(() => normalizeBackup({ expectedRevision: 0, data: invalid }));
  const tooMany = data(); tooMany.history = Array(10001).fill(tooMany.history[0]);
  assert.throws(() => normalizeBackup({ expectedRevision: 0, data: tooMany }), error => error.status === 413);
});
