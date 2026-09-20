"""
AnExcel Processing Service — FastAPI application.

Handles the extraction pipeline: alignment, cropping, recognition,
cross-validation. All heavy work runs through Celery workers.

Provides /trigger endpoints for the Next.js frontend to enqueue
Celery tasks via proper message serialization (not raw Redis push).
"""

import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.celery_app import celery_app
from app.routers import export

logger = logging.getLogger(__name__)

app = FastAPI(
    title="AnExcel Processing Service",
    description="Answer-sheet extraction pipeline API",
    version="0.1.0",
)

app.include_router(export.router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    """Health check endpoint for Docker Compose and load balancers."""
    return {
        "status": "ok",
        "service": "processing-service",
    }


# ---------------------------------------------------------------------------
# Trigger endpoints — internal, called by the Next.js backend
# These use celery_app.send_task() which handles Celery's message
# envelope format correctly, fixing the raw-Redis-push issue.
# ---------------------------------------------------------------------------

class SplitPdfPayload(BaseModel):
    batch_id: str
    pdf_id: str
    storage_key: str


class ProcessSheetPayload(BaseModel):
    batch_id: str
    sheet_id: str
    storage_key: str


@app.post("/trigger/split-pdf")
async def trigger_split_pdf(payload: SplitPdfPayload):
    """Enqueue a PDF splitting job on the Celery worker."""
    try:
        result = celery_app.send_task(
            "app.tasks.split_pdf.split_pdf",
            args=[{
                "batch_id": payload.batch_id,
                "pdf_id": payload.pdf_id,
                "storage_key": payload.storage_key,
            }],
        )
        logger.info(
            "Enqueued split_pdf task %s for pdf_id=%s",
            result.id, payload.pdf_id,
        )
        return {"status": "queued", "task_id": result.id}
    except Exception as e:
        logger.error("Failed to enqueue split_pdf: %s", e)
        raise HTTPException(status_code=500, detail="Failed to enqueue task")


@app.post("/trigger/process-sheet")
async def trigger_process_sheet(payload: ProcessSheetPayload):
    """Enqueue a sheet processing job on the Celery worker."""
    try:
        result = celery_app.send_task(
            "app.tasks.process_sheet.process_sheet",
            args=[{
                "batch_id": payload.batch_id,
                "sheet_id": payload.sheet_id,
                "storage_key": payload.storage_key,
            }],
        )
        logger.info(
            "Enqueued process_sheet task %s for sheet_id=%s",
            result.id, payload.sheet_id,
        )
        return {"status": "queued", "task_id": result.id}
    except Exception as e:
        logger.error("Failed to enqueue process_sheet: %s", e)
        raise HTTPException(status_code=500, detail="Failed to enqueue task")
