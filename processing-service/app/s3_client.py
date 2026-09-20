"""
S3/MinIO client utility.

Thin wrapper around boto3 that reads connection details from environment
variables. Provides download_file() and upload_file() helpers used by
the Celery tasks.
"""

import io
import os

import boto3
from botocore.config import Config as BotoConfig


def _get_client():
    """Create and return an S3 client configured for MinIO."""
    return boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        aws_access_key_id=os.environ["S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["S3_SECRET_KEY"],
        config=BotoConfig(signature_version="s3v4"),
        region_name="us-east-1",  # MinIO default
    )


_BUCKET = None


def _bucket():
    global _BUCKET
    if _BUCKET is None:
        _BUCKET = os.environ["S3_BUCKET"]
    return _BUCKET


def download_file(key: str) -> bytes:
    """Download a file from S3/MinIO and return its contents as bytes."""
    client = _get_client()
    response = client.get_object(Bucket=_bucket(), Key=key)
    return response["Body"].read()


def upload_file(key: str, data: bytes, content_type: str = "image/jpeg") -> None:
    """Upload bytes to S3/MinIO at the given key."""
    client = _get_client()
    client.put_object(
        Bucket=_bucket(),
        Key=key,
        Body=io.BytesIO(data),
        ContentType=content_type,
    )
