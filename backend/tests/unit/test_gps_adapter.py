from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.integrations.gps.base import InvalidPayload
from app.integrations.gps.generic import MAX_POSITIONS, GenericAdapter
from app.services.geo import distance_km
from app.services.telemetry import reconstruct_journeys

ADAPTER = GenericAdapter()
VALID: dict[str, Any] = {
    "device_id": "D1",
    "recorded_at": "2026-10-30T14:00:00+01:00",
    "latitude": -1.29,
    "longitude": 36.82,
}


def test_a_position_is_converted_to_utc_without_inventing_missing_values() -> None:
    position = ADAPTER.parse({"positions": [VALID]})[0]
    assert position.error is None
    assert position.recorded_at == datetime(2026, 10, 30, 13, 0, tzinfo=UTC)
    assert position.speed_kph is None
    assert position.heading_degrees is None
    assert position.ignition_on is None


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"latitude": 91}, "latitude"),
        ({"longitude": -181}, "longitude"),
        ({"latitude": "NaN"}, "latitude"),
        ({"speed_kph": -1}, "speed_kph"),
        ({"heading_degrees": 360}, "heading_degrees"),
        ({"recorded_at": "2026-10-30T14:00:00"}, "recorded_at"),
        ({"recorded_at": "yesterday"}, "recorded_at"),
        ({"device_id": ""}, "device_id"),
        ({"signal_status": "amazing"}, "signal_status"),
    ],
)
def test_one_bad_position_is_marked_without_failing_the_batch(
    overrides: dict[str, Any], field: str
) -> None:
    good, bad = ADAPTER.parse({"positions": [VALID, VALID | overrides]})
    assert good.error is None
    assert bad.error is not None
    assert field in bad.error


def test_is_simulated_in_the_payload_is_ignored() -> None:
    assert not hasattr(
        ADAPTER.parse({"positions": [VALID | {"is_simulated": False}]})[0], "is_simulated"
    )


@pytest.mark.parametrize("payload", [None, [], "x", {}, {"positions": "x"}])
def test_an_unusable_payload_is_refused(payload: Any) -> None:
    with pytest.raises(InvalidPayload):
        ADAPTER.parse(payload)


def test_too_many_positions_are_refused() -> None:
    with pytest.raises(InvalidPayload, match=str(MAX_POSITIONS)):
        ADAPTER.parse({"positions": [VALID] * (MAX_POSITIONS + 1)})


def test_distance_matches_a_known_value() -> None:
    assert distance_km(0, 0, 0, 1) == pytest.approx(111.19, abs=0.01)
    assert distance_km(1, 1, 1, 1) == 0


START = datetime(2026, 10, 30, 8, 0, tzinfo=UTC)


def row(minutes: int, latitude: float = 0.0, ignition: bool | None = True) -> dict[str, Any]:
    return {
        "recorded_at": START + timedelta(minutes=minutes),
        "latitude": latitude,
        "longitude": 0.0,
        "ignition_on": ignition,
        "is_simulated": False,
    }


GAP = timedelta(minutes=10)


def test_journeys_split_at_reporting_gaps() -> None:
    journeys = reconstruct_journeys([row(0), row(5, 0.1), row(30), row(35, 0.1)], GAP)
    assert len(journeys) == 2
    assert journeys[0].distance_km == pytest.approx(11.12, abs=0.01)


def test_journeys_split_when_the_ignition_goes_off() -> None:
    journeys = reconstruct_journeys(
        [row(0), row(1, 0.1), row(2, ignition=False), row(3, 0.2), row(4, 0.3)], GAP
    )
    assert len(journeys) == 2


def test_unknown_ignition_does_not_split_a_journey() -> None:
    assert len(reconstruct_journeys([row(0, ignition=None), row(5, 0.1, None)], GAP)) == 1


def test_a_long_stop_splits_a_journey_even_without_ignition_data() -> None:
    rows = [
        row(0, 0.0, None),
        row(5, 0.1, None),
        row(10, 0.1, None),
        row(16, 0.1, None),
        row(30, 0.1, None),
        row(35, 0.2, None),
        row(40, 0.3, None),
    ]
    journeys = reconstruct_journeys(rows, GAP)
    assert len(journeys) == 2
    assert journeys[0].distance_km == pytest.approx(11.12, abs=0.01)
    assert journeys[1].distance_km == pytest.approx(11.12, abs=0.01)


def test_a_short_stop_does_not_split_a_journey() -> None:
    rows = [row(0, 0.0), row(3, 0.1), row(6, 0.1), row(9, 0.2)]
    assert len(reconstruct_journeys(rows, GAP)) == 1


def test_a_lone_position_is_not_a_journey() -> None:
    assert reconstruct_journeys([row(0)], GAP) == []
