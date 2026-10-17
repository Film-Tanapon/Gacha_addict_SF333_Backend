const bcrypt = require("bcryptjs");
const prisma = require("../config/prisma");
const { signToken } = require("../utils/jwt");
const { initFirebase } = require("../config/firebase");
const { resolveProfileFrame } = require('./profileFrame.service');

// Account fields are for the authenticated owner, not public profile responses.
const PRIVATE_USER_FIELDS = {
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
    authVersion: user.authVersion,
  });
  const { password, googleId, googleLinkVerified, authVersion, ...safeUser } = user;
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
  const frameData = await resolveProfileFrame({ frameId, frameColor, frameUrl });
  const cleanEmail = v.text(email, "email").toLowerCase();
  const cleanUsername = v.text(username, "username");
  require('../utils/password').validatePassword(password);

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
      ...frameData,
      isGoogle: false,
    },
  });

  await require("./economy.service").loginProgress(user.id);
  const current = await prisma.user.findUniqueOrThrow({where:{id:user.id}});
  if (current.password !== user.password || current.authVersion !== user.authVersion)
    throw createError('Password changed. Please sign in again.', 401);
  return toAuthResponse(current);
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
  if (await require('./deletionLedger.service').isDeletionRequested(user))
    throw createError('Account deletion has been requested', 401);

  if (user.googleId && !user.googleLinkVerified)
    throw createError('Please sign in with Google and confirm your existing account password before using this account.', 401);

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    throw createError("Invalid email or password", 401);
  }

  await require("./economy.service").loginProgress(user.id);
  const current = await prisma.user.findUniqueOrThrow({where:{id:user.id}});
  if (current.password !== user.password || current.authVersion !== user.authVersion)
    throw createError('Password changed. Please sign in again.', 401);
  return toAuthResponse(current);
}

function linkRequired() {
  const error = createError('Confirm your existing account password to link this Google account. If you do not know it, reset it using your email first.', 409);
  error.publicCode = 'GOOGLE_LINK_REQUIRED';
  return error;
}

async function limitGoogleLinkAttempts(userId) {
  const now = new Date();
  const expires = new Date(now.getTime() + 15 * 60 * 1000);
  const key = `google-link:${userId}`;
  const [rate] = await prisma.$queryRaw`INSERT INTO "password_reset_rate_limit" ("key", "count", "expires_at")
    VALUES (${key}, 1, ${expires}) ON CONFLICT ("key") DO UPDATE SET
    "count" = CASE WHEN "password_reset_rate_limit"."expires_at" <= ${now} THEN 1 ELSE "password_reset_rate_limit"."count" + 1 END,
    "expires_at" = CASE WHEN "password_reset_rate_limit"."expires_at" <= ${now} THEN ${expires} ELSE "password_reset_rate_limit"."expires_at" END
    RETURNING "count", "expires_at"`;
  if (rate.count > 5) {
    const error = createError('Too many confirmation attempts. Please wait 15 minutes before trying again.', 429);
    error.retryAfter = Math.max(1, Math.ceil((rate.expires_at.getTime() - now.getTime()) / 1000));
    throw error;
  }
}

async function authenticateGoogle({ idToken, password } = {}, allowLink = false) {
  if (!idToken) {
    throw createError("idToken is required", 400);
  }

  const admin = initFirebase();
  if (!admin) {
    throw createError("Google login is not configured on the server", 500);
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken, true);
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
  const cleanEmail = email.trim().toLowerCase();
  if (allowLink) {
    const age = Date.now() / 1000 - decoded.auth_time;
    if (!Number.isFinite(age) || age < -60 || age > 300)
      throw createError('Please sign in with Google again before linking your account.', 401);
  }
  if (await prisma.accountDeletionJob.findFirst({ where: { firebaseUid: uid }, select: { userId: true } }))
    throw createError('Account deletion is being completed. Please try again later.', 409);

  let user = await prisma.user.findUnique({ where: { googleId: uid } });
  if (user && await require('./deletionLedger.service').isDeletionRequested(user))
    throw createError('Account deletion has been requested', 401);

  if (!user) user = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (user) {
    if (await require('./deletionLedger.service').isDeletionRequested(user))
      throw createError('Account deletion has been requested', 401);
    if (user.googleId && user.googleId !== uid)
      throw createError('This account is already linked to a different Google account.', 409);

    const needsLink = !user.googleId || (!user.googleLinkVerified && !!user.password);
    if (needsLink || allowLink) {
      if (!allowLink) throw linkRequired();
      if (user.email !== cleanEmail || !user.password)
        throw createError('Please sign in using the original account method.', 409);
      await limitGoogleLinkAttempts(user.id);
      if (typeof password !== 'string' || !password || !(await bcrypt.compare(password, user.password)))
        throw createError('The existing account password is incorrect.', 401);
      const original = user;
      user = await prisma.$transaction(async tx => {
        // Match password-reset/deletion lock ordering; do not link after the
        // checked password or account has changed during bcrypt verification.
        await tx.$queryRaw`SELECT "user_id" FROM "user" WHERE "user_id" = ${original.id} FOR UPDATE`;
        const current = await tx.user.findUnique({ where: { id: original.id } });
        if (!current || current.password !== original.password || current.authVersion !== original.authVersion ||
            current.email !== cleanEmail || (current.googleId && current.googleId !== uid) ||
            await require('./deletionLedger.service').isDeletionRequested(current))
          throw createError('Account changed. Please sign in with Google and confirm again.', 401);
        const linked = await tx.user.update({ where: { id: current.id }, data: {
          googleId: uid, isGoogle: true, googleLinkVerified: true,
          avatarUrl: current.avatarUrl || picture || null,
          authVersion: { increment: 1 },
        } });
        await tx.passwordResetChallenge.deleteMany({ where: { userId: current.id } });
        return linked;
      });
    }
  } else {
    if (allowLink) throw createError('No existing account to link. Please start Google sign-in again.', 409);
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
        googleLinkVerified: true,
        email: cleanEmail || `${uid}@no-email.google`,
        username,
        avatarUrl: picture || null,
      },
    });
  }

  await require("./economy.service").loginProgress(user.id);
  const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (current.authVersion !== user.authVersion || current.password !== user.password || current.googleId !== uid)
    throw createError('Account changed. Please sign in with Google again.', 401);
  return toAuthResponse(current);
}

const googleLogin = body => authenticateGoogle(body);
const linkGoogleAccount = body => authenticateGoogle(body, true);

async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: PRIVATE_USER_FIELDS,
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
  linkGoogleAccount,
  getProfile,
  PRIVATE_USER_FIELDS,
};
