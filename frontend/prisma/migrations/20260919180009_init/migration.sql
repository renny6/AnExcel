-- CreateEnum
CREATE TYPE "IdentitySource" AS ENUM ('test', 'real');

-- CreateEnum
CREATE TYPE "RetentionPeriod" AS ENUM ('one_week', 'two_weeks', 'one_month', 'three_months', 'six_months');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('draft', 'processing', 'ready_for_review', 'approved', 'exported');

-- CreateEnum
CREATE TYPE "AnswerSheetStatus" AS ENUM ('processing', 'needs_review', 'auto_approved', 'manual', 'failed', 'reviewed');

-- CreateEnum
CREATE TYPE "QuestionMarkSource" AS ENUM ('auto', 'corrected');

-- CreateTable
CREATE TABLE "professors" (
    "id" UUID NOT NULL,
    "identity_source" "IdentitySource" NOT NULL DEFAULT 'test',
    "external_id" TEXT NOT NULL,
    "password_hash" TEXT,
    "name" TEXT NOT NULL,
    "college_code" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "professors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "professor_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "professor_id" UUID NOT NULL,
    "declared_subject_code" TEXT NOT NULL,
    "declared_subject_name" TEXT NOT NULL,
    "declared_course_batch" TEXT NOT NULL,
    "retention_period" "RetentionPeriod" NOT NULL,
    "images_purge_at" TIMESTAMP(3),
    "status" "BatchStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_sheets" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "image_storage_key" TEXT NOT NULL,
    "register_number" TEXT,
    "total_marks" DECIMAL(5,2),
    "status" "AnswerSheetStatus" NOT NULL DEFAULT 'processing',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "answer_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_marks" (
    "id" UUID NOT NULL,
    "answer_sheet_id" UUID NOT NULL,
    "question_no" TEXT NOT NULL,
    "sub_part" TEXT,
    "marks" DECIMAL(5,2) NOT NULL,
    "tick_state" BOOLEAN NOT NULL,
    "confidence_score" DECIMAL(5,4) NOT NULL,
    "source" "QuestionMarkSource" NOT NULL DEFAULT 'auto',

    CONSTRAINT "question_marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log_entries" (
    "id" UUID NOT NULL,
    "answer_sheet_id" UUID NOT NULL,
    "professor_id" UUID NOT NULL,
    "field_changed" TEXT NOT NULL,
    "old_value" TEXT NOT NULL,
    "new_value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_professor_id_idx" ON "sessions"("professor_id");

-- CreateIndex
CREATE INDEX "batches_professor_id_idx" ON "batches"("professor_id");

-- CreateIndex
CREATE UNIQUE INDEX "answer_sheets_image_storage_key_key" ON "answer_sheets"("image_storage_key");

-- CreateIndex
CREATE INDEX "answer_sheets_batch_id_idx" ON "answer_sheets"("batch_id");

-- CreateIndex
CREATE INDEX "answer_sheets_register_number_idx" ON "answer_sheets"("register_number");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "professors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "professors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_sheets" ADD CONSTRAINT "answer_sheets_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_marks" ADD CONSTRAINT "question_marks_answer_sheet_id_fkey" FOREIGN KEY ("answer_sheet_id") REFERENCES "answer_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_answer_sheet_id_fkey" FOREIGN KEY ("answer_sheet_id") REFERENCES "answer_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "professors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
