// Preview + QA page for /js/room.js: rooms at several sizes and styles, the
// galleries of walls, floors, views, lights, seasons and earned decor,
// stand-ins (people and cats) to check the layers, a debug overlay of every
// layout rect, and a size sweep that asserts the layout contract.
import { layoutRoom, paintRoom, paintWallOnly, roomPhase } from '/js/room.js';
import { cat, CAT_W, CAT_H } from '/js/cat.js';

const INK = '#2b2a5e';
const $ = (id) => document.getElementById(id);
const out = $('out');
const timingEl = $('timing');
const errEl = $('err');
const sweepEl = $('sweep');
const params = new URLSearchParams(location.search);
const debugBox = $('debug');
const peopleBox = $('people');
const hourInput = $('hour');
const hourOut = $('hourOut');
debugBox.checked = params.get('debug') === '1';

addEventListener('error', (e) => {
  errEl.textContent += `error: ${e.message}\n`;
});
addEventListener('unhandledrejection', (e) => {
  errEl.textContent += `rejection: ${e.reason}\n`;
});

const at = (h, m = 0, mo = 9, d = 5) => new Date(2026, mo, d, h, m);
const BASE = { dayOffset: 0, deskBusy: [true, false, true], binCount: 0, fridgeCount: 0, eggCount: 2, boardBars: [0.3, 0.6, 0.45, 0.8] };
const EARN = { none: { trophies: 0, plant: 0, books: 0 }, mid: { trophies: 3, plant: 2, books: 4 }, max: { trophies: 9, plant: 5, books: 12 } };
const STATES = {
  day: { ...BASE, now: at(11, 10) },
  night: { ...BASE, now: at(22, 40), deskBusy: [false, true, false], binCount: 2, fridgeCount: 1, eggCount: 0, boardBars: [0.2, 0.5] },
  busy: { ...BASE, now: at(18, 40), dayOffset: 26, deskBusy: [true, true, true], binCount: 3, fridgeCount: 2, eggCount: 6, boardBars: [0.2, 0.55, 0.4, 0.9, 0.7, 0.35, 1] },
};

// the main rooms: sizes × a spread of styles
const SCENES = [
  { W: 300, H: 170, s: 3, st: 'busy', style: {}, earned: EARN.max, music: true, label: 'smallest · default style · busy · max decor · music' },
  { W: 316, H: 190, s: 3, st: 'day', style: { wall: 'mint', floor: 'checker', view: 'beach' }, earned: EARN.none, label: 'armchair on the floor · mint/checker/beach' },
  { W: 350, H: 200, s: 3, st: 'day', style: { wall: 'peach', floor: 'carpet', view: 'mountains', light: 'golden' }, earned: EARN.mid, label: 'narrow · peach/carpet/mountains · golden' },
  { W: 420, H: 220, s: 3, st: 'night', style: { wall: 'sky', floor: 'tatami', view: 'rain' }, earned: EARN.max, music: true, label: 'sky/tatami/rain · night · music' },
  { W: 480, H: 230, s: 3, st: 'busy', style: { wall: 'butter', floor: 'wood', view: 'stars' }, earned: EARN.mid, label: 'butter/wood/stars · busy +26 days' },
  { W: 560, H: 240, s: 2, st: 'day', style: { wall: 'cocoa', floor: 'checker', view: 'space', light: 'night' }, earned: EARN.max, music: true, label: 'cocoa/checker/space · forced night' },
  { W: 720, H: 260, s: 2, st: 'day', style: { wall: 'lilac', floor: 'carpet', view: 'garden' }, earned: EARN.max, meeting: true, label: 'lilac/carpet/garden · town meeting' },
  { W: 720, H: 280, s: 2, st: 'busy', style: { wall: 'mint', floor: 'tatami', view: 'city', light: 'day' }, earned: EARN.mid, label: 'tallest · mint/tatami/city · forced day' },
  { W: 480, H: 230, s: 3, st: 'custom', style: {}, earned: null, label: 'custom hour (slider) · no style/earned given = the original look' },
];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mk(W, H, s, cls) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.style.width = `${W * s}px`;
  c.style.height = `${H * s}px`;
  if (cls) c.className = cls;
  return c;
}

