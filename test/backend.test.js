if (process.env.TEST_DATABASE_URL)
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { test } = require("node:test");
const assert = require("node:assert/strict");
const v = require("../src/utils/input");
const { normalize, toGacha } = require("../src/services/card.service");
const prisma = require("../src/config/prisma");
test("accepts frontend custom form and validates weights, booleans and costs", () => {
  const c = normalize(
    {
      Title: " Dinner ",
      Card_Image: null,
      Frame_ID: "f1",
      is_equal_rate: 0,
      Items: [
        { name: "Pizza", rate: 25 },
        { name: "Rice", rate: 75 },
      ],
    },
    true
  );
  assert.equal(c.title, "Dinner");
  assert.equal(normalize({ pullOneCost: 99, pullManyCost: 99 }).pullOneCost, 0);
  assert.equal(
    normalize({ pullOneCost: 99, pullManyCost: 99 }).pullManyCost,
    0
  );
  assert.equal(c.isEqualRate, false);
  assert.equal(c.cardItems.create.length, 2);
  assert.equal(normalize({ is_equal_rate: "0" }).isEqualRate, false);
  for (const data of [
    { title: "" },
    { pullManyCount: 1 },
    { Items: [] },
    { Items: [{ name: "a", rate: "no" }] },
  ])
    assert.throws(() => normalize({ title: "Valid", ...data }, true));
  assert.throws(() => v.pagination({ take: 101 }));
  assert.throws(() => v.integer(1.5, "count"));
  assert.throws(() => v.integer(true, "count"));
  const g = toGacha({
    id: 1,
    title: "Food",
    cardItems: [
      { id: 2, name: "Pizza", rate: 1 },
      { id: 3, name: "Rice", rate: 3 },
    ],
  });
  assert.equal(g.randomList[0].rate, "25%");
  assert.equal(g.id, "1");
});
test(
  "API persists frontend data and prevents duplicate rewards and overspending",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const app = require("../index");
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = "http://127.0.0.1:" + server.address().port + "/api";
    let token;
    const userIds = [];
    async function request(path, method = "GET", data, auth = token) {
      const response = await fetch(base + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: "Bearer " + auth } : {}),
        },
        ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
      });
      const body = response.status === 204 ? null : await response.json();
      return { status: response.status, body };
    }
    try {
      assert.equal((await request("/wallet")).status, 401);
      const tag = Date.now().toString();
      const register = await request("/auth/register", "POST", {
        username: "test" + tag,
        email: tag + "@example.com",
        password: "Abc12345",
        profileImage: "https://example.com/avatar.png",
        frameId: "frame1",
      });
      assert.equal(register.status, 201);
      token = register.body.token;
      const userId = register.body.user.id;
      userIds.push(userId);
      assert.equal(
        register.body.user.avatarUrl,
        "https://example.com/avatar.png"
      );
      assert.equal(register.body.user.coins, 20);
      assert.equal(register.body.user.password, undefined);
      const created = await request("/gachas", "POST", {
        Title: "Food",
        is_equal_rate: 1,
        Items: [
          { name: "Pizza", rate: 50 },
          { name: "Rice", rate: 50 },
        ],
      });
      assert.equal(created.status, 201);
      const id = created.body.id;
      assert.equal(created.body.randomList.length, 2);
      assert.equal(
        (await request("/favorites/" + id, "PUT", {})).body.isFavorite,
        true
      );
      assert.equal((await request("/gachas/" + id)).body.isFavorite, true);
      assert.equal((await request("/favorites")).body.length, 1);
      const draw = await request("/gachas/" + id + "/pull", "POST", {
        count: 5,
      });
      assert.equal(draw.status, 201);
      assert.equal(draw.body.resultElements.length, 5);
      assert.equal(draw.body.coins, 20);
      assert.equal(
        (await request("/gachas/" + id + "/pull", "POST", { count: 1.5 }))
          .status,
        400
      );
      const claims = await Promise.all([
        request("/missions/m2/claim", "POST", {}),
        request("/missions/m2/claim", "POST", {}),
      ]);
      assert.deepEqual(claims.map((r) => r.status).sort(), [200, 409]);
      assert.equal((await request("/wallet")).body.coins, 22);
      assert.equal(
        (await request("/themes/t2/purchase", "POST", {})).status,
        409
      );
      assert.equal((await request("/wallet")).body.coins, 22);
      const outsider = await request(
        "/auth/register",
        "POST",
        {
          username: "other" + tag,
          email: "other" + tag + "@example.com",
          password: "Abc12345",
        },
        null
      );
      userIds.push(outsider.body.user.id);
      assert.equal((await request('/backup', 'GET', undefined, null)).status, 401);
      assert.equal((await request('/backup')).body.revision, 0);
      const localBackup = { version: 1, gachas: [created.body], history: [{ id: 'local-history', gachaName: 'Food', resultElement: 'Pizza', pulledAt: new Date().toISOString() }], coins: 999999 };
      const backedUp = await request('/backup', 'PUT', { expectedRevision: 0, data: localBackup });
      assert.equal(backedUp.status, 200);
      assert.equal(backedUp.body.revision, 1);
      assert.equal((await request('/backup')).body.data.history[0].id, 'local-history');
      assert.equal((await request('/backup', 'GET', undefined, outsider.body.token)).body.data, null);
      assert.equal((await request('/backup', 'PUT', { expectedRevision: 0, data: localBackup })).status, 409);
      const competingBackups = await Promise.all([
        request('/backup', 'PUT', { expectedRevision: 1, data: localBackup }),
        request('/backup', 'PUT', { expectedRevision: 1, data: localBackup }),
      ]);
      assert.deepEqual(competingBackups.map(r => r.status).sort(), [200, 409]);
      assert.equal((await request('/wallet')).body.coins, 22);
      assert.equal(
        (
          await request(
            "/gachas/" + id,
            "PUT",
            { title: "Stolen" },
            outsider.body.token
          )
        ).status,
        403
      );
      await prisma.user.update({ where: { id: userId }, data: { coins: 50 } });
      const purchases = await Promise.all([
        request("/themes/t2/purchase", "POST", {}),
        request("/themes/t2/purchase", "POST", {}),
      ]);
      assert.ok(purchases.some((r) => r.status === 200));
      assert.equal((await request("/wallet")).body.coins, 20);
      assert.equal((await request("/themes/t2/select", "PUT", {})).status, 200);
      assert.equal(
        (
          await request("/profile", "PUT", {
            username: "changed" + tag,
            frameColor: "#ff00ff",
            coins: 999,
          })
        ).body.coins,
        20
      );
      const updated = await request("/gachas/" + id, "PUT", {
        name: "Updated",
        randomList: [{ element: "New", rate: "100%" }],
      });
      assert.equal(updated.status, 200);
      let history = (await request("/history")).body;
      assert.equal(history.length, 5);
      assert.ok(
        history.every(
          (r) =>
            r.gachaName === "Food" &&
            ["Pizza", "Rice"].includes(r.resultElement)
        )
      );
      assert.equal((await request("/gachas/" + id, "DELETE")).status, 204);
      history = (await request("/history")).body;
      assert.equal(history.length, 5);
      await prisma.user.update({ where: { id: userId }, data: { coins: 0 } });
      const limited = await request("/gachas", "POST", {
        name: "Limited",
        pullOneCost: 1,
        randomList: [{ element: "A", rate: "100%" }],
      });
      const pulls = await Promise.all([
        request("/gachas/" + limited.body.id + "/pull", "POST", { count: 1 }),
        request("/gachas/" + limited.body.id + "/pull", "POST", { count: 1 }),
      ]);
      assert.deepEqual(pulls.map((r) => r.status).sort(), [201, 201]);
      assert.equal((await request("/wallet")).body.coins, 0);
      const arbitrary = await request(
        "/gachas/" + limited.body.id + "/pull",
        "POST",
        { count: 3 }
      );
      assert.equal(arbitrary.status, 201);
      assert.equal(arbitrary.body.resultElements.length, 3);
      const max = await request(
        "/gachas/" + limited.body.id + "/pull",
        "POST",
        { count: 100 }
      );
      assert.equal(max.status, 201);
      assert.equal(max.body.resultElements.length, 100);
      assert.equal(max.body.coins, 0);
      assert.equal(
        (
          await request("/gachas/" + limited.body.id + "/pull", "POST", {
            count: 101,
          })
        ).status,
        400
      );
      const legacy = await request(
        "/cards/" + limited.body.id + "/pull",
        "POST",
        { count: 2 }
      );
      assert.equal(legacy.status, 201);
      assert.equal(legacy.body.length, 2);
      assert.equal((await request("/wallet")).body.coins, 0);
      const stored = await prisma.card.findUnique({
        where: { id: Number(limited.body.id) },
      });
      assert.equal(stored.pullOneCost, 0);
      assert.equal(stored.pullManyCost, 0);
      const login = await request("/auth/login", "POST", {
        email: tag + "@example.com",
        password: "Abc12345",
      });
      assert.equal(login.status, 200);
      const m1 = (await request("/missions")).body.find((m) => m.id === "m1");
      assert.equal(m1.progressLabel, "1/3");
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await new Promise((resolve) => server.close(resolve));
      await prisma.$disconnect();
    }
  }
);
