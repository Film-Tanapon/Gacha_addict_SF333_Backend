-- Local/offline IDs are strings and history must survive deleting a deck.
-- Do not infer identity from names: different decks can share or reuse a name.
ALTER TABLE "backup_history" ADD COLUMN "gacha_id" TEXT;
ALTER TABLE "result" ADD COLUMN "gacha_id" TEXT;

-- A surviving item relation is proof of the original server card's ID.
-- Results whose item was already deleted remain legacy history (NULL).
UPDATE "result" r SET "gacha_id" = i."card_id"::text
FROM "card_items" i WHERE r."card_item_id" = i."carditem_id";
