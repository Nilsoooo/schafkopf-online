'use strict';
// Schafkopf-Regeln und Bot-Logik (serverseitig, autoritativ)

const SUITS = ['E', 'G', 'H', 'S'];
const SUIT_NAME = { E: 'Eichel', G: 'Gras', H: 'Herz', S: 'Schellen' };
const SUIT_ORD = { E: 4, G: 3, H: 2, S: 1 };
const RANKS = ['A', '10', 'K', 'O', 'U', '9', '8', '7'];
const PTS = { A: 11, '10': 10, K: 4, O: 3, U: 2, '9': 0, '8': 0, '7': 0 };
const PLAIN = { A: 8, '10': 7, K: 6, O: 5, U: 4, '9': 3, '8': 2, '7': 1 };
const LEVEL = { sau: 1, wenz: 2, solo: 3 };
const TARIF = { sau: 10, wenz: 50, solo: 50, extra: 10 };

function makeDeck() { const d = []; let id = 0; for (const s of SUITS) for (const r of RANKS) d.push({ s, r, id: id++ }); return d; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function trumpSuitOf(g) { return g.type === 'sau' ? 'H' : g.type === 'solo' ? g.suit : null; }
function isTrump(c, g) { if (g.type === 'wenz') return c.r === 'U'; return c.r === 'O' || c.r === 'U' || c.s === trumpSuitOf(g); }
function trumpRank(c) { if (c.r === 'O') return 40 + SUIT_ORD[c.s]; if (c.r === 'U') return 30 + SUIT_ORD[c.s]; return 10 + PLAIN[c.r]; }
function eff(c, g) { return isTrump(c, g) ? 'T' : c.s; }
function power(c, g, lead) { if (isTrump(c, g)) return 100 + trumpRank(c); if (c.s === lead) return PLAIN[c.r]; return 0; }
function winnerIdx(trick, g) { const lead = eff(trick[0].card, g); let bi = 0, bp = -1; trick.forEach((t, i) => { const p = power(t.card, g, lead); if (p > bp) { bp = p; bi = i; } }); return bi; }
function pts(cards) { return cards.reduce((a, c) => a + PTS[c.r], 0); }
function allTrumps(g) { return makeDeck().filter(c => isTrump(c, g)).sort((a, b) => trumpRank(b) - trumpRank(a)); }
function gameName(g) { if (g.type === 'sau') return `Sauspiel auf die ${SUIT_NAME[g.suit]}-Sau`; if (g.type === 'wenz') return 'Wenz'; return `${SUIT_NAME[g.suit]}-Solo`; }

function canCallSau(hand, suit) {
  const g = { type: 'sau' };
  if (!['E', 'G', 'S'].includes(suit)) return false;
  if (hand.some(c => c.s === suit && c.r === 'A')) return false;
  return hand.some(c => c.s === suit && !isTrump(c, g));
}

function validBid(G, p, bid) {
  if (bid === null) return true;
  if (!bid || !LEVEL[bid.type]) return false;
  const lvl = G.best ? LEVEL[G.best.type] : 0;
  if (LEVEL[bid.type] <= lvl) return false;
  if (bid.type === 'sau') return canCallSau(G.hands[p], bid.suit);
  if (bid.type === 'solo') return SUITS.includes(bid.suit);
  return true;
}

function sortHand(hand, g) {
  g = g || { type: 'sau' };
  const order = { E: 4, G: 3, S: 2, H: 1 };
  const key = c => isTrump(c, g) ? 1000 + trumpRank(c) : order[c.s] * 100 + PLAIN[c.r];
  return hand.sort((a, b) => key(b) - key(a));
}

function legal(G, p) {
  const hand = G.hands[p], g = G.game, trick = G.trick;
  const ace = (g.type === 'sau' && p === g.partner && !g.ranAway) ? hand.find(c => c.s === g.suit && c.r === 'A') : null;
  if (trick.length === 0) {
    if (ace) {
      const suitCards = hand.filter(c => c.s === g.suit && !isTrump(c, g));
      if (suitCards.length >= 4) return hand.slice();
      return hand.filter(c => !(c.s === g.suit && !isTrump(c, g) && c.r !== 'A'));
    }
    return hand.slice();
  }
  const lead = eff(trick[0].card, g);
  const follow = hand.filter(c => eff(c, g) === lead);
  if (follow.length) { if (ace && lead === g.suit) return [ace]; return follow; }
  if (ace && hand.length > 1) return hand.filter(c => c !== ace);
  return hand.slice();
}

/* ---------- Bots: Reizen ---------- */
function evalNormal(hand, suit) {
  const g = { type: 'solo', suit }; let t = 0, str = 0;
  for (const c of hand) {
    if (isTrump(c, g)) { t++; str += c.r === 'O' ? (c.s === 'E' || c.s === 'G' ? 3.5 : 3) : c.r === 'U' ? 2 : (c.r === 'A' || c.r === '10') ? 1.5 : 1; }
    else if (c.r === 'A') str += 1.5;
    else if (c.r === '10' && hand.some(x => x.s === c.s && x.r === 'A')) str += .5;
  }
  const voids = SUITS.filter(s => s !== suit && !hand.some(c => c.s === s && !isTrump(c, g))).length;
  return { t, str, voids };
}
function evalWenz(hand) {
  const UV = { E: 4, G: 3.5, H: 3, S: 2.5 }; let u = 0, str = 0;
  for (const c of hand) if (c.r === 'U') { u++; str += UV[c.s]; }
  for (const s of SUITS) {
    const cs = hand.filter(c => c.s === s && c.r !== 'U');
    const a = cs.some(c => c.r === 'A'), z = cs.some(c => c.r === '10');
    if (a) { str += 2; if (z) str += 1.5; if (cs.length >= 3) str += .5 * (cs.length - 2); } else if (z && cs.length === 1) str -= 1;
  }
  return { u, str, hasUE: hand.some(c => c.r === 'U' && c.s === 'E') };
}
function botBid(G, p) {
  const h = G.hands[p], lvl = G.best ? LEVEL[G.best.type] : 0;
  if (lvl < 3) {
    let bs = null, bv = 0;
    for (const s of SUITS) { const e = evalNormal(h, s); const v = e.str + e.voids * .7; if ((e.t >= 6 && v >= 15.5) || (e.t >= 7 && v >= 13.5)) { if (v > bv) { bv = v; bs = s; } } }
    if (bs) return { type: 'solo', suit: bs };
  }
  if (lvl < 2) { const w = evalWenz(h); if (w.u >= 2 && w.str >= 13 && (w.u >= 3 || w.hasUE)) return { type: 'wenz', suit: null }; }
  if (lvl < 1) {
    const e = evalNormal(h, 'H');
    if ((e.t >= 4 && e.str >= 9.5) || (e.t >= 5 && e.str >= 8.5)) {
      const n = s => h.filter(c => c.s === s && c.r !== 'O' && c.r !== 'U').length;
      const opts = ['E', 'G', 'S'].filter(s => canCallSau(h, s)).sort((a, b) => n(a) - n(b));
      if (opts.length) return { type: 'sau', suit: opts[0] };
    }
  }
  return null;
}

/* ---------- Bots: Spielen ---------- */
function friend(G, p, q) {
  const g = G.game; if (p === q) return true;
  if (g.type !== 'sau') return (p === g.decl) === (q === g.decl);
  const team = [g.decl, g.partner];
  if (g.revealed) return team.includes(p) === team.includes(q);
  if (p === g.partner) return team.includes(q);
  return false;
}
function keepVal(G, c) { return isTrump(c, G.game) ? 10 + trumpRank(c) / 2 : PLAIN[c.r]; }
function lowCard(G, cards) { return cards.slice().sort((a, b) => (PTS[a.r] * 2 + keepVal(G, a)) - (PTS[b.r] * 2 + keepVal(G, b)))[0]; }
function smearCard(G, cards) { const g = G.game; const sc = c => PTS[c.r] * 2 - (isTrump(c, g) ? trumpRank(c) * .6 : 0); return cards.slice().sort((a, b) => sc(b) - sc(a))[0]; }
function unseen(G, p) { const seen = new Set([...G.played, ...G.hands[p], ...G.trick.map(t => t.card)].map(c => c.id)); return makeDeck().filter(c => !seen.has(c.id)); }
function isTopCard(G, c, p, lead) { const g = G.game; const myP = power(c, g, lead); return !unseen(G, p).some(x => power(x, g, lead) > myP && (isTrump(x, g) || x.s === lead)); }

function botPlay(G, p) {
  const g = G.game, L = legal(G, p);
  if (L.length === 1) return L[0];
  const trumps = L.filter(c => isTrump(c, g)), plain = L.filter(c => !isTrump(c, g));
  const declSide = p === g.decl || (g.type === 'sau' && p === g.partner);
  if (G.trick.length === 0) {
    if (declSide) {
      const enemyTrumps = unseen(G, p).filter(c => isTrump(c, g)).length;
      if (trumps.length && enemyTrumps > 0 && (g.type !== 'sau' || trumps.length >= 2 || p === g.decl)) {
        const top = trumps.slice().sort((a, b) => trumpRank(b) - trumpRank(a));
        return isTopCard(G, top[0], p, 'T') || g.type !== 'sau' ? top[0] : top[top.length - 1];
      }
      const aces = plain.filter(c => c.r === 'A' && !(g.type === 'sau' && c.s === g.suit && p === g.decl));
      if (aces.length) return aces[0];
      if (plain.length) return lowCard(G, plain);
      return trumps.sort((a, b) => trumpRank(b) - trumpRank(a))[0];
    }
    if (g.type === 'sau' && !g.revealed) { const call = plain.filter(c => c.s === g.suit); if (call.length) return lowCard(G, call); }
    const aces = plain.filter(c => c.r === 'A' && !G.played.some(x => x.s === c.s && !isTrump(x, g)));
    if (aces.length) return aces[0];
    if (plain.length) return lowCard(G, plain);
    return lowCard(G, trumps);
  }
  const lead = eff(G.trick[0].card, g);
  const w = G.trick[winnerIdx(G.trick, g)];
  const bestP = power(w.card, g, lead);
  const isLast = G.trick.length === 3;
  const trickPts = pts(G.trick.map(t => t.card));
  const remaining = []; for (let k = 1; k < 4 - G.trick.length; k++) remaining.push((p + k) % 4);
  const winners = L.filter(c => power(c, g, lead) > bestP);
  if (friend(G, p, w.p)) {
    const secure = isLast || remaining.every(q => friend(G, p, q)) || isTopCard(G, w.card, p, lead);
    return secure ? smearCard(G, L) : lowCard(G, L);
  }
  if (winners.length) {
    const cheapest = arr => arr.slice().sort((a, b) => keepVal(G, a) - keepVal(G, b))[0];
    const secureW = winners.filter(c => isLast || remaining.every(q => friend(G, p, q)) || isTopCard(G, c, p, lead));
    if (secureW.length && (trickPts >= 3 || !isTrump(cheapest(secureW), g) || (isLast && trickPts > 0))) return cheapest(secureW);
    if (trickPts >= 10) return cheapest(winners);
    if (isLast && trickPts > 0) return cheapest(winners);
  }
  return lowCard(G, L);
}

/* ---------- Abrechnung ---------- */
function score(G) {
  const g = G.game;
  const team = g.type === 'sau' ? [g.decl, g.partner] : [g.decl];
  const others = [0, 1, 2, 3].filter(x => !team.includes(x));
  const tp = team.reduce((a, p) => a + pts(G.won[p]), 0);
  const tt = team.reduce((a, p) => a + G.tricks[p], 0);
  const won = tp >= 61;
  const schneider = won ? tp >= 91 : tp <= 30;
  const schwarz = won ? tt === 8 : tt === 0;
  const order = allTrumps(g);
  const holder = c => G.initial.findIndex(h => h.some(x => x.id === c.id));
  const first = team.includes(holder(order[0])); let n = 0;
  for (const c of order) { if (team.includes(holder(c)) === first) n++; else break; }
  const lauf = n >= (g.type === 'wenz' ? 2 : 3) ? n : 0;
  const base = TARIF[g.type];
  const value = base + (schneider ? TARIF.extra : 0) + (schwarz ? TARIF.extra : 0) + lauf * TARIF.extra;
  const delta = [0, 0, 0, 0];
  if (g.type === 'sau') { for (const p of team) delta[p] = won ? value : -value; for (const p of others) delta[p] = won ? -value : value; }
  else { delta[g.decl] = won ? 3 * value : -3 * value; for (const p of others) delta[p] = won ? -value : value; }
  return { team, tp, won, schneider, schwarz, lauf, laufMit: first, base, value, delta };
}

module.exports = {
  SUITS, SUIT_NAME, LEVEL, makeDeck, shuffle, isTrump, winnerIdx, pts, gameName, canCallSau, validBid,
  sortHand, legal, botBid, botPlay, score,
};
