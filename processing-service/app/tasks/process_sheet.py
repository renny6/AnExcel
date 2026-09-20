"""
Celery task: process_sheet

Downloads a scanned answer sheet image from MinIO, aligns it against
the reference template using OpenCV ORB features, crops the register
number and marks grid regions, sends all crops in a single Gemini Flash
API call for structured extraction (with per-field confidence), cross-
validates the marks mathematically, and writes results to Postgres in
a single transaction using upsert for idempotency.
"""

import base64
import io
import json
import logging
import os
from decimal import Decimal

import cv2
import numpy as np
from google import genai
from google.genai import types as genai_types

from app.celery_app import celery_app
from app.db import get_db_connection
from app.s3_client import download_file
from app.template_config import (
    ALIGNMENT_MATCH_THRESHOLD,
    CANONICAL_HEIGHT,
    CANONICAL_WIDTH,
    CONFIDENCE_THRESHOLD,
    crop_region,
    get_template,
)
from app import rate_limiter

logger = logging.getLogger(__name__)


# Custom exception for Gemini 429 responses
class GeminiRateLimitError(Exception):
    pass


# ---------------------------------------------------------------------------
# Alignment
# ---------------------------------------------------------------------------

def align_image(scan_bytes: bytes) -> tuple[np.ndarray | None, float]:
    """
    Align a scanned image to the reference template.

    Returns:
        (aligned_image, match_ratio) — aligned_image is None if alignment
        quality is below ALIGNMENT_MATCH_THRESHOLD.
    """
    # Decode scan image
    img_array = np.frombuffer(scan_bytes, dtype=np.uint8)
    scan_color = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

    if scan_color is None:
        logger.error("Failed to decode image bytes")
        return None, 0.0

    # Resize scan to canonical dimensions before alignment to ensure
    # ORB feature scale roughly matches the template scale.
    scan_color = cv2.resize(scan_color, (CANONICAL_WIDTH, CANONICAL_HEIGHT))

    scan_gray = cv2.cvtColor(scan_color, cv2.COLOR_BGR2GRAY)

    # Get template features
    template_img, template_kp, template_desc, orb = get_template()

    # Detect features in the scan
    scan_kp, scan_desc = orb.detectAndCompute(scan_gray, None)

    if scan_desc is None or template_desc is None:
        logger.warning("No features detected in scan or template")
        return None, 0.0

    # Match features using BFMatcher with Hamming distance
    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = bf.match(scan_desc, template_desc)

    # Filter matches by distance (Hamming distance < 50 is typically a good match)
    good_matches = [m for m in matches if m.distance < 50]

    total_features = max(len(scan_kp), 1)
    match_ratio = len(good_matches) / total_features

    logger.info(
        "Alignment: %d good matches out of %d features (ratio=%.3f, threshold=%.3f)",
        len(good_matches), total_features, match_ratio, ALIGNMENT_MATCH_THRESHOLD,
    )

    if match_ratio < ALIGNMENT_MATCH_THRESHOLD:
        return None, match_ratio

    if len(good_matches) < 4:
        logger.warning("Not enough matches for homography (%d)", len(good_matches))
        return None, match_ratio

    # Compute homography
    src_pts = np.float32(
        [scan_kp[m.queryIdx].pt for m in good_matches]
    ).reshape(-1, 1, 2)
    dst_pts = np.float32(
        [template_kp[m.trainIdx].pt for m in good_matches]
    ).reshape(-1, 1, 2)

    H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)

    if H is None:
        logger.warning("Homography computation failed")
        return None, match_ratio

    # Warp to canonical dimensions
    aligned = cv2.warpPerspective(
        scan_color, H, (CANONICAL_WIDTH, CANONICAL_HEIGHT)
    )

    return aligned, match_ratio


# ---------------------------------------------------------------------------
# Gemini extraction
# ---------------------------------------------------------------------------

def _image_to_base64(img: np.ndarray) -> str:
    """Encode a numpy image as a base64 JPEG string."""
    _, buffer = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buffer.tobytes()).decode("utf-8")


