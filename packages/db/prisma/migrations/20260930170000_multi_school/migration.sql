-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'superadmin';

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "brandHue" INTEGER,
ADD COLUMN     "isPlatform" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "logoKey" TEXT,
ADD COLUMN     "logoMime" TEXT,
ADD COLUMN     "logoUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "tagline" TEXT;

-- Existing schools get an address made from their name (a short id suffix keeps any duplicates apart).
UPDATE "School" SET "slug" = trim(both '-' from lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g')));
UPDATE "School" SET "slug" = 'school' WHERE "slug" = '';
UPDATE "School" s SET "slug" = s."slug" || '-' || substr(s."id", length(s."id") - 3)
WHERE s."id" IN (SELECT "id" FROM (SELECT "id", row_number() OVER (PARTITION BY "slug" ORDER BY "createdAt") AS rn FROM "School") t WHERE t.rn > 1);

-- CreateIndex
CREATE UNIQUE INDEX "School_slug_key" ON "School"("slug");

