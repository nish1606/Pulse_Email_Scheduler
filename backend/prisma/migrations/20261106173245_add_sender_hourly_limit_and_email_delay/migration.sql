-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "sendDelayMs" INTEGER;

-- AlterTable
ALTER TABLE "Sender" ADD COLUMN     "hourlyLimit" INTEGER;
