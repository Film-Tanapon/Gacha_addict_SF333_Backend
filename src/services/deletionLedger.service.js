const fs = require('node:fs/promises');
const path = require('node:path');
const { backupRetentionDays } = require('../config/privacy');
function ledgerPath() {
  const file = path.resolve(process.env.DELETION_LEDGER_PATH || path.join(__dirname, '../../private-data/account-deletions.jsonl'));
  const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value;
  for (const root of [process.env.BACKUP_DIR || path.join(__dirname, '../../private-backups'), process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads')]) {
    if (comparable(file).startsWith(comparable(path.resolve(root) + path.sep))) throw new Error('Deletion ledger must be outside backups and public uploads');
  }
  return file;
}
const retentionMs = backupRetentionDays * 86400000;

async function readDeletionLedger(now = new Date()) {
  let text;
  try { text = await fs.readFile(ledgerPath(), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return text.split('\n').filter(Boolean).map(line => {
    const row = JSON.parse(line);
    if (!Number.isSafeInteger(row.userId) || !Number.isFinite(Date.parse(row.createdAt)) || !Number.isFinite(Date.parse(row.deletedAt)))
      throw new Error('Invalid deletion ledger');
    return row;
  }).filter(row => Date.parse(row.deletedAt) > now.getTime() - retentionMs);
}

async function withLedgerLock(work) {
  const file = ledgerPath();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const lockPath = file + '.lock';
  let lock;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { lock = await fs.open(lockPath, 'wx', 0o600); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = await fs.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 300000) await fs.unlink(lockPath).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  if (!lock) throw new Error('Deletion ledger is busy; retry later');
  try { return await work(file); }
  finally { await lock.close(); await fs.unlink(lockPath).catch(() => {}); }
}

async function recordDeletion(user) {
  await withLedgerLock(async file => {
    const row = { userId: user.id, createdAt: user.createDate.toISOString(), deletedAt: new Date().toISOString() };
    const handle = await fs.open(file, 'a', 0o600);
    try { await handle.writeFile(JSON.stringify(row) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
  });
}
async function isDeletionRequested(user) {
  const rows = await readDeletionLedger();
  return rows.some(row => row.userId === user.id && row.createdAt === user.createDate.toISOString());
}
async function pruneDeletionLedger(now = new Date()) {
  await withLedgerLock(async file => {
    // Managed backups expire from day 89 and restore refuses those snapshots.
    // Leave a day for the hourly sweep to physically remove this minimal record
    // within the public maximum of 90 days as well.
    const rows = (await readDeletionLedger(now)).filter(row => Date.parse(row.deletedAt) > now.getTime() - retentionMs + 86400000);
    const temporary = file + '.tmp';
    await fs.writeFile(temporary, rows.map(row => JSON.stringify(row) + '\n').join(''), { mode: 0o600 });
    await fs.rename(temporary, file);
  });
}
module.exports = { readDeletionLedger, recordDeletion, isDeletionRequested, pruneDeletionLedger, ledgerPath };
