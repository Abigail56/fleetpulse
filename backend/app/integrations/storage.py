from typing import Any

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import Settings
from app.core.errors import ApiError

SIGNATURE_VERSION = "s3v4"
MISSING_BUCKET_CODES = ("404", "NoSuchBucket")


def _attachment(filename: str) -> str:
    ascii_name = filename.encode("ascii", "ignore").decode().replace('"', "").replace("\\", "")
    return f'attachment; filename="{ascii_name or "file"}"'


class StorageUnavailable(ApiError):
    def __init__(self) -> None:
        super().__init__(503, "storage_unavailable", "File storage isn't available right now.")


class ObjectStorage:
    """Private, S3-compatible storage. Files are only ever reached through signed links."""

    def __init__(self, settings: Settings) -> None:
        if (
            not settings.storage_bucket
            or not settings.storage_endpoint_url
            or not settings.storage_access_key
            or not settings.storage_secret_key
        ):
            raise StorageUnavailable
        self.bucket = settings.storage_bucket
        self.auto_create_bucket = not settings.is_production
        self.link_seconds = settings.storage_link_seconds
        options: dict[str, Any] = {
            "aws_access_key_id": settings.storage_access_key,
            "aws_secret_access_key": settings.storage_secret_key.get_secret_value(),
            "region_name": settings.storage_region,
            "config": Config(signature_version=SIGNATURE_VERSION, s3={"addressing_style": "path"}),
        }
        self.client = boto3.client("s3", endpoint_url=settings.storage_endpoint_url, **options)
        # A link has to name the address the browser will use, which a container's may not be.
        self.signer = boto3.client(
            "s3",
            endpoint_url=settings.storage_public_url or settings.storage_endpoint_url,
            **options,
        )

    def _ensure_bucket(self) -> None:
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in MISSING_BUCKET_CODES:
                # New buckets are private. Production buckets are created by whoever hosts them.
                self.client.create_bucket(Bucket=self.bucket)
            else:
                raise

    def check(self) -> None:
        try:
            self._ensure_bucket() if self.auto_create_bucket else self.client.head_bucket(
                Bucket=self.bucket
            )
        except (BotoCoreError, ClientError) as exc:
            raise StorageUnavailable from exc

    def put(self, key: str, data: bytes, content_type: str, filename: str) -> None:
        try:
            if self.auto_create_bucket:
                self._ensure_bucket()
            self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
                # Stored with the file too, for services that ignore a link's own override.
                ContentDisposition=_attachment(filename),
            )
        except (BotoCoreError, ClientError) as exc:
            raise StorageUnavailable from exc

    def signed_link(self, key: str, filename: str, content_type: str) -> str:
        """Always a download, so an uploaded file can't run as a page on the storage host."""
        try:
            link: str = self.signer.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": self.bucket,
                    "Key": key,
                    "ResponseContentDisposition": _attachment(filename),
                    "ResponseContentType": content_type,
                },
                ExpiresIn=self.link_seconds,
            )
        except (BotoCoreError, ClientError) as exc:
            raise StorageUnavailable from exc
        return link
