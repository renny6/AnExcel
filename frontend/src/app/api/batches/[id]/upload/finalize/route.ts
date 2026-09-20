import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifySession } from '@/lib/auth/session';

// Internal URL for the processing service within the Docker network
const PROCESSING_SERVICE_URL = process.env.PROCESSING_SERVICE_URL || 'http://processing-service:8000';

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
          storage_key: storageKey,
          status: 'processing',
        }
      });

      // Enqueue split job via processing-service HTTP trigger
      // This uses celery_app.send_task() on the Python side for proper
      // Celery message serialization (not raw Redis push).
      const triggerResponse = await fetch(`${PROCESSING_SERVICE_URL}/trigger/split-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: batch.id,
          pdf_id: pdfUpload.id,
          storage_key: storageKey,
        }),
      });

      if (!triggerResponse.ok) {
        console.error('Failed to trigger split-pdf:', await triggerResponse.text());
        // Update PDF status to failed so the UI can show the error
        await prisma.pdfUpload.update({
          where: { id: pdfUpload.id },
          data: { status: 'failed', error_message: 'Failed to enqueue processing job' },
        });
        return NextResponse.json({ error: 'Failed to enqueue processing' }, { status: 502 });
      }

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

    // Enqueue processing job via processing-service HTTP trigger
    const triggerResponse = await fetch(`${PROCESSING_SERVICE_URL}/trigger/process-sheet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batch_id: batch.id,
        sheet_id: sheet.id,
        storage_key: storageKey,
      }),
    });

    if (!triggerResponse.ok) {
      console.error('Failed to trigger process-sheet:', await triggerResponse.text());
      // Don't fail the whole request — the sheet is created, it just needs
      // manual re-triggering or will be picked up by a retry mechanism.
    }

    return NextResponse.json({ success: true, sheetId: sheet.id });
  } catch (error) {
    console.error('Finalize error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
