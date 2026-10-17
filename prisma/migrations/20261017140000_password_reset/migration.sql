ALTER TABLE "user" ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "password_reset_challenge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email_key" TEXT NOT NULL UNIQUE,
  "user_id" INTEGER REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE,
  "auth_version" INTEGER,
  "code_hash" TEXT NOT NULL,
  "encrypted_code" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "verified_at" TIMESTAMP(3),
  "reset_token_hash" TEXT UNIQUE,
  "delivery_attempts" INTEGER NOT NULL DEFAULT 0,
  "next_delivery_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "password_reset_challenge_expires_at_idx" ON "password_reset_challenge"("expires_at");
CREATE INDEX "password_reset_challenge_next_delivery_at_idx" ON "password_reset_challenge"("next_delivery_at");
CREATE TABLE "password_reset_rate_limit" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "password_reset_rate_limit_expires_at_idx" ON "password_reset_rate_limit"("expires_at");
