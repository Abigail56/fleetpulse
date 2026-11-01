#!/bin/sh
# Restores a backup into a new database, leaving the current one untouched.
#   deploy/restore.sh backups/fleetpulse-....dump fleetpulse_restored
# To go live with it, follow "Restoring from a backup" in docs/operations.md.
set -eu

ENV_FILE="${ENV_FILE:-deploy/.env.production}"
COMPOSE="docker compose --env-file $ENV_FILE -f ${COMPOSE_FILE_PATH:-deploy/docker-compose.prod.yml}"
FILE="${1:?usage: deploy/restore.sh BACKUP_FILE NEW_DATABASE_NAME}"
TARGET="${2:?usage: deploy/restore.sh BACKUP_FILE NEW_DATABASE_NAME}"

case "$TARGET" in
  *[!a-z0-9_]*) echo "The database name can only have lowercase letters, numbers and underscores." >&2; exit 2 ;;
esac

$COMPOSE exec -T db sh -c "createdb -U \"\$POSTGRES_USER\" $TARGET"
$COMPOSE exec -T db sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $TARGET --no-owner --role=\"\$POSTGRES_USER\"" < "$FILE"
echo "Restored into $TARGET. The current database wasn't changed."
