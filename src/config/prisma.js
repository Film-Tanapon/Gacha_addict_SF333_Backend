const { PrismaClient } = require("@prisma/client");

// Single shared Prisma client instance
const prisma = new PrismaClient({
  transactionOptions: { maxWait: 10000, timeout: 15000 },
});

module.exports = prisma;
