#!/usr/bin/env bash
# ============================================================
# Face to Work — script de despliegue (Docker Compose)
# ============================================================
# Uso:
#   ./deploy.sh                # menu interactivo
#   ./deploy.sh <comando>      # ejecuta comando directo
#
# Comandos:
#   full       Deploy completo (primera vez) — build + up + seed admin
#   redeploy   Rebuild de la api y reinicio (sin tocar la BD)
#   up         Levanta los contenedores
#   logs       Logs en vivo de la api
#   restart    Reinicia los contenedores
#   stop       Detiene los contenedores
#   status     Estado de los contenedores
#   admin      Crea/actualiza el usuario administrador (corre el seed)
#   backup     Backup .sql de la base de datos
#   shell      Shell dentro del contenedor api
#   help       Muestra esta ayuda
# ============================================================

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

ENV_FILE=".env.production"
DC() { docker compose --env-file "$ENV_FILE" "$@"; }

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
CYAN='\033[0;36m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${GREEN}==>${NC} $*"; }
info() { echo -e "${CYAN}-->${NC} $*"; }
warn() { echo -e "${YELLOW}!! ${NC}$*"; }
err()  { echo -e "${RED}xx ${NC}$*" >&2; }
title(){ echo -e "${BOLD}${BLUE}$*${NC}"; }

require_docker() {
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 || {
    err "Docker o Docker Compose v2 no disponibles."
    exit 1
  }
}
require_env() {
  [ -f "$ENV_FILE" ] || {
    err "No existe $ENV_FILE. Copia .env.production.example a .env.production y rellena valores."
    exit 1
  }
}

cmd_full() {
  require_docker; require_env
  log "Construyendo la imagen de la api..."
  DC build api
  log "Levantando contenedores (db, api, caddy)..."
  DC up -d
  log "Esperando a que la base de datos esté lista..."
  sleep 8
  log "Creando el usuario administrador (seed)..."
  DC exec -T api node dist/seed.js || warn "El seed falló. Revisa: ./deploy.sh logs"
  echo
  ( set -a; source "$ENV_FILE"; set +a; log "Listo. Abre  https://${SITE_ADDRESS}  (acepta el aviso del certificado auto-firmado)." )
  info "Trabajadores marcan en /me ; administración en /admin ; login en /"
}

cmd_redeploy() {
  require_docker; require_env
  if [ -d .git ]; then git pull || warn "git pull falló (continúo igual)"; fi
  log "Rebuild de la api..."
  DC build api
  DC up -d api caddy
  log "OK"
}

cmd_up()      { require_docker; require_env; DC up -d; }
cmd_logs()    { require_docker; require_env; DC logs -f api; }
cmd_restart() { require_docker; require_env; DC restart; }
cmd_stop()    { require_docker; require_env; DC down; }
cmd_status()  { require_docker; require_env; DC ps; }
cmd_admin()   { require_docker; require_env; log "Re-ejecutando seed..."; DC exec -T api node dist/seed.js; }
cmd_shell()   { require_docker; require_env; DC exec api sh; }

cmd_backup() {
  require_docker; require_env
  local out="backup-$(date +%F-%H%M).sql"
  log "Generando $out..."
  set -a; source "$ENV_FILE"; set +a
  DC exec -T db pg_dump -U "$DB_USERNAME" "$DB_NAME" > "$out"
  log "Guardado en $out"
}

cmd_help() { sed -n '1,25p' "$0"; }

cmd_menu() {
  title "Face to Work · Deploy"
  echo "1) full      - Deploy completo (primera vez)"
  echo "2) redeploy  - Rebuild api + reinicio"
  echo "3) logs      - Logs en vivo"
  echo "4) restart   - Reiniciar contenedores"
  echo "5) stop      - Detener todo"
  echo "6) status    - Estado"
  echo "7) admin     - Crear/actualizar admin"
  echo "8) backup    - Backup de BD"
  echo "9) shell     - Shell en api"
  echo "0) salir"
  read -rp "> " opt
  case "$opt" in
    1) cmd_full ;;
    2) cmd_redeploy ;;
    3) cmd_logs ;;
    4) cmd_restart ;;
    5) cmd_stop ;;
    6) cmd_status ;;
    7) cmd_admin ;;
    8) cmd_backup ;;
    9) cmd_shell ;;
    0) exit 0 ;;
    *) err "Opción inválida" ;;
  esac
}

case "${1:-menu}" in
  full)     cmd_full ;;
  redeploy) cmd_redeploy ;;
  up)       cmd_up ;;
  logs)     cmd_logs ;;
  restart)  cmd_restart ;;
  stop)     cmd_stop ;;
  status)   cmd_status ;;
  admin)    cmd_admin ;;
  backup)   cmd_backup ;;
  shell)    cmd_shell ;;
  help|-h|--help) cmd_help ;;
  menu)     cmd_menu ;;
  *) err "Comando desconocido: $1"; cmd_help; exit 1 ;;
esac