// a 20x28 stand-in with a face and a red waist line at y-16
function person(ctx, x, y, col, back = false) {
  ctx.fillStyle = INK;
  ctx.fillRect(x - 10, y - 28, 20, 28);
  ctx.fillStyle = col;
  ctx.fillRect(x - 9, y - 27, 18, 26);
  if (!back) {
    ctx.fillStyle = INK;
    ctx.fillRect(x - 4, y - 23, 2, 2);
    ctx.fillRect(x + 2, y - 23, 2, 2);
    ctx.fillRect(x - 2, y - 20, 4, 1);
  }
  ctx.fillStyle = '#ff2d55';
  ctx.fillRect(x - 10, y - 16, 20, 1);
  ctx.fillStyle = 'rgba(43,42,94,0.35)';
  for (let yy = y - 14; yy < y; yy += 3) ctx.fillRect(x - 9, yy, 18, 1);
}
function napper(ctx, x, y, col) {
  ctx.fillStyle = INK;
  ctx.fillRect(x - 14, y - 20, 28, 20);
  ctx.fillStyle = col;
  ctx.fillRect(x - 13, y - 19, 26, 18);
  ctx.fillStyle = INK;
  ctx.fillRect(x + 6, y - 13, 3, 1);
  ctx.fillRect(x + 1, y - 13, 3, 1);
}
function egg(ctx, x, y, col) {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(x, y - 7, 5.5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(x, y - 7, 4.5, 6, 0, 0, Math.PI * 2);
  ctx.fill();
}

const COLS = ['#ffb3d1', '#ffe27a', '#c9b6ff', '#c6ef6a', '#a9dcff', '#ffc9a3', '#a8f0d4'];
const CATS = [0, 1, 2, 4, 15, 16].map((s) => cat(s));

function drawPeople(L, sc, st, seated, top) {
  const a = seated.getContext('2d');
  const b = top.getContext('2d');
  a.clearRect(0, 0, L.W, L.H);
  b.clearRect(0, 0, L.W, L.H);
  if (!peopleBox.checked) return;
  if (sc.meeting) {
    // everyone gathers to face the board
    L.meeting.forEach((m, i) => person(b, m.x, m.y, COLS[i % COLS.length], true));
    L.desks.forEach((d, i) => b.drawImage(CATS[i].sleep, d.cat.x - (CAT_W >> 1), d.cat.y - CAT_H));
    return;
  }
  L.desks.forEach((d, i) => {
    if (st.deskBusy[i]) person(a, d.seat.x, d.seat.y, COLS[i]);
    // a cat napping on every monitor, to check the spot
    b.drawImage(CATS[(i + sc.W) % CATS.length].sleep, d.cat.x - (CAT_W >> 1), d.cat.y - CAT_H);
  });
  L.sofa.seats.forEach((s, i) => {
    if (i !== 1 || st.deskBusy.every(Boolean)) person(a, s.x, s.y, COLS[3 + i]);
  });
  person(a, L.chair.x, L.chair.y, '#ffffff');
  for (let i = 0; i < Math.min(st.eggCount, L.nest.slots.length); i++) {
    const s = L.nest.slots[i];
    egg(b, s.x, s.y, COLS[i % COLS.length]);
  }
  L.naps.slice(0, 2).forEach((n, i) => napper(b, n.x, n.y, COLS[(i + 4) % COLS.length]));
  const r = rng(L.W * 7 + L.H);
  const walkers = Array.from({ length: Math.round(L.W / 90) }, () => ({
    x: Math.round(L.walk.left + 10 + r() * (L.walk.right - L.walk.left - 20)),
    y: Math.round(L.walk.top + r() * (L.walk.bottom - L.walk.top)),
  })).sort((p, q) => p.y - q.y);
  walkers.forEach((w, i) => person(b, w.x, w.y, COLS[(i + 2) % COLS.length]));
  // a cat strolling on the floor
  const c = CATS[sc.W % CATS.length];
  b.drawImage(c.walk[0], L.walk.left + 30, L.walk.bottom - 4 - CAT_H);
  b.drawImage(c.sit, L.walk.right - 60, L.walk.top + 14 - CAT_H);
}

function drawDebug(L, c, s) {
  const d = c.getContext('2d');
  d.clearRect(0, 0, c.width, c.height);
  if (!debugBox.checked) return;
  d.save();
  d.lineWidth = 1;
  const rect = (r, col, dash, fill) => {
    d.setLineDash(dash || []);
    if (fill) {
      d.fillStyle = fill;
      d.fillRect(r.x * s, r.y * s, r.w * s, r.h * s);
    }
    d.strokeStyle = col;
    d.strokeRect(r.x * s + 0.5, r.y * s + 0.5, r.w * s - 1, r.h * s - 1);
  };
  const mark = (x, y, col, size = 3) => {
    d.strokeStyle = col;
    d.setLineDash([]);
    d.beginPath();
    d.moveTo((x - size) * s, y * s + 0.5);
    d.lineTo((x + size) * s, y * s + 0.5);
    d.moveTo(x * s + 0.5, (y - size) * s);
    d.lineTo(x * s + 0.5, (y + size) * s);
    d.stroke();
  };
  d.strokeStyle = 'rgba(0,90,255,.6)';
  d.setLineDash([4, 4]);
  d.beginPath();
  d.moveTo(0, L.floorY * s + 0.5);
  d.lineTo(L.W * s, L.floorY * s + 0.5);
  d.stroke();
  const w = L.walk;
  rect({ x: w.left, y: w.top, w: w.right - w.left, h: w.bottom - w.top }, 'rgba(0,160,90,.9)', [6, 3], 'rgba(0,200,120,.08)');
  const gh = L.ghosts;
  rect({ x: gh.left, y: gh.top, w: gh.right - gh.left, h: gh.bottom - gh.top }, 'rgba(0,170,255,.9)', [2, 3]);
  d.font = `${Math.max(10, s * 3.4)}px ui-monospace, Consolas, monospace`;
  d.textBaseline = 'top';
  for (const h of L.hotspots) {
    rect(h, '#ff00aa');
    const tw = d.measureText(h.id).width;
    d.fillStyle = 'rgba(255,0,170,.85)';
    d.fillRect(h.x * s, h.y * s, tw + 4, s * 3.4 + 2);
    d.fillStyle = '#fff';
    d.fillText(h.id, h.x * s + 2, h.y * s + 1);
  }
  rect(L.sign, '#ff7a00', [], 'rgba(255,122,0,.18)');
  rect(L.boardText, '#00b8d9', [4, 2], 'rgba(0,184,217,.12)');
  for (const p of L.boardPins) rect({ x: p.x, y: p.y, w: 14, h: 12 }, '#d4a000', [], 'rgba(255,214,0,.25)');
  for (const p of L.wallSpots) rect(p, '#00a060', [], 'rgba(0,200,110,.28)');
  for (const k of L.desks) {
    rect(k.screen, '#2070ff', [], 'rgba(32,112,255,.2)');
    rect({ x: k.cat.x - (CAT_W >> 1), y: k.cat.y - CAT_H, w: CAT_W, h: CAT_H }, '#8a5a2b', [2, 2]);
    mark(k.cat.x, k.cat.y, '#8a5a2b', 2);
    mark(k.seat.x, k.seat.y, '#ff2020', 4);
  }
  L.sofa.seats.forEach((k) => mark(k.x, k.y, '#ff2020', 4));
  mark(L.chair.x, L.chair.y, '#ff0000', 6);
  L.naps.forEach((k) => mark(k.x, k.y, '#ff8a00', 4));
  L.nest.slots.forEach((k) => mark(k.x, k.y, '#d4a000', 2));
  d.fillStyle = '#8a2be2';
  for (const m of L.meeting) d.fillRect(m.x * s - 3, m.y * s - 3, 6, 6);
  d.restore();
}

function stateFor(sc) {
  const base = sc.st === 'custom' ? customState() : STATES[sc.st];
  const st = { ...base };
  if (sc.style) st.style = sc.style;
  if (sc.earned) st.earned = sc.earned;
  if (sc.music) st.music = true;
  return st;
}
function customState() {
  const hv = Number(hourInput.value);
  const hh = Math.floor(hv);
  const mm = Math.round((hv - hh) * 60);
  hourOut.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  return { ...STATES.day, now: at(hh, mm), deskBusy: [true, true, false], eggCount: 3, binCount: 1, fridgeCount: 1 };
}

const scenes = [];
for (const sc of SCENES) {
  const L = layoutRoom(sc.W, sc.H);
  const card = document.createElement('div');
  card.className = 'card';
  const h = document.createElement('h2');
  h.innerHTML = `<b>${sc.W}×${sc.H}</b> · ${sc.label} · level ${L.parts.lv} · ${L.wallSpots.length} wall spots · ×${sc.s}`;
  const stack = document.createElement('div');
  stack.className = 'stack';
  stack.style.width = `${sc.W * sc.s}px`;
  stack.style.height = `${sc.H * sc.s}px`;
  const back = mk(sc.W, sc.H, sc.s);
  const seated = mk(sc.W, sc.H, sc.s);
  const front = mk(sc.W, sc.H, sc.s);
  const top = mk(sc.W, sc.H, sc.s);
  const debug = mk(sc.W * sc.s, sc.H * sc.s, 1, 'debug');
  stack.append(back, seated, front, top, debug);
  card.append(h, stack);
  out.append(card);
  scenes.push({ ...sc, L, back, seated, front, top, debug });
}

const timings = [];
function render(sc, measure) {
  const st = stateFor(sc);
  const bctx = sc.back.getContext('2d');
  const fctx = sc.front.getContext('2d');
  const t0 = performance.now();
  paintRoom(bctx, fctx, sc.L, st);
  const cold = performance.now() - t0;
  if (measure) {
    const n = 40;
    const t1 = performance.now();
    for (let i = 0; i < n; i++) paintRoom(bctx, fctx, sc.L, st);
    const warm = (performance.now() - t1) / n;
    timings.push(`${String(sc.W).padStart(3)}×${sc.H} ${sc.st.padEnd(6)} first ${cold.toFixed(2)} ms · repaint ${warm.toFixed(3)} ms · phase ${roomPhase(st)}`);
  }
  drawPeople(sc.L, sc, st, sc.seated, sc.top);
  drawDebug(sc.L, sc.debug, sc.s);
}
for (const sc of scenes) render(sc, true);

// ---------------------------------------------------------------- galleries

// paint a room offscreen and show a scaled crop of it (back + front)
function cropCard(host, title, W, H, state, crop, s) {
  const L = layoutRoom(W, H);
  const b = document.createElement('canvas');
  const f = document.createElement('canvas');
  b.width = f.width = W;
  b.height = f.height = H;
  paintRoom(b.getContext('2d'), f.getContext('2d'), L, state);
  const r = typeof crop === 'function' ? crop(L) : crop || { x: 0, y: 0, w: W, h: H };
  const c = document.createElement('canvas');
  c.className = 'crop';
  c.width = r.w * s;
  c.height = r.h * s;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(b, r.x, r.y, r.w, r.h, 0, 0, r.w * s, r.h * s);
  g.drawImage(f, r.x, r.y, r.w, r.h, 0, 0, r.w * s, r.h * s);
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>${title}</h2>`;
  card.append(c);
  host.append(card);
  return L;
}

const WALLS = ['lilac', 'mint', 'peach', 'sky', 'butter', 'cocoa'];
const FLOORS = ['wood', 'checker', 'carpet', 'tatami'];
WALLS.forEach((wall, i) => {
  for (const floor of [FLOORS[i % 4], FLOORS[(i + 2) % 4]]) {
    cropCard($('walls'), `<b>${wall}</b> wall · ${floor} floor`, 420, 220, { ...STATES.day, style: { wall, floor }, earned: EARN.mid }, { x: 0, y: 0, w: 230, h: 220 }, 2);
  }
});

const VIEWS = ['city', 'beach', 'mountains', 'rain', 'stars', 'space', 'garden'];
const LIGHTS = [
  ['day', 'day', at(11, 10)],
  ['golden', 'golden', at(11, 10)],
  ['night', 'night', at(11, 10)],
  ['real · dawn 06:10', 'real', at(6, 10)],
  ['real · dusk 20:00', 'real', at(20, 0)],
];
const winCrop = (L) => {
  const w = L.parts.window;
  return { x: w.x - 13, y: w.y - 7, w: w.w + 26, h: w.h + 12 };
};
for (const view of VIEWS) {
  for (const [label, light, now] of LIGHTS) {
    cropCard($('views'), `<b>${view}</b> · ${label}`, 560, 230, { ...STATES.day, now, style: { view, light }, earned: EARN.mid }, winCrop, 2);
  }
}

const SEASONS = [
  ['January', 0, 'city'],
  ['April', 3, 'garden'],
  ['July', 6, 'beach'],
  ['October', 9, 'city'],
  ['December', 11, 'mountains'],
];
for (const [name, mo, view] of SEASONS) {
  cropCard($('seasons'), `<b>${name}</b> · ${view}`, 480, 230, { ...STATES.day, now: at(11, 10, mo, 12), style: { view }, earned: EARN.mid }, null, 2);
}

// the cubby (with the armchair under it) at each level, then music
const cubbyCrop = (L) => {
  const e = L.parts.earned;
  const c = L.parts.chair;
  const x = Math.min(e.x, c.x) - 4;
  return { x, y: e.y - 18, w: Math.max(e.x + e.w, c.x + c.w) + 4 - x, h: c.y + 6 - (e.y - 18) };
};
for (const [k, e, music, night] of [
  ['nothing earned yet', EARN.none],
  ['3 shipped · 4 lessons', EARN.mid],
  ['9 shipped · 12 lessons (shows 6 + 8)', EARN.max],
  ['max + music', EARN.max, true],
  ['max + music · night', EARN.max, true, true],
]) {
  cropCard($('earned'), `<b>${k}</b>`, 480, 230, { ...STATES.day, now: night ? at(22, 30) : at(11, 10), earned: e, music }, cubbyCrop, 4);
}
// the revival plant on the sill, stage by stage (no earned at all = the old succulent)
const sillCrop = (L) => {
  const w = L.parts.window;
  return { x: w.x + w.w - 30, y: w.y + w.h - 30, w: 36, h: 34 };
};
cropCard($('earned'), '<b>no earned</b> · succulent', 480, 230, { ...STATES.day, now: at(11, 10, 1, 3) }, sillCrop, 5);
for (let p = 0; p <= 5; p++) {
  cropCard($('earned'), `plant <b>${p}</b>`, 480, 230, { ...STATES.day, now: at(11, 10, 1, 3), earned: { trophies: 0, plant: p, books: 0 } }, sillCrop, 5);
}

// ---------------------------------------------------------------- timing

{
  // typical repaint: same state, the minute ticking over now and then
  const L = layoutRoom(480, 230);
  const b = document.createElement('canvas');
  const f = document.createElement('canvas');
  b.width = f.width = 480;
  b.height = f.height = 230;
  const bc = b.getContext('2d');
  const fc = f.getContext('2d');
  const st = { ...STATES.day, style: { wall: 'mint', floor: 'carpet', view: 'beach' }, earned: EARN.max, music: true };
  paintRoom(bc, fc, L, st);
  const n = 200;
  let t0 = performance.now();
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const s0 = performance.now();
    paintRoom(bc, fc, L, { ...st, now: at(11, 10 + (i >> 5)) });
    worst = Math.max(worst, performance.now() - s0);
  }
  const typical = (performance.now() - t0) / n;
  // alternating three different states (nothing coasts on the last frame)
  const states = [
    { ...STATES.day, style: { view: 'garden' }, earned: EARN.mid },
    { ...STATES.night, style: { view: 'rain', wall: 'sky' }, earned: EARN.mid, music: true },
    { ...STATES.busy, style: { view: 'city', light: 'golden' }, earned: EARN.mid },
  ];
  for (const s of states) paintRoom(bc, fc, L, s);
  t0 = performance.now();
  let worst2 = 0;
  for (let i = 0; i < 150; i++) {
    const s0 = performance.now();
    paintRoom(bc, fc, L, states[i % 3]);
    worst2 = Math.max(worst2, performance.now() - s0);
  }
  const alt = (performance.now() - t0) / 150;
  // first paint at sizes it has never seen
  const firsts = [];
  const lays = [];
  for (let i = 0; i < 16; i++) {
    const W = 333 + i * 23;
    const H = 181 + ((i * 7) % 90);
    const l0 = performance.now();
    const L2 = layoutRoom(W, H);
    lays.push(performance.now() - l0);
    const c1 = document.createElement('canvas');
    const c2 = document.createElement('canvas');
    c1.width = c2.width = W;
    c1.height = c2.height = H;
    const p0 = performance.now();
    paintRoom(c1.getContext('2d'), c2.getContext('2d'), L2, { ...STATES.day, style: { view: VIEWS[i % 7] }, earned: EARN.mid });
    firsts.push(performance.now() - p0);
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  window.__roomTiming = { typical, worst, alt, worst2, firstAvg: avg(firsts), firstMax: Math.max(...firsts), layoutAvg: avg(lays), layoutMax: Math.max(...lays) };
  timings.unshift(
    `W=480 typical repaint (same state, minutes ticking): avg ${typical.toFixed(3)} ms, worst ${worst.toFixed(3)} ms`,
    `W=480 alternating 3 different states: avg ${alt.toFixed(3)} ms, worst ${worst2.toFixed(3)} ms`,
    `first paint at 16 new sizes: avg ${avg(firsts).toFixed(2)} ms, worst ${Math.max(...firsts).toFixed(2)} ms`,
    `layoutRoom at 16 new sizes: avg ${avg(lays).toFixed(2)} ms, worst ${Math.max(...lays).toFixed(2)} ms`,
    '',
  );
}
timingEl.textContent = timings.join('\n');
console.log('[room timing]\n' + timings.join('\n'));

// ---------------------------------------------------------------- the sweep

const NEED = ['board', 'fridge', 'bin', 'calendar', 'cabinet', 'nest', 'door', 'desk0', 'desk1', 'desk2', 'sofa', 'window', 'clock', 'shelf', 'record', 'chair', 'sign', 'trophies'];
const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

async function sweep() {
  sweepEl.textContent = 'sweeping…';
  const sizes = [];
  for (let W = 300; W <= 720; W += 2) sizes.push([W, 170], [W, 280]);
  for (let W = 303; W <= 720; W += 6) for (let H = 175; H < 280; H += 10) sizes.push([W, H]);
  const fails = [];
  const fail = (W, H, msg) => fails.push(`${W}×${H}: ${msg}`);
  const b = document.createElement('canvas');
  const f = document.createElement('canvas');
  const w = document.createElement('canvas');
  const opts = { willReadFrequently: true };
  let checked = 0;
  let spotsMin = 99;
  let spotsMax = 0;
  const t0 = performance.now();
  for (let i = 0; i < sizes.length; i++) {
    const [W, H] = sizes[i];
    const L = layoutRoom(W, H);
    const box = { x: 0, y: 0, w: W, h: H };
    // hotspots: all there, in bounds, and no two buttons on top of each other
    const ids = new Set(L.hotspots.map((h) => h.id));
    for (const id of NEED) if (!ids.has(id)) fail(W, H, `missing hotspot ${id}`);
    for (const h of L.hotspots) if (!inside(h, box) || h.w < 4 || h.h < 4) fail(W, H, `hotspot ${h.id} out of bounds ${JSON.stringify(h)}`);
    const btn = L.hotspots.filter((h) => h.id !== 'window');
    for (let p = 0; p < btn.length; p++) for (let q = p + 1; q < btn.length; q++) if (ov(btn[p], btn[q])) fail(W, H, `hotspots ${btn[p].id} and ${btn[q].id} overlap`);
    // the new rects
    if (!(L.sign.w >= 30 && L.sign.h >= 9 && inside(L.sign, box))) fail(W, H, `sign ${JSON.stringify(L.sign)}`);
    const board = L.hotspots.find((h) => h.id === 'board');
    const inner = { x: board.x + 4, y: board.y + 4, w: board.w - 8, h: board.h - 10 };
    if (!inside(L.boardText, inner) || L.boardText.w < 24 || L.boardText.h < 12) fail(W, H, `boardText ${JSON.stringify(L.boardText)}`);
    if (L.boardPins.length < 3 || L.boardPins.length > 4) fail(W, H, `${L.boardPins.length} board pins`);
    for (const p of L.boardPins) {
      const r = { x: p.x, y: p.y, w: 14, h: 12 };
      if (!inside(r, { x: board.x + 2, y: board.y + 2, w: board.w - 4, h: board.h - 4 })) fail(W, H, `pin off the board ${JSON.stringify(p)}`);
      if (ov(r, L.boardText)) fail(W, H, 'pin over the text area');
    }
    const n = L.wallSpots.length;
    spotsMin = Math.min(spotsMin, n);
    spotsMax = Math.max(spotsMax, n);
    if (n < 4 || n > 8) fail(W, H, `${n} wall spots`);
    L.wallSpots.forEach((s, k) => {
      if (s.w < 16 || s.h < 16 || !inside(s, box)) fail(W, H, `wall spot ${JSON.stringify(s)}`);
      for (const h of L.hotspots) if (ov(s, h)) fail(W, H, `wall spot overlaps hotspot ${h.id}`);
      for (const o of L.wallSpots.slice(k + 1)) if (ov(s, o)) fail(W, H, 'wall spots overlap');
      for (const d of L.desks) if (ov(s, { x: d.cat.x - 8, y: d.cat.y - CAT_H, w: 16, h: CAT_H })) fail(W, H, 'wall spot under a desk cat');
    });
    L.desks.forEach((d, k) => {
      const catR = { x: d.cat.x - (CAT_W >> 1), y: d.cat.y - CAT_H, w: CAT_W, h: CAT_H };
      const face = { x: d.seat.x - 10, y: d.seat.y - 28, w: 20, h: 11 };
      if (ov(catR, face)) fail(W, H, `desk${k} cat in front of the face`);
      if (!inside(catR, box)) fail(W, H, `desk${k} cat out of bounds`);
      if (d.screen.w < 6 || d.screen.h < 6) fail(W, H, `desk${k} screen too small`);
    });
    if (L.meeting.length < 8 || L.meeting.length > 12) fail(W, H, `${L.meeting.length} meeting spots`);
    for (const m of L.meeting) if (m.x < L.walk.left || m.x > L.walk.right || m.y < L.walk.top || m.y > L.walk.bottom) fail(W, H, 'meeting spot off the floor');
    if (!inside({ x: L.chair.x - 10, y: L.chair.y - 28, w: 20, h: 28 }, box)) fail(W, H, 'chair sitter out of bounds');

    // paint the busiest version of the room
    b.width = f.width = w.width = W;
    b.height = f.height = w.height = H;
    const bc = b.getContext('2d', opts);
    const fc = f.getContext('2d', opts);
    const wc = w.getContext('2d', opts);
    paintRoom(bc, fc, L, { ...STATES.busy, now: at(12, 0, 9, 20), dayOffset: 0, style: { light: 'day' }, earned: EARN.max, music: true });
    // front layer: opaque across each seat from y-16 to y, clear over the face
    const fpx = fc.getImageData(0, 0, W, H).data;
    const seats = [...L.desks.map((d) => ['desk', d.seat]), ...L.sofa.seats.map((s) => ['sofa', s]), ['chair', L.chair]];
    for (const [what, s] of seats) {
      let holes = 0;
      let covered = 0;
      for (let y = s.y - 16; y < s.y; y++) for (let x = s.x - 10; x < s.x + 10; x++) if (fpx[(y * W + x) * 4 + 3] !== 255) holes++;
      for (let y = s.y - 28; y <= s.y - 18; y++) for (let x = s.x - 10; x < s.x + 10; x++) if (fpx[(y * W + x) * 4 + 3] !== 0) covered++;
      if (holes) fail(W, H, `${what} seat at ${s.x},${s.y}: ${holes} see-through px below the waist`);
      if (covered) fail(W, H, `${what} seat at ${s.x},${s.y}: ${covered} front px over the face`);
    }
    // wall spots: every pixel must still be bare wallpaper
    paintWallOnly(wc, L, 'lilac');
    const bpx = bc.getImageData(0, 0, W, H).data;
    const wpx = wc.getImageData(0, 0, W, H).data;
    for (const s of L.wallSpots) {
      let diff = 0;
      for (let y = s.y; y < s.y + s.h; y++) {
        for (let x = s.x; x < s.x + s.w; x++) {
          const o = (y * W + x) * 4;
          if (bpx[o] !== wpx[o] || bpx[o + 1] !== wpx[o + 1] || bpx[o + 2] !== wpx[o + 2]) diff++;
        }
      }
      if (diff) fail(W, H, `wall spot ${s.x},${s.y} covers ${diff} painted px`);
    }
    checked++;
    if (i % 25 === 24) {
      sweepEl.textContent = `sweeping… ${i + 1}/${sizes.length}, ${fails.length} problems so far`;
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  const result = { sizes: checked, fails: fails.length, spotsMin, spotsMax, secs, first: fails.slice(0, 40) };
  window.__sweep = result;
  sweepEl.innerHTML = '';
  const head = document.createElement('div');
  head.className = fails.length ? 'fail' : 'pass';
  head.textContent = `${fails.length ? 'FAIL' : 'PASS'} · ${checked} sizes (W 300–720 × H 170–280) in ${secs}s · ${fails.length} problems · wall spots per room ${spotsMin}–${spotsMax}`;
  sweepEl.append(head);
  if (fails.length) sweepEl.append(fails.slice(0, 60).join('\n'));
  console.log('[room sweep] ' + head.textContent);
  return result;
}

$('sweepBtn').addEventListener('click', () => sweep());

const rerenderAll = () => scenes.forEach((sc) => render(sc, false));
debugBox.addEventListener('change', rerenderAll);
peopleBox.addEventListener('change', rerenderAll);
hourInput.addEventListener('input', () => scenes.filter((sc) => sc.st === 'custom').forEach((sc) => render(sc, false)));

if (params.get('sweep') === '1') await sweep();
window.__roomReady = true;
