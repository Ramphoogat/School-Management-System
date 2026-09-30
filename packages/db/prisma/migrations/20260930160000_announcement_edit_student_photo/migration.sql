-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "editedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StudentPhoto" (
    "studentId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentPhoto_pkey" PRIMARY KEY ("studentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentPhoto_storageKey_key" ON "StudentPhoto"("storageKey");

