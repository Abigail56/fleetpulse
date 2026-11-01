from datetime import date
from typing import Any, Literal

from pydantic import BaseModel

ColumnKind = Literal["text", "number", "money", "percent", "distance", "date", "datetime"]


class ReportColumn(BaseModel):
    key: str
    label: str
    kind: ColumnKind = "text"


class ReportTile(BaseModel):
    label: str
    value: str


class ReportResponse(BaseModel):
    key: str
    title: str
    start: date
    end: date
    tiles: list[ReportTile]
    columns: list[ReportColumn]
    rows: list[dict[str, Any]]
    # What the figures do and don't include, so nobody over-reads them.
    notes: list[str]
    truncated: bool


class ReportSummary(BaseModel):
    key: str
    title: str
    description: str
