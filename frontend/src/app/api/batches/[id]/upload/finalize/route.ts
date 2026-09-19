import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifySession } from '@/lib/auth/session';
import { redis } from '@/lib/redis';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import pdfParse from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';

const s3Client = new S3Client({
  region: 'us-east-1',
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'anexcel_minio_admin',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'anexcel_minio_pass',
  },
  forcePathStyle: true,
});

const BUCKET_NAME = process.env.MINIO_BUCKET || 'anexcel-storage';
const MAX_PDF_PAGES = 100;

async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

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

    // PDF Server-Side Validation
    if (fileType === 'application/pdf') {
      try {
        const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: storageKey });
        const s3Object = await s3Client.send(getCmd);
        
        if (s3Object.Body) {
          const buffer = await streamToBuffer(s3Object.Body);
          const pdfData = await pdfParse(buffer, { max: 0 }); // parse all pages to count
          
          if (pdfData.numpages > MAX_PDF_PAGES) {
            // Delete from MinIO if invalid
            await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: storageKey }));
            return NextResponse.json({ error: `PDF exceeds maximum of ${MAX_PDF_PAGES} pages.` }, { status: 400 });
          }
        }
      } catch (err) {
        console.error('Error validating PDF:', err);
        return NextResponse.json({ error: 'Failed to validate PDF' }, { status: 500 });
      }
    }

    // Create AnswerSheet record
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
