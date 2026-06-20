-- Add new AuditAction enum values
-- These statements must run outside a transaction in PostgreSQL
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BACKUP_EXPORT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BACKUP_VALIDATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BACKUP_RESTORE';

-- Create password_reset_tokens table
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedIp" TEXT,
    "requestedUserAgent" TEXT,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- Unique index on tokenHash (prevents token reuse even if two happen to collide, which is astronomically unlikely)
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- Indexes for efficient lookups
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

-- Foreign key — cascade delete: if a user is deleted, their reset tokens disappear too
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
