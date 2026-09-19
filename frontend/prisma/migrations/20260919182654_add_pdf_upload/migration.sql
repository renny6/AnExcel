-- CreateEnum
CREATE TYPE "PdfUploadStatus" AS ENUM ('processing', 'split', 'failed');

-- CreateTable
CREATE TABLE "pdf_uploads" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "original_filename" TEXT NOT NULL,
    "status" "PdfUploadStatus" NOT NULL DEFAULT 'processing',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdf_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pdf_uploads_batch_id_idx" ON "pdf_uploads"("batch_id");

-- AddForeignKey
ALTER TABLE "pdf_uploads" ADD CONSTRAINT "pdf_uploads_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
