from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Protocol

from app.models.enums import GpsSignalStatus


class InvalidPayload(Exception):
    """The whole request is unusable. Problems with single positions are reported per position."""


@dataclass(frozen=True)
class RawPosition:
    """One position in FleetPulse's terms, or the reason it couldn't be understood."""

    device_id: str | None = None
    recorded_at: datetime | None = None
    latitude: float | None = None
    longitude: float | None = None
    speed_kph: Decimal | None = None
    heading_degrees: Decimal | None = None
    ignition_on: bool | None = None
    signal_status: GpsSignalStatus = GpsSignalStatus.UNKNOWN
    error: str | None = None


class GpsAdapter(Protocol):
    """Each tracking vendor gets one adapter, so nothing else knows about vendor formats."""

    def parse(self, payload: Any) -> list[RawPosition]: ...
