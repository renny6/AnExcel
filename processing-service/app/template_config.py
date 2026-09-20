"""
Template configuration for Anna University answer sheet alignment.

Loads the reference template image and defines all crop regions as
normalized coordinates (0.0–1.0 relative to the canonical aligned frame).
Threshold constants are defined here — no inline magic numbers in tasks.
"""

import os
import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Thresholds — named constants with real starting values
# ---------------------------------------------------------------------------

# Minimum ratio of good ORB matches to total detected — below this the
# scan is too distorted/unreadable and routes to manual entry.
ALIGNMENT_MATCH_THRESHOLD = 0.25

# Per-field confidence floor (0.0–1.0) from Gemini output.
# Fields below this are flagged; if ANY field is below, the sheet
# status becomes needs_review instead of auto_approved.
CONFIDENCE_THRESHOLD = 0.85

# Canonical output dimensions for the aligned image (width, height).
# All normalized coordinates reference this frame.
CANONICAL_WIDTH = 2480
CANONICAL_HEIGHT = 3508  # A4 at 300 DPI

# ---------------------------------------------------------------------------
# Crop regions — normalized coordinates (x, y, w, h) in [0.0, 1.0]
# These will be calibrated from the real reference-sample.jpg.
# Current values are initial estimates to be tuned.
# ---------------------------------------------------------------------------

REGIONS = {
    "register_number": {"x": 0.5736, "y": 0.0684, "w": 0.3680, "h": 0.0471},
    "marks_grid": {"x": 0.0758, "y": 0.5775, "w": 0.8442, "h": 0.3153},
}

# ---------------------------------------------------------------------------
# Reference template
# ---------------------------------------------------------------------------

_TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "..", "templates")
_TEMPLATE_PATH = os.path.join(_TEMPLATE_DIR, "reference-sample.jpg")

_template_image = None
_template_keypoints = None
_template_descriptors = None
_orb = None


def _load_template():
    """Load the reference template and pre-compute ORB features."""
    global _template_image, _template_keypoints, _template_descriptors, _orb

    if _template_image is not None:
        return

    if not os.path.exists(_TEMPLATE_PATH):
        raise FileNotFoundError(
            f"Reference template not found at {_TEMPLATE_PATH}. "
            "Please add reference-sample.jpg to processing-service/templates/"
        )

    _template_image = cv2.imread(_TEMPLATE_PATH, cv2.IMREAD_GRAYSCALE)
    if _template_image is None:
        raise ValueError(f"Failed to load template image from {_TEMPLATE_PATH}")

    # Resize to canonical dimensions
    _template_image = cv2.resize(
        _template_image, (CANONICAL_WIDTH, CANONICAL_HEIGHT)
    )

    # Pre-compute ORB features for the template
    _orb = cv2.ORB_create(nfeatures=2000)
    _template_keypoints, _template_descriptors = _orb.detectAndCompute(
        _template_image, None
    )


def get_template():
    """Return (template_image, keypoints, descriptors, orb_detector)."""
    _load_template()
    return _template_image, _template_keypoints, _template_descriptors, _orb


def crop_region(aligned_image: np.ndarray, region_name: str) -> np.ndarray:
    """
    Crop a named region from an aligned image using normalized coordinates.

    Args:
        aligned_image: The aligned image (at canonical dimensions).
        region_name: Key into the REGIONS dict.

    Returns:
        Cropped sub-image as a numpy array.
    """
    if region_name not in REGIONS:
        raise ValueError(f"Unknown region: {region_name}. Available: {list(REGIONS.keys())}")

    region = REGIONS[region_name]
    h, w = aligned_image.shape[:2]

    x1 = int(region["x"] * w)
    y1 = int(region["y"] * h)
    x2 = int((region["x"] + region["w"]) * w)
    y2 = int((region["y"] + region["h"]) * h)

    # Clamp to image bounds
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)

    return aligned_image[y1:y2, x1:x2]
