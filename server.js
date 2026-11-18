'use strict';
// Schafkopf Online – Server ohne externe Abhängigkeiten (Node >= 18)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = require('./rules');

const PORT = +process.env.PORT || 3000;
const BOT_DELAY = +process.env.BOT_DELAY || 750;     // ms Bedenkzeit der Bots
const TRICK_DELAY = +process.env.TRICK_DELAY || 1600; // ms, wie lange ein voller Stich liegen bleibt
const ROOM_TTL = 30 * 60 * 1000;                       // leere Sessions nach 30 min löschen
const BOT_NAMES = ['Sepp', 'Resi', 'Hias', 'Vroni', 'Wastl', 'Zenzi'];
const PUBLIC = path.join(__dirname, 'public');

/* =================== HTTP =================== */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.webp': 'image/webp', '.md': 'text/markdown; charset=utf-8' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const cache = p.startsWith('/cards/') ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': cache });
    res.end(data);
  });
});

/* =================== Minimaler WebSocket-Server (RFC 6455) =================== */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
server.on('upgrade', (req, sock) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws' || (req.headers.upgrade || '').toLowerCase() !== 'websocket') return sock.destroy();
  const key = req.headers['sec-websocket-key'];
  if (!key) return sock.destroy();
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);
  const ws = makeWS(sock);
  onConnection(ws);
});

function makeWS(sock) {
  let buf = Buffer.alloc(0), frag = [], fragOp = 0;
  const ws = { alive: true, open: true, onmessage: null, onclose: null };
  const frame = (op, payload) => {
    const len = payload.length; let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    return Buffer.concat([head, payload]);
  };
  ws.send = str => { if (ws.open && !sock.destroyed) sock.write(frame(1, Buffer.from(str))); };
  ws.ping = () => { if (ws.open && !sock.destroyed) sock.write(frame(9, Buffer.alloc(0))); };
  ws.close = () => { if (!ws.open) return; ws.open = false; try { sock.end(frame(8, Buffer.alloc(0))); } catch (e) { } finish(); };
  const finish = () => { ws.open = false; if (ws._closed) return; ws._closed = true; ws.onclose && ws.onclose(); };
  sock.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > 1 << 20) return sock.destroy();
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 64 * 1024) return sock.destroy();
      if (!masked) return sock.destroy(); // Clients müssen maskieren
      if (buf.length < off + 4 + len) return;
      const mask = buf.slice(off, off + 4); off += 4;
      const data = Buffer.alloc(len);
      for (let i = 0; i < len; i++) data[i] = buf[off + i] ^ mask[i & 3];
      buf = buf.slice(off + len);
      if (op === 8) { ws.close(); return; }
      if (op === 9) { sock.write(frame(10, data)); continue; }
      if (op === 10) { ws.alive = true; continue; }
      if (op === 1 || op === 2) { frag = [data]; fragOp = op; } else if (op === 0) frag.push(data); else continue;
      if (fin) { const msg = Buffer.concat(frag); frag = []; if (fragOp === 1 && ws.onmessage) ws.onmessage(msg.toString('utf8')); }
    }
  });
  sock.on('close', finish);
  sock.on('error', () => { sock.destroy(); finish(); });
  return ws;
}

/* =================== Sessions =================== */
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const newCode = () => { let c; do { c = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''); } while (rooms.has(c)); return c; };
const newToken = () => crypto.randomBytes(16).toString('hex');
const cleanName = n => (String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16)) || 'Gast';

function createRoom() {
  const room = {
    code: newCode(), seats: [null, null, null, null], host: null, started: false, conns: new Set(),
    bal: [0, 0, 0, 0], round: 0, waiting: null, ready: new Set(), readyResolve: null, lastActive: Date.now(), G: null,
  };
  rooms.set(room.code, room);
  return room;
}
function seatName(room, p) { return room.seats[p] ? room.seats[p].name : '—'; }
function botNameFor(room) { const used = new Set(room.seats.filter(Boolean).map(s => s.name)); return BOT_NAMES.find(n => !used.has(n)) || 'Bot'; }
function logMsg(room, msg) { if (!room.G) return; room.G.log.push(msg); if (room.G.log.length > 60) room.G.log.shift(); }

