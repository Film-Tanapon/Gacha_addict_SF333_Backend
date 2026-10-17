CREATE TABLE "backup_history" (
 "sequence" BIGSERIAL PRIMARY KEY,
 "user_id" INTEGER NOT NULL REFERENCES "user"("user_id") ON DELETE CASCADE,
 "client_id" TEXT NOT NULL,
 "gacha_name" TEXT NOT NULL,
 "result_element" TEXT NOT NULL,
 "pulled_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "backup_history_user_id_client_id_key" ON "backup_history"("user_id", "client_id");
CREATE INDEX "backup_history_user_id_sequence_idx" ON "backup_history"("user_id", "sequence");

-- Copy accepted legacy history without granting mission rewards again. Keep
-- the original JSON intact so source rollback never destroys the old snapshot.
INSERT INTO "backup_history" ("user_id", "client_id", "gacha_name", "result_element", "pulled_at")
SELECT b."user_id", h->>'id', h->>'gachaName', h->>'resultElement',
 (h->>'pulledAt')::timestamptz AT TIME ZONE 'UTC'
FROM "user_backup" b CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(b."data"->'history') = 'array' THEN b."data"->'history' ELSE '[]'::jsonb END
) h
ON CONFLICT ("user_id", "client_id") DO NOTHING;
