from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel

from app.services.health import CheckStatus, check_dependencies

router = APIRouter(prefix="/health", tags=["health"])


class LivenessResponse(BaseModel):
    status: Literal["ok"] = "ok"


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    checks: dict[str, CheckStatus]


@router.get("")
def liveness() -> LivenessResponse:
    return LivenessResponse()


@router.get("/ready")
def readiness(
    response: Response,
    checks: Annotated[dict[str, CheckStatus], Depends(check_dependencies)],
) -> ReadinessResponse:
    if all(result == "ok" for result in checks.values()):
        return ReadinessResponse(status="ready", checks=checks)
    response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadinessResponse(status="not_ready", checks=checks)
