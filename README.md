# Schafkopf Online

Schafkopf im Browser mit Freunden: Session erstellen, Link/Code teilen, freie Plätze mit Bots füllen.
Reines Node.js (≥ 18), **keine npm-Abhängigkeiten**. Der Server rechnet alle Regeln selbst, jeder Client sieht nur die eigene Hand.

## Features
- Sessions erstellen nur mit Passwort (siehe unten), Beitreten per Link/Code ohne Passwort
- Sessions mit 4-stelligem Code bzw. Link `https://schafkopf.nilsoo.xyz/?r=K7QM`
- Gastgeber: Bots hinzufügen/Spieler entfernen, Spiel starten, Spielstand zurücksetzen, „Bot übernimmt“ für Spieler, die offline gegangen sind
- Reconnect: Seite neu laden oder WLAN weg → man landet automatisch wieder auf seinem Platz (Token im localStorage)
- Zuschauer: wer einer laufenden Session beitritt, schaut zu und kann einen Bot-Platz übernehmen
- Sauspiel, Wenz, Farbsolo · Rufsau-Regeln (zugeben, nicht schmieren, davonlaufen) · Schneider/Schwarz
- Spielstand: gewonnene Spiele je Spieler und gespielte Runden (kein Geld, kein Tarif)

Nicht enthalten: Kontra/Re, Tout, Ramsch (bei „alle weiter“ wird neu gegeben).
Sessions liegen im RAM: Ein Neustart des Containers beendet laufende Spiele.

## Installation aus GitHub (Debian-LXC, empfohlen)

LXC z. B. mit dem community-scripts Debian-Script anlegen, dann im LXC:

```bash
apt install -y git
git clone https://github.com/Nilsoooo/schafkopf-online.git /root/schafkopf-online
bash /root/schafkopf-online/setup.sh
```

Update:
```bash
cd /root/schafkopf-online && git pull && bash setup.sh
```

`setup.sh` installiert Node.js (Debian-Paket), legt den Benutzer `schafkopf` an, fragt beim ersten Mal das Passwort ab, kopiert alles nach
`/opt/schafkopf`, richtet den systemd-Dienst ein und prüft den Healthcheck.

## Installation (Proxmox-LXC mit Docker)

```bash
# Ordner auf den Host kopieren, z. B. nach /opt/schafkopf
cd /opt/schafkopf
echo "CREATE_PASSWORD='geheim'" > .env && chmod 600 .env
docker compose up -d --build
curl http://localhost:3000/healthz   # → ok
```

### Ohne Docker (Debian-LXC, Node 22)
```bash
apt install -y nodejs        # Debian 13: Node 20 – reicht. Sonst NodeSource für Node 22
useradd -r -s /usr/sbin/nologin schafkopf
cp -r . /opt/schafkopf && chown -R schafkopf: /opt/schafkopf
cp schafkopf.service /etc/systemd/system/
(umask 077; echo "CREATE_PASSWORD='geheim'" > /etc/schafkopf.env)
systemctl daemon-reload && systemctl enable --now schafkopf
```

## Passwort

Nur wer das Passwort kennt, kann eine Session **erstellen**. Mitspieler treten per Link oder Code ohne Passwort bei.

- Der Server liest es aus der Umgebungsvariable `CREATE_PASSWORD`. Ist sie leer, ist das Erstellen gesperrt
  (Warnung im Log: `journalctl -u schafkopf`).
- **LXC/systemd:** `setup.sh` fragt das Passwort beim ersten Lauf ab und legt `/etc/schafkopf.env` an
  (`root:root`, Rechte 600). Ändern:
  ```bash
  nano /etc/schafkopf.env          # CREATE_PASSWORD='neues-passwort'
  systemctl restart schafkopf
  ```
- **Docker:** `.env` neben `docker-compose.yml` mit `CREATE_PASSWORD='…'`, dann `docker compose up -d`.
- Schutz gegen Durchprobieren: höchstens 5 Fehlversuche pro IP in 10 Minuten. Hinter NPMplus zählt die
  echte Client-IP (`X-Real-IP`).
- Im Browser kann man „Passwort merken“ anhaken (liegt dann im localStorage dieses Browsers).
- Das Passwort gehört nie ins Repo (`.env` steht in `.gitignore`).

## Erreichbar über die eigene Domain (NPMplus + Cloudflare)

1. **DNS:** Lege `schafkopf.nilsoo.xyz` an, entweder als CNAME auf einen bestehenden Eintrag
   (z. B. `homeassistant.nilsoo.xyz`) oder in der `DOMAINS`-Liste deines cloudflare-ddns-Containers.
   Cloudflare-Proxy (orange Wolke) geht, WebSockets laufen da problemlos durch.
2. **NPMplus → Proxy Host hinzufügen:**
   - Domain: `schafkopf.nilsoo.xyz`
   - Scheme `http`, Forward Host = IP des LXC, Port `3000`
   - **„Websockets Support“ einschalten**, sonst bleibt die Seite auf „Verbindung getrennt“ hängen.
   - SSL: dein bestehendes Zertifikat bzw. Let's Encrypt (DNS-Challenge über Cloudflare), „Force SSL“ an
3. Aufrufen, Namen eingeben, „Session erstellen“, oben „Link kopieren“ und an die Freunde schicken.

Der Server schickt alle 25 s ein Ping, damit nginx und Cloudflare die Verbindung nicht wegen Inaktivität (Standard 60 s bzw. 100 s) trennen.

## Konfiguration (Umgebungsvariablen)
| Variable | Standard | Bedeutung |
|---|---|---|
| `CREATE_PASSWORD` | – | Passwort zum Erstellen von Sessions (leer = Erstellen gesperrt) |
| `PORT` | 3000 | HTTP-/WebSocket-Port |
| `BOT_DELAY` | 750 | Bedenkzeit der Bots (ms) |
| `TRICK_DELAY` | 1600 | wie lange ein voller Stich liegen bleibt (ms) |

## Dateien
- `server.js`: HTTP, WebSocket (eigene, schlanke Implementierung), Sessions, Spielablauf
- `rules.js`: Regeln, Auswertung, Bot-Logik
- `public/index.html`: kompletter Client (Lobby + Spieltisch)
- `public/cards/`: Kartenbilder (bayerisches Blatt, eigene Gestaltung, siehe `CREDITS.md`), erzeugt mit `node tools/make-cards.js`

## Test
```bash
CREATE_PASSWORD=test BOT_DELAY=20 TRICK_DELAY=30 PORT=3999 node server.js   # Terminal 1
node test/smoke.js                                                          # Terminal 2 (Node 22+)
```
Prüft Passwort (falsch/richtig/Sperre nach 5 Fehlversuchen), Beitreten ohne Passwort und 5 automatisch gespielte Runden.
Vor jedem weiteren Lauf den Server neu starten (die Fehlversuche bleiben 10 Minuten gespeichert).
