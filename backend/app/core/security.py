import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import Settings

JWT_ALGORITHM = "HS256"
REQUIRED_CLAIMS = ["sub", "sid", "jti", "iat", "exp", "iss", "aud"]
MIN_DISTINCT_PASSWORD_CHARACTERS = 5
MIN_PERSONAL_PART_LENGTH = 4
COMMON_PASSWORDS = frozenset(
    {
        "123456789012",
        "1234567890123",
        "qwertyuiop12",
        "qwertyuiop123",
        "qwertyuiopas",
        "password1234",
        "password12345",
        "password123456",
        "passwordpassword",
        "adminadmin12",
        "administrator",
        "administrator1",
        "letmeinletmein",
        "welcomewelcome",
        "welcome12345",
        "iloveyou1234",
        "fleetpulse12",
        "fleetpulse123",
        "fleetpulse1234",
    }
)

_hasher = PasswordHasher()  # Argon2id
# Verified against when an account doesn't exist, so response time doesn't reveal that.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(32))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def burn_password_check(password: str) -> None:
    verify_password(_DUMMY_HASH, password)


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def password_problem(password: str, email: str, full_name: str | None = None) -> str | None:
    """A small offline check. It does not replace a breached-password service."""
    lowered = password.casefold()
    if lowered in COMMON_PASSWORDS or len(set(lowered)) < MIN_DISTINCT_PASSWORD_CHARACTERS:
        return "This password is too easy to guess."
    personal = [email.partition("@")[0].casefold(), *(full_name or "").casefold().split()]
    if any(len(part) >= MIN_PERSONAL_PART_LENGTH and part in lowered for part in personal):
        return "Your password must not contain your name or email address."
    return None


def new_opaque_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass(frozen=True)
class AccessClaims:
    user_id: uuid.UUID
    session_id: uuid.UUID


def create_access_token(settings: Settings, user_id: uuid.UUID, session_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user_id),
            "sid": str(session_id),
            "jti": str(uuid.uuid4()),
            "iat": now,
            "exp": now + timedelta(minutes=settings.access_token_minutes),
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
        },
        settings.jwt_secret.get_secret_value(),
        algorithm=JWT_ALGORITHM,
    )


def decode_access_token(settings: Settings, token: str) -> AccessClaims | None:
    """Returns None for anything invalid. The algorithm is fixed, never read from the token."""
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[JWT_ALGORITHM],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
            options={"require": REQUIRED_CLAIMS},
        )
        return AccessClaims(user_id=uuid.UUID(claims["sub"]), session_id=uuid.UUID(claims["sid"]))
    except (jwt.InvalidTokenError, ValueError):
        return None


def csrf_token_for(settings: Settings, session_id: uuid.UUID) -> str:
    """Bound to the session and returned in response bodies, which other sites cannot read."""
    key = settings.jwt_secret.get_secret_value().encode()
    return hmac.new(key, f"csrf:{session_id}".encode(), hashlib.sha256).hexdigest()


def csrf_token_is_valid(settings: Settings, session_id: uuid.UUID, candidate: str | None) -> bool:
    if candidate is None:
        return False
    # Compared as bytes: compare_digest raises on non-ASCII strings, and headers can hold those.
    return hmac.compare_digest(csrf_token_for(settings, session_id).encode(), candidate.encode())
