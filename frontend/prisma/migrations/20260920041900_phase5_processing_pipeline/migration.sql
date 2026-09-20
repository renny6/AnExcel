-- AlterTable
ALTER TABLE "answer_sheets" ADD COLUMN     "original_filename" TEXT;

-- AlterTable
ALTER TABLE "pdf_uploads" ADD COLUMN     "storage_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "question_marks_answer_sheet_id_question_no_sub_part_key" ON "question_marks"("answer_sheet_id", "question_no", "sub_part");
