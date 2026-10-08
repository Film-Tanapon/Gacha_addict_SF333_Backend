CREATE TABLE "user_backup" (
    "user_id" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_backup_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_backup_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE
);
