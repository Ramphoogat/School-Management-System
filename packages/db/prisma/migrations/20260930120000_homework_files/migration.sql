-- CreateTable
CREATE TABLE "HomeworkFile" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeworkFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomeworkFile_storageKey_key" ON "HomeworkFile"("storageKey");

-- CreateIndex
CREATE INDEX "HomeworkFile_assignmentId_studentId_idx" ON "HomeworkFile"("assignmentId", "studentId");

-- AddForeignKey
ALTER TABLE "HomeworkFile" ADD CONSTRAINT "HomeworkFile_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
