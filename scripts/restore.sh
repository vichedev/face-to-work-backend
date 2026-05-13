#!/bin/sh
# Restaura un backup de la BD face_to_work desde el contenedor ftw_backup.
# Uso (desde el host):
#   docker exec -it ftw_backup sh /usr/local/bin/restore.sh /backups/ftw-YYYYMMDD-HHMMSS.sql.gz
# o si has montado el volumen `ftw_backups` en otro contenedor con pg_restore.

set -eu

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Uso: restore.sh <ruta-al-archivo .sql.gz>"
  echo "Backups disponibles:"
  ls -1t /backups/ftw-*.sql.gz 2>/dev/null | sed 's/^/  · /' || echo "  (ninguno)"
  exit 1
fi

echo "ATENCIÓN: vas a restaurar '$FILE' sobre la BD '$PGDATABASE' en '$PGHOST'."
echo "Esto BORRA todo lo que haya ahora. Esperando 5 s, Ctrl-C para cancelar..."
sleep 5

gunzip -c "$FILE" | psql --quiet "$PGDATABASE"
echo "[$(date -Iseconds)] [ftw_backup] restore completado desde $FILE"
