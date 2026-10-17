const v = require('./input');
function normalizeHistory(h) {
  if (!h) v.fail('Invalid backup history');
  const text = (value, field) => {
    const result = v.text(value, field);
    if (result.length > 500) v.fail(field + ' is too long');
    return result;
  };
  if (typeof h.pulledAt !== 'string' || !Number.isFinite(Date.parse(h.pulledAt))) v.fail('Invalid backup timestamp');
  return { id: text(h.id, 'history id'), gachaName: text(h.gachaName, 'gachaName'),
    ...(h.gachaId == null ? {} : { gachaId: text(h.gachaId, 'gachaId') }),
    resultElement: text(h.resultElement, 'resultElement'), pulledAt: new Date(h.pulledAt).toISOString() };
}
function normalizeBackup(body) {
  if (!body || typeof body !== 'object') v.fail('Invalid backup');
  const expectedRevision = v.integer(body.expectedRevision, 'expectedRevision', 0);
  const data = body.data;
  if (!data || data.version !== 1 || !Array.isArray(data.gachas) || !Array.isArray(data.history)) v.fail('Invalid backup format');
  if (data.gachas.length > 1000 || data.history.length > 10000) v.fail('Backup has too many records', 413);
  if (body.historyMode === 'paged' && data.history.length) v.fail('Send history in separate batches');
  const bounded = (value, field, max = 500) => {
    const text = v.text(value, field);
    if (text.length > max) v.fail(field + ' is too long');
    return text;
  };
  const optional = value => value == null ? null : bounded(value, 'optional text', 200000);
  const date = value => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) v.fail('Invalid backup timestamp');
    return new Date(value).toISOString();
  };
  const gachas = data.gachas.map(g => {
    if (!g || !Array.isArray(g.randomList) || !g.randomList.length || g.randomList.length > 100) v.fail('Invalid backup gacha');
    if (!['Custom', 'YesOrNo', 'Food'].includes(g.category)) v.fail('Invalid category');
    const randomList = g.randomList.map(item => {
      if (!item) v.fail('Invalid backup item');
      const rate = Number(typeof item.rate === 'string' ? item.rate.replace(/%$/, '') : item.rate);
      if (!Number.isFinite(rate) || rate < 0) v.fail('Invalid backup rate');
      return { id: bounded(item.id, 'item id'), element: bounded(item.element, 'element'), rate: rate + '%' };
    });
    const isEqualRate = v.boolean(g.isEqualRate ?? false);
    if (!isEqualRate && !randomList.some(item => parseFloat(item.rate) > 0)) v.fail('Backup gacha needs a positive weight');
    return {
      id: bounded(g.id, 'gacha id'), name: bounded(g.name, 'name'), category: g.category,
      bannerUri: optional(g.bannerUri), emoji: g.emoji ? bounded(g.emoji, 'emoji', 50) : '🎴',
      frameId: optional(g.frameId), animation: optional(g.animation), isEqualRate,
      isFavorite: v.boolean(g.isFavorite), pullOneCost: 0, pullManyCost: 0,
      pullManyCount: v.integer(g.pullManyCount ?? 5, 'pullManyCount', 2, 100), randomList,
      ...(g.localUpdatedAt ? { localUpdatedAt: date(g.localUpdatedAt) } : {}),
    };
  });
  const history = data.history.map(normalizeHistory);
  for (const records of [gachas, history]) if (new Set(records.map(r => r.id)).size !== records.length) v.fail('Duplicate backup record id');
  // Whitelist only local records; a backup cannot mint coins, themes or mission rewards.
  return { expectedRevision, data: { version: 1, gachas, history } };
}
module.exports = { normalizeBackup, normalizeHistory };
