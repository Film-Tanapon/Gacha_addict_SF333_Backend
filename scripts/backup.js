require('dotenv').config();
const { createBackup, cleanupBackups } = require('../src/services/backupRetention.service');
const { pruneDeletionLedger } = require('../src/services/deletionLedger.service');
cleanupBackups().then(() => pruneDeletionLedger()).then(() => createBackup()).then(directory => console.log(`Backup created: ${directory}`))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