EXTRACTION_PROMPT = """You are analyzing a scanned Anna University answer sheet.
I'm providing two cropped regions from the sheet:
1. The register number area
2. The marks grid area

Extract the following information and return it as valid JSON with this exact structure:

{
  "register_number": "<string>",
  "register_number_confidence": <float 0.0-1.0>,
  "register_number_note": "<string or null (include for confidence < 0.9)>",
  "questions": [
    {
      "question_no": "<string>",
      "sub_part": "<string or null>",
      "marks": <number>,
      "tick_state": <boolean>,
      "confidence": <float 0.0-1.0>,
      "confidence_note": "<string or null (include for confidence < 0.9)>"
    }
  ],
  "part_a_total": <number or null>,
  "part_bc_total": <number or null>,
  "grand_total": <number or null>
}

Rules:
- For Part A questions (1-10), sub_part is null, marks should be 2 if ticked.
- For Part B & C questions (11-16), sub_part is "a" or "b".
- tick_state is true if the question was attempted (tick mark present).
- Both `confidence` and `register_number_confidence` represent your certainty. For ALL confidence scores, assign a value based on this rubric — do not default to a high score by habit or field type:
  0.95-1.0: Mark/Digit is completely unambiguous, cleanly written, matches exactly one plausible reading.
  0.80-0.94: Legible but with minor pen bleed, faint strokes, or slight ambiguity a careful reader would still resolve confidently.
  0.50-0.79: Genuinely ambiguous — could plausibly be read more than one way, overlapping ink, a visible correction/strikethrough, or the mark crosses outside its cell.
  Below 0.50: Illegible or contradictory — you are effectively guessing.
- If ANY confidence score is < 0.9, provide a brief explanation in the corresponding note field (`confidence_note` or `register_number_note`). Examples: 'faint ink', 'overlapping strikethrough', 'digit 5 looks like a 6'.
- Return ONLY the JSON, no markdown formatting or explanation."""


def extract_with_gemini(
    register_crop: np.ndarray,
    marks_crop: np.ndarray,
) -> dict:
    """
    Send cropped regions to Gemini Flash for structured extraction.

    Raises GeminiRateLimitError on 429 responses.
    """
    api_key = os.environ.get("VISION_API_KEY", "")
    if not api_key:
        raise ValueError("VISION_API_KEY environment variable is not set")

    client = genai.Client(api_key=api_key)

    # Encode images
    reg_b64 = _image_to_base64(register_crop)
    marks_b64 = _image_to_base64(marks_crop)

    # Acquire rate limiter slot
    rate_limiter.acquire(max_rpm=15)

    import time
    logger.info("Calling Gemini API...")
    start_time = time.time()
    try:
        response = client.models.generate_content(
            model="gemini-3.6-flash",
            contents=[
                genai_types.Content(
                    parts=[
                        genai_types.Part(text=EXTRACTION_PROMPT),
                        genai_types.Part(
                            inline_data=genai_types.Blob(
                                mime_type="image/jpeg",
                                data=base64.b64decode(reg_b64),
                            )
                        ),
                        genai_types.Part(
                            inline_data=genai_types.Blob(
                                mime_type="image/jpeg",
                                data=base64.b64decode(marks_b64),
                            )
                        ),
                    ]
                )
            ],
        )
    except Exception as e:
        error_str = str(e)
        if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
            raise GeminiRateLimitError(f"Gemini rate limit hit: {e}") from e
        raise

    # Parse the response
    logger.info(f"Raw Gemini Response: {response.text}")
    response_text = response.text.strip()

    # Strip markdown code fences if present
    if response_text.startswith("```"):
        lines = response_text.split("\n")
        # Remove first and last lines (```json and ```)
        lines = [l for l in lines if not l.strip().startswith("```")]
        response_text = "\n".join(lines)

    try:
        return json.loads(response_text)
    except json.JSONDecodeError as e:
        logger.error("Failed to parse Gemini response: %s\nRaw: %s", e, response_text)
        raise ValueError(f"Gemini returned invalid JSON: {e}") from e


# ---------------------------------------------------------------------------
# Cross-validation
# ---------------------------------------------------------------------------

