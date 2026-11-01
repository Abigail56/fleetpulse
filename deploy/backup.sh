#!/bin/sh
# Writes a compressed database backup. Files in object storage need the provider's own versioning.
#   deploy/backup.sh [directory]
# Copy backups to another location: one on this server is lost with this server.
set -eu

ENV_FILE="${ENV_FILE:-deploy/.env.production}"
COMPOSE="docker compose --env-file $ENV_FILE -f ${COMPOSE_FILE_PATH:-deploy/docker-compose.prod.yml}"
DIRECTORY="${1:-backups}"
FILE="$DIRECTORY/fleetpulse-$(date -u +%Y%m%dT%H%M%SZ).dump"

mkdir -p "$DIRECTORY"
umask 077
$COMPOSE exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$FILE.partial"
# Renamed last, so a backup that failed halfway can't be mistaken for a good one.
[ -s "$FILE.partial" ]
mv "$FILE.partial" "$FILE"
echo "$FILE"
