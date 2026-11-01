"""trip distance source

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-30 21:30:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("trips", sa.Column("distance_source", sa.String(length=16), nullable=True))
    op.create_check_constraint(
        "distance_source_known",
        "trips",
        "distance_source IS NULL OR distance_source IN ('gps', 'simulated', 'manual')",
    )


def downgrade() -> None:
    op.drop_constraint("distance_source_known", "trips", type_="check")
    op.drop_column("trips", "distance_source")
