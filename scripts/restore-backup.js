require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readBackup, backupDir, managedChild, runPostgresTool } = require('../src/services/backupRetention.service');
const { uploadDir } = require('../src/services/uploadStorage.service');
const { processDeletionJobs, reconcileDeletionLedger } = require('../src/services/accountDeletion.service');
const { ledgerPath, readDeletionLedger } = require('../src/services/deletionLedger.service');
async function restore() {
  const [name, confirmation] = process.argv.slice(2);
  if (confirmation !== 'RESTORE-AND-DELETE-CURRENT-DATA')
    throw new Error('Stop the API, then pass a managed backup directory name and RESTORE-AND-DELETE-CURRENT-DATA. Preserve the independent deletion ledger.');
  const directory = managedChild(backupDir(), name || '');
  const manifest = await readBackup(directory);
  if (Date.now() - Date.parse(manifest.createdAt) >= 89 * 86400000)
    throw new Error('This backup has expired and must not be restored');
  // A missing/corrupt independent ledger must stop restoration, not resurrect users.
  await fs.access(ledgerPath());
  await readDeletionLedger();
  await runPostgresTool('pg_restore', ['--clean', '--if-exists', '--single-transaction', '--exit-on-error', '--no-owner', '--no-acl', '--dbname', new URL(process.env.DATABASE_URL).pathname.slice(1), path.join(directory, 'database.dump')]);
  await promisify(execFile)(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { env: process.env, windowsHide: true });
  await fs.mkdir(uploadDir, { recursive: true });
  for (const file of await fs.readdir(path.join(directory, 'uploads'), { withFileTypes: true })) {
    if (file.isFile() && /^[a-f\d-]{36}\.webp$/i.test(file.name))
      await fs.copyFile(path.join(directory, 'uploads', file.name), path.join(uploadDir, file.name));
  }
  await reconcileDeletionLedger();
  await processDeletionJobs();
  console.log('Restored data and reapplied deletion requests. Keep the cleanup worker running for any pending provider retries.');
}
restore().catch(() => { console.error('Restore failed. Keep the API stopped; inspect the backup and deletion ledger before retrying.'); process.exitCode = 1; })
  .finally(() => require('../src/config/prisma').$disconnect());
