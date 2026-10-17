require('dotenv').config();
const prisma = require('../src/config/prisma');
const { deleteAccountByVerifiedSupport } = require('../src/services/accountDeletion.service');
async function main() {
  const [id, confirmation] = process.argv.slice(2);
  if (!/^\d+$/.test(id || '') || confirmation !== `DELETE-USER-${id}`)
    throw new Error('After verifying the support requester, run: node scripts/delete-account.js USER_ID DELETE-USER-USER_ID');
  await deleteAccountByVerifiedSupport(Number(id));
  console.log('Account removed. Any external cleanup failures remain queued for retry.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
