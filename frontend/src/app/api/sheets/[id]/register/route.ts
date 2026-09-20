import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifySession } from '@/lib/auth/session';
import { AnswerSheetStatus } from '@prisma/client';

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sheetId = params.id;

  try {
    const { register_number } = await request.json();
    if (!register_number) {
      return NextResponse.json({ error: 'Missing register number' }, { status: 400 });
    }

    const sheet = await prisma.answerSheet.findUnique({
      where: { id: sheetId },
      include: { batch: true },
    });

    if (!sheet) {
      return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });
    }

    if (sheet.batch.professor_id !== session.professorId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await prisma.$transaction(async (tx) => {
      if (sheet.register_number !== register_number) {
        await tx.auditLogEntry.create({
          data: {
            answer_sheet_id: sheetId,
            professor_id: session.professorId,
            field_changed: 'register_number (resolved duplicate)',
            old_value: sheet.register_number || 'null',
            new_value: register_number,
          }
        });
      }

      // If we are manually correcting a duplicate, we should flag it as reviewed 
      // if it was previously auto-approved.
      let newStatus = sheet.status;
      if (sheet.status === 'auto_approved' || sheet.status === 'needs_review') {
        newStatus = 'reviewed';
      } else if (sheet.status === 'failed') {
        newStatus = 'manual';
      }

      await tx.answerSheet.update({
        where: { id: sheetId },
        data: { 
          register_number,
          status: newStatus as AnswerSheetStatus,
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating register number:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
