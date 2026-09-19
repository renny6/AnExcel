import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifySession } from '@/lib/auth/session';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({
  region: 'us-east-1', // MinIO default
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'anexcel_minio_admin',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'anexcel_minio_pass',
  },
  forcePathStyle: true,
});

const BUCKET_NAME = process.env.MINIO_BUCKET || 'anexcel-storage';
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const MAX_BATCH_SIZE = 100;

export async function POST(request: Request, context: { params: { id: string } }) {
  const session = await verifySession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const batchId = (await context.params).id;

  try {
    const { fileName, fileType, fileSize, fileHash } = await request.json();

    if (!fileName || !fileType || !fileSize || !fileHash) {
      return NextResponse.json({ error: 'Missing file metadata' }, { status: 400 });
    }

    if (fileSize > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File exceeds 20MB limit' }, { status: 400 });
    }

    // Verify batch ownership
    const batch = await prisma.batch.findUnique({
      where: { id: batchId, professor_id: session.professorId },
      include: { _count: { select: { answer_sheets: true } } },
    });

    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    if (batch._count.answer_sheets >= MAX_BATCH_SIZE) {
      return NextResponse.json({ error: 'Batch limit of 100 sheets exceeded' }, { status: 400 });
    }

    // Idempotency check: use hash as image_storage_key
    const storageKey = `${batchId}/${fileHash}-${fileName}`;
    
    const existingSheet = await prisma.answerSheet.findUnique({
      where: { image_storage_key: storageKey },
    });

    if (existingSheet) {
      // Return success without generating a new URL, effectively deduplicating
      return NextResponse.json({ 
        success: true, 
        duplicate: true, 
        sheetId: existingSheet.id 
      });
    }

    // Generate Presigned URL
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: storageKey,
      ContentType: fileType,
      ContentLength: fileSize,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return NextResponse.json({
      success: true,
      presignedUrl,
      storageKey,
    });
  } catch (error) {
    console.error('Presign error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
