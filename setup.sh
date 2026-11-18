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

# Passwort zum Erstellen von Sessions (nur beim ersten Mal abfragen)
ENVFILE=/etc/schafkopf.env
if [ ! -f "$ENVFILE" ]; then
  [ -r /dev/tty ] || { echo "Kein Terminal für die Passwort-Abfrage. $ENVFILE bitte von Hand anlegen: CREATE_PASSWORD='…'"; exit 1; }
  echo "» Passwort festlegen, mit dem man Sessions erstellen darf (Beitreten geht ohne):"
  while true; do
    read -rsp "  Passwort: " PW1 </dev/tty; echo
    read -rsp "  Wiederholen: " PW2 </dev/tty; echo
    if [ -z "$PW1" ]; then echo "  Leeres Passwort geht nicht."; continue; fi
    if [ "$PW1" != "$PW2" ]; then echo "  Stimmt nicht überein, nochmal."; continue; fi
    case "$PW1" in *\'*|*\\*) echo "  Bitte ohne ' und \\."; continue ;; esac
    break
  done
  ( umask 077; printf "CREATE_PASSWORD='%s'\n" "$PW1" > "$ENVFILE" )
  chown root:root "$ENVFILE"; chmod 600 "$ENVFILE"
  unset PW1 PW2
  echo "✓ $ENVFILE angelegt."
fi
echo "  Passwort ändern: $ENVFILE bearbeiten (CREATE_PASSWORD='…'), dann: systemctl restart schafkopf"

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
