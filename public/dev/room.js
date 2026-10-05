// Preview + QA page for /js/room.js: several sizes, day/night, a busy state,
// stand-in people to check the front layer, and a debug overlay.
import { layoutRoom, paintRoom } from '/js/room.js';

const INK = '#2b2a5e';
const out = document.getElementById('out');
const timingEl = document.getElementById('timing');
const errEl = document.getElementById('err');
const params = new URLSearchParams(location.search);
const debugBox = document.getElementById('debug');
const peopleBox = document.getElementById('people');
const hourInput = document.getElementById('hour');
const hourOut = document.getElementById('hourOut');
debugBox.checked = params.get('debug') === '1';

addEventListener('error', (e) => {
  errEl.textContent += `error: ${e.message}\n`;
});

const at = (h, m = 0) => new Date(2026, 9, 5, h, m);
const STATES = {
  day: { now: at(11, 10), dayOffset: 0, deskBusy: [true, false, true], binCount: 0, fridgeCount: 0, eggCount: 2, boardBars: [0.3, 0.6, 0.45, 0.8] },
  night: { now: at(22, 40), dayOffset: 0, deskBusy: [false, true, false], binCount: 2, fridgeCount: 1, eggCount: 0, boardBars: [0.2, 0.5] },
  busy: { now: at(18, 40), dayOffset: 26, deskBusy: [true, true, true], binCount: 3, fridgeCount: 2, eggCount: 6, boardBars: [0.2, 0.55, 0.4, 0.9, 0.7, 0.35, 1] },
};

