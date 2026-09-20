"""
Celery worker task definitions.

Imports both task modules so Celery discovers them when the worker boots.
"""

from app.celery_app import celery_app  # noqa: F401

# Import task modules for Celery auto-discovery
import app.tasks.split_pdf  # noqa: F401
import app.tasks.process_sheet  # noqa: F401
