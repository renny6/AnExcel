"""
AnExcel Processing Service — FastAPI application.

Handles the extraction pipeline: alignment, cropping, recognition,
cross-validation. All heavy work runs through Celery workers.
"""

from fastapi import FastAPI

app = FastAPI(
    title="AnExcel Processing Service",
    description="Answer-sheet extraction pipeline API",
    version="0.1.0",
)


@app.get("/health")
async def health_check():
    """Health check endpoint for Docker Compose and load balancers."""
    return {
        "status": "ok",
        "service": "processing-service",
    }
