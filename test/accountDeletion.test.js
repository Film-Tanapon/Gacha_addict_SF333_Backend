if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

test('deletion requires recent Google identity or the account password', async () => {
  const { verifyDeletion } = require('../src/services/accountDeletion.service');
  const google = { googleId: 'correct-uid', password: null };
  const credentials = { confirmation: 'DELETE', firebaseIdToken: 'test-token' };
  const firebase = decoded => () => ({ auth: () => ({ verifyIdToken: async (token, checkRevoked) => {
    assert.equal(checkRevoked, true); return decoded;
  } }) });
  await verifyDeletion(google, credentials, firebase({ uid: 'correct-uid', auth_time: Date.now() / 1000 }));
  for (const decoded of [{ uid: 'another-uid', auth_time: Date.now() / 1000 }, { uid: 'correct-uid', auth_time: Date.now() / 1000 - 600 }, { uid: 'correct-uid' }])
    await assert.rejects(verifyDeletion(google, credentials, firebase(decoded)), { status: 401 });
  await assert.rejects(verifyDeletion(google, { confirmation: 'DELETE' }), { status: 401 });
  await assert.rejects(verifyDeletion(google, {}), { status: 400 });
});

test('account deletion cascades data, removes owned/legacy files, revokes tokens and survives backup restoration/provider failures', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-deletion-'));
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  process.env.DELETION_LEDGER_PATH = path.join(dir, 'ledger/deletions.jsonl');
  // The unit subtest loads services first; reload storage so this process uses its temporary directory.
  for (const module of ['../src/services/accountDeletion.service', '../src/services/uploadStorage.service']) delete require.cache[require.resolve(module)];
  await fs.mkdir(process.env.UPLOAD_DIR);
  const prisma = require('../src/config/prisma');
  const app = require('../index');
  const { signToken } = require('../src/utils/jwt');
  const { deleteAccount, processDeletionJobs } = require('../src/services/accountDeletion.service');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const ids = [];
  const tag = `${Date.now()}-${process.pid}`;
  async function request(route, token, body) {
    const response = await fetch(base + route, { method: body ? 'DELETE' : 'GET', headers: {
      'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  async function waitForCleanup(id) {
    for (let n = 0; n < 50; n++) {
      if (!(await prisma.accountDeletionJob.findUnique({ where: { userId: id } }))) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Cleanup did not finish');
  }
  try {
    const password = await bcrypt.hash('DeleteTest123', 10);
    const owner = await prisma.user.create({ data: { email: `delete-${tag}@example.com`, username: `delete-${tag}`, password } });
    const other = await prisma.user.create({ data: { email: `other-delete-${tag}@example.com`, username: `other-delete-${tag}` } });
    ids.push(owner.id, other.id);
    const files = { owned: randomUUID()+'.webp', unused: randomUUID()+'.webp', legacy: randomUUID()+'.webp', shared: randomUUID()+'.webp', admin: randomUUID()+'.webp' };
    const url = name => '/api/uploads/' + files[name];
    for (const name of Object.values(files)) await fs.writeFile(path.join(process.env.UPLOAD_DIR, name), 'private-image');
    await prisma.uploadedImage.createMany({ data: [
      { filename: files.owned, ownerId: owner.id }, { filename: files.unused, ownerId: owner.id }, { filename: files.admin, ownerId: null },
    ] });
    await prisma.user.update({ where: { id: owner.id }, data: { avatarUrl: url('legacy') } });
    await prisma.user.update({ where: { id: other.id }, data: { avatarUrl: url('shared') } });
    const frame = await prisma.frame.findFirstOrThrow();
    const theme = await prisma.theme.findFirstOrThrow();
    const mission = await prisma.mission.findFirstOrThrow();
    const card = await prisma.card.create({ data: { title: 'Private deck', createBy: owner.id, cardImage: url('owned'), cardItems: { create: [{ name: 'Private result', imageUrl: url('shared') }, { name: 'Catalog', imageUrl: url('admin') }] } }, include: { cardItems: true } });
    await prisma.result.create({ data: { createBy: owner.id, cardItemId: card.cardItems[0].id, gachaName: 'Private deck', resultElement: 'Private result' } });
    await prisma.favorite.create({ data: { userId: owner.id, cardId: card.id } });
    await prisma.userBackup.create({ data: { userId: owner.id, data: { version: 1, gachas: [], history: [] } } });
    await prisma.userFrame.create({ data: { userId: owner.id, frameId: frame.id } });
    await prisma.userTheme.create({ data: { userId: owner.id, themeId: theme.id } });
    await prisma.userMission.create({ data: { userId: owner.id, missionId: mission.id } });
    await prisma.syncedPull.create({ data: { userId: owner.id, clientId: 'private-pull' } });
    const token = signToken({ id: owner.id });
    assert.equal((await request(`/users/${owner.id}`, null, { confirmation: 'DELETE', password: 'DeleteTest123' })).status, 401);
    assert.equal((await request(`/users/${owner.id}`, signToken({ id: other.id }), { confirmation: 'DELETE', password: 'DeleteTest123' })).status, 403);
    assert.equal((await request(`/users/${owner.id}`, token, { password: 'DeleteTest123' })).status, 400);
    assert.equal((await request(`/users/${owner.id}`, token, { confirmation: 'DELETE', password: 'wrong' })).status, 401);
    assert.ok(await prisma.user.findUnique({ where: { id: owner.id } }));
    assert.equal((await request(`/users/${owner.id}`, token, { confirmation: 'DELETE', password: 'DeleteTest123' })).status, 202);
    assert.equal(await prisma.user.findUnique({ where: { id: owner.id } }), null);
    assert.equal((await request('/auth/me', token)).status, 401);
    const upload = await fetch(base + '/uploads', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(upload.status, 401);
    await waitForCleanup(owner.id);
    for (const name of ['owned', 'unused', 'legacy']) await assert.rejects(fs.access(path.join(process.env.UPLOAD_DIR, files[name])));
    for (const name of ['shared', 'admin']) await fs.access(path.join(process.env.UPLOAD_DIR, files[name]));
    for (const model of ['favorite', 'userBackup', 'userFrame', 'userTheme', 'userMission', 'syncedPull'])
      assert.equal(await prisma[model].count({ where: { userId: owner.id } }), 0);
    assert.equal(await prisma.card.count({ where: { createBy: owner.id } }), 0);
    assert.equal(await prisma.result.count({ where: { createBy: owner.id } }), 0);
    const ledger = await fs.readFile(process.env.DELETION_LEDGER_PATH, 'utf8');
    assert.ok(!ledger.includes(owner.email) && !ledger.includes(password));
    // Simulate restoring an older database/image snapshot. The independent ledger wins.
    await prisma.user.create({ data: { id: owner.id, createDate: owner.createDate, email: owner.email, username: owner.username, password, avatarUrl: url('legacy') } });
    await fs.writeFile(path.join(process.env.UPLOAD_DIR, files.legacy), 'restored-private-image');
    assert.equal((await request('/auth/me', token)).status, 401);
    await processDeletionJobs();
    assert.equal(await prisma.user.findUnique({ where: { id: owner.id } }), null);
    await assert.rejects(fs.access(path.join(process.env.UPLOAD_DIR, files.legacy)));
    // Firebase failure must leave durable retry work while local files/data stay deleted.
    const google = await prisma.user.create({ data: { email: `google-delete-${tag}@example.com`, username: `google-delete-${tag}`, googleId: `fake-${tag}`, isGoogle: true } });
    ids.push(google.id);
    const changedIdentity = () => ({ auth: () => ({ verifyIdToken: async () => {
      await prisma.user.update({ where: { id: google.id }, data: { googleId: 'changed-' + tag } });
      return { uid: google.googleId, auth_time: Date.now()/1000 };
    } }) });
    await assert.rejects(deleteAccount(google.id, { confirmation: 'DELETE', firebaseIdToken: 'verified-test' },
      { firebase: changedIdentity, scheduleCleanup: false }), { status: 401 });
    assert.ok(await prisma.user.findUnique({ where: { id: google.id } }));
    assert.ok(!(await fs.readFile(process.env.DELETION_LEDGER_PATH, 'utf8')).includes(`"userId":${google.id},`));
    await prisma.user.update({ where: { id: google.id }, data: { googleId: google.googleId } });
    const firebase = () => ({ auth: () => ({ verifyIdToken: async () => ({ uid: google.googleId, auth_time: Date.now()/1000 }) }) });
    await deleteAccount(google.id, { confirmation: 'DELETE', firebaseIdToken: 'verified-test' }, { firebase, scheduleCleanup: false });
    await processDeletionJobs({ firebase: () => null });
    assert.equal((await prisma.accountDeletionJob.findUnique({ where: { userId: google.id } })).lastErrorCode, 'FIREBASE_DELETE_FAILED');
    await processDeletionJobs({ now: new Date(Date.now() + 120000), firebase: () => ({ auth: () => ({ deleteUser: async uid => {
      assert.equal(uid, google.googleId); const error = new Error(); error.code = 'auth/user-not-found'; throw error;
    } }) }) });
    assert.equal(await prisma.accountDeletionJob.findUnique({ where: { userId: google.id } }), null);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.accountDeletionJob.deleteMany({ where: { userId: { in: ids } } });
    await prisma.uploadedImage.deleteMany({ where: { ownerId: null, filename: { in: (await fs.readdir(process.env.UPLOAD_DIR)) } } });
    await prisma.$disconnect();
    await fs.rm(dir, { recursive: true, force: true });
    delete process.env.UPLOAD_DIR;
    delete process.env.DELETION_LEDGER_PATH;
  }
});
