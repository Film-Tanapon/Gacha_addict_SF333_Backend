-- Credit completed missions left unclaimed under the previous manual reward flow.
WITH awarded AS (
 UPDATE "user_mission" um SET "claimed" = true FROM "mission" m
 WHERE um."mission_id" = m."id" AND um."claimed" = false AND um."progress" >= m."target"
 RETURNING um."user_id", m."coin_reward"
), totals AS (SELECT "user_id", SUM("coin_reward") AS reward FROM awarded GROUP BY "user_id")
UPDATE "user" u SET "coins" = u."coins" + totals.reward FROM totals WHERE u."user_id" = totals."user_id";