function view(room, seat) {
  const G = room.G, me = seat;
  const v = {
    t: 'state', code: room.code, you: me, host: room.seats[me] && room.seats[me].token === room.host,
    started: room.started, bal: room.bal, round: room.round,
    seats: room.seats.map(s => s ? { name: s.name, bot: s.bot, online: s.bot || s.conns.size > 0 } : null),
  };
  if (!G) return v;
  const g = G.game;
  v.phase = G.phase; v.dealer = G.dealer; v.turn = G.turn; v.status = G.status;
  v.counts = G.hands.map(h => h.length); v.tricks = G.tricks;
  v.trick = G.trick; v.lastTrick = G.lastTrick; v.bubbles = G.bubbles; v.log = G.log;
  v.best = G.best ? { type: G.best.type, suit: G.best.suit, p: G.best.p } : null;
  v.hand = me >= 0 ? R.sortHand(G.hands[me].slice(), g) : [];
  if (g) {
    const showPartner = g.type === 'sau' && (g.revealed || G.phase === 'end' || g.partner === me);
    v.game = { type: g.type, suit: g.suit, decl: g.decl, partner: showPartner ? g.partner : null, name: R.gameName(g) };
  }
  if (me >= 0 && room.waiting && room.waiting.p === me) {
    v.waiting = room.waiting.kind;
    if (room.waiting.kind === 'play') v.legal = R.legal(G, me).map(c => c.id);
    if (room.waiting.kind === 'bid') v.callable = ['E', 'G', 'S'].filter(s => R.canCallSau(G.hands[me], s));
  }
  if (G.phase === 'end') { v.result = G.result; v.ready = [...room.ready]; }
  return v;
}
function broadcast(room) {
  room.lastActive = Date.now();
  for (const c of room.conns) c.ws.send(JSON.stringify(view(room, c.seat)));
}
function sendErr(ws, msg) { ws.send(JSON.stringify({ t: 'error', msg })); }

/* =================== Spielablauf =================== */
function decide(room, p, kind) {
  const G = room.G;
  if (room.seats[p].bot) return sleep(BOT_DELAY).then(() => kind === 'bid' ? R.botBid(G, p) : R.botPlay(G, p));
  return new Promise(res => { room.waiting = { p, kind, res }; broadcast(room); });
}
// Wenn ein Platz während des Wartens zum Bot wird
function resolveWithBot(room, p) {
  const w = room.waiting; if (!w || w.p !== p) return;
  room.waiting = null;
  w.res(w.kind === 'bid' ? R.botBid(room.G, p) : R.botPlay(room.G, p));
}

async function gameLoop(room) {
  room.G = { dealer: crypto.randomInt(4), log: [], hands: [[], [], [], []], trick: [], tricks: [0, 0, 0, 0], bubbles: {}, phase: 'deal', turn: -1 };
  while (rooms.has(room.code)) {
    await playRound(room);
    if (!rooms.has(room.code)) return;
    // auf "Weiter" aller verbundenen Menschen warten
    room.ready = new Set();
    await new Promise(res => { room.readyResolve = res; checkReady(room); broadcast(room); });
    room.readyResolve = null;
  }
}
function checkReady(room) {
  if (!room.readyResolve) return;
  const humans = room.seats.map((s, i) => (s && !s.bot && s.conns.size > 0) ? i : -1).filter(i => i >= 0);
  if (humans.length === 0 || humans.every(i => room.ready.has(i))) room.readyResolve();
}

