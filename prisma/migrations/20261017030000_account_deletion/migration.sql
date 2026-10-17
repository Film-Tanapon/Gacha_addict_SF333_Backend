CREATE TABLE "uploaded_image" (
    "filename" TEXT NOT NULL,
    "owner_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "uploaded_image_pkey" PRIMARY KEY ("filename")
);
CREATE INDEX "uploaded_image_owner_id_idx" ON "uploaded_image"("owner_id");
ALTER TABLE "uploaded_image" ADD CONSTRAINT "uploaded_image_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "account_deletion_job" (
    "user_id" INTEGER NOT NULL,
    "firebase_uid" TEXT,
    "filenames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,
    CONSTRAINT "account_deletion_job_pkey" PRIMARY KEY ("user_id")
);
CREATE INDEX "account_deletion_job_next_attempt_at_idx" ON "account_deletion_job"("next_attempt_at");
