const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { signToken } = require('../utils/jwt');
const { initFirebase } = require('../config/firebase');

const PUBLIC_USER_FIELDS = {
  id: true,
  email: true,
  username: true,
  avatarUrl: true,
  phoneNo: true,
  isGoogle: true,
  createDate: true,
  updateDate: true,
};

function toAuthResponse(user) {
  const token = signToken({ id: user.id, email: user.email, username: user.username });
  const { password, googleId, ...safeUser } = user;
  return { token, user: safeUser };
}

async function register({ email, username, password, phoneNo }) {
  if (!email || !username || !password) {
    const err = new Error('email, username and password are required');
    err.status = 400;
    throw err;
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });
  if (existing) {
    const err = new Error('Email or username already in use');
    err.status = 409;
    throw err;
  }

  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { email, username, password: hashed, phoneNo, isGoogle: false },
  });

  return toAuthResponse(user);
}

async function login({ email, password }) {
  if (!email || !password) {
    const err = new Error('email and password are required');
    err.status = 400;
    throw err;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.password) {
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  return toAuthResponse(user);
}

async function googleLogin({ idToken }) {
  if (!idToken) {
    const err = new Error('idToken is required');
    err.status = 400;
    throw err;
  }

  const admin = initFirebase();
  if (!admin) {
    const err = new Error('Google login is not configured on the server');
    err.status = 500;
    throw err;
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    const e = new Error('Invalid Google ID token');
    e.status = 401;
    throw e;
  }

  const { uid, email, name, picture } = decoded;

  let user = await prisma.user.findUnique({ where: { googleId: uid } });

  if (!user) {
    // Fall back to matching by email in case they previously registered manually
    user = email ? await prisma.user.findUnique({ where: { email } }) : null;

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId: uid, isGoogle: true, avatarUrl: user.avatarUrl || picture || null },
      });
    } else {
      // Auto-generate a unique username from email/name
      const base = (name || (email ? email.split('@')[0] : `user${uid.slice(0, 6)}`))
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '');
      let username = base || `user_${uid.slice(0, 6)}`;
      let suffix = 0;
      while (await prisma.user.findUnique({ where: { username } })) {
        suffix += 1;
        username = `${base}${suffix}`;
      }

      user = await prisma.user.create({
        data: {
          googleId: uid,
          isGoogle: true,
          email: email || `${uid}@no-email.google`,
          username,
          avatarUrl: picture || null,
        },
      });
    }
  }

  return toAuthResponse(user);
}

async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: PUBLIC_USER_FIELDS,
  });
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  return user;
}

module.exports = { register, login, googleLogin, getProfile, PUBLIC_USER_FIELDS };