async function playRound(room) {
  const G = room.G;
  room.round++;
  G.dealer = (G.dealer + 1) % 4;
  const deck = R.shuffle(R.makeDeck());
  Object.assign(G, { game: null, trick: [], won: [[], [], [], []], tricks: [0, 0, 0, 0], played: [], lastTrick: null, bubbles: {}, best: null, result: null, phase: 'bid' });
  for (let p = 0; p < 4; p++) G.hands[p] = deck.slice(p * 8, p * 8 + 8);
  G.initial = G.hands.map(h => h.slice());
  logMsg(room, `— Spiel ${room.round}: ${seatName(room, G.dealer)} gibt —`);
  for (let i = 1; i <= 4; i++) {
    const p = (G.dealer + i) % 4; G.turn = p; G.status = `${seatName(room, p)} überlegt …`; broadcast(room);
    let bid = await decide(room, p, 'bid');
    if (!R.validBid(G, p, bid)) bid = null;
    if (bid) { G.best = { ...bid, p }; G.bubbles[p] = R.gameName(bid); logMsg(room, `${seatName(room, p)}: ${R.gameName(bid)}`); }
    else { G.bubbles[p] = 'Weiter'; logMsg(room, `${seatName(room, p)}: weiter`); }
    broadcast(room);
  }
  G.turn = -1;
  if (!G.best) {
    G.status = 'Keiner spielt – zamgeschmissen!'; logMsg(room, 'Zamgeschmissen, neu geben.'); broadcast(room);
    await sleep(2000); room.round--; return playRound(room);
  }
  await sleep(900);
  const b = G.best;
  G.game = { type: b.type, suit: b.suit, decl: b.p, partner: null, revealed: false, ranAway: false };
  if (b.type === 'sau') G.game.partner = G.hands.findIndex(h => h.some(c => c.s === b.suit && c.r === 'A'));
  G.bubbles = {}; G.phase = 'play';
  logMsg(room, `${seatName(room, b.p)} spielt ${R.gameName(G.game)}.`);

  let leader = (G.dealer + 1) % 4;
  for (let t = 0; t < 8; t++) {
    G.trick = [];
    for (let k = 0; k < 4; k++) {
      const p = (leader + k) % 4; G.turn = p; G.status = `${seatName(room, p)} ist dran …`; broadcast(room);
      let c = await decide(room, p, 'play');
      const L = R.legal(G, p);
      if (!c || !L.some(x => x.id === c.id)) c = R.botPlay(G, p);
      playCard(room, p, c); broadcast(room);
    }
    G.turn = -1;
    const w = G.trick[R.winnerIdx(G.trick, G.game)].p;
    const tp = R.pts(G.trick.map(x => x.card));
    G.status = `${seatName(room, w)} macht den Stich (${tp} Augen).`; broadcast(room);
    await sleep(TRICK_DELAY);
    G.won[w].push(...G.trick.map(x => x.card)); G.tricks[w]++;
    G.lastTrick = G.trick; G.trick = []; leader = w;
    logMsg(room, `Stich ${t + 1}: ${seatName(room, w)} (${tp})`);
  }
  const res = R.score(G);
  for (let i = 0; i < 4; i++) room.bal[i] += res.delta[i];
  G.result = res; G.phase = 'end'; G.status = '';
  logMsg(room, `${res.team.map(x => seatName(room, x)).join(' & ')} ${res.won ? 'gewinnt' : 'verliert'} mit ${res.tp} Augen.`);
}

function playCard(room, p, c) {
  const G = room.G, g = G.game;
  G.hands[p] = G.hands[p].filter(x => x.id !== c.id);
  if (g.type === 'sau' && p === g.partner && G.trick.length === 0 && !g.revealed && c.s === g.suit && !R.isTrump(c, g) && c.r !== 'A') {
    g.ranAway = true; logMsg(room, `${seatName(room, p)} läuft davon.`);
  }
  G.trick.push({ p, card: c }); G.played.push(c);
  if (g.type === 'sau' && c.s === g.suit && c.r === 'A' && !g.revealed) {
    g.revealed = true; logMsg(room, `Die ${R.SUIT_NAME[g.suit]}-Sau ist gefallen: ${seatName(room, p)} spielt mit ${seatName(room, g.decl)}.`);
  }
}

/* =================== Nachrichten =================== */
function onConnection(ws) {
  const conn = { ws, room: null, seat: -1 };
  ws.onmessage = raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    try { handle(conn, m); } catch (e) { console.error(e); sendErr(ws, 'Serverfehler'); }
  };
  ws.onclose = () => leaveConn(conn);
}

function attach(conn, room, seat) {
  if (conn.room) leaveConn(conn);
  conn.room = room; conn.seat = seat; room.conns.add(conn);
  if (seat >= 0) room.seats[seat].conns.add(conn);
}
function leaveConn(conn) {
  const room = conn.room; if (!room) return;
  room.conns.delete(conn);
  if (conn.seat >= 0 && room.seats[conn.seat] && room.seats[conn.seat].conns) room.seats[conn.seat].conns.delete(conn);
  conn.room = null; conn.seat = -1;
  checkReady(room);
  broadcast(room);
}
function freeSeat(room) { return room.seats.findIndex(s => s === null); }
function humanSeat(name, token) { return { name, bot: false, token, conns: new Set() }; }

