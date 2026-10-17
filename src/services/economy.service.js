const prisma = require("../config/prisma");
const v = require("../utils/input");
const { Prisma } = require('@prisma/client');
const { missionPeriod } = require('../utils/mission');
const { resolveProfileFrame } = require('./profileFrame.service');

// Serialize mission state and wallet changes without conflicting with foreign-key inserts.
async function lockMissionUser(tx, userId) {
  const user = await tx.$queryRaw`SELECT "user_id" FROM "user" WHERE "user_id" = ${userId} FOR NO KEY UPDATE`;
  if (!user.length) v.fail('User not found', 404);
}
async function readMissions(tx, { event, id } = {}) {
  const where = id !== undefined ? Prisma.sql`WHERE "id" = ${id}`
    : event !== undefined ? Prisma.sql`WHERE "event" = ${event}` : Prisma.empty;
  // Shared locks keep a definition stable until progress/rewards commit.
  return tx.$queryRaw`SELECT "id", "title", "event", "target", "coin_reward" AS "coinReward",
    "reset_every_days" AS "resetEveryDays", "reset_anchor_date" AS "resetAnchorDate",
    "schedule_version" AS "scheduleVersion" FROM "mission" ${where} ORDER BY "id" FOR SHARE`;
}
async function currentMissionState(tx, userId, mission, now) {
  const period = missionPeriod(mission, now);
  const where = { userId_missionId: { userId, missionId: mission.id } };
  let state = await tx.userMission.upsert({ where,
    create: { userId, missionId: mission.id, periodKey: period.key }, update: {} });
  if (state.periodKey !== period.key) state = await tx.userMission.update({ where,
    data: { progress: 0, claimed: false, periodKey: period.key } });
  return { state, period, where };
}
async function debit(tx, userId, amount) {
  const changed = await tx.user.updateMany({
    where: { id: userId, coins: { gte: amount } },
    data: { coins: { decrement: amount } },
  });
  if (changed.count !== 1) v.fail("Insufficient coins or user not found", 409);
}
async function progress(tx, userId, event, amount = 1, options = {}) {
  v.integer(amount, 'progress amount');
  await lockMissionUser(tx, userId);
  const missions = await readMissions(tx, { event });
  const now = options.now ?? new Date();
  for (const mission of missions) {
    const { state, period, where } = await currentMissionState(tx, userId, mission, now);
    if (!period.active || state.claimed) continue;
    // Offline events belong to the round in which they occurred, not the sync day.
    const increment = options.eventTimes ? options.eventTimes.filter(value => {
      const date = new Date(value);
      return date <= now && (!period.startsAt || date >= period.startsAt);
    }).length : amount;
    if (!increment) continue;
    const n = Math.min(mission.target, state.progress + increment);
    await tx.userMission.update({ where, data: { progress: n } });
    const awarded = await tx.userMission.updateMany({
      where: { userId, missionId: mission.id, periodKey: period.key, claimed: false, progress: { gte: mission.target } },
      data: { claimed: true },
    });
    if (awarded.count) await tx.user.update({ where: { id: userId }, data: { coins: { increment: mission.coinReward } } });
  }
}
async function loginProgress(userId, at) {
  await prisma.$transaction(async tx => {
    await lockMissionUser(tx, userId);
    const now = at ?? new Date();
    const day = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const changed = await tx.user.updateMany({
      where: { id: userId, OR: [{ lastLoginDay: null }, { lastLoginDay: { not: day } }] },
      data: { lastLoginDay: day },
    });
    if (changed.count) await progress(tx, userId, 'login', 1, { now });
  });
}
async function listThemes(userId) {
  const themes = await prisma.theme.findMany({
    orderBy: { price: "asc" },
    include: { owners: { where: { userId } } },
  });
  return themes.map(({ owners, ...theme }) => ({
    ...theme,
    owned: theme.price === 0 || owners.length > 0,
  }));
}
async function purchaseTheme(userId, themeId) {
  return prisma.$transaction(async (tx) => {
    const theme = await tx.theme.findUnique({ where: { id: themeId } });
    if (!theme) v.fail("Theme not found", 404);
    const key = { userId_themeId: { userId, themeId } };
    if (await tx.userTheme.findUnique({ where: key }))
      return {
        ...theme,
        owned: true,
        coins: (await tx.user.findUniqueOrThrow({ where: { id: userId } }))
          .coins,
      };
    await debit(tx, userId, theme.price);
    await tx.userTheme.create({ data: { userId, themeId } });
    return {
      ...theme,
      owned: true,
      coins: (await tx.user.findUniqueOrThrow({ where: { id: userId } })).coins,
    };
  });
}
async function selectTheme(userId, themeId) {
  const theme = await prisma.theme.findUnique({ where: { id: themeId } });
  if (!theme) v.fail("Theme not found", 404);
  if (
    theme.price > 0 &&
    !(await prisma.userTheme.findUnique({
      where: { userId_themeId: { userId, themeId } },
    }))
  )
    v.fail("Purchase this theme first", 403);
  await prisma.user.update({
    where: { id: userId },
    data: { selectedThemeId: themeId },
  });
  return { selectedThemeId: themeId };
}
async function listMissions(userId, at) {
  return prisma.$transaction(async tx => {
    await lockMissionUser(tx, userId);
    const missions = await readMissions(tx);
    const now = at ?? new Date();
    const result = [];
    for (const mission of missions) {
      const { state, period } = await currentMissionState(tx, userId, mission, now);
      const n = period.active ? Math.min(state.progress, mission.target) : 0;
      const { event, target, scheduleVersion, ...publicMission } = mission;
      result.push({ ...publicMission, progress: n / target, progressLabel: n + '/' + target,
        claimed: period.active && state.claimed, startsAt: period.startsAt, nextResetAt: period.nextResetAt });
    }
    return result;
  });
}
async function claimMission(userId, missionId, at) {
  return prisma.$transaction(async tx => {
    await lockMissionUser(tx, userId);
    const [mission] = await readMissions(tx, { id: missionId });
    if (!mission) v.fail('Mission not found', 404);
    const { period } = await currentMissionState(tx, userId, mission, at ?? new Date());
    if (!period.active) v.fail('Mission has not started', 409);
    const changed = await tx.userMission.updateMany({
      where: { userId, missionId, periodKey: period.key, claimed: false, progress: { gte: mission.target } },
      data: { claimed: true },
    });
    if (!changed.count) v.fail('Mission incomplete or already claimed', 409);
    const user = await tx.user.update({ where: { id: userId }, data: { coins: { increment: mission.coinReward } } });
    return { claimed: true, coinReward: mission.coinReward, coins: user.coins };
  });
}
module.exports = {
  debit,
  progress,
  loginProgress,
  listThemes,
  purchaseTheme,
  selectTheme,
  listMissions,
  claimMission,
};

async function listFrames(userId) {
 const frames = await prisma.frame.findMany({orderBy:{price:'asc'},include:{owners:{where:{userId}}}});
 return frames.map(({owners,...frame})=>({...frame,owned:frame.price===0 || owners.length>0}));
}
async function purchaseFrame(userId,frameId) {
 return prisma.$transaction(async tx=>{
 const frame=await tx.frame.findUnique({where:{id:frameId}});
 if(!frame) v.fail('Frame not found',404);
 const key={userId_frameId:{userId,frameId}};
 if(!(await tx.userFrame.findUnique({where:key}))) {
 await debit(tx,userId,frame.price);
 await tx.userFrame.create({data:{userId,frameId}});
 }
 return {...frame,owned:true,coins:(await tx.user.findUniqueOrThrow({where:{id:userId}})).coins};
 });
}
async function selectFrame(userId,frameId) {
 const frameData=await resolveProfileFrame({frameId},userId);
 await prisma.user.update({where:{id:userId},data:frameData});
 return frameData;
}
Object.assign(module.exports,{listFrames,purchaseFrame,selectFrame});
