-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "description" TEXT,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookRevocation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "revokedById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookRevocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Book_storageKey_key" ON "Book"("storageKey");

-- CreateIndex
CREATE INDEX "Book_classId_createdAt_idx" ON "Book"("classId", "createdAt");

-- CreateIndex
CREATE INDEX "BookRevocation_studentId_idx" ON "BookRevocation"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "BookRevocation_bookId_studentId_key" ON "BookRevocation"("bookId", "studentId");

-- AddForeignKey
ALTER TABLE "BookRevocation" ADD CONSTRAINT "BookRevocation_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every class that exists already gets a books channel too (unless it already has a channel with that name).
INSERT INTO "Channel" ("id", "classId", "type", "name")
SELECT 'books_' || md5(c."id"), c."id", 'books', 'books'
FROM "Class" c
WHERE NOT EXISTS (SELECT 1 FROM "Channel" ch WHERE ch."classId" = c."id" AND ch."name" = 'books');
