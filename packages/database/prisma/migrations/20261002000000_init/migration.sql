-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Player" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "playerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "civilizationName" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentTurn" INTEGER NOT NULL,
    "era" INTEGER NOT NULL,
    "stateHash" TEXT NOT NULL,
    "commandSeq" INTEGER NOT NULL DEFAULT 0,
    "schemaVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameState" (
    "id" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameCommand" (
    "id" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "commandId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "aiInputs" JSONB,
    "stateHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaveGame" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "autosave" BOOLEAN NOT NULL DEFAULT false,
    "seed" TEXT NOT NULL,
    "civilizationName" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "era" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "appVersion" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "commandSeq" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaveGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Faction" (
    "gameId" TEXT NOT NULL,
    "factionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "archetype" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "alive" BOOLEAN NOT NULL,
    "opinionOfPlayer" DOUBLE PRECISION NOT NULL,
    "militaryStrength" DOUBLE PRECISION NOT NULL,
    "settlementCount" INTEGER NOT NULL,
    "techCount" INTEGER NOT NULL,
    "posture" TEXT NOT NULL,
    "personality" JSONB NOT NULL,
    "memories" JSONB NOT NULL,

    CONSTRAINT "Faction_pkey" PRIMARY KEY ("gameId","factionId")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "gameId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "founderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tile" INTEGER NOT NULL,
    "population" INTEGER NOT NULL,
    "stability" DOUBLE PRECISION NOT NULL,
    "hp" INTEGER NOT NULL,
    "isCapital" BOOLEAN NOT NULL,
    "foundedTurn" INTEGER NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("gameId","settlementId")
);

-- CreateTable
CREATE TABLE "Unit" (
    "gameId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tile" INTEGER NOT NULL,
    "hp" INTEGER NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("gameId","unitId")
);

-- CreateTable
CREATE TABLE "Tile" (
    "gameId" TEXT NOT NULL,
    "tileIndex" INTEGER NOT NULL,
    "biome" TEXT NOT NULL,
    "baseBiome" TEXT NOT NULL,
    "ownerId" TEXT,
    "buildingType" TEXT,
    "pollution" DOUBLE PRECISION NOT NULL,
    "forest" DOUBLE PRECISION NOT NULL,
    "fertility" DOUBLE PRECISION NOT NULL,
    "habitat" DOUBLE PRECISION NOT NULL,
    "prosperity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Tile_pkey" PRIMARY KEY ("gameId","tileIndex")
);

-- CreateTable
CREATE TABLE "ResourceNode" (
    "gameId" TEXT NOT NULL,
    "tileIndex" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "initialAmount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ResourceNode_pkey" PRIMARY KEY ("gameId","tileIndex")
);

-- CreateTable
CREATE TABLE "Technology" (
    "gameId" TEXT NOT NULL,
    "factionId" TEXT NOT NULL,
    "techId" TEXT NOT NULL,

    CONSTRAINT "Technology_pkey" PRIMARY KEY ("gameId","factionId","techId")
);

-- CreateTable
CREATE TABLE "Quest" (
    "gameId" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "issuedTurn" INTEGER NOT NULL,
    "expiresTurn" INTEGER NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "Quest_pkey" PRIMARY KEY ("gameId","questId")
);

-- CreateTable
CREATE TABLE "GameEvent" (
    "gameId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "severity" DOUBLE PRECISION NOT NULL,
    "region" TEXT NOT NULL,
    "major" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "GameEvent_pkey" PRIMARY KEY ("gameId","eventId")
);

-- CreateTable
CREATE TABLE "HistoricalEvent" (
    "gameId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "importance" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "HistoricalEvent_pkey" PRIMARY KEY ("gameId","entryId")
);

-- CreateTable
CREATE TABLE "DiplomacyRelation" (
    "gameId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "a" TEXT NOT NULL,
    "b" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trade" BOOLEAN NOT NULL,
    "sinceTurn" INTEGER NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "DiplomacyRelation_pkey" PRIMARY KEY ("gameId","pairKey")
);

-- CreateTable
CREATE TABLE "AIDecision" (
    "id" UUID NOT NULL,
    "gameId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "factionId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "questionSchemaVersion" TEXT NOT NULL,
    "answer" JSONB,
    "probability" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "executionResult" JSONB,
    "latencyMs" INTEGER NOT NULL,
    "fallbackUsed" BOOLEAN NOT NULL,
    "fallbackReason" TEXT,
    "requestId" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIRequest" (
    "id" UUID NOT NULL,
    "correlationId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorKind" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "retryCount" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedAsset" (
    "id" UUID NOT NULL,
    "promptHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storageLocation" TEXT NOT NULL,
    "gameId" TEXT,
    "eventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameAssetLink" (
    "gameId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "assetId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameAssetLink_pkey" PRIMARY KEY ("gameId","key")
);

-- CreateTable
CREATE TABLE "Narrative" (
    "gameId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "reactions" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Narrative_pkey" PRIMARY KEY ("gameId","key")
);

-- CreateIndex
CREATE INDEX "Game_playerId_updatedAt_idx" ON "Game"("playerId", "updatedAt");

-- CreateIndex
CREATE INDEX "GameState_gameId_seq_idx" ON "GameState"("gameId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "GameCommand_gameId_commandId_key" ON "GameCommand"("gameId", "commandId");

-- CreateIndex
CREATE UNIQUE INDEX "GameCommand_gameId_seq_key" ON "GameCommand"("gameId", "seq");

-- CreateIndex
CREATE INDEX "SaveGame_playerId_createdAt_idx" ON "SaveGame"("playerId", "createdAt");

-- CreateIndex
CREATE INDEX "SaveGame_gameId_autosave_idx" ON "SaveGame"("gameId", "autosave");

-- CreateIndex
CREATE INDEX "Settlement_gameId_ownerId_idx" ON "Settlement"("gameId", "ownerId");

-- CreateIndex
CREATE INDEX "GameEvent_gameId_turn_idx" ON "GameEvent"("gameId", "turn");

-- CreateIndex
CREATE INDEX "HistoricalEvent_gameId_turn_idx" ON "HistoricalEvent"("gameId", "turn");

-- CreateIndex
CREATE INDEX "AIDecision_gameId_turn_idx" ON "AIDecision"("gameId", "turn");

-- CreateIndex
CREATE INDEX "AIRequest_createdAt_idx" ON "AIRequest"("createdAt");

-- CreateIndex
CREATE INDEX "AIRequest_gameId_idx" ON "AIRequest"("gameId");

-- CreateIndex
CREATE INDEX "AIRequest_provider_status_idx" ON "AIRequest"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedAsset_promptHash_key" ON "GeneratedAsset"("promptHash");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameState" ADD CONSTRAINT "GameState_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameCommand" ADD CONSTRAINT "GameCommand_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaveGame" ADD CONSTRAINT "SaveGame_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaveGame" ADD CONSTRAINT "SaveGame_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Faction" ADD CONSTRAINT "Faction_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tile" ADD CONSTRAINT "Tile_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceNode" ADD CONSTRAINT "ResourceNode_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Technology" ADD CONSTRAINT "Technology_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quest" ADD CONSTRAINT "Quest_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameEvent" ADD CONSTRAINT "GameEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalEvent" ADD CONSTRAINT "HistoricalEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiplomacyRelation" ADD CONSTRAINT "DiplomacyRelation_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIDecision" ADD CONSTRAINT "AIDecision_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAssetLink" ADD CONSTRAINT "GameAssetLink_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAssetLink" ADD CONSTRAINT "GameAssetLink_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "GeneratedAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Narrative" ADD CONSTRAINT "Narrative_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

