-- CreateTable
CREATE TABLE "user" (
    "user_id" SERIAL NOT NULL,
    "google_id" TEXT,
    "google" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatar_url" TEXT,
    "password" TEXT,
    "phone_no" TEXT,
    "create_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "card" (
    "card_id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "card_image" TEXT,
    "frame" TEXT,
    "is_equal_rate" BOOLEAN NOT NULL DEFAULT false,
    "animation" TEXT,
    "create_by" INTEGER NOT NULL,
    "create_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "update_date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_pkey" PRIMARY KEY ("card_id")
);

-- CreateTable
CREATE TABLE "card_items" (
    "carditem_id" SERIAL NOT NULL,
    "card_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "image_url" TEXT,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "card_items_pkey" PRIMARY KEY ("carditem_id")
);

-- CreateTable
CREATE TABLE "result" (
    "result_id" SERIAL NOT NULL,
    "card_item_id" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "create_by" INTEGER NOT NULL,

    CONSTRAINT "result_pkey" PRIMARY KEY ("result_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_google_id_key" ON "user"("google_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- AddForeignKey
ALTER TABLE "card" ADD CONSTRAINT "card_create_by_fkey" FOREIGN KEY ("create_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_items" ADD CONSTRAINT "card_items_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "card"("card_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result" ADD CONSTRAINT "result_card_item_id_fkey" FOREIGN KEY ("card_item_id") REFERENCES "card_items"("carditem_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result" ADD CONSTRAINT "result_create_by_fkey" FOREIGN KEY ("create_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
