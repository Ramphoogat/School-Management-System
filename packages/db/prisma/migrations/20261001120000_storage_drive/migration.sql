-- CreateTable
CREATE TABLE "StorageObject" (
    "key" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "remoteId" TEXT,
    "size" INTEGER NOT NULL,
    "schoolId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageObject_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "StorageSetting" (
    "schoolId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'auto',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageSetting_pkey" PRIMARY KEY ("schoolId")
);

-- CreateIndex
CREATE INDEX "StorageObject_backend_idx" ON "StorageObject"("backend");

-- CreateIndex
CREATE INDEX "StorageObject_schoolId_backend_idx" ON "StorageObject"("schoolId", "backend");

-- Everything stored so far is in the main storage. Record it, so the space already used is counted.
INSERT INTO "StorageObject" ("key", "backend", "size", "schoolId") SELECT "storageKey", 'primary', "size", "schoolId" FROM "HomeworkFile" ON CONFLICT ("key") DO NOTHING;
INSERT INTO "StorageObject" ("key", "backend", "size", "schoolId") SELECT "storageKey", 'primary', "size", "schoolId" FROM "ResourceFile" ON CONFLICT ("key") DO NOTHING;
INSERT INTO "StorageObject" ("key", "backend", "size", "schoolId") SELECT "storageKey", 'primary', "size", "schoolId" FROM "SchoolDocument" ON CONFLICT ("key") DO NOTHING;
INSERT INTO "StorageObject" ("key", "backend", "size", "schoolId") SELECT "storageKey", 'primary', "size", "schoolId" FROM "DmAttachment" ON CONFLICT ("key") DO NOTHING;
INSERT INTO "StorageObject" ("key", "backend", "size", "schoolId") SELECT "storageKey", 'primary', "size", "schoolId" FROM "Book" ON CONFLICT ("key") DO NOTHING;
