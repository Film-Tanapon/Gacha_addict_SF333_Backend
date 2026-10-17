const bcrypt = require("bcryptjs");
const input = require("../utils/input");
const prisma = require("../config/prisma");
const { PRIVATE_USER_FIELDS } = require("./auth.service");

const PUBLIC_PROFILE_FIELDS = {
  id: true,
  username: true,
  avatarUrl: true,
  frameId: true,
  frameColor: true,
  frameUrl: true,
};

async function listUsers({ skip = 0, take = 20 } = {}) {
  return prisma.user.findMany({
    select: PUBLIC_PROFILE_FIELDS,
    ...input.pagination({ skip, take }),
    orderBy: { id: "asc" },
  });
}

async function findUserById(id, select) {
  const user = await prisma.user.findUnique({
    where: { id: input.integer(id, "user id") },
    select,
  });
  if (!user) {
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }
  return user;
}

// Used by owner-only controllers and internal wallet operations.
const getUserById = id => findUserById(id, PRIVATE_USER_FIELDS);
const getPublicUserById = id => findUserById(id, PUBLIC_PROFILE_FIELDS);

async function updateUser(id, data) {
  const updateData = {};
  if (data.frameId) {
    const frame = await prisma.frame.findUnique({where:{id:data.frameId}});
    if (frame && frame.price > 0 && !(await prisma.userFrame.findUnique({where:{userId_frameId:{userId:Number(id),frameId:frame.id}}}))) input.fail('Purchase this frame first',403);
  }
  const v = require("../utils/input");
  if (data.username !== undefined)
    updateData.username = v.text(data.username, "username");
  for (const field of ["frameId", "frameColor", "frameUrl"])
    if (data[field] !== undefined)
      updateData[field] = v.optionalText(data[field], field);
  if (data.profileImage !== undefined)
    updateData.avatarUrl = v.optionalText(data.profileImage, "profileImage");
  if (data.avatarUrl !== undefined)
    updateData.avatarUrl = v.optionalText(data.avatarUrl, "avatarUrl");
  if (data.phoneNo !== undefined)
    updateData.phoneNo = v.optionalText(data.phoneNo, "phoneNo");
  if (data.password !== undefined)
    updateData.password = await bcrypt.hash(
      v.text(data.password, "password"),
      10
    );

  try {
    const user = await prisma.user.update({
      where: { id: input.integer(id, "user id") },
      data: updateData,
      select: PRIVATE_USER_FIELDS,
    });
    return user;
  } catch (err) {
    if (err.code === "P2025") {
      const e = new Error("User not found");
      e.status = 404;
      throw e;
    }
    if (err.code === "P2002") {
      const e = new Error("Username already taken");
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

module.exports = { listUsers, getUserById, getPublicUserById, updateUser };
