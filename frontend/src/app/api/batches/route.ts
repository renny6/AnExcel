import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifySession } from '@/lib/auth/session';
import { RetentionPeriod } from '@prisma/client';

export async function POST(request: Request) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      declared_subject_code,
      declared_subject_name,
      declared_course_batch,
      retention_period,
    } = body;

    // Validate inputs
    if (!declared_subject_code || !declared_subject_name || !declared_course_batch || !retention_period) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate retention period against enum
    const validRetentionPeriods = Object.values(RetentionPeriod);
    if (!validRetentionPeriods.includes(retention_period)) {
      return NextResponse.json({ error: 'Invalid retention period' }, { status: 400 });
    }

    const batch = await prisma.batch.create({
      data: {
        professor_id: session.professorId,
        declared_subject_code,
        declared_subject_name,
        declared_course_batch,
        retention_period: retention_period as RetentionPeriod,
        status: 'draft', // Initial status
      },
    });

    return NextResponse.json({ success: true, batchId: batch.id });
  } catch (error: any) {
    console.error('Error creating batch:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
