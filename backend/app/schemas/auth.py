import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 128  # bounds the hashing work a single request can cause

NewPassword = Annotated[str, Field(min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)]
RawToken = Annotated[str, Field(min_length=1, max_length=256)]


def reject_control_characters(value: str) -> str:
    """Names are placed in emails, so line breaks could otherwise forge content."""
    if any(not character.isprintable() for character in value):
        raise ValueError("must not contain control characters")
    return value


DisplayName = Annotated[
    str, Field(min_length=1, max_length=200), AfterValidator(reject_control_characters)
]


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RegisterRequest(RequestModel):
    email: EmailStr
    password: NewPassword
    full_name: DisplayName


class LoginRequest(RequestModel):
    email: EmailStr
    # No minimum: rejecting a short password here would reveal the password rules are unmet.
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class EmailRequest(RequestModel):
    email: EmailStr


class VerifyEmailRequest(RequestModel):
    token: RawToken
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class ResetPasswordRequest(RequestModel):
    token: RawToken
    new_password: NewPassword


class ChangePasswordRequest(RequestModel):
    current_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    new_password: NewPassword


class MessageResponse(BaseModel):
    message: str


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    # Only decides whether the link appears. The API checks for itself on every request.
    is_platform_admin: bool = False


class AuthResponse(BaseModel):
    user: UserResponse
    # Kept in memory by the frontend and sent back as the X-CSRF-Token header.
    csrf_token: str


class SessionResponse(BaseModel):
    id: uuid.UUID
    user_agent: str | None
    created_at: datetime
    last_active_at: datetime
    expires_at: datetime
    is_current: bool
