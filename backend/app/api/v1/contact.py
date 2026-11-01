import structlog
from fastapi import APIRouter, Request, status
from kombu.exceptions import OperationalError

from app.api.deps import RedisDep, SettingsDep, StrictEmailQueueDep, client_ip
from app.core import rate_limit
from app.core.errors import ApiError
from app.schemas.auth import MessageResponse
from app.schemas.contact import ContactRequest
from app.services.email import contact_message_email

router = APIRouter(tags=["contact"])

HOUR_SECONDS = 3600
RECEIVED = "Thanks. Your message has been received."

logger = structlog.get_logger(__name__)


@router.post("/contact", status_code=status.HTTP_202_ACCEPTED)
def submit_contact_message(
    body: ContactRequest,
    request: Request,
    redis: RedisDep,
    settings: SettingsDep,
    queue: StrictEmailQueueDep,
) -> MessageResponse:
    rate_limit.enforce_limit(
        redis,
        rate_limit.hashed_key("contact:ip", client_ip(request)),
        settings.contact_messages_per_hour_per_ip,
        HOUR_SECONDS,
    )
    if body.website:  # looks like success, so a bot learns nothing
        return MessageResponse(message=RECEIVED)

    unavailable = ApiError(503, "contact_unavailable", "We couldn't send your message just now.")
    if not settings.contact_inbox_email:
        logger.error("contact_inbox_not_configured")
        raise unavailable
    try:
        queue(
            contact_message_email(
                settings.contact_inbox_email,
                body.name,
                body.email,
                body.company,
                body.fleet_size,
                body.message,
            )
        )
    except OperationalError as exc:
        logger.error("contact_queue_failed", error_type=type(exc).__name__)
        raise unavailable from exc
    return MessageResponse(message=RECEIVED)
