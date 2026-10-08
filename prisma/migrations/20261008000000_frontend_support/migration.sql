BEGIN;

-- DropForeignKey
ALTER TABLE "card" DROP CONSTRAINT "card_create_by_fkey";

-- DropForeignKey
ALTER TABLE "result" DROP CONSTRAINT "result_card_item_id_fkey";

-- DropForeignKey
ALTER TABLE "result" DROP CONSTRAINT "result_create_by_fkey";

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "coins" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "frame_color" TEXT,
ADD COLUMN     "frame_id" TEXT,
ADD COLUMN     "frame_url" TEXT,
ADD COLUMN     "last_login_day" TEXT,
ADD COLUMN     "selected_theme_id" TEXT;

-- AlterTable
ALTER TABLE "card" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'Custom',
ADD COLUMN     "emoji" TEXT NOT NULL DEFAULT '🎴',
ADD COLUMN     "pull_many_cost" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "pull_many_count" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "pull_one_cost" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "result" ADD COLUMN     "gacha_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "result_element" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "card_item_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "favorite" (
    "user_id" INTEGER NOT NULL,
    "card_id" INTEGER NOT NULL,

    CONSTRAINT "favorite_pkey" PRIMARY KEY ("user_id","card_id")
);

-- CreateTable
CREATE TABLE "theme" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "color_preview" TEXT NOT NULL,

    CONSTRAINT "theme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_theme" (
    "user_id" INTEGER NOT NULL,
    "theme_id" TEXT NOT NULL,
    "purchased_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_theme_pkey" PRIMARY KEY ("user_id","theme_id")
);

-- CreateTable
CREATE TABLE "mission" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "coin_reward" INTEGER NOT NULL,

    CONSTRAINT "mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mission" (
    "user_id" INTEGER NOT NULL,
    "mission_id" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "claimed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_mission_pkey" PRIMARY KEY ("user_id","mission_id")
);

-- CreateIndex
CREATE INDEX "result_create_by_timestamp_idx" ON "result"("create_by", "timestamp");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_selected_theme_id_fkey" FOREIGN KEY ("selected_theme_id") REFERENCES "theme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card" ADD CONSTRAINT "card_create_by_fkey" FOREIGN KEY ("create_by") REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result" ADD CONSTRAINT "result_card_item_id_fkey" FOREIGN KEY ("card_item_id") REFERENCES "card_items"("carditem_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result" ADD CONSTRAINT "result_create_by_fkey" FOREIGN KEY ("create_by") REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "card"("card_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_theme" ADD CONSTRAINT "user_theme_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_theme" ADD CONSTRAINT "user_theme_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mission" ADD CONSTRAINT "user_mission_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mission" ADD CONSTRAINT "user_mission_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve historical labels before items can be edited/deleted.
UPDATE "result" AS r SET "gacha_name" = c."title", "result_element" = i."name" FROM "card_items" AS i JOIN "card" AS c ON c."card_id" = i."card_id" WHERE r."card_item_id" = i."carditem_id";
ALTER TABLE "user" ADD CONSTRAINT "user_coins_nonnegative" CHECK ("coins" >= 0);
ALTER TABLE "card" ADD CONSTRAINT "card_costs_valid" CHECK ("pull_one_cost" >= 0 AND "pull_many_cost" >= 0 AND "pull_many_count" BETWEEN 2 AND 10);
ALTER TABLE "theme" ADD CONSTRAINT "theme_price_nonnegative" CHECK ("price" >= 0);
ALTER TABLE "mission" ADD CONSTRAINT "mission_values_valid" CHECK ("target" > 0 AND "coin_reward" >= 0);
ALTER TABLE "card_items" ADD CONSTRAINT "item_rate_valid" CHECK ("rate" >= 0 AND "rate" < 'Infinity'::float8);
INSERT INTO "theme" ("id", "name", "price", "color_preview") VALUES ('t1','Mint',0,'#86efac'),('t2','Sunset',30,'#fca5a5'),('t3','Ocean',40,'#93c5fd'),('t4','Lavender',50,'#c9bdf7');
INSERT INTO "mission" ("id", "title", "event", "target", "coin_reward") VALUES ('m1','Log In','login',3,1),('m2','Gacha','pull',2,2),('m3','Gacha','pull',10,3);

COMMIT;
