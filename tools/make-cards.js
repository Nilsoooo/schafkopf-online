'use strict';
// Erzeugt den Kartensatz (bayerisches Blatt, eigene Gestaltung) als SVG nach public/cards/.
// Aufruf: node tools/make-cards.js   (keine Abhängigkeiten)
const fs = require('fs');
const path = require('path');

const W = 60, H = 96, MID = H / 2;          // Kartenmaß 1 : 1,6
const OUT = path.join(__dirname, '..', 'public', 'cards');
const INK = '#1a1a1a';

/* ---------- Farbzeichen: [viewBox-Breite, -Höhe, Inhalt] ---------- */
const PIP = {
  // Eichel: Nuss mit grün-gelbem Hütchen und Stiel
  E: [24, 27, '<path d="M12 4.2V1" stroke="#4a2a10" stroke-width="1.6" stroke-linecap="round"/>'
    + '<path d="M6.3 12h11.4c0 6.6-2.8 12.2-5.7 13.8C9.1 24.2 6.3 18.6 6.3 12z" fill="#c98a3a" stroke="#5a3412" stroke-width="1"/>'
    + '<path d="M9.2 15c.2 3.4 1.2 6.3 2.6 8.3" stroke="#f3d9a4" stroke-width="1.2" fill="none" stroke-linecap="round"/>'
    + '<path d="M3.6 12.6C3.6 7.6 7.4 3.8 12 3.8s8.4 3.8 8.4 8.8z" fill="#3d8b3d" stroke="#1f4f1f" stroke-width=".9"/>'
    + '<path d="M5.6 7.8l12.8 4.6M4.4 10.6l9 2M8 4.9l11.7 6.6M12.5 3.9l7 4.4M18.4 7.8L5.6 12.4M19.6 10.6l-9 2M16 4.9L4.3 11.5M11.5 3.9l-7 4.4" stroke="#f2c230" stroke-width=".85"/>'
    + '<path d="M3.6 12.6h16.8" stroke="#1f4f1f" stroke-width="1"/>'],
  // Gras: grünes Blatt mit Stiel
  G: [24, 28, '<path d="M12 22v5.2" stroke="#4a6a1a" stroke-width="1.8" stroke-linecap="round"/>'
    + '<path d="M12 1C6 5.5 3.5 11 4.6 16.5 5.6 21 8.6 22.6 12 22.6s6.4-1.6 7.4-6.1C20.5 11 18 5.5 12 1z" fill="#3c9a3c" stroke="#1f4f1f" stroke-width="1"/>'
    + '<path d="M12 4v18.6M12 10l-4-3M12 10l4-3M12 15l-5-3.5M12 15l5-3.5M12 19.5l-4.5-3M12 19.5l4.5-3" stroke="#1f4f1f" stroke-width="1" fill="none" stroke-linecap="round"/>'],
  // Herz
  H: [24, 24, '<path d="M12 21.5s-8-4.9-10.3-9.9C0 8 2.2 3.6 6.2 3.6c2.4 0 3.9 1.4 5.8 3.8 1.9-2.4 3.4-3.8 5.8-3.8 4 0 6.2 4.4 4.5 8C20 16.6 12 21.5 12 21.5z" fill="#e0302a" stroke="#8e1b1b" stroke-width="1"/>'
    + '<path d="M5 8.5c.5-1.6 1.6-2.4 3-2.4" stroke="#ffb3a8" stroke-width="1.3" fill="none" stroke-linecap="round"/>'],
  // Schellen: runde Schelle, geviertelt Gelb/Rot/Schwarz/Grün, schwarzer Schlitz
  S: [24, 25, '<circle cx="12" cy="2.3" r="1.4" fill="none" stroke="#5a3a05" stroke-width="1"/>'
    + '<clipPath id="sc"><circle cx="12" cy="13.5" r="9.6"/></clipPath>'
    + '<g clip-path="url(#sc)"><rect x="0" y="0" width="24" height="9" fill="#f2c230"/><rect x="0" y="9" width="24" height="3.6" fill="#e0302a"/>'
    + '<rect x="0" y="12.6" width="24" height="2" fill="#1a1a1a"/><rect x="0" y="14.6" width="24" height="12" fill="#3d8b3d"/></g>'
    + '<path d="M8.2 19.2Q12 21.4 15.8 19.2" stroke="#1a1a1a" stroke-width="1.7" fill="none" stroke-linecap="round"/><circle cx="12" cy="20.3" r="1.2" fill="#1a1a1a"/>'
    + '<circle cx="8.6" cy="7" r="1.5" fill="#fff6c8" opacity=".85"/>'
    + '<circle cx="12" cy="13.5" r="9.6" fill="none" stroke="#5a3a05" stroke-width="1"/>'],
};
let uid = 0;
function pip(s, cx, cy, w, rot) {
  const [vw, vh, raw] = PIP[s]; const h = w * vh / vw;
  const inner = raw.replace(/id="sc"/g, `id="sc${++uid}"`).replace(/url\(#sc\)/g, `url(#sc${uid})`);
  const svg = `<svg x="${r2(cx - w / 2)}" y="${r2(cy - h / 2)}" width="${r2(w)}" height="${r2(h)}" viewBox="0 0 ${vw} ${vh}">${inner}</svg>`;
  return rot ? `<g transform="rotate(180 ${r2(cx)} ${r2(cy)})">${svg}</g>` : svg;
}
const r2 = n => Math.round(n * 100) / 100;

/* ---------- Zahlkarten: klassische Anordnung (y bezogen auf Höhe 90, wird skaliert) ---------- */
const LAYOUT = {
  '7': [[19, 18], [41, 18], [30, 31], [19, 45], [41, 45], [19, 72], [41, 72]],
  '8': [[19, 16], [41, 16], [19, 35], [41, 35], [19, 55], [41, 55], [19, 74], [41, 74]],
  '9': [[20, 20], [31.5, 20], [43, 20], [17, 45], [30, 45], [43, 45], [17, 70], [28.5, 70], [40, 70]],
  '10': [[19, 15], [41, 15], [30, 25], [19, 35], [41, 35], [19, 55], [41, 55], [30, 65], [19, 75], [41, 75]],
};
const SY = H / 90;

/* ---------- Figurenkarten: obere Hälfte, die untere ist dieselbe um 180° gedreht ---------- */
const VEST = { E: '#b8452a', G: '#2f7d32', H: '#c62828', S: '#d89a1a' };
const SLEEVE = { E: '#3d8b3d', G: '#c62828', H: '#3d8b3d', S: '#2f6fb0' };
const OL = 'stroke="#3a2a1a" stroke-width=".5"';
function figHalf(r, s) {
  const v = VEST[s], sl = SLEEVE[s], skin = '#f3cfa7', gold = '#f2c230';
  const hair = r === 'K' ? '#e6e0d2' : r === 'O' ? '#c08a34' : '#7a4a1c';
  const arm = (x2, y2) => `<path d="M41.5 31L${x2} ${y2}" stroke="#3a2a1a" stroke-width="5.6" stroke-linecap="round"/><path d="M41.5 31L${x2} ${y2}" stroke="${sl}" stroke-width="4.6" stroke-linecap="round"/>`;
  let o = '';
  o += r === 'K' ? `<path d="M24 15Q23 23 22 26L38 26Q37 23 36 15Z" fill="${hair}" ${OL}/>`
    : `<path d="M23.5 14Q22 27 18.5 31L41.5 31Q38 27 36.5 14Z" fill="${hair}" ${OL}/>`;
  o += `<path d="M19 31Q14 35 13 45L19.5 45Z" fill="${sl}" ${OL}/>`;
  o += `<path d="M17.5 45L18.5 31Q20 27 26 26L34 26Q40 27 41.5 31L42.5 45Z" fill="${v}" ${OL}/>`;
  o += `<path d="M27.5 26H32.5V45H27.5Z" fill="${gold}" ${OL}/>`;
  o += [30, 34, 38, 42].map(y => `<circle cx="30" cy="${y}" r=".9" fill="#3a2a1a"/>`).join('');
  o += `<path d="M22 37Q30 39.5 38 37" stroke="${gold}" stroke-width="1.4" fill="none"/>`;
  if (r === 'O') o += arm(45, 17) + `<circle cx="45.3" cy="15.6" r="2.2" fill="${skin}" ${OL}/>` + pip(s, 46, 9, 11);
  else if (r === 'U') o += arm(45, 39) + `<circle cx="45.4" cy="40.2" r="2.2" fill="${skin}" ${OL}/>` + pip(s, 48, 31, 11);
  else o += `<path d="M46.5 44L48 17" stroke="#8a6a10" stroke-width="1.4"/><circle cx="48.1" cy="16" r="1.6" fill="${gold}" ${OL}/>`
    + arm(46, 40) + `<circle cx="46.6" cy="41" r="2.2" fill="${skin}" ${OL}/>` + pip(s, 47, 8.5, 9);
  o += `<ellipse cx="30" cy="26" rx="7" ry="2.2" fill="#fff" ${OL}/>`;
  o += `<ellipse cx="30" cy="18" rx="5.2" ry="6.3" fill="${skin}" ${OL}/>`;
  o += `<circle cx="28" cy="17.3" r=".65" fill="#2a1a0a"/><circle cx="32" cy="17.3" r=".65" fill="#2a1a0a"/>`
    + `<path d="M27 15.8h2M31 15.8h2" stroke="${r === 'K' ? '#999' : '#5a3a1a'}" stroke-width=".5"/><path d="M30 18v2.2h.8" stroke="#b07a5a" stroke-width=".5" fill="none"/>`;
  if (r === 'K') o += `<path d="M24.8 19.5Q25 27.5 30 28Q35 27.5 35.2 19.5Q33 23.5 30 23.5Q27 23.5 24.8 19.5Z" fill="${hair}" ${OL}/><path d="M27.5 22.3Q30 21.4 32.5 22.3" stroke="#bdb5a3" stroke-width=".7" fill="none"/>`;
  else o += `<path d="M28.6 22.3Q30 23 31.4 22.3" stroke="#a0442e" stroke-width=".6" fill="none"/><path d="M24.8 16Q25.5 11.5 30 11.5Q34.5 11.5 35.2 16Q33 13.8 30 13.6Q27 13.8 24.8 16Z" fill="${hair}" ${OL}/>`;
  if (r === 'K') o += `<path d="M24 14L23.5 6.5L26.8 9.8L30 5L33.2 9.8L36.5 6.5L36 14Z" fill="${gold}" ${OL}/><path d="M24 12.6H36" stroke="#8a6a10" stroke-width=".6"/><circle cx="30" cy="10.6" r=".9" fill="#c62828"/><circle cx="26.4" cy="11.4" r=".6" fill="#2f6fb0"/><circle cx="33.6" cy="11.4" r=".6" fill="#2f6fb0"/>`;
  else if (r === 'O') o += `<path d="M24.5 12.3Q24.5 6 30 6Q35.5 6 35.5 12.3Z" fill="${v}" ${OL}/><ellipse cx="30" cy="12.3" rx="8.5" ry="2.1" fill="#2b2b2b"/><path d="M34.5 8Q38 4.5 41 5" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M34.5 8Q38 4.5 41 5" stroke="#3a2a1a" stroke-width=".3" fill="none"/>`;
  else o += `<path d="M22 12.8Q23 7 30.5 7.4Q37.5 8 38 12.4Q30 10.6 22 12.8Z" fill="${sl}" ${OL}/><path d="M23 12.4Q30 10.9 37.5 12.1" stroke="${gold}" stroke-width=".9" fill="none"/>`;
  return `<g transform="translate(0 3)">${o}</g>`;
}

/* ---------- Karte zusammensetzen ---------- */
const rot = x => `<g transform="rotate(180 ${W / 2} ${MID})">${x}</g>`;
function corner(s, r) {
  const big = r !== '10';
  return `<text x="8.3" y="13" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="${big ? 11.5 : 9}" fill="${INK}">${r}</text>` + pip(s, 8.3, 19.5, 7);
}
function frame() {
  return `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="4" fill="#fff" stroke="#bbb" stroke-width=".6"/>`
    + `<rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="2.2" fill="none" stroke="${INK}" stroke-width=".55"/>`;
}
function card(s, r) {
  uid = 0;
  let o = frame();
  if (r === 'K' || r === 'O' || r === 'U') {
    const h = figHalf(r, s);
    o += h + rot(h) + `<path d="M3 ${MID}H${W - 3}" stroke="${INK}" stroke-width=".55"/>`;
  } else if (r === 'A') {
    o += `<path d="M30 ${69 * SY}Q22 ${72 * SY} 17 ${78 * SY}M30 ${69 * SY}Q36 ${72 * SY} 40 ${75 * SY}" stroke="#3d8b3d" stroke-width="1.4" fill="none"/>`
      + `<path d="M17 ${78 * SY}q-3-4 0-7q3 3 0 7zM40 ${75 * SY}q4-3 6 1q-4 2-6-1z" fill="#3d8b3d"/>`;
    o += `<path d="M14 ${80 * SY}Q21.5 ${74.5 * SY} 29 ${78 * SY}Q36.5 ${81.5 * SY} 43.5 ${76 * SY}L44 ${82 * SY}Q36.5 ${87.5 * SY} 29 ${84 * SY}Q21.5 ${80.5 * SY} 13.5 ${86 * SY}Z" fill="${VEST[s]}" stroke="#3a2a1a" stroke-width=".5"/>`;
    o += pip(s, 30, 40 * SY, 30);
  } else {
    o += LAYOUT[r].map(([x, y]) => pip(s, x, y * SY, r === '9' || r === '10' ? 10 : 11, y > 45)).join('');
  }
  const k = corner(s, r); o += k + rot(k);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 4}" height="${H * 4}">${o}</svg>\n`;
}
function back() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 4}" height="${H * 4}">`
    + `<defs><pattern id="d" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#23467f"/>`
    + `<path d="M3 0L6 3L3 6L0 3Z" fill="#2f5da3"/><path d="M3 1.4L4.6 3L3 4.6L1.4 3Z" fill="#1a3563"/><circle cx="0" cy="0" r=".55" fill="#e8d9a8"/><circle cx="6" cy="6" r=".55" fill="#e8d9a8"/><circle cx="6" cy="0" r=".55" fill="#e8d9a8"/><circle cx="0" cy="6" r=".55" fill="#e8d9a8"/></pattern></defs>`
    + `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="4" fill="#fff" stroke="#bbb" stroke-width=".6"/>`
    + `<rect x="3.5" y="3.5" width="${W - 7}" height="${H - 7}" rx="2.2" fill="url(#d)" stroke="#1a3563" stroke-width=".8"/>`
    + `<rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="1.5" fill="none" stroke="#e8d9a8" stroke-width=".5"/>`
    + `</svg>\n`;
}

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const s of ['E', 'G', 'H', 'S']) for (const r of ['A', '10', 'K', 'O', 'U', '9', '8', '7']) {
  const svg = card(s, r); fs.writeFileSync(path.join(OUT, `${s}${r}.svg`), svg); total += svg.length;
}
const b = back(); fs.writeFileSync(path.join(OUT, 'back.svg'), b); total += b.length;
console.log(`33 Karten nach ${OUT} geschrieben (${(total / 1024).toFixed(1)} KB)`);
