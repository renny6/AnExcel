import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifySession } from '@/lib/auth/session';
import { redis } from '@/lib/redis';
import { S3Client } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: Request, context: { params: { id: string } }) {
  const session = await verifySession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const batchId = (await context.params).id;

  try {
    const { storageKey, fileName, fileType } = await request.json();

    if (!storageKey || !fileName || !fileType) {
      return NextResponse.json({ error: 'Missing metadata' }, { status: 400 });
    }

    const batch = await prisma.batch.findUnique({
      where: { id: batchId, professor_id: session.professorId },
    });

    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    // Double check idempotency before creating DB record
    const existingSheet = await prisma.answerSheet.findUnique({
      where: { image_storage_key: storageKey },
    });
    if (existingSheet) {
      return NextResponse.json({ success: true, sheetId: existingSheet.id });
    }

    // PDF Route
    if (fileType === 'application/pdf') {
      const pdfUpload = await prisma.pdfUpload.create({
        data: {
          batch_id: batch.id,
          original_filename: fileName,
          status: 'processing',
        }
      });

      // Enqueue async split job to Celery
      const pdfJobPayload = {
        task: 'split_pdf',
        id: uuidv4(),
        args: [{
          batch_id: batch.id,
          pdf_id: pdfUpload.id,
          storage_key: storageKey
        }]
      };
      await redis.lpush('celery', JSON.stringify(pdfJobPayload));

      return NextResponse.json({ success: true, pdfId: pdfUpload.id });
    }

    // Image Route
    const sheet = await prisma.answerSheet.create({
      data: {
        batch_id: batch.id,
        image_storage_key: storageKey,
        original_filename: fileName,
        status: 'processing',
      },
    });

    // Enqueue real job to Redis for Phase 5 worker
    const jobPayload = {
      task: 'process_sheet',
      id: uuidv4(),
      args: [{
        batch_id: batch.id,
        sheet_id: sheet.id,
        storage_key: storageKey
      }]
    };
    
    // push to 'celery' list
    await redis.lpush('celery', JSON.stringify(jobPayload));

    return NextResponse.json({ success: true, sheetId: sheet.id });
  } catch (error) {
    console.error('Finalize error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
