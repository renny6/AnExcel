import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifySession } from '@/lib/auth/session';
import { AnswerSheetStatus } from '@prisma/client';

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sheetId = params.id;

  try {
    const body = await request.json();
    const { register_number, total_marks, questions } = body;

    // Verify sheet belongs to a batch owned by the professor
    const sheet = await prisma.answerSheet.findUnique({
      where: { id: sheetId },
      include: {
        batch: true,
        question_marks: true,
      },
    });

    if (!sheet) {
      return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });
    }

    if (sheet.batch.professor_id !== session.professorId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Determine the new status based on the old status
    const newStatus = sheet.status === 'failed' ? 'manual' : 'reviewed';

    // We need to compare old values to new values to create audit logs
    const auditLogs = [];
    
    if (sheet.register_number !== register_number) {
      auditLogs.push({
        answer_sheet_id: sheetId,
        professor_id: session.professorId,
        field_changed: 'register_number',
        old_value: sheet.register_number || 'null',
        new_value: register_number || 'null',
      });
    }

    if (Number(sheet.total_marks) !== Number(total_marks)) {
      auditLogs.push({
        answer_sheet_id: sheetId,
        professor_id: session.professorId,
        field_changed: 'total_marks',
        old_value: sheet.total_marks?.toString() || 'null',
        new_value: total_marks?.toString() || 'null',
      });
    }

    // Process questions
    const questionUpdates = [];
    const questionCreates = [];
    
    const existingMarksMap = new Map();
    for (const q of sheet.question_marks) {
      const key = `${q.question_no}_${q.sub_part || ''}`;
      existingMarksMap.set(key, q);
    }

    if (questions && Array.isArray(questions)) {
      for (const q of questions) {
        const key = `${q.question_no}_${q.sub_part || ''}`;
        const existing = existingMarksMap.get(key);
        
        if (existing) {
          if (Number(existing.marks) !== Number(q.marks) || existing.tick_state !== q.tick_state) {
            questionUpdates.push({
              where: { id: existing.id },
              data: {
                marks: q.marks,
                tick_state: q.tick_state,
                source: 'corrected' as any,
              }
            });
            
            auditLogs.push({
              answer_sheet_id: sheetId,
              professor_id: session.professorId,
              field_changed: `question_${key}`,
              old_value: `marks:${existing.marks},tick:${existing.tick_state}`,
              new_value: `marks:${q.marks},tick:${q.tick_state}`,
            });
          }
        } else {
          questionCreates.push({
            question_no: q.question_no,
            sub_part: q.sub_part,
            marks: q.marks,
            tick_state: q.tick_state,
            confidence_score: 1.0, // Manual entry has 100% confidence
            source: 'corrected' as any,
          });
          
          auditLogs.push({
            answer_sheet_id: sheetId,
            professor_id: session.professorId,
            field_changed: `question_${key}`,
            old_value: 'null',
            new_value: `marks:${q.marks},tick:${q.tick_state}`,
          });
        }
      }
    }

    // Execute in a transaction
    await prisma.$transaction(async (tx) => {
      // Update sheet
      await tx.answerSheet.update({
        where: { id: sheetId },
        data: {
          register_number,
          total_marks,
          status: newStatus as AnswerSheetStatus,
        },
      });

      // Update existing questions
      for (const update of questionUpdates) {
        await tx.questionMark.update(update);
      }
      
      // Create new questions (if it was a failed sheet with no extractions)
      if (questionCreates.length > 0) {
        await tx.questionMark.createMany({
          data: questionCreates.map(q => ({
            ...q,
            answer_sheet_id: sheetId
          }))
        });
      }

      // Insert audit logs
      if (auditLogs.length > 0) {
        await tx.auditLogEntry.createMany({
          data: auditLogs,
        });
      }
    });

    return NextResponse.json({ success: true, status: newStatus });
  } catch (error: any) {
    console.error('Error updating sheet:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sheetId = params.id;

  try {
    const url = new URL(request.url);
    const reason = url.searchParams.get('reason') || 'duplicate';

    // Verify sheet belongs to a batch owned by the professor
    const sheet = await prisma.answerSheet.findUnique({
      where: { id: sheetId },
      include: {
        batch: true,
      },
    });

    if (!sheet) {
      return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });
    }

    if (sheet.batch.professor_id !== session.professorId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Insert audit log to record the deletion
    // We put the sheet ID and register number in old_value so it's not lost when answer_sheet_id is set to null
    await prisma.$transaction(async (tx) => {
      await tx.auditLogEntry.create({
        data: {
          answer_sheet_id: sheetId,
          professor_id: session.professorId,
          field_changed: 'status',
          old_value: `deleted: ${sheet.register_number || 'unknown'}`,
          new_value: `deleted (reason: ${reason})`,
        }
      });

      // Now delete the sheet. Due to onDelete: SetNull on audit_log_entries,
      // the log above will survive with answer_sheet_id = null.
      // We must also delete question_marks. QuestionMark has onDelete: Cascade if configured,
      // wait, schema.prisma doesn't have Cascade for QuestionMark! Let's check or manually delete.
      await tx.questionMark.deleteMany({
        where: { answer_sheet_id: sheetId }
      });
      
      await tx.answerSheet.delete({
        where: { id: sheetId }
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting sheet:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await verifySession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { batch_id, register_number, total_marks } = body;

    const sheet = await prisma.answerSheet.findUnique({
      where: { id },
      include: { batch: true }
    });

    if (!sheet || sheet.batch.professor_id !== session.professorId || sheet.batch_id !== batch_id) {
      return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });
    }

    if (sheet.batch.status !== 'approved' && sheet.batch.status !== 'exported') {
      return NextResponse.json({ error: 'Batch must be approved to edit sheets in the table' }, { status: 400 });
    }

    if (register_number && register_number !== sheet.register_number) {
      const existing = await prisma.answerSheet.findFirst({
        where: {
          batch_id: batch_id,
          register_number: register_number,
          id: { not: id }
        }
      });
      if (existing) {
        return NextResponse.json({ error: `Conflict: Register number ${register_number} already exists in this batch.` }, { status: 409 });
      }
    }

    const updatedSheet = await prisma.$transaction(async (tx) => {
      if (register_number !== sheet.register_number) {
        await tx.auditLogEntry.create({
          data: {
            answer_sheet_id: sheet.id,
            professor_id: session.professorId,
            field_changed: 'register_number',
            old_value: sheet.register_number || 'null',
            new_value: register_number || 'null',
          }
        });
      }

      const newTotalMarksNum = total_marks !== null ? Number(total_marks) : null;
      const oldTotalMarksNum = sheet.total_marks !== null ? Number(sheet.total_marks) : null;
      if (newTotalMarksNum !== oldTotalMarksNum) {
        await tx.auditLogEntry.create({
          data: {
            answer_sheet_id: sheet.id,
            professor_id: session.professorId,
            field_changed: 'total_marks',
            old_value: sheet.total_marks ? sheet.total_marks.toString() : 'null',
            new_value: total_marks !== null ? total_marks.toString() : 'null',
          }
        });
      }

      const result = await tx.answerSheet.update({
        where: { id },
        data: {
          register_number,
          total_marks,
        }
      });

      if (sheet.batch.status === 'exported') {
        await tx.batch.update({
          where: { id: batch_id },
          data: { status: 'approved' }
        });
      }

      return result;
    });

    return NextResponse.json({ success: true, sheet: updatedSheet });
  } catch (error) {
    console.error('Error updating sheet via table:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
