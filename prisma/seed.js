require("dotenv").config();
const prisma = require("../src/config/prisma");
async function main() {
  const themes = [
    { id: "t1", name: "Mint", price: 0, colorPreview: "#86efac" },
    { id: "t2", name: "Sunset", price: 30, colorPreview: "#fca5a5" },
    { id: "t3", name: "Ocean", price: 40, colorPreview: "#93c5fd" },
    { id: "t4", name: "Lavender", price: 50, colorPreview: "#c9bdf7" },
  ];
  const missions = [
    { id: "m1", title: "Log In", event: "login", target: 3, coinReward: 1 },
    { id: "m2", title: "Gacha", event: "pull", target: 2, coinReward: 2 },
    { id: "m3", title: "Gacha", event: "pull", target: 10, coinReward: 3 },
  ];
  for (const theme of themes)
    await prisma.theme.upsert({
      where: { id: theme.id },
      create: theme,
      update: theme,
    });
  for (const mission of missions)
    await prisma.mission.upsert({
      where: { id: mission.id },
      create: mission,
      update: mission,
    });
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
