const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const { uploadDir } = require('./uploadStorage.service');
const { pruneDeletionLedger } = require('./deletionLedger.service');
const DAY = 86400000;
const backupDir = () => path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '../../private-backups'));
const managedName = /^gacha-backup-\d{8}T\d{6}Z-[a-f\d-]{36}(\.partial)?$/;

function managedChild(root, name) {
  const file = path.resolve(root, name);
  if (!managedName.test(name) || path.dirname(file) !== path.resolve(root)) throw new Error('Unsafe backup path');
  return file;
}
function postgresEnvironment() {
  const url = new URL(process.env.DATABASE_URL);
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) throw new Error('PostgreSQL URL is required');
  return { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: url.searchParams.get('sslmode') || 'prefer', PGCONNECT_TIMEOUT: '10' };
}
async function runPostgresTool(tool, args) {
  const executable = process.env[tool === 'pg_dump' ? 'PG_DUMP_PATH' : 'PG_RESTORE_PATH'] || tool;
  // Passwords are passed through the child environment, never shell arguments.
  try { await execute(executable, args, { env: postgresEnvironment(), timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true }); }
  catch { throw new Error(`${tool} failed; inspect PostgreSQL access and client version without exposing credentials`); }
}
async function readBackup(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Backup must be a regular managed directory');
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.application !== 'gacha-addict' || manifest.version !== 1 || !Number.isFinite(Date.parse(manifest.createdAt)))
    throw new Error('Invalid backup manifest');
  return manifest;
}
async function cleanupBackups({ root = backupDir(), now = new Date() } = {}) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  let deleted = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !managedName.test(entry.name)) continue;
    const directory = managedChild(root, entry.name);
    if (entry.name.endsWith('.partial')) {
      if (now - (await fs.stat(directory)).mtime < DAY) continue;
    } else {
      let manifest;
      try { manifest = await readBackup(directory); } catch { continue; }
      // Start expiry a day early, leaving room for the hourly sweep to run
      // before the public maximum retention of 90 days.
      if (now.getTime() - Date.parse(manifest.createdAt) < 89 * DAY) continue;
    }
    await fs.rm(directory, { recursive: true, force: true });
    deleted++;
  }
  return deleted;
}
async function createBackup({ root = backupDir(), now = new Date(), dump = runPostgresTool, imagesDir = uploadDir } = {}) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const lockPath = path.join(root, '.backup.lock');
  let lock;
  try { lock = await fs.open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = await fs.stat(lockPath).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > 600000) await fs.unlink(lockPath);
    throw new Error('A backup is already running or recovering; retry later');
  }
  const name = `gacha-backup-${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z-${randomUUID()}`;
  const temporary = managedChild(root, name + '.partial');
  try {
    await fs.mkdir(temporary, { mode: 0o700 });
    const database = path.join(temporary, 'database.dump');
    await fs.writeFile(database, '', { flag: 'wx', mode: 0o600 });
    await dump('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', database]);
    const images = path.join(temporary, 'uploads');
    await fs.mkdir(images, { mode: 0o700 });
    const entries = await fs.readdir(imagesDir, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return []; throw error;
    });
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f\d-]{36}\.webp$/i.test(entry.name)) continue;
      const destination = path.join(images, entry.name);
      try { await fs.copyFile(path.join(imagesDir, entry.name), destination); await fs.chmod(destination, 0o600); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await fs.writeFile(path.join(temporary, 'manifest.json'), JSON.stringify({ application: 'gacha-addict', version: 1, createdAt: now.toISOString() }), { mode: 0o600 });
    const destination = managedChild(root, name);
    await fs.rename(temporary, destination);
    await cleanupBackups({ root, now });
    return destination;
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  } finally { await lock.close(); await fs.unlink(lockPath).catch(() => {}); }
}
function startBackupWorker() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const root = backupDir();
      await cleanupBackups({ root });
      await pruneDeletionLedger();
      if (process.env.BACKUP_ENABLED === 'true') {
        let newest = 0;
        for (const entry of await fs.readdir(root)) {
          if (!managedName.test(entry) || entry.endsWith('.partial')) continue;
          try { newest = Math.max(newest, Date.parse((await readBackup(managedChild(root, entry))).createdAt)); } catch { /* Skip unrelated or invalid directories. */ }
        }
        if (Date.now() - newest >= DAY) await createBackup({ root });
      }
    } catch { console.error('[privacy] Backup/retention task failed; check private storage permissions and PostgreSQL client'); }
    finally { running = false; }
  };
  run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
module.exports = { createBackup, cleanupBackups, startBackupWorker, readBackup, backupDir, managedChild, runPostgresTool };
