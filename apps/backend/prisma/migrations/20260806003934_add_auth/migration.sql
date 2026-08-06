-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_login_at" TIMESTAMPTZ(6),
ADD COLUMN     "password_hash" TEXT;
