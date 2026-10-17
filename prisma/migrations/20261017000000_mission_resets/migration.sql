ALTER TABLE "mission"
  ADD COLUMN "reset_every_days" INTEGER,
  ADD COLUMN "reset_anchor_date" TEXT NOT NULL DEFAULT '2026-01-05',
  ADD COLUMN "schedule_version" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "mission_reset_days_valid" CHECK ("reset_every_days" IS NULL OR "reset_every_days" BETWEEN 1 AND 3650),
  ADD CONSTRAINT "mission_schedule_version_valid" CHECK ("schedule_version" > 0);
ALTER TABLE "user_mission" ADD COLUMN "period_key" TEXT NOT NULL DEFAULT '1:lifetime';
-- Existing one-time custom missions retain their behavior. Enable recurrence for built-in missions.
UPDATE "mission" SET "reset_every_days" = 7 WHERE "id" = 'm1' AND "event" = 'login' AND "target" <= 7;
UPDATE "mission" SET "reset_every_days" = 1 WHERE "id" IN ('m2', 'm3') AND "event" = 'pull';
