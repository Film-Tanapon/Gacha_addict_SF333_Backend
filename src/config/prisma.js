const { PrismaClient } = require('@prisma/client');

// Single shared Prisma client instance
const prisma = new PrismaClient();

module.exports = prisma;
