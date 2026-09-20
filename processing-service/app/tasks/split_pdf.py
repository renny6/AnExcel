"""
Celery task: split_pdf

Downloads a multi-page PDF from MinIO, converts each page to a JPEG,
uploads the images back to MinIO, inserts answer_sheet rows (with
INSERT RETURNING for idempotent retries), and enqueues process_sheet
jobs only for newly-inserted rows.
"""

import io
import logging
import uuid

from pdf2image import convert_from_bytes
from PIL import Image

from app.celery_app import celery_app
from app.db import get_db_connection
from app.s3_client import download_file, upload_file

logger = logging.getLogger(__name__)

# Maximum pages allowed per PDF (safety limit)
MAX_PDF_PAGES = 100

# JPEG compression quality for page images
JPEG_QUALITY = 80


@celery_app.task(
    name="app.tasks.split_pdf.split_pdf",
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    acks_late=True,
)
def split_pdf(self, payload: dict):
    """
    Split a multi-page PDF into individual page images.

    Args:
        payload: {batch_id, pdf_id, storage_key}
    """
    batch_id = payload["batch_id"]
    pdf_id = payload["pdf_id"]
    storage_key = payload["storage_key"]

    logger.info(
        "split_pdf started: batch_id=%s, pdf_id=%s, storage_key=%s",
        batch_id, pdf_id, storage_key,
    )

    conn = get_db_connection()
    try:
        # 1. Download PDF from MinIO
        pdf_bytes = download_file(storage_key)
        logger.info("Downloaded PDF: %d bytes", len(pdf_bytes))

        # 2. Convert PDF pages to PIL images
        try:
            pages = convert_from_bytes(pdf_bytes, dpi=300, fmt="jpeg")
        except Exception as e:
            logger.error("PDF conversion failed: %s", e)
            _fail_pdf(conn, pdf_id, f"PDF conversion failed: {e}")
            return

        # 3. Validate page count
        if len(pages) > MAX_PDF_PAGES:
            msg = f"PDF has {len(pages)} pages, exceeding limit of {MAX_PDF_PAGES}"
            logger.warning(msg)
            _fail_pdf(conn, pdf_id, msg)
            return

        logger.info("PDF split into %d pages", len(pages))

        # 4–6. Upload pages, insert rows, collect newly-inserted IDs
        newly_inserted = []

        with conn:
            with conn.cursor() as cur:
                for page_idx, page_image in enumerate(pages):
                    sheet_id = str(uuid.uuid4())
                    page_storage_key = f"{batch_id}/{sheet_id}/original.jpg"

                    # 4. Upload page image to MinIO (compressed JPEG)
                    img_buffer = io.BytesIO()
                    page_image.save(img_buffer, format="JPEG", quality=JPEG_QUALITY)
                    img_bytes = img_buffer.getvalue()

                    upload_file(page_storage_key, img_bytes, "image/jpeg")

                    # 5. INSERT ... ON CONFLICT DO NOTHING RETURNING id
                    # Only returns the id if the row was actually newly inserted.
                    cur.execute(
                        """
                        INSERT INTO answer_sheets (
                            id, batch_id, image_storage_key,
                            original_filename, status, created_at, updated_at
                        )
                        VALUES (%s, %s, %s, %s, 'processing', NOW(), NOW())
                        ON CONFLICT (image_storage_key) DO NOTHING
                        RETURNING id
                        """,
                        (sheet_id, batch_id, page_storage_key,
                         f"page_{page_idx + 1}.jpg"),
                    )

                    result = cur.fetchone()
                    if result:
                        # Row was newly inserted
                        newly_inserted.append({
                            "sheet_id": result["id"],
                            "storage_key": page_storage_key,
                        })
                        logger.info(
                            "Inserted answer_sheet %s for page %d",
                            result["id"], page_idx + 1,
                        )
                    else:
                        # Row already existed (previous partial run) — skip
                        logger.info(
                            "Skipped page %d — answer_sheet already exists for key %s",
                            page_idx + 1, page_storage_key,
                        )

                # 7. Update pdf_uploads status to 'split'
                cur.execute(
                    """
                    UPDATE pdf_uploads
                    SET status = 'split'
                    WHERE id = %s
                    """,
                    (pdf_id,),
                )

        # Transaction committed. Now enqueue process_sheet for new rows only.
        # 6. Enqueue process_sheet only for the returned IDs
        for sheet_info in newly_inserted:
            celery_app.send_task(
                "app.tasks.process_sheet.process_sheet",
                args=[{
                    "batch_id": batch_id,
                    "sheet_id": sheet_info["sheet_id"],
                    "storage_key": sheet_info["storage_key"],
                }],
            )

        logger.info(
            "split_pdf complete: pdf_id=%s, total_pages=%d, newly_inserted=%d, "
            "skipped=%d",
            pdf_id, len(pages), len(newly_inserted),
            len(pages) - len(newly_inserted),
        )

    except Exception as e:
        logger.exception("split_pdf failed: %s", e)
        try:
            _fail_pdf(conn, pdf_id, f"Unexpected error: {e}")
        except Exception:
            pass
        raise self.retry(exc=e)
    finally:
        conn.close()


def _fail_pdf(conn, pdf_id: str, error_message: str):
    """Mark a PDF upload as failed with an error message."""
    with conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE pdf_uploads
                SET status = 'failed', error_message = %s
                WHERE id = %s
                """,
                (error_message, pdf_id),
            )
    logger.error("PDF %s marked as failed: %s", pdf_id, error_message)
