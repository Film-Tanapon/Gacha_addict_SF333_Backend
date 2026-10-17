const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

test('Google SDK dependency callers retain CommonJS UUID v4 and bounds-checked v3 support', () => {
  for (const name of ['gaxios', 'google-gax', 'teeny-request']) {
    const fromCaller = createRequire(require.resolve(name));
    const uuid = fromCaller('uuid');
    assert.ok(uuid.validate(uuid.v4()), name);
    assert.throws(() => uuid.v3('dependency-check', uuid.v3.DNS, Buffer.alloc(8)), RangeError);
  }
});

test('Prisma config still accepts the project schema and migrations with deepmerge-ts 8', () => {
  const { defineConfig } = require('prisma/config');
  const config = defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations' } });
  assert.match(config.schema, /prisma[\\/]schema\.prisma$/);
  assert.match(config.migrations.path, /prisma[\\/]migrations$/);
});

test('the installed Firebase Admin SDK exposes the current Auth methods without network credentials', async () => {
  const admin = require('firebase-admin');
  const app = admin.initializeApp({ projectId: 'isolated-dependency-compatibility' }, 'dependency-compatibility');
  try {
    assert.equal(typeof app.auth().verifyIdToken, 'function');
    assert.equal(typeof app.auth().deleteUser, 'function');
  } finally { await app.delete(); }
});
