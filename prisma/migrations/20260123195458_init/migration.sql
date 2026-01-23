-- CreateTable
CREATE TABLE "ProfileSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MonitoredProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "fullName" TEXT,
    "profilePicUrl" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "followerCount" INTEGER,
    "followingCount" INTEGER,
    "lastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "setId" TEXT NOT NULL,
    CONSTRAINT "MonitoredProfile_setId_fkey" FOREIGN KEY ("setId") REFERENCES "ProfileSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowingEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "fullName" TEXT,
    "profilePicUrl" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "profileId" TEXT NOT NULL,
    CONSTRAINT "FollowingEntry_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MonitoredProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChangeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "targetUsername" TEXT NOT NULL,
    "targetFullName" TEXT,
    "targetPicUrl" TEXT,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" DATETIME,
    "profileId" TEXT NOT NULL,
    CONSTRAINT "ChangeEvent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MonitoredProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'app_config',
    "n8nWebhookUrl" TEXT,
    "checkIntervalMs" INTEGER NOT NULL DEFAULT 1800000,
    "delayBetweenProfilesMs" INTEGER NOT NULL DEFAULT 45000,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfileSet_name_key" ON "ProfileSet"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoredProfile_setId_username_key" ON "MonitoredProfile"("setId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "FollowingEntry_profileId_username_key" ON "FollowingEntry"("profileId", "username");
