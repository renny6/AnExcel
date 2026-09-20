import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifySession } from '@/lib/auth/session';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const batchId = params.id;

  try {
    // Verify batch belongs to professor
    const batch = await prisma.batch.findFirst({
      where: {
        id: batchId,
        professor_id: session.professorId,
      },
    });

    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    // Fetch sheets that need review or failed
    const sheets = await prisma.answerSheet.findMany({
      where: {
        batch_id: batchId,
        status: {
          in: ['needs_review', 'failed'],
        },
      },
      include: {
        question_marks: {
          orderBy: [
            { question_no: 'asc' },
            { sub_part: 'asc' }
          ]
        },
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    const s3Endpoint = process.env.S3_PUBLIC_ENDPOINT;
    const s3AccessKey = process.env.S3_ACCESS_KEY;
    const s3SecretKey = process.env.S3_SECRET_KEY;
    const s3Bucket = process.env.S3_BUCKET;

    if (!s3Endpoint || !s3AccessKey || !s3SecretKey || !s3Bucket) {
      throw new Error('Missing required S3 environment variables (S3_PUBLIC_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET)');
    }

    const s3Client = new S3Client({
      region: 'us-east-1',
      endpoint: s3Endpoint,
      credentials: {
        accessKeyId: s3AccessKey,
        secretAccessKey: s3SecretKey,
      },
      forcePathStyle: true,
    });
    const BUCKET_NAME = s3Bucket;

    const sheetsWithUrls = await Promise.all(sheets.map(async (sheet) => {
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: sheet.image_storage_key,
      });
      const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      return {
        ...sheet,
        presignedUrl
      };
    }));

    return NextResponse.json({ sheets: sheetsWithUrls });
  } catch (error: any) {
    console.error('Error fetching review sheets:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
