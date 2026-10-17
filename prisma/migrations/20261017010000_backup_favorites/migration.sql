-- Restore flags already saved in legacy backups into the normalized Favorite table.
-- Preserve newer card edits and other users' favorites. Re-running is safe.
INSERT INTO "favorite" ("user_id", "card_id")
SELECT b."user_id", c."card_id"
FROM "user_backup" b
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(b."data"->'gachas') = 'array' THEN b."data"->'gachas' ELSE '[]'::jsonb END
) AS g(item)
JOIN "card" c ON c."create_by" = b."user_id" AND c."client_id" = g.item->>'id'
WHERE g.item->>'isFavorite' = 'true'
  AND (c."client_updated_at" IS NULL OR
    (g.item->>'localUpdatedAt')::timestamptz AT TIME ZONE 'UTC' >= c."client_updated_at")
ON CONFLICT ("user_id", "card_id") DO NOTHING;
