#!/usr/bin/env bash
# Instalación en Ubuntu (VPS de Hostinger). Ejecutar como root desde la carpeta del repo:
#   sudo bash deploy/install.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="${APP_USER:-revenue}"

echo "==> Paquetes del sistema"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates build-essential

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

echo "==> Usuario de servicio: $APP_USER"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "==> Dependencias"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund && bash deploy/setup-adapters.sh"

if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "!! Rellena $APP_DIR/.env (DUNE_API_KEYS, DASHBOARD_USER/PASS) y vuelve a ejecutar este script"
fi

echo "==> Servicios systemd"
for f in revenue-dashboard.service revenue-collect.service revenue-collect.timer; do
  sed -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__APP_USER__#$APP_USER#g" "$APP_DIR/deploy/$f" > "/etc/systemd/system/$f"
done
systemctl daemon-reload
systemctl enable --now revenue-dashboard.service revenue-collect.timer

echo
echo "Listo:"
echo "  Dashboard:      http://$(hostname -I | awk '{print $1}'):$(grep -E '^PORT=' "$APP_DIR/.env" | cut -d= -f2 || echo 3000)"
echo "  Próximas runs:  systemctl list-timers revenue-collect.timer"
echo "  Logs:           journalctl -u revenue-collect -f"