function handle(conn, m) {
  const ws = conn.ws;
  if (m.t === 'create') {
    const room = createRoom(); const token = newToken();
    room.seats[0] = humanSeat(cleanName(m.name), token); room.host = token;
    attach(conn, room, 0);
    ws.send(JSON.stringify({ t: 'joined', code: room.code, token }));
    return broadcast(room);
  }
  if (m.t === 'join') {
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!room) return sendErr(ws, 'Session nicht gefunden.');
    // Wiederverbinden per Token
    const back = m.token ? room.seats.findIndex(s => s && !s.bot && s.token === m.token) : -1;
    if (back >= 0) { attach(conn, room, back); ws.send(JSON.stringify({ t: 'joined', code: room.code, token: m.token })); checkReady(room); return broadcast(room); }
    const token = newToken();
    let seat = room.started ? -1 : freeSeat(room);
    if (seat >= 0) room.seats[seat] = humanSeat(cleanName(m.name), token);
    attach(conn, room, seat);
    ws.send(JSON.stringify({ t: 'joined', code: room.code, token, name: cleanName(m.name) }));
    return broadcast(room);
  }
  const room = conn.room; if (!room) return sendErr(ws, 'Keine Session.');
  const me = conn.seat;
  const isHost = me >= 0 && room.seats[me] && room.seats[me].token === room.host;

  switch (m.t) {
    case 'takeSeat': { // Zuschauer übernimmt leeren Platz oder Bot-Platz
      const s = +m.seat; if (!(s >= 0 && s < 4) || me >= 0) return;
      const cur = room.seats[s];
      if (cur && !cur.bot) return sendErr(ws, 'Platz ist belegt.');
      const token = newToken();
      room.seats[s] = humanSeat(cleanName(m.name), token);
      conn.seat = s; room.seats[s].conns.add(conn);
      ws.send(JSON.stringify({ t: 'joined', code: room.code, token }));
      return broadcast(room);
    }
    case 'addBot': {
      if (!isHost) return; const s = +m.seat; if (!(s >= 0 && s < 4)) return;
      const cur = room.seats[s];
      if (cur && !cur.bot && cur.conns.size > 0) return sendErr(ws, 'Spieler ist noch online.');
      if (cur && cur.bot) return;
      const keepName = cur ? cur.name + ' (Bot)' : botNameFor(room);
      if (cur) for (const c of cur.conns) { c.seat = -1; }
      room.seats[s] = { name: keepName, bot: true, conns: new Set() };
      if (room.started) resolveWithBot(room, s);
      checkReady(room);
      return broadcast(room);
    }
    case 'kick': {
      if (!isHost || room.started) return; const s = +m.seat; if (!(s >= 0 && s < 4) || s === me) return;
      const cur = room.seats[s]; if (!cur) return;
      for (const c of cur.conns) { c.seat = -1; }
      room.seats[s] = null; return broadcast(room);
    }
    case 'start': {
      if (!isHost || room.started) return;
      if (room.seats.some(s => !s)) return sendErr(ws, 'Alle 4 Plätze müssen belegt sein (Spieler oder Bot).');
      room.started = true; gameLoop(room).catch(e => console.error(e));
      return;
    }
    case 'bid': {
      const w = room.waiting; if (!w || w.p !== me || w.kind !== 'bid') return;
      const bid = m.bid === null ? null : { type: String(m.bid.type), suit: m.bid.suit ? String(m.bid.suit) : null };
      if (!R.validBid(room.G, me, bid)) return sendErr(ws, 'Ungültige Ansage.');
      room.waiting = null; return w.res(bid);
    }
    case 'play': {
      const w = room.waiting; if (!w || w.p !== me || w.kind !== 'play') return;
      const c = room.G.hands[me].find(x => x.id === +m.id);
      if (!c || !R.legal(room.G, me).some(x => x.id === c.id)) return sendErr(ws, 'Die Karte darfst du nicht spielen.');
      room.waiting = null; return w.res(c);
    }
    case 'next': {
      if (me < 0 || !room.readyResolve) return;
      room.ready.add(me); checkReady(room); return broadcast(room);
    }
    case 'resetBal': { if (!isHost) return; room.bal = [0, 0, 0, 0]; return broadcast(room); }
    case 'leave': { // Platz freigeben → Bot übernimmt, wenn Spiel läuft
      if (me >= 0) {
        const cur = room.seats[me];
        if (room.started) { room.seats[me] = { name: cur.name + ' (Bot)', bot: true, conns: new Set() }; resolveWithBot(room, me); }
        else room.seats[me] = null;
        if (cur.token === room.host) { const h = room.seats.find(s => s && !s.bot); room.host = h ? h.token : null; }
      }
      leaveConn(conn); ws.send(JSON.stringify({ t: 'left' }));
      return;
    }
  }
}

/* =================== Wartung =================== */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const online = [...room.conns].length;
    if (online === 0 && now - room.lastActive > ROOM_TTL) { rooms.delete(code); if (room.waiting) room.waiting = null; }
    // Host weg? an nächsten verbundenen Menschen übergeben
    const host = room.seats.find(s => s && s.token === room.host);
    if (!host || host.conns.size === 0) { const h = room.seats.find(s => s && !s.bot && s.conns.size > 0); if (h && h.token !== room.host) { room.host = h.token; broadcast(room); } }
  }
}, 15000);
// Keepalive gegen Proxy-Timeouts
setInterval(() => { for (const room of rooms.values()) for (const c of room.conns) c.ws.ping(); }, 25000);

server.listen(PORT, () => console.log(`Schafkopf läuft auf Port ${PORT}`));
