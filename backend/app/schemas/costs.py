import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import AwareDatetime, BaseModel, Field, StringConstraints

from app.models.enums import ExpenseCategory, ExpenseStatus, FuelUnit
from app.schemas.auth import RequestModel

Currency = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Z]{3}$")]
Kilometres = Annotated[Decimal, Field(ge=0, le=99999999, decimal_places=1)]
Quantity = Annotated[Decimal, Field(gt=0, le=9999999, decimal_places=3)]
UnitPrice = Annotated[Decimal, Field(ge=0, le=99999999, decimal_places=4)]
Amount = Annotated[Decimal, Field(gt=0, le=999999999999, decimal_places=2)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=160)]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


class FileResponse(BaseModel):
    id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int


class FileLink(BaseModel):
    url: str
    expires_in_seconds: int


class FuelCreate(RequestModel):
    vehicle_id: uuid.UUID
    filled_at: AwareDatetime
    quantity: Quantity
    unit: FuelUnit = FuelUnit.LITRES
    unit_price: UnitPrice
    currency: Currency
    odometer_km: Kilometres | None = None
    is_full_tank: bool = False
    station_name: ShortText | None = None
    notes: Notes | None = None
    receipt_file_id: uuid.UUID | None = None


class FuelUpdate(RequestModel):
    filled_at: AwareDatetime | None = None
    quantity: Quantity | None = None
    unit: FuelUnit | None = None
    unit_price: UnitPrice | None = None
    currency: Currency | None = None
    odometer_km: Kilometres | None = None
    is_full_tank: bool | None = None
    station_name: ShortText | None = None
    notes: Notes | None = None
    receipt_file_id: uuid.UUID | None = None


class FuelResponse(BaseModel):
    id: uuid.UUID
    vehicle_id: uuid.UUID
    vehicle_registration: str
    filled_at: datetime
    quantity: Decimal
    unit: FuelUnit
    unit_price: Decimal
    total_cost: Decimal
    currency: str
    odometer_km: Decimal | None
    is_full_tank: bool
    station_name: str | None
    notes: str | None
    receipt: FileResponse | None
    created_by_user_id: uuid.UUID | None
    voided_at: datetime | None


class FuelList(BaseModel):
    items: list[FuelResponse]
    total: int
    page: int
    page_size: int


class ExpenseCreate(RequestModel):
    vehicle_id: uuid.UUID
    category: ExpenseCategory
    amount: Amount
    currency: Currency
    incurred_on: date
    vendor: ShortText | None = None
    description: Notes | None = None
    receipt_file_id: uuid.UUID | None = None


class ExpenseUpdate(RequestModel):
    category: ExpenseCategory | None = None
    amount: Amount | None = None
    currency: Currency | None = None
    incurred_on: date | None = None
    vendor: ShortText | None = None
    description: Notes | None = None
    receipt_file_id: uuid.UUID | None = None


class ExpenseReview(RequestModel):
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] | None = None


class ExpenseResponse(BaseModel):
    id: uuid.UUID
    vehicle_id: uuid.UUID
    vehicle_registration: str
    category: ExpenseCategory
    amount: Decimal
    currency: str
    incurred_on: date
    vendor: str | None
    description: str | None
    receipt: FileResponse | None
    status: ExpenseStatus
    submitted_by_user_id: uuid.UUID | None
    reviewed_at: datetime | None
    review_note: str | None
    voided_at: datetime | None


class ExpenseList(BaseModel):
    items: list[ExpenseResponse]
    total: int
    page: int
    page_size: int


class CostOptionVehicle(BaseModel):
    id: uuid.UUID
    registration_number: str
    make: str
    model: str


class CostOptions(BaseModel):
    vehicles: list[CostOptionVehicle]
    default_currency: str


class CostLine(BaseModel):
    currency: str
    fuel: Decimal
    maintenance: Decimal
    expenses: Decimal
    total: Decimal


class CategoryTotal(BaseModel):
    category: ExpenseCategory
    currency: str
    amount: Decimal


class CostSummary(BaseModel):
    start: date
    end: date
    # By currency, because amounts in different currencies are never added together.
    totals: list[CostLine]
    expense_categories: list[CategoryTotal]
    awaiting_approval: int


class CurrencyCostPerKm(BaseModel):
    currency: str
    total: Decimal
    cost_per_km: Decimal | None


class Consumption(BaseModel):
    unit: FuelUnit
    per_100_km: Decimal
    distance_km: Decimal


class VehicleCosts(BaseModel):
    start: date
    end: date
    # Null with fewer than two odometer readings in the period.
    distance_km: Decimal | None
    readings: int
    costs: list[CurrencyCostPerKm]
    consumption: list[Consumption]
