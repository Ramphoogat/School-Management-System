-- DropIndex
DROP INDEX "Channel_classId_type_key";

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "channelId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Channel_classId_name_key" ON "Channel"("classId", "name");

-- CreateIndex
CREATE INDEX "ChatMessage_channelId_createdAt_idx" ON "ChatMessage"("channelId", "createdAt");