def cross_validate(extracted: dict) -> tuple[bool, str]:
    """
    Cross-validate extracted marks by recomputing totals.

    Returns:
        (is_valid, reason) — is_valid is True if all totals match.
    """
    questions = extracted.get("questions", [])
    if not questions:
        return False, "No questions extracted"

    # Compute Part A total (questions 1-10)
    part_a_computed = sum(
        q["marks"] for q in questions
        if q.get("sub_part") is None and q.get("tick_state", False)
    )

    # Compute Part B&C total (questions 11-16)
    part_bc_computed = sum(
        q["marks"] for q in questions
        if q.get("sub_part") is not None
    )

    grand_computed = part_a_computed + part_bc_computed

    # Compare with extracted totals
    extracted_grand = extracted.get("grand_total")
    if extracted_grand is not None and abs(grand_computed - extracted_grand) > 0.5:
        return False, (
            f"Grand total mismatch: computed={grand_computed}, "
            f"extracted={extracted_grand}"
        )

    extracted_part_a = extracted.get("part_a_total")
    if extracted_part_a is not None and abs(part_a_computed - extracted_part_a) > 0.5:
        return False, (
            f"Part A total mismatch: computed={part_a_computed}, "
            f"extracted={extracted_part_a}"
        )

    extracted_part_bc = extracted.get("part_bc_total")
    if extracted_part_bc is not None and abs(part_bc_computed - extracted_part_bc) > 0.5:
        return False, (
            f"Part B&C total mismatch: computed={part_bc_computed}, "
            f"extracted={extracted_part_bc}"
        )

    return True, "All totals match"


# ---------------------------------------------------------------------------
# Main Celery task
# ---------------------------------------------------------------------------

