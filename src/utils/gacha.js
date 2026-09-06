/**
 * Core gacha-pull logic.
 * Given a list of card items (each with a numeric `rate`) and whether the
 * card uses an equal-rate policy, pick one item at random.
 */

function pickEqualRate(items) {
  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

function pickWeightedRate(items) {
  const totalWeight = items.reduce((sum, item) => sum + (item.rate > 0 ? item.rate : 0), 0);

  // If nobody set a rate, fall back to equal odds instead of crashing
  if (totalWeight <= 0) {
    return pickEqualRate(items);
  }

  let roll = Math.random() * totalWeight;
  for (const item of items) {
    const weight = item.rate > 0 ? item.rate : 0;
    if (roll < weight) return item;
    roll -= weight;
  }

  // Floating point edge case fallback
  return items[items.length - 1];
}

/**
 * @param {Array} items - card items belonging to a card, must be non-empty
 * @param {boolean} isEqualRate - true = every item has the same odds
 * @param {number} count - how many times to pull (default 1)
 * @returns {Array} the drawn items, length === count
 */
function pullGacha(items, isEqualRate, count = 1) {
  if (!items || items.length === 0) {
    throw new Error('This card has no items to pull from');
  }

  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(isEqualRate ? pickEqualRate(items) : pickWeightedRate(items));
  }
  return results;
}

module.exports = { pullGacha };
