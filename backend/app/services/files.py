import uuid

from fastapi import UploadFile
from sqlmodel import Session, select

from app.core.config import Settings
from app.core.errors import ApiError
from app.integrations.storage import ObjectStorage
from app.models import StoredFile
from app.models.enums import FilePurpose
from app.services.audit import record_audit

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_FILENAME = 255
READ_CHUNK = MAX_FILE_BYTES + 1
WEBP_MARK_AT = 8
EXTENSIONS = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def detect_type(data: bytes) -> str | None:
    """From the file's own bytes: a browser's claim or a file's name proves nothing."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"RIFF") and data[WEBP_MARK_AT : WEBP_MARK_AT + 4] == b"WEBP":
        return "image/webp"
    return None


def clean_filename(name: str | None, content_type: str) -> str:
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    kept = "".join(ch for ch in base if ch.isprintable() and ch not in '"<>|:*?').strip()
    return kept[:MAX_FILENAME] or f"file.{EXTENSIONS[content_type]}"


def store_file(
    db: Session,
    settings: Settings,
    organisation_id: uuid.UUID,
    actor_id: uuid.UUID,
    upload: UploadFile,
    purpose: FilePurpose,
) -> StoredFile:
    data = upload.file.read(READ_CHUNK)
    if len(data) > MAX_FILE_BYTES:
        raise ApiError(413, "file_too_large", "Files can be up to 10 MB.")
    if not data:
        raise ApiError(422, "empty_file", "That file is empty.")
    content_type = detect_type(data)
    if content_type is None:
        raise ApiError(422, "unsupported_file", "Use a PDF, JPEG, PNG or WebP file.")
    file_id = uuid.uuid4()
    # Nothing a person typed goes into the path.
    key = f"{organisation_id}/{purpose.value}/{file_id}.{EXTENSIONS[content_type]}"
    filename = clean_filename(upload.filename, content_type)
    ObjectStorage(settings).put(key, data, content_type, filename)
    stored = StoredFile(
        id=file_id,
        organisation_id=organisation_id,
        object_key=key,
        filename=filename,
        content_type=content_type,
        size_bytes=len(data),
        purpose=purpose,
        uploaded_by_user_id=actor_id,
    )
    db.add(stored)
    record_audit(
        db,
        "file.uploaded",
        actor_user_id=actor_id,
        organisation_id=organisation_id,
        entity_type="file",
        entity_id=file_id,
        details={"purpose": purpose.value, "size_bytes": len(data)},
    )
    db.commit()
    return stored


def get_file(db: Session, organisation_id: uuid.UUID, file_id: uuid.UUID) -> StoredFile:
    stored = db.exec(
        select(StoredFile).where(
            StoredFile.id == file_id, StoredFile.organisation_id == organisation_id
        )
    ).first()
    if stored is None:
        raise ApiError(404, "not_found", "File not found.")
    return stored


def signed_link(settings: Settings, stored: StoredFile) -> tuple[str, int]:
    storage = ObjectStorage(settings)
    return (
        storage.signed_link(stored.object_key, stored.filename, stored.content_type),
        storage.link_seconds,
    )
