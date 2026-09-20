import io
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from openpyxl import Workbook

from app.db import get_db_connection

logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/api/export/{batch_id}")
async def export_batch_excel(batch_id: str):
    """
    Generates an Excel export for the given batch.
    Requires batch to be 'approved' (or at least completed).
    Columns: Register Number, Subject Code, Subject Name, Total Marks, Status
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Check batch
            cur.execute(
                "SELECT id, status, declared_subject_code, declared_subject_name FROM batches WHERE id = %s",
                (batch_id,)
            )
            batch = cur.fetchone()
            if not batch:
                raise HTTPException(status_code=404, detail="Batch not found")

            subject_code = batch["declared_subject_code"]
            subject_name = batch["declared_subject_name"]

            # Fetch sheets
            cur.execute(
                """
                SELECT register_number, total_marks, status
                FROM answer_sheets
                WHERE batch_id = %s
                ORDER BY register_number ASC NULLS LAST
                """,
                (batch_id,)
            )
            sheets = cur.fetchall()

            # Create Excel workbook
            wb = Workbook()
            ws = wb.active
            ws.title = "Answer Sheets"

            # Headers exactly matching PRD/Architecture:
            # Register Number, Subject Code, Subject Name, Total Marks, Status
            headers = [
                "Register Number", 
                "Subject Code", 
                "Subject Name", 
                "Total Marks", 
                "Status"
            ]
            ws.append(headers)

            for sheet in sheets:
                reg_num = sheet.get("register_number") or "N/A"
                marks = sheet.get("total_marks")
                marks_str = str(marks) if marks is not None else ""
                status = sheet.get("status") or "unknown"
                
                ws.append([
                    reg_num,
                    subject_code,
                    subject_name,
                    marks_str,
                    status
                ])

            # Save to memory stream
            output = io.BytesIO()
            wb.save(output)
            output.seek(0)
            
            # If batch is approved, mark as exported
            if batch["status"] == "approved":
                with conn.cursor() as update_cur:
                    update_cur.execute(
                        "UPDATE batches SET status = 'exported' WHERE id = %s",
                        (batch_id,)
                    )
                conn.commit()

            filename = f"batch_{subject_code}_export.xlsx"
            return StreamingResponse(
                output,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"'
                }
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error generating Excel export: %s", e)
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        conn.close()
