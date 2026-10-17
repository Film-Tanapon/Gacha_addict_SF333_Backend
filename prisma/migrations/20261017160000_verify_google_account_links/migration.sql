ALTER TABLE "user" ADD COLUMN "google_link_verified" BOOLEAN NOT NULL DEFAULT false;

-- Google-only accounts have no unverified password credential to reconcile.
UPDATE "user" SET "google_link_verified" = true
WHERE "google_id" IS NOT NULL AND "password" IS NULL;

-- Previously automatic links must prove both identities before using either
-- login method again. Invalidate existing sessions, including password sessions.
UPDATE "user" SET "auth_version" = "auth_version" + 1
WHERE "google_id" IS NOT NULL AND "password" IS NOT NULL;
