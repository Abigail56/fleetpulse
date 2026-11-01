"""Grants or removes FleetPulse staff access. Run on the server: no API can do this.

uv run python -m app.db.make_platform_admin someone@example.com
uv run python -m app.db.make_platform_admin someone@example.com --remove
"""

import sys

from sqlalchemy import create_engine, text

from app.core.config import get_settings

USAGE = "usage: python -m app.db.make_platform_admin EMAIL [--remove]"


def main(arguments: list[str]) -> int:
    remove = "--remove" in arguments
    addresses = [item for item in arguments if not item.startswith("--")]
    if len(addresses) != 1:
        print(USAGE, file=sys.stderr)
        return 2
    url = get_settings().migration_database_url
    if url is None:
        print("FLEETPULSE_MIGRATION_DATABASE_URL isn't set.", file=sys.stderr)
        return 2
    engine = create_engine(str(url))
    with engine.begin() as connection:
        changed = connection.execute(
            text(
                """
                UPDATE users SET is_platform_admin = :value
                WHERE email = lower(:email) AND email_verified_at IS NOT NULL
                RETURNING id
                """
            ),
            {"value": not remove, "email": addresses[0]},
        ).first()
        if changed is None:
            print("No verified account has that email address.", file=sys.stderr)
            return 1
        connection.execute(
            text(
                """
                INSERT INTO audit_logs (id, action, entity_type, entity_id, details, occurred_at)
                VALUES (
                    gen_random_uuid(), :action, 'user', :id, '{"source": "command line"}', now()
                )
                """
            ),
            {
                "action": "platform_admin.removed" if remove else "platform_admin.granted",
                "id": str(changed[0]),
            },
        )
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
