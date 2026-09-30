-- CreateTable
CREATE TABLE "VoiceChannel" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceNote" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoiceChannel_schoolId_idx" ON "VoiceChannel"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceChannel_classId_name_key" ON "VoiceChannel"("classId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceNote_channelId_userId_key" ON "VoiceNote"("channelId", "userId");

-- AddForeignKey
ALTER TABLE "VoiceNote" ADD CONSTRAINT "VoiceNote_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "VoiceChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing class gets the new "voice" channel entry (new classes get it from the API).
INSERT INTO "Channel" ("id", "classId", "type", "name")
SELECT 'voice_' || c."id", c."id", 'voice', 'voice'
FROM "Class" c
WHERE NOT EXISTS (SELECT 1 FROM "Channel" ch WHERE ch."classId" = c."id" AND ch."type" = 'voice');
