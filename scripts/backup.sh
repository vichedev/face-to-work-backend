#!/bin/sh
# Backup nocturno de la BD face_to_work.
# Lo invoca cron dentro del contenedor ftw_backup (ver docker-compose.yml).
# Variables de entorno requeridas: PGHOST, PGUSER, PGPASSWORD, PGDATABASE, BACKUP_KEEP_DAILY.

set -eu

BACKUP_DIR="/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${BACKUP_DIR}/ftw-${STAMP}.sql.gz"
KEEP="${BACKUP_KEEP_DAILY:-14}"

mkdir -p "$BACKUP_DIR"

echo "[$(date -Iseconds)] [ftw_backup] dump → $FILE"
# --clean: incluye DROP antes de CREATE → permite restore en una BD existente.
# --if-exists: evita errores si los objetos no estaban.
# --no-owner --no-privileges: portable entre instancias con distintos usuarios.
pg_dump --clean --if-exists --no-owner --no-privileges "$PGDATABASE" | gzip -9 > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"

SIZE="$(du -h "$FILE" | cut -f1)"
echo "[$(date -Iseconds)] [ftw_backup] OK ${FILE} (${SIZE})"

# Retención: conserva sólo los $KEEP más recientes.
TO_DELETE="$(ls -1t "${BACKUP_DIR}"/ftw-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) || true)"
if [ -n "$TO_DELETE" ]; then
  echo "[$(date -Iseconds)] [ftw_backup] eliminando antiguos:"
  echo "$TO_DELETE" | sed 's/^/  · /'
  echo "$TO_DELETE" | xargs rm -f
fi
