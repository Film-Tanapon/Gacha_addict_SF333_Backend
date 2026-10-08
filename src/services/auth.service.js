const bcrypt = require("bcryptjs");
const prisma = require("../config/prisma");
const { signToken } = require("../utils/jwt");
const { initFirebase } = require("../config/firebase");

const PUBLIC_USER_FIELDS = {
  id: true,
  coins: true,
  frameId: true,
  frameColor: true,
  frameUrl: true,
  selectedThemeId: true,
  email: true,
  username: true,
  avatarUrl: true,
  phoneNo: true,
  isGoogle: true,
  createDate: true,
  updateDate: true,
};

// Helper สร้าง Error พร้อม Status Code
function createError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toAuthResponse(user) {
  const token = signToken({
    id: user.id,
    email: user.email,
    username: user.username,
  });
  const { password, googleId, ...safeUser } = user;
  return { token, user: safeUser };
}

async function register({
  email,
  username,
  password,
  phoneNo,
  avatarUrl,
  profileImage,
  frameId,
  frameColor,
  frameUrl,
}) {
  if (!email || !username || !password) {
    throw createError("email, username and password are required", 400);
  }

  const v = require("../utils/input");
  if (frameId) {
    const frame = await prisma.frame.findUnique({where:{id:frameId}});
    if (frame && frame.price > 0) v.fail('Purchase this frame after signing in',403);
  }
  const cleanEmail = v.text(email, "email").toLowerCase();
  const cleanUsername = v.text(username, "username");
  v.text(password, "password");

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email: cleanEmail }, { username: cleanUsername }],
    },
  });

  if (existing) {
    throw createError("Email or username already in use", 409);
  }

  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email: cleanEmail,
      username: cleanUsername,
      password: hashed,
      phoneNo: phoneNo?.trim() || null,
      avatarUrl: v.optionalText(avatarUrl ?? profileImage ?? null, "avatarUrl"),
      frameId: v.optionalText(frameId ?? null, "frameId"),
      frameColor: v.optionalText(frameColor ?? null, "frameColor"),
      frameUrl: v.optionalText(frameUrl ?? null, "frameUrl"),
      isGoogle: false,
    },
  });

  await require("./economy.service").loginProgress(user.id);
  return toAuthResponse(await prisma.user.findUniqueOrThrow({where:{id:user.id}}));
}

async function login({ email, password }) {
  if (!email || !password) {
    throw createError("email and password are required", 400);
  }

  const cleanEmail = require("../utils/input")
    .text(email, "email")
    .toLowerCase();
  require("../utils/input").text(password, "password");

  const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (!user || !user.password) {
    throw createError("Invalid email or password", 401);
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    throw createError("Invalid email or password", 401);
  }

  await require("./economy.service").loginProgress(user.id);
  return toAuthResponse(await prisma.user.findUniqueOrThrow({where:{id:user.id}}));
}

async function googleLogin({ idToken }) {
  if (!idToken) {
    throw createError("idToken is required", 400);
  }

  const admin = initFirebase();
  if (!admin) {
    throw createError("Google login is not configured on the server", 500);
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    throw createError("Invalid Google ID token", 401);
  }

  if (
    decoded.firebase?.sign_in_provider !== "google.com" ||
    !decoded.email_verified ||
    !decoded.email
  )
    throw createError("A verified Google email is required", 401);
  const { uid, email, name, picture } = decoded;

  let user = await prisma.user.findUnique({ where: { googleId: uid } });

  if (!user) {
    // Fallback เช็กจาก Email ถ้าเคยสมัครแบบปกติไว้ก่อน
    const cleanEmail = email ? email.trim().toLowerCase() : null;
    user = cleanEmail
      ? await prisma.user.findUnique({ where: { email: cleanEmail } })
      : null;

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: uid,
          isGoogle: true,
          avatarUrl: user.avatarUrl || picture || null,
        },
      });
    } else {
      // 1. ดึง prefix จาก email หรือ name
      const emailPrefix = cleanEmail ? cleanEmail.split("@")[0] : "";
      const sanitizedName = (name || "")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "");
      const sanitizedEmailPrefix = emailPrefix
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "");

      // ป้องกันภาษาไทย/อักขระพิเศษโดนลบจนกลายเป็น String ว่าง
      const base =
        sanitizedEmailPrefix || sanitizedName || `user_${uid.slice(0, 6)}`;

      // 2. ดึงรายการ username ที่ขึ้นต้นด้วย base ทั้งหมดขึ้นมาเช็กครั้งเดียว (แก้ N+1 Query)
      const existingUsers = await prisma.user.findMany({
        where: { username: { startsWith: base } },
        select: { username: true },
      });

      const existingUsernames = new Set(existingUsers.map((u) => u.username));
      let username = base;
      let suffix = 0;

      while (existingUsernames.has(username)) {
        suffix += 1;
        username = `${base}${suffix}`;
      }

      user = await prisma.user.create({
        data: {
          googleId: uid,
          isGoogle: true,
          email: cleanEmail || `${uid}@no-email.google`,
          username,
          avatarUrl: picture || null,
        },
      });
    }
  }

  await require("./economy.service").loginProgress(user.id);
  return toAuthResponse(await prisma.user.findUniqueOrThrow({where:{id:user.id}}));
}

async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: PUBLIC_USER_FIELDS,
  });

  if (!user) {
    throw createError("User not found", 404);
  }

  return user;
}

module.exports = {
  register,
  login,
  googleLogin,
  getProfile,
  PUBLIC_USER_FIELDS,
};
