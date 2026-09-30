-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "termId" TEXT;

-- CreateTable
CREATE TABLE "AcademicYear" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Term" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,

    CONSTRAINT "Term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeBand" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "minPercent" DOUBLE PRECISION NOT NULL,
    "grade" TEXT NOT NULL,

    CONSTRAINT "GradeBand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcademicYear_schoolId_name_key" ON "AcademicYear"("schoolId", "name");

-- CreateIndex
CREATE INDEX "Term_schoolId_startDate_idx" ON "Term"("schoolId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "Term_yearId_name_key" ON "Term"("yearId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "GradeBand_schoolId_grade_key" ON "GradeBand"("schoolId", "grade");

-- CreateIndex
CREATE UNIQUE INDEX "GradeBand_schoolId_minPercent_key" ON "GradeBand"("schoolId", "minPercent");

-- AddForeignKey
ALTER TABLE "Term" ADD CONSTRAINT "Term_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
