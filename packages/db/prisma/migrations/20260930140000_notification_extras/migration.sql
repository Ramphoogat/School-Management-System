-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "urgent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "QuietHours" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuietHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuietHours_userId_key" ON "QuietHours"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_schoolId_event_variant_key" ON "NotificationTemplate"("schoolId", "event", "variant");

