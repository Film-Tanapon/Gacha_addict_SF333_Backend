function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
function integer(value, name, min = 1, max = 2147483647) {
  const n = Number(value);
  if (
    value === null ||
    value === "" ||
    typeof value === "boolean" ||
    !Number.isSafeInteger(n) ||
    n < min ||
    n > max
  )
    fail(name + " must be an integer between " + min + " and " + max);
  return n;
}
function text(value, name) {
  if (typeof value !== "string" || !value.trim()) fail(name + " is required");
  return value.trim();
}
function optionalText(value, name) {
  if (value === null) return null;
  if (typeof value !== "string") fail(name + " must be a string or null");
  return value.trim() || null;
}
function boolean(value) {
  if ([true, 1, "1", "true"].includes(value)) return true;
  if ([false, 0, "0", "false"].includes(value)) return false;
  fail("isEqualRate must be a boolean");
}
function pagination({ skip = 0, take = 20 } = {}) {
  return {
    skip: integer(skip, "skip", 0),
    take: integer(take, "take", 1, 100),
  };
}
function item(data) {
  if (!data || typeof data !== "object") fail("Invalid item");
  const raw = data.rate ?? data.weight ?? 0;
  const rate = Number(typeof raw === "string" ? raw.replace(/%$/, "") : raw);
  if (!Number.isFinite(rate) || rate < 0)
    fail("rate must be a non-negative number");
  return {
    name: text(data.name ?? data.element, "item name"),
    rate,
    imageUrl: optionalText(data.imageUrl ?? null, "imageUrl"),
  };
}
module.exports = {
  fail,
  integer,
  text,
  optionalText,
  boolean,
  pagination,
  item,
};
