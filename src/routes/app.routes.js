const { Router } = require("express");
const prisma = require("../config/prisma");
const { requireAuth } = require("../middleware/auth.middleware");
const { asyncHandler: wrap } = require("../middleware/error.middleware");
const cards = require("../services/card.service");
const results = require("../services/result.service");
const economy = require("../services/economy.service");
const users = require("../services/user.service");
const v = require("../utils/input");
const router = Router();
router.use(requireAuth);
async function favoriteIds(userId) {
  return new Set(
    (await prisma.favorite.findMany({ where: { userId } })).map((f) => f.cardId)
  );
}
router.get(
  "/gachas",
  wrap(async (req, res) => {
    const favorites = await favoriteIds(req.user.id);
    res.json(
      (await cards.listCards(req.query)).map((c) =>
        cards.toGacha(c, favorites.has(c.id))
      )
    );
  })
);
router.get(
  "/gachas/:id",
  wrap(async (req, res) => {
    const c = await cards.getCardById(req.params.id);
    const favorites = await favoriteIds(req.user.id);
    res.json(cards.toGacha(c, favorites.has(c.id)));
  })
);
router.post(
  "/gachas",
  wrap(async (req, res) =>
    res
      .status(201)
      .json(cards.toGacha(await cards.createCard(req.user.id, req.body)))
  )
);
router.put(
  "/gachas/:id",
  wrap(async (req, res) => {
    const c = await cards.updateCard(req.params.id, req.user.id, req.body);
    const favorites = await favoriteIds(req.user.id);
    res.json(cards.toGacha(c, favorites.has(c.id)));
  })
);
router.delete(
  "/gachas/:id",
  wrap(async (req, res) => {
    await cards.deleteCard(req.params.id, req.user.id);
    res.sendStatus(204);
  })
);
router.post(
  "/gachas/:id/pull",
  wrap(async (req, res) => {
    const drawn = await results.pullCard(
      req.params.id,
      req.user.id,
      req.body.count ?? req.body.pullCount ?? 1
    );
    const user = await users.getUserById(req.user.id);
    res
      .status(201)
      .json({
        resultElements: drawn.map((r) => r.resultElement),
        history: drawn.map(results.toHistory),
        coins: user.coins,
      });
  })
);
router.get(
  "/favorites",
  wrap(async (req, res) => {
    const favorites = await prisma.favorite.findMany({
      where: { userId: req.user.id },
      ...v.pagination(req.query),
      include: { card: { include: { cardItems: true } } },
    });
    res.json(favorites.map((f) => cards.toGacha(f.card, true)));
  })
);
router.put(
  "/favorites/:id",
  wrap(async (req, res) => {
    const card = await cards.getCardById(req.params.id);
    await prisma.favorite.upsert({
      where: { userId_cardId: { userId: req.user.id, cardId: card.id } },
      create: { userId: req.user.id, cardId: card.id },
      update: {},
    });
    res.json({ isFavorite: true });
  })
);
router.delete(
  "/favorites/:id",
  wrap(async (req, res) => {
    await prisma.favorite.deleteMany({
      where: {
        userId: req.user.id,
        cardId: v.integer(req.params.id, "card id"),
      },
    });
    res.json({ isFavorite: false });
  })
);
router.get(
  "/history",
  wrap(async (req, res) =>
    res.json(
      (await results.listResults(req.user.id, req.query)).map(results.toHistory)
    )
  )
);
router.delete(
  "/history/:id",
  wrap(async (req, res) => {
    await results.deleteResult(req.params.id, req.user.id);
    res.sendStatus(204);
  })
);
router.get(
  "/wallet",
  wrap(async (req, res) =>
    res.json({ coins: (await users.getUserById(req.user.id)).coins })
  )
);
router.get(
  "/themes",
  wrap(async (req, res) => res.json(await economy.listThemes(req.user.id)))
);
router.post(
  "/themes/:id/purchase",
  wrap(async (req, res) =>
    res.json(await economy.purchaseTheme(req.user.id, req.params.id))
  )
);
router.put(
  "/themes/:id/select",
  wrap(async (req, res) =>
    res.json(await economy.selectTheme(req.user.id, req.params.id))
  )
);
router.get(
  "/missions",
  wrap(async (req, res) => res.json(await economy.listMissions(req.user.id)))
);
router.post(
  "/missions/:id/claim",
  wrap(async (req, res) =>
    res.json(await economy.claimMission(req.user.id, req.params.id))
  )
);
router.put(
  "/profile",
  wrap(async (req, res) =>
    res.json(await users.updateUser(req.user.id, req.body))
  )
);
module.exports = router;
