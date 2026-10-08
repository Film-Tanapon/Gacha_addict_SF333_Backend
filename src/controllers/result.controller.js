const { asyncHandler } = require("../middleware/error.middleware");
const resultService = require("../services/result.service");

const pull = asyncHandler(async (req, res) => {
  const count = req.body.count ?? 1;
  const results = await resultService.pullCard(
    req.params.cardId,
    req.user.id,
    count
  );
  res.status(201).json(results);
});

const list = asyncHandler(async (req, res) => {
  const results = await resultService.listResults(req.user.id, req.query);
  res.json(results);
});

const getOne = asyncHandler(async (req, res) => {
  const result = await resultService.getResultById(req.params.id, req.user.id);
  res.json(result);
});

const remove = asyncHandler(async (req, res) => {
  await resultService.deleteResult(req.params.id, req.user.id);
  res.status(204).send();
});

module.exports = { pull, list, getOne, remove };
