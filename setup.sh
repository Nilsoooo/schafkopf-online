#!/usr/bin/env bash
# Schafkopf Online – Installation/Update im Debian-LXC
# Aufruf im entpackten Ordner:  bash setup.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen."; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST=/opt/schafkopf

if ! command -v node >/dev/null; then
  echo "» Installiere Node.js …"
  apt-get update -qq && apt-get install -y -qq nodejs >/dev/null
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || { echo "Node $NODE_MAJOR ist zu alt (mind. 18)."; exit 1; }

id schafkopf >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin schafkopf

echo "» Kopiere Dateien nach $DEST …"
mkdir -p "$DEST"
if [ "$SRC" != "$DEST" ]; then
  cp -r "$SRC"/server.js "$SRC"/rules.js "$SRC"/package.json "$SRC"/public "$DEST"/
fi
chown -R schafkopf: "$DEST"

cp "$SRC/schafkopf.service" /etc/systemd/system/schafkopf.service
systemctl daemon-reload
systemctl enable schafkopf >/dev/null 2>&1
systemctl restart schafkopf

sleep 1
if curl -fs http://127.0.0.1:3000/healthz >/dev/null 2>&1 || wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
  echo "✓ Schafkopf läuft: http://$(hostname -I | awk '{print $1}'):3000"
else
  echo "✗ Healthcheck fehlgeschlagen – Logs: journalctl -u schafkopf -n 50"; exit 1
fi
