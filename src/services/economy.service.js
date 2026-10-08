const prisma = require("../config/prisma");
const v = require("../utils/input");
async function debit(tx, userId, amount) {
  const changed = await tx.user.updateMany({
    where: { id: userId, coins: { gte: amount } },
    data: { coins: { decrement: amount } },
  });
  if (changed.count !== 1) v.fail("Insufficient coins or user not found", 409);
}
async function progress(tx, userId, event, amount = 1) {
  const missions = await tx.mission.findMany({ where: { event } });
  for (const m of missions) {
    await tx.userMission.upsert({
      where: { userId_missionId: { userId, missionId: m.id } },
      create: { userId, missionId: m.id, progress: amount },
      update: { progress: { increment: amount } },
    });
    // Mark rewarded and credit in the same transaction; concurrent progress cannot pay twice.
    const awarded = await tx.userMission.updateMany({
      where: { userId, missionId: m.id, claimed: false, progress: { gte: m.target } },
      data: { claimed: true },
    });
    if (awarded.count) await tx.user.update({
      where: { id: userId }, data: { coins: { increment: m.coinReward } },
    });
  }
}
async function loginProgress(userId) {
  // Count one login per calendar day in Bangkok, using a conditional update for concurrent logins.
  const day = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Bangkok",
  });
  await prisma.$transaction(async (tx) => {
    const changed = await tx.user.updateMany({
      where: {
        id: userId,
        OR: [{ lastLoginDay: null }, { lastLoginDay: { not: day } }],
      },
      data: { lastLoginDay: day },
    });
    if (changed.count) await progress(tx, userId, "login");
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
async function listMissions(userId) {
  const missions = await prisma.mission.findMany({
    orderBy: { id: "asc" },
    include: { users: { where: { userId } } },
  });
  return missions.map(({ users, event, target, ...m }) => {
    const n = Math.min(users[0]?.progress ?? 0, target);
    return {
      ...m,
      progress: n / target,
      progressLabel: n + "/" + target,
      claimed: users[0]?.claimed ?? false,
    };
  });
}
async function claimMission(userId, missionId) {
  return prisma.$transaction(async (tx) => {
    const mission = await tx.mission.findUnique({ where: { id: missionId } });
    if (!mission) v.fail("Mission not found", 404);
    const changed = await tx.userMission.updateMany({
      where: {
        userId,
        missionId,
        claimed: false,
        progress: { gte: mission.target },
      },
      data: { claimed: true },
    });
    if (!changed.count) v.fail("Mission incomplete or already claimed", 409);
    const user = await tx.user.update({
      where: { id: userId },
      data: { coins: { increment: mission.coinReward } },
    });
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
 const frame=await prisma.frame.findUnique({where:{id:frameId}});
 if(!frame) v.fail('Frame not found',404);
 if(frame.price>0 && !(await prisma.userFrame.findUnique({where:{userId_frameId:{userId,frameId}}}))) v.fail('Purchase this frame first',403);
 await prisma.user.update({where:{id:userId},data:{frameId,frameColor:frame.color,frameUrl:null}});
 return {frameId,frameColor:frame.color,frameUrl:null};
}
Object.assign(module.exports,{listFrames,purchaseFrame,selectFrame});
