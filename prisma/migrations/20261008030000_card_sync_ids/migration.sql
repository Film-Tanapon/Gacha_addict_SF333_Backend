ALTER TABLE "card" ADD COLUMN "client_id" TEXT;
ALTER TABLE "card" ADD COLUMN "client_updated_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "card_create_by_client_id_key" ON "card"("create_by", "client_id");
