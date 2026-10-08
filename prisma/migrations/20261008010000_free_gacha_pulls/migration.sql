BEGIN;
ALTER TABLE "card" ALTER COLUMN "pull_one_cost" SET DEFAULT 0;
ALTER TABLE "card" ALTER COLUMN "pull_many_cost" SET DEFAULT 0;
UPDATE "card" SET "pull_one_cost" = 0, "pull_many_cost" = 0;
ALTER TABLE "card" DROP CONSTRAINT "card_costs_valid";
ALTER TABLE "card" ADD CONSTRAINT "card_costs_valid" CHECK ("pull_one_cost" = 0 AND "pull_many_cost" = 0 AND "pull_many_count" BETWEEN 2 AND 100);
COMMIT;
