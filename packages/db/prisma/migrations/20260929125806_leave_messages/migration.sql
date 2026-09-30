-- CreateTable
CREATE TABLE "LeaveMessage" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "leaveId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveMessage_leaveId_createdAt_idx" ON "LeaveMessage"("leaveId", "createdAt");

-- AddForeignKey
ALTER TABLE "LeaveMessage" ADD CONSTRAINT "LeaveMessage_leaveId_fkey" FOREIGN KEY ("leaveId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