const SCENES = [
  { W: 300, H: 190, s: 3, state: 'day' },
  { W: 300, H: 190, s: 3, state: 'night' },
  { W: 420, H: 220, s: 3, state: 'day' },
  { W: 420, H: 220, s: 3, state: 'night' },
  { W: 480, H: 230, s: 3, state: 'busy', label: 'busy · +26 days · golden hour' },
  { W: 560, H: 240, s: 3, state: 'day' },
  { W: 560, H: 240, s: 3, state: 'night' },
  { W: 720, H: 260, s: 2, state: 'day' },
  { W: 720, H: 260, s: 2, state: 'night' },
  { W: 300, H: 170, s: 3, state: 'busy', label: 'smallest · busy' },
  { W: 720, H: 280, s: 2, state: 'busy', label: 'tallest · busy' },
  { W: 480, H: 230, s: 3, state: 'custom', label: 'custom hour (slider)' },
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
function person(ctx, x, y, col) {
  ctx.fillStyle = INK;
  ctx.fillRect(x - 10, y - 28, 20, 28);
  ctx.fillStyle = col;
  ctx.fillRect(x - 9, y - 27, 18, 26);
  ctx.fillStyle = INK;
  ctx.fillRect(x - 4, y - 23, 2, 2);
  ctx.fillRect(x + 2, y - 23, 2, 2);
  ctx.fillRect(x - 2, y - 20, 4, 1);
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
function ghost(ctx, x, y) {
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(x - 10, y - 28, 20, 28);
  ctx.fillStyle = INK;
  ctx.fillRect(x - 4, y - 22, 2, 2);
  ctx.fillRect(x + 2, y - 22, 2, 2);
}

const COLS = ['#ffb3d1', '#ffe27a', '#c9b6ff', '#c6ef6a', '#a9dcff', '#ffc9a3', '#a8f0d4'];

function drawPeople(L, st, seated, top) {
  const a = seated.getContext('2d');
  const b = top.getContext('2d');
  a.clearRect(0, 0, L.W, L.H);
  b.clearRect(0, 0, L.W, L.H);
  if (!peopleBox.checked) return;
  L.desks.forEach((d, i) => {
    if (st.deskBusy[i]) person(a, d.seat.x, d.seat.y, COLS[i]);
  });
  L.sofa.seats.forEach((s, i) => {
    if (i !== 1 || st.deskBusy.every(Boolean)) person(a, s.x, s.y, COLS[3 + i]);
  });
  for (let i = 0; i < Math.min(st.eggCount, L.nest.slots.length); i++) {
    const s = L.nest.slots[i];
    egg(b, s.x, s.y, COLS[i % COLS.length]);
  }
  L.naps.slice(0, 2).forEach((n, i) => napper(b, n.x, n.y, COLS[(i + 4) % COLS.length]));
  const r = rng(L.W * 7 + L.H);
  const walkers = Array.from({ length: Math.round(L.W / 70) }, () => ({
    x: Math.round(L.walk.left + 10 + r() * (L.walk.right - L.walk.left - 20)),
    y: Math.round(L.walk.top + r() * (L.walk.bottom - L.walk.top)),
  })).sort((p, q) => p.y - q.y);
  walkers.forEach((w, i) => person(b, w.x, w.y, COLS[(i + 2) % COLS.length]));
  const gr = rng(L.H * 13 + L.W);
  for (let i = 0; i < 2; i++) {
    ghost(b, Math.round(L.ghosts.left + gr() * (L.ghosts.right - L.ghosts.left)), Math.round(L.ghosts.top + gr() * (L.ghosts.bottom - L.ghosts.top)));
  }
}

function drawDebug(L, c, s) {
  const d = c.getContext('2d');
  d.clearRect(0, 0, c.width, c.height);
  if (!debugBox.checked) return;
  d.save();
  d.lineWidth = 1;
  const rect = (r, col, dash) => {
    d.setLineDash(dash || []);
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
  // floor line
  d.strokeStyle = 'rgba(0,90,255,.6)';
  d.setLineDash([4, 4]);
  d.beginPath();
  d.moveTo(0, L.floorY * s + 0.5);
  d.lineTo(L.W * s, L.floorY * s + 0.5);
  d.stroke();
  const w = L.walk;
  d.fillStyle = 'rgba(0,200,120,.12)';
  d.fillRect(w.left * s, w.top * s, (w.right - w.left) * s, (w.bottom - w.top) * s);
  rect({ x: w.left, y: w.top, w: w.right - w.left, h: w.bottom - w.top }, 'rgba(0,160,90,.9)', [6, 3]);
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
  L.desks.forEach((k) => mark(k.seat.x, k.seat.y, '#ff2020', 4));
  L.sofa.seats.forEach((k) => mark(k.x, k.y, '#ff2020', 4));
  L.naps.forEach((k) => mark(k.x, k.y, '#ff8a00', 4));
  L.nest.slots.forEach((k) => mark(k.x, k.y, '#d4a000', 2));
  d.restore();
}

const scenes = [];
for (const sc of SCENES) {
  const L = layoutRoom(sc.W, sc.H);
  const card = document.createElement('div');
  card.className = 'card';
  const h = document.createElement('h2');
  h.innerHTML = `<b>${sc.W}×${sc.H}</b> · ${sc.label || sc.state} · level ${L.parts.lv} · ×${sc.s}`;
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
  scenes.push({ ...sc, L, back, seated, front, top, debug, h });
}

function stateFor(sc) {
  if (sc.state !== 'custom') return STATES[sc.state];
  const hv = Number(hourInput.value);
  const hh = Math.floor(hv);
  const mm = Math.round((hv - hh) * 60);
  hourOut.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  return { ...STATES.day, now: at(hh, mm), deskBusy: [true, true, false], eggCount: 3, binCount: 1, fridgeCount: 1 };
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
    timings.push(`${String(sc.W).padStart(3)}×${sc.H} ${sc.state.padEnd(6)} first ${cold.toFixed(2)} ms · repaint ${warm.toFixed(3)} ms`);
  }
  drawPeople(sc.L, st, sc.seated, sc.top);
  drawDebug(sc.L, sc.debug, sc.s);
}

for (const sc of scenes) render(sc, true);

// the contract's budget: repaint at W=480 under 8 ms (alternating states so
// nothing can coast on the previous frame)
{
  const L = layoutRoom(480, 230);
  const b = document.createElement('canvas');
  const f = document.createElement('canvas');
  b.width = f.width = 480;
  b.height = f.height = 230;
  const bc = b.getContext('2d');
  const fc = f.getContext('2d');
  const states = [STATES.day, STATES.night, STATES.busy];
  let worst = 0;
  const n = 150;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const s0 = performance.now();
    paintRoom(bc, fc, L, states[i % 3]);
    worst = Math.max(worst, performance.now() - s0);
  }
  const avg = (performance.now() - t0) / n;
  timings.unshift(`W=480 benchmark: ${n} repaints alternating day/night/busy → avg ${avg.toFixed(3)} ms, worst ${worst.toFixed(3)} ms`, '');
  window.__roomTiming = { avg, worst };
}

timingEl.textContent = timings.join('\n');
console.log('[room timing]\n' + timings.join('\n'));

const rerenderAll = () => scenes.forEach((sc) => render(sc, false));
debugBox.addEventListener('change', rerenderAll);
peopleBox.addEventListener('change', rerenderAll);
hourInput.addEventListener('input', () => scenes.filter((sc) => sc.state === 'custom').forEach((sc) => render(sc, false)));
window.__roomReady = true;
