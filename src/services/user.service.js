const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./auth.service');

async function listUsers({ skip = 0, take = 20 } = {}) {
  return prisma.user.findMany({
    select: PUBLIC_USER_FIELDS,
    skip: Number(skip),
    take: Number(take),
    orderBy: { id: 'asc' },
  });
}

async function getUserById(id) {
  const user = await prisma.user.findUnique({
    where: { id: Number(id) },
    select: PUBLIC_USER_FIELDS,
  });
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  return user;
}

async function updateUser(id, data) {
  const updateData = {};
  if (data.username !== undefined) updateData.username = data.username;
  if (data.avatarUrl !== undefined) updateData.avatarUrl = data.avatarUrl;
  if (data.phoneNo !== undefined) updateData.phoneNo = data.phoneNo;
  if (data.password) updateData.password = await bcrypt.hash(data.password, 10);

  try {
    const user = await prisma.user.update({
      where: { id: Number(id) },
      data: updateData,
      select: PUBLIC_USER_FIELDS,
    });
    return user;
  } catch (err) {
    if (err.code === 'P2025') {
      const e = new Error('User not found');
      e.status = 404;
      throw e;
    }
    if (err.code === 'P2002') {
      const e = new Error('Username already taken');
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

async function deleteUser(id) {
  try {
    await prisma.user.delete({ where: { id: Number(id) } });
  } catch (err) {
    if (err.code === 'P2025') {
      const e = new Error('User not found');
      e.status = 404;
      throw e;
    }
    throw err;
  }
}

module.exports = { listUsers, getUserById, updateUser, deleteUser };
