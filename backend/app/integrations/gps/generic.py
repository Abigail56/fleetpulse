from datetime import UTC
from decimal import Decimal
from typing import Any

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError
from pydantic.types import confloat

from app.integrations.gps.base import InvalidPayload, RawPosition
from app.models.enums import GpsSignalStatus

MAX_POSITIONS = 500

Latitude = confloat(ge=-90, le=90, allow_inf_nan=False)
Longitude = confloat(ge=-180, le=180, allow_inf_nan=False)


class _Position(BaseModel):
    model_config = ConfigDict(extra="ignore")

    device_id: str = Field(min_length=1, max_length=128)
    recorded_at: AwareDatetime
    latitude: Latitude  # type: ignore[valid-type]
    longitude: Longitude  # type: ignore[valid-type]
    speed_kph: float | None = Field(default=None, ge=0, le=9999)
    heading_degrees: float | None = Field(default=None, ge=0, lt=360)
    ignition_on: bool | None = None
    signal_status: GpsSignalStatus = GpsSignalStatus.UNKNOWN


class GenericAdapter:
    """FleetPulse's own documented format: see docs/gps-ingestion.md."""

    def parse(self, payload: Any) -> list[RawPosition]:
        if not isinstance(payload, dict) or not isinstance(payload.get("positions"), list):
            raise InvalidPayload('Expected a JSON object with a "positions" list.')
        items = payload["positions"]
        if len(items) > MAX_POSITIONS:
            raise InvalidPayload(f"Send at most {MAX_POSITIONS} positions at a time.")
        return [self._parse_one(item) for item in items]

    def _parse_one(self, item: Any) -> RawPosition:
        try:
            position = _Position.model_validate(item)
        except ValidationError as exc:
            fields = sorted({str(error["loc"][0]) for error in exc.errors() if error["loc"]})
            return RawPosition(error=f"invalid: {', '.join(fields) or 'position'}")

        def to_decimal(value: float | None) -> Decimal | None:
            return None if value is None else round(Decimal(str(value)), 2)

        return RawPosition(
            device_id=position.device_id,
            recorded_at=position.recorded_at.astimezone(UTC),
            latitude=position.latitude,
            longitude=position.longitude,
            speed_kph=to_decimal(position.speed_kph),
            heading_degrees=to_decimal(position.heading_degrees),
            ignition_on=position.ignition_on,
            signal_status=position.signal_status,
        )
