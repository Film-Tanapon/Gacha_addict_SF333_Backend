const v = require('./input');
const DAY_MS = 86400000;
const BANGKOK_OFFSET_MS = 7 * 3600000;
const DEFAULT_ANCHOR = '2026-01-05';
function dateOnly(value) {
  if (typeof value !== 'string' || !/^(19|2\d)\d{2}-\d{2}-\d{2}$/.test(value)) v.fail('resetAnchorDate must be YYYY-MM-DD (1900-2999)');
  const n = Date.parse(value + 'T00:00:00.000Z');
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value) v.fail('Invalid resetAnchorDate');
  return value;
}
function missionData(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) v.fail('Invalid mission');
  const title = v.text(body.title, 'title');
  if (title.length > 200) v.fail('title must be at most 200 characters');
  if (!['login', 'pull'].includes(body.event)) v.fail('event must be login or pull');
  const target = v.integer(body.target, 'target');
  const resetEveryDays = body.resetEveryDays == null ? null : v.integer(body.resetEveryDays, 'resetEveryDays', 1, 3650);
  if (body.event === 'login' && resetEveryDays !== null && target > resetEveryDays) v.fail('Login target cannot exceed the number of days in its reset cycle');
  return { title, event: body.event, target, coinReward: v.integer(body.coinReward, 'coinReward', 0), resetEveryDays, resetAnchorDate: dateOnly(body.resetAnchorDate ?? DEFAULT_ANCHOR) };
}
function missionPeriod(mission, now = new Date()) {
  const version = mission.scheduleVersion ?? 1;
  if (!mission.resetEveryDays) return { key: version + ':lifetime', startsAt: null, nextResetAt: null, active: true };
  const currentDay = Math.floor((now.getTime() + BANGKOK_OFFSET_MS) / DAY_MS);
  const anchor = Date.parse(mission.resetAnchorDate + 'T00:00:00.000Z') / DAY_MS;
  const startDay = anchor + Math.max(0, Math.floor((currentDay - anchor) / mission.resetEveryDays)) * mission.resetEveryDays;
  const startsAt = new Date(startDay * DAY_MS - BANGKOK_OFFSET_MS);
  const active = currentDay >= anchor;
  return {
    key: version + ':' + new Date(startDay * DAY_MS).toISOString().slice(0, 10),
    startsAt,
    nextResetAt: active ? new Date(startsAt.getTime() + mission.resetEveryDays * DAY_MS) : startsAt,
    active,
  };
}
module.exports = { missionData, missionPeriod, dateOnly, DEFAULT_ANCHOR };
