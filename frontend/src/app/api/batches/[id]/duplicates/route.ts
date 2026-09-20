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
    // Duplicate Register Number Detection
    const duplicates = await prisma.answerSheet.groupBy({
      by: ['register_number'],
      where: {
        batch_id: batchId,
        register_number: { not: null },
      },
      having: {
        register_number: { _count: { gt: 1 } },
      },
    });

    if (duplicates.length === 0) {
      return NextResponse.json({ duplicates: [] });
    }

    const duplicateRegisterNumbers = duplicates.map(d => d.register_number as string);
    
    const duplicateSheets = await prisma.answerSheet.findMany({
      where: {
        batch_id: batchId,
        register_number: { in: duplicateRegisterNumbers },
      },
      orderBy: { register_number: 'asc' },
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

    const sheetsWithUrls = await Promise.all(duplicateSheets.map(async (sheet) => {
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

    // Group them by register number for the frontend
    const grouped: Record<string, any[]> = {};
    for (const sheet of sheetsWithUrls) {
      const rn = sheet.register_number as string;
      if (!grouped[rn]) grouped[rn] = [];
      grouped[rn].push(sheet);
    }

    return NextResponse.json({ duplicates: grouped });
  } catch (error: any) {
    console.error('Error fetching duplicates:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
