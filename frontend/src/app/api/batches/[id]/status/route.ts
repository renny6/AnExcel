import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifySession } from '@/lib/auth/session';

export async function GET(request: Request, context: { params: { id: string } }) {
  const session = await verifySession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const batchId = (await context.params).id;

  try {
    const batch = await prisma.batch.findUnique({
      where: { id: batchId, professor_id: session.professorId },
      include: {
        _count: {
          select: { answer_sheets: true }
        }
      }
    });

    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    const pendingPdfs = await prisma.pdfUpload.findMany({
      where: {
        batch_id: batchId,
        status: 'processing'
      },
      select: {
        id: true,
        original_filename: true,
      }
    });

    return NextResponse.json({
      success: true,
      batchStatus: batch.status,
      totalSheets: batch._count.answer_sheets,
      pendingPdfs,
    });
  } catch (error) {
    console.error('Status check error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