@celery_app.task(
    name="app.tasks.process_sheet.process_sheet",
    bind=True,
    autoretry_for=(GeminiRateLimitError,),
    retry_backoff=True,
    retry_backoff_max=300,
    max_retries=10,
    acks_late=True,
)
def process_sheet(self, payload: dict):
    """
    Process a single answer sheet: align, crop, extract, validate, save.

    Args:
        payload: {batch_id, sheet_id, storage_key}
    """
    batch_id = payload["batch_id"]
    sheet_id = payload["sheet_id"]
    storage_key = payload["storage_key"]

    logger.info(
        "process_sheet started: sheet_id=%s, storage_key=%s",
        sheet_id, storage_key,
    )

    conn = get_db_connection()
    try:
        # 1. Download image from MinIO
        image_bytes = download_file(storage_key)
        logger.info("Downloaded image: %d bytes", len(image_bytes))

        # 2. Alignment
        aligned, match_ratio = align_image(image_bytes)

        if aligned is None:
            logger.warning(
                "Alignment failed for sheet %s (ratio=%.3f)", sheet_id, match_ratio
            )
            _update_sheet_status(conn, sheet_id, "failed")
            return

        logger.info("Alignment succeeded: ratio=%.3f", match_ratio)

        # 3. Crop regions
        register_crop = crop_region(aligned, "register_number")
        marks_crop = crop_region(aligned, "marks_grid")

        # 4–5. Extraction (rate limiter + Gemini call)
        try:
            extracted = extract_with_gemini(register_crop, marks_crop)
        except GeminiRateLimitError:
            # Let Celery's autoretry handle this
            raise
        except ValueError as e:
            logger.error("Extraction failed for sheet %s: %s", sheet_id, e)
            _update_sheet_status(conn, sheet_id, "needs_review")
            return
        except Exception as e:
            logger.error("Unexpected extraction error for sheet %s: %s", sheet_id, e)
            # Non-rate-limit API errors → failed after retries
            if self.request.retries >= 3:
                _update_sheet_status(conn, sheet_id, "failed")
                return
            raise self.retry(exc=e, max_retries=3)

        logger.info(
            "Extraction complete: register=%s, %d questions",
            extracted.get("register_number", "?"),
            len(extracted.get("questions", [])),
        )

        # 6. Cross-validation
        is_valid, validation_reason = cross_validate(extracted)
        logger.info("Cross-validation: valid=%s, reason=%s", is_valid, validation_reason)

        # Check per-field confidence
        all_confident = True
        questions = extracted.get("questions", [])

        reg_confidence = extracted.get("register_number_confidence", 0.0)
        reg_note = extracted.get("register_number_note")
        if reg_confidence <= CONFIDENCE_THRESHOLD or reg_note:
            all_confident = False
            logger.info(
                "Register number needs review: conf=%.3f, note=%s",
                reg_confidence, reg_note
            )

        for q in questions:
            q_conf = q.get("confidence", 0.0)
            q_note = q.get("confidence_note")
            if q_conf <= CONFIDENCE_THRESHOLD or q_note:
                all_confident = False
                logger.info(
                    "Question %s needs review: conf=%.3f, note=%s",
                    q.get("question_no"), q_conf, q_note
                )
                break

        # Determine final status
        register_number = extracted.get("register_number", "")
        reg_str = str(register_number).strip() if register_number else ""
        
        # Structural validation for register number (must be exactly 10 digits)
        if len(reg_str) != 10 or not reg_str.isdigit():
            all_confident = False
            logger.warning(
                "Register number structural check failed: expected 10 digits, got '%s'",
                reg_str
            )
        else:
            # Derive 8-digit prefix from sibling sheets' confirmed prefixes
            with conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT SUBSTRING(register_number, 1, 8) as prefix, COUNT(*) as cnt
                        FROM answer_sheets
                        WHERE batch_id = %s AND status IN ('auto_approved', 'reviewed') AND register_number IS NOT NULL
                        GROUP BY prefix
                        ORDER BY cnt DESC
                        LIMIT 1
                        """,
                        (batch_id,)
                    )
                    prefix_row = cur.fetchone()

            if prefix_row and prefix_row.get("prefix"):
                expected_prefix = prefix_row["prefix"]
                if not reg_str.startswith(expected_prefix):
                    all_confident = False
                    logger.warning(
                        "Register number prefix check failed: '%s' does not start with sibling prefix '%s'",
                        reg_str, expected_prefix
                    )

        if is_valid and all_confident:
            status = "auto_approved"
        else:
            status = "needs_review"

        # Compute grand total from extracted questions
        grand_total = sum(q.get("marks", 0) for q in questions)

        # 7. Database write — single transaction with upsert
        register_number = extracted.get("register_number")

        with conn:
            with conn.cursor() as cur:
                # Upsert question_marks
                for q in questions:
                    cur.execute(
                        """
                        INSERT INTO question_marks (
                            id, answer_sheet_id, question_no, sub_part,
                            marks, tick_state, confidence_score, source
                        )
                        VALUES (
                            gen_random_uuid(), %s, %s, %s,
                            %s, %s, %s, 'auto'
                        )
                        ON CONFLICT (answer_sheet_id, question_no, sub_part)
                        DO UPDATE SET
                            marks = EXCLUDED.marks,
                            tick_state = EXCLUDED.tick_state,
                            confidence_score = EXCLUDED.confidence_score,
                            source = 'auto'
                        """,
                        (
                            sheet_id,
                            str(q.get("question_no", "")),
                            q.get("sub_part"),
                            Decimal(str(q.get("marks", 0))),
                            bool(q.get("tick_state", False)),
                            Decimal(str(q.get("confidence", 0.0))),
                        ),
                    )

                # Update answer_sheets
                cur.execute(
                    """
                    UPDATE answer_sheets
                    SET register_number = %s,
                        total_marks = %s,
                        status = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        register_number,
                        Decimal(str(grand_total)),
                        status,
                        sheet_id,
                    ),
                )

        logger.info(
            "process_sheet complete: sheet_id=%s, register=%s, "
            "total=%s, status=%s",
            sheet_id, register_number, grand_total, status,
        )

    except GeminiRateLimitError:
        raise  # Let Celery handle retry
    except Exception as e:
        logger.exception("process_sheet failed: %s", e)
        try:
            _update_sheet_status(conn, sheet_id, "failed")
        except Exception:
            pass
        raise
    finally:
        conn.close()


def _update_sheet_status(conn, sheet_id: str, status: str):
    """Update the status of an answer sheet."""
    with conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE answer_sheets
                SET status = %s, updated_at = NOW()
                WHERE id = %s
                """,
                (status, sheet_id),
            )
