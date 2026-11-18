'use strict';
// Rauchtest gegen einen laufenden Server (Node >= 22, eingebautes WebSocket, keine Abhängigkeiten).
//   CREATE_PASSWORD=test BOT_DELAY=20 TRICK_DELAY=30 PORT=3999 node server.js
//   node test/smoke.js                       (URL/Passwort: SMOKE_URL, SMOKE_PASSWORD, Runden: SMOKE_ROUNDS)
// Hinweis: Der Test verbraucht alle 5 erlaubten Fehlversuche der eigenen IP. Vor einem zweiten Lauf den Server neu starten.
const URL = process.env.SMOKE_URL || 'ws://localhost:3999/ws';
const PASSWORD = process.env.SMOKE_PASSWORD || 'test';
const ROUNDS = +process.env.SMOKE_ROUNDS || 5;
const TIMEOUT = 120000;

if (typeof WebSocket !== 'function') { console.error('Dieses Node hat kein eingebautes WebSocket (Node 22+ nötig).'); process.exit(2); }

let failed = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failed++; console.log('  ✗ ' + msg); } };
const MONEY_KEYS = ['bal', 'delta', 'value', 'base', 'lauf', 'laufMit', 'tarif', 'euro', 'cent'];
function moneyKeys(obj, found = new Set()) {
  if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) { if (MONEY_KEYS.includes(k)) found.add(k); moneyKeys(v, found); }
  return found;
}

// kleiner Client mit Warteschlange für Nachrichten
function client(name) {
  const ws = new WebSocket(URL);
  const c = { name, ws, msgs: [], waiters: [], state: null, errors: [], onState: null };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'state') { c.state = m; if (c.onState) c.onState(m); }
    if (m.t === 'error') c.errors.push(m.msg);
    const w = c.waiters.findIndex(x => x.pred(m));
    if (w >= 0) c.waiters.splice(w, 1)[0].res(m); else c.msgs.push(m);
  };
  c.send = m => ws.send(JSON.stringify(m));
  c.next = (pred, ms = 5000) => new Promise((res, rej) => {
    const i = c.msgs.findIndex(pred); if (i >= 0) return res(c.msgs.splice(i, 1)[0]);
    const t = setTimeout(() => rej(new Error(`${name}: Zeitüberschreitung`)), ms);
    c.waiters.push({ pred, res: m => { clearTimeout(t); res(m); } });
  });
  c.open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Keine Verbindung zu ' + URL)); });
  return c;
}
const isReply = m => m.t === 'joined' || m.t === 'error';

