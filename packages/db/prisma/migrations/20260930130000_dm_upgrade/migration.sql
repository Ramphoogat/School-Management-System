-- AlterTable
ALTER TABLE "DirectMessage" ADD COLUMN     "aboutStudentId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "editedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "ref" TEXT;

-- CreateTable
CREATE TABLE "DmAttachment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "uploaderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageBlock" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageReport" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "reporterId" TEXT NOT NULL,
    "reportedUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DmAttachment_messageId_idx" ON "DmAttachment"("messageId");

-- CreateIndex
CREATE INDEX "DmAttachment_conversationId_idx" ON "DmAttachment"("conversationId");

-- CreateIndex
CREATE INDEX "MessageBlock_blockedId_idx" ON "MessageBlock"("blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageBlock_blockerId_blockedId_key" ON "MessageBlock"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "MessageReport_status_createdAt_idx" ON "MessageReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MessageReport_conversationId_idx" ON "MessageReport"("conversationId");

-- AddForeignKey
ALTER TABLE "DmAttachment" ADD CONSTRAINT "DmAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "DirectMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

