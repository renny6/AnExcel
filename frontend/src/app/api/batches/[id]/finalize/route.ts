import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifySession } from '@/lib/auth/session';

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const batchId = params.id;

  try {
    // Verify batch
    const batch = await prisma.batch.findFirst({
      where: {
        id: batchId,
        professor_id: session.professorId,
      },
    });

    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    // Enforce that no sheets remain in processing, needs_review, or failed
    const pendingSheets = await prisma.answerSheet.count({
      where: {
        batch_id: batchId,
        status: {
          in: ['processing', 'needs_review', 'failed'],
        },
      },
    });

    if (pendingSheets > 0) {
      return NextResponse.json(
        { error: `Cannot finalize: ${pendingSheets} sheet(s) still require review or processing.` },
        { status: 400 }
      );
    }

    // Duplicate Register Number Detection
    // We group by register_number and find any with count > 1
    const duplicates = await prisma.answerSheet.groupBy({
      by: ['register_number'],
      where: {
        batch_id: batchId,
        register_number: {
          not: null, // Ignore null register numbers if any exist
        },
      },
      having: {
        register_number: {
          _count: {
            gt: 1,
          },
        },
      },
    });

    if (duplicates.length > 0) {
      // Find the specific sheet IDs for these duplicate register numbers
      const duplicateRegisterNumbers = duplicates.map(d => d.register_number);
      
      const duplicateSheets = await prisma.answerSheet.findMany({
        where: {
          batch_id: batchId,
          register_number: {
            in: duplicateRegisterNumbers as string[],
          },
        },
        select: {
          id: true,
          register_number: true,
          image_storage_key: true,
        },
      });

      return NextResponse.json(
        {
          error: 'Duplicate register numbers detected',
          duplicates: duplicateSheets,
        },
        { status: 409 }
      );
    }

    // All clear! Approve the batch
    await prisma.batch.update({
      where: { id: batchId },
      data: {
        status: 'approved',
        approved_at: new Date(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error finalizing batch:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
