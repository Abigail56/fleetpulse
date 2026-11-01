from app.integrations.gps.base import GpsAdapter
from app.integrations.gps.generic import GenericAdapter

GENERIC_PROVIDER = "generic"
SIMULATOR_PROVIDER = "simulator"

# A new vendor is one adapter and one line here. The simulator has no adapter on purpose: it
# can't be reached through the public ingestion endpoint.
ADAPTERS: dict[str, GpsAdapter] = {GENERIC_PROVIDER: GenericAdapter()}
