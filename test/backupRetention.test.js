const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { cleanupBackups, createBackup, managedChild } = require('../src/services/backupRetention.service');

test('retention deletes only expired managed backups and preserves unrelated files/directories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-retention-'));
  const now = new Date('2026-10-17T00:00:00Z');
  async function fixture(age, valid = true) {
    const name = `gacha-backup-20261017T000000Z-${randomUUID()}`;
    const directory = managedChild(root, name);
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ application: valid ? 'gacha-addict' : 'another-app', version: 1, createdAt: new Date(now - age * 86400000).toISOString() }));
    await fs.writeFile(path.join(directory, 'database.dump'), 'private backup');
    return directory;
  }
  try {
    const expired = await fixture(90);
    const fresh = await fixture(88);
    const unrelated = await fixture(100, false);
    await fs.writeFile(path.join(root, 'manual-database.dump'), 'do not delete unknown backups');
    assert.equal(await cleanupBackups({ root, now }), 1);
    await assert.rejects(fs.access(expired));
    await fs.access(fresh); await fs.access(unrelated); await fs.access(path.join(root, 'manual-database.dump'));
    assert.throws(() => managedChild(root, '../outside'));
    assert.throws(() => managedChild(root, '/outside'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('backup publishes only complete database/image snapshots and never copies the deletion ledger or secrets', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-backup-'));
  const root = path.join(dir, 'backups');
  const imagesDir = path.join(dir, 'images');
  await fs.mkdir(imagesDir);
  const image = randomUUID() + '.webp';
  await fs.writeFile(path.join(imagesDir, image), 'image fixture');
  await fs.writeFile(path.join(imagesDir, '.account-deletions.jsonl'), 'must stay independent');
  await fs.writeFile(path.join(imagesDir, '.env'), 'not an image');
  try {
    const directory = await createBackup({ root, imagesDir, dump: async (tool, args) => {
      assert.equal(tool, 'pg_dump');
      await fs.writeFile(args[args.indexOf('--file') + 1], 'database fixture');
    } });
    assert.equal((await fs.readFile(path.join(directory, 'database.dump'), 'utf8')), 'database fixture');
    assert.deepEqual(await fs.readdir(path.join(directory, 'uploads')), [image]);
    await assert.rejects(createBackup({ root, imagesDir, dump: async () => { throw new Error('dump failed'); } }));
    assert.deepEqual((await fs.readdir(root)).filter(name => name.endsWith('.partial')), []);
    assert.equal((await fs.readdir(root)).filter(name => name.startsWith('gacha-backup')).length, 1);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('deletion ledger retains only the minimal identity needed for 90 days and rejects public/backup paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-ledger-'));
  const old = process.env.DELETION_LEDGER_PATH;
  process.env.DELETION_LEDGER_PATH = path.join(root, 'ledger.jsonl');
  const { readDeletionLedger, pruneDeletionLedger, recordDeletion, isDeletionRequested, ledgerPath } = require('../src/services/deletionLedger.service');
  const now = new Date();
  const createdAt = '2026-01-01T00:00:00.000Z';
  try {
    await fs.writeFile(process.env.DELETION_LEDGER_PATH, [
      { userId: 1, createdAt, deletedAt: new Date(now - 91*86400000).toISOString() },
      { userId: 2, createdAt, deletedAt: now.toISOString() },
    ].map(row => JSON.stringify(row)+'\n').join(''));
    assert.deepEqual((await readDeletionLedger()).map(row => row.userId), [2]);
    await pruneDeletionLedger();
    assert.equal((await fs.readFile(process.env.DELETION_LEDGER_PATH, 'utf8')).includes('"userId":1'), false);
    await recordDeletion({ id: 3, createDate: new Date(createdAt), email: 'must-not-be-recorded@example.com' });
    assert.equal(await isDeletionRequested({ id: 3, createDate: new Date(createdAt) }), true);
    assert.equal(await isDeletionRequested({ id: 3, createDate: now }), false);
    assert.ok(!(await fs.readFile(process.env.DELETION_LEDGER_PATH, 'utf8')).includes('must-not-be-recorded'));
    process.env.DELETION_LEDGER_PATH = path.join(process.env.BACKUP_DIR || path.resolve(__dirname, '../private-backups'), 'bad-ledger');
    assert.throws(ledgerPath);
  } finally {
    if (old === undefined) delete process.env.DELETION_LEDGER_PATH; else process.env.DELETION_LEDGER_PATH = old;
    await fs.rm(root, { recursive: true, force: true });
  }
});
