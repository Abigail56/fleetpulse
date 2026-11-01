from typing import Literal

from pydantic import EmailStr, Field

from app.schemas.auth import DisplayName, RequestModel

FleetSize = Literal["1-10", "11-50", "51-200", "201-1000", "1000+"]


class ContactRequest(RequestModel):
    name: DisplayName
    email: EmailStr
    company: DisplayName | None = None
    fleet_size: FleetSize | None = None
    message: str = Field(min_length=10, max_length=4000)
    # Hidden from people by the form; only bots fill it in.
    website: str = Field(default="", max_length=200)