async function main() {
  console.log('Erstellen mit Passwort');
  const A = client('A'); await A.open;
  A.send({ t: 'create', name: 'Anna', password: 'falsch' });
  let r = await A.next(isReply);
  ok(r.t === 'error' && r.msg === 'Falsches Passwort.', 'falsches Passwort wird abgelehnt (' + (r.msg || r.t) + ')');
  A.send({ t: 'create', name: 'Anna' });
  r = await A.next(isReply);
  ok(r.t === 'error', 'fehlendes Passwort wird abgelehnt');
  A.send({ t: 'create', name: 'Anna', password: PASSWORD });
  r = await A.next(isReply);
  ok(r.t === 'joined' && /^[A-Z0-9]{4}$/.test(r.code), 'richtiges Passwort: Session ' + r.code);
  const code = r.code; A.errors.length = 0; A.msgs.length = 0;

  console.log('Beitreten ohne Passwort, Bots, Start');
  const B = client('B'); await B.open;
  B.send({ t: 'join', code, name: 'Bert' });
  r = await B.next(isReply);
  ok(r.t === 'joined', 'zweiter Client tritt ohne Passwort bei');
  A.send({ t: 'addBot', seat: 2 }); A.send({ t: 'addBot', seat: 3 });
  await new Promise(res => { const chk = () => A.state && A.state.seats.every(Boolean) ? res() : setTimeout(chk, 20); chk(); });
  ok(true, 'zwei Bots aufgefüllt');

  console.log(`Automatisch spielen (${ROUNDS} Runden)`);
  const lastKey = new Map(), money = new Set(); let maxGames = 0, winsSeen = [];
  const done = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('Zeitüberschreitung beim Spielen')), TIMEOUT);
    const auto = c => st => {
      moneyKeys(st).forEach(k => money.add(k));
      if (st.games > maxGames) { maxGames = st.games; winsSeen.push(st.wins.slice()); }
      if (st.games >= ROUNDS) { clearTimeout(t); return res(); }
      // jede Entscheidung nur einmal senden
      // (Handkarten statt nur Anzahl: nach „zamgeschmissen“ wird mit gleicher Rundennummer neu gegeben)
      const key = JSON.stringify([st.round, st.phase, st.waiting, (st.hand || []).map(c => c.id), (st.trick || []).length, st.ready]);
      if (lastKey.get(c) === key) return;
      if (st.waiting === 'bid') { lastKey.set(c, key); c.send({ t: 'bid', bid: null }); }
      else if (st.waiting === 'play') { lastKey.set(c, key); c.send({ t: 'play', id: st.legal[0] }); }
      else if (st.phase === 'end' && st.result && !(st.ready || []).includes(st.you)) { lastKey.set(c, key); c.send({ t: 'next' }); }
    };
    A.onState = auto(A); B.onState = auto(B);
  });
  A.send({ t: 'start' });
  await done;
  const allErr = [...A.errors, ...B.errors];
  ok(allErr.length === 0, 'keine Fehlermeldungen beim Spielen' + (allErr.length ? ': ' + allErr.join(' | ') : ''));
  const st = A.state;
  ok(st.games >= ROUNDS, `Runden gespielt: ${st.games}`);
  const sum = st.wins.reduce((a, b) => a + b, 0);
  ok(sum > 0 && sum >= st.games, `wins steigt: [${st.wins.join(', ')}] (${winsSeen.length} Zwischenstände)`);
  ok(winsSeen.every((w, i) => i === 0 || w.reduce((a, b) => a + b) > winsSeen[i - 1].reduce((a, b) => a + b)), 'Summe der Siege wächst mit jeder Runde');
  ok(money.size === 0, 'kein Geldfeld im State' + (money.size ? ': ' + [...money].join(', ') : ''));
  const res = st.result;
  ok(Array.isArray(res.winners) && 'tp' in res && 'schneider' in res && 'schwarz' in res, 'Ergebnis hat winners, tp, schneider, schwarz');
  A.send({ t: 'resetScore' });
  await new Promise(res => { const chk = () => A.state.games === 0 ? res() : setTimeout(chk, 20); chk(); });
  ok(A.state.wins.every(w => w === 0), 'Host kann den Spielstand zurücksetzen');

  console.log('Brute-Force-Schutz');
  const C = client('C'); await C.open;
  // bisher 2 Fehlversuche (falsch + leer) von dieser IP → noch 3 erlaubt
  for (let i = 0; i < 3; i++) { C.send({ t: 'create', name: 'X', password: 'nope' + i }); r = await C.next(isReply); }
  ok(r.msg === 'Falsches Passwort.', '5. Fehlversuch: noch „Falsches Passwort.“');
  C.send({ t: 'create', name: 'X', password: PASSWORD });
  r = await C.next(isReply);
  ok(r.t === 'error' && r.msg === 'Zu viele Versuche, bitte später erneut.', 'nach 5 Fehlversuchen gesperrt, auch mit richtigem Passwort');

  for (const c of [A, B, C]) c.ws.close();
}

main().then(() => {
  console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : '\nAlles ok.');
  process.exit(failed ? 1 : 0);
}).catch(e => { console.error('\nAbbruch: ' + e.message); process.exit(1); });
