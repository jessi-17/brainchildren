// pixelfolk.js — procedural pixel-art chibi people (and eggs) for brainchildren.
//
// Plain browser ES module: no dependencies, no network, no Math.random.
// Every person is built from a 32-bit seed: same seed + opts => same pixels.
//
//   person(seed, { mood, stage, kind }) -> { stand, walk:[a,b], type:[a,b], sleep, lie, color }
//   egg(seed, { cold })                 -> canvas
//
// Frames are 1x canvases with a transparent background; scale them up with CSS
// (image-rendering: pixelated). Canvases are cached and shared between callers,
// so draw them (drawImage) or clone them rather than appending one canvas twice.
//
// Geometry (sprite px, y grows downwards):
//   SPRITE_W x SPRITE_H  every person frame ('lie' is SPRITE_H x SPRITE_W)
//   FEET_Y               the ground line: feet pixels sit in rows < FEET_Y,
//                        centred on x = SPRITE_W / 2
//   WAIST_Y              rows >= WAIST_Y are legs/hips; when sitting at a desk or
//                        on a sofa everything from this row down can be hidden
//                        (head, shoulders, arms and typing hands are all above it)

const INK = '#2b2a5e';

export const SPRITE_W = 24;
export const SPRITE_H = 28;
export const FEET_Y = 28;
export const WAIST_Y = 21;
export const EGG_W = 11;
export const EGG_H = 14;

// People are designed on a 22px-wide grid (mirror axis between x=10 and x=11)
// and drawn one pixel in from the left of the 24px frame.
const OX = 1;
const MX = 21; // mirror: x -> MX - x

/* ------------------------------------------------------------------ random */

function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash32(n) {
  n = (n ^ 0x9e3779b9) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return (n ^ (n >>> 16)) >>> 0;
}

function makeRng(seed, salt) {
  const next = mulberry32(hash32((seed >>> 0) ^ salt));
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    weighted(pairs) {
      let total = 0;
      for (const [, w] of pairs) total += w;
      let x = next() * total;
      for (const [v, w] of pairs) if ((x -= w) < 0) return v;
      return pairs[pairs.length - 1][0];
    },
  };
}

/* ------------------------------------------------------------------ colour */

const RGB = new Map();
function rgb(hex) {
  let v = RGB.get(hex);
  if (!v) {
    const n = parseInt(hex.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    RGB.set(hex, v);
  }
  return v;
}
const toHex = (r, g, b) => '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  return toHex(...A.map((v, i) => Math.round(v + (B[i] - v) * t)));
}
const dark = (c, t = 0.28) => mix(c, INK, t);
const light = (c, t = 0.45) => mix(c, '#ffffff', t);
function luma(c) {
  const [r, g, b] = rgb(c);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
// ghost palette: mostly grey, lifted towards a pale lavender; ink stays ink
const GHOST = new Map();
function ghostly(c) {
  if (c === INK) return c;
  let v = GHOST.get(c);
  if (!v) {
    const [r, g, b] = rgb(c);
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const pale = [236, 234, 250];
    v = toHex(...[r, g, b].map((x, i) => {
      const d = x + (l - x) * 0.82;
      return Math.round(d + (pale[i] - d) * 0.5);
    }));
    GHOST.set(c, v);
  }
  return v;
}

/* ------------------------------------------------------------------ grid */

class Grid {
  constructor(w = SPRITE_W, h = SPRITE_H, ox = OX) {
    this.w = w;
    this.h = h;
    this.ox = ox;
    this.p = new Array(w * h).fill(null);
  }
  idx(x, y) {
    x += this.ox;
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? y * this.w + x : -1;
  }
  get(x, y) {
    const i = this.idx(x, y);
    return i < 0 ? null : this.p[i];
  }
  set(x, y, c) {
    const i = this.idx(x, y);
    if (i >= 0) this.p[i] = c;
  }
  row(x0, x1, y, c) {
    for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
  rect(x0, y0, x1, y1, c) {
    for (let y = y0; y <= y1; y++) this.row(x0, x1, y, c);
  }
  mset(x, y, c) {
    this.set(x, y, c);
    this.set(MX - x, y, c);
  }
  mrow(x0, x1, y, c) {
    this.row(x0, x1, y, c);
    this.row(MX - x1, MX - x0, y, c);
  }
  recolor(x, y, c) {
    if (this.get(x, y)) this.set(x, y, c);
  }
  topIn(x0, x1) {
    for (let y = 0; y < this.h; y++) for (let x = x0; x <= x1; x++) if (this.get(x, y)) return y;
    return this.h;
  }
}

// Paint `src` onto `dst` (shifted down by dy), first ringing it with a 1px ink
// outline (4-neighbour, so corners stay soft). Outlines land on top of whatever
// is already in dst — that's what draws the chin line, arm lines, etc.
function stamp(dst, src, dy = 0, outline = true) {
  const { w, h, p } = src;
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? p[y * w + x] : null);
  const put = (x, y, c) => {
    y += dy;
    if (x >= 0 && y >= 0 && x < dst.w && y < dst.h) dst.p[y * dst.w + x] = c;
  };
  if (outline) {
    for (let y = -1; y <= h; y++) {
      for (let x = -1; x <= w; x++) {
        if (at(x, y)) continue;
        if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) put(x, y, INK);
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = p[y * w + x];
      if (c) put(x, y, c);
    }
  }
}

function toCanvas(g, tone) {
  const canvas = document.createElement('canvas');
  canvas.width = g.w;
  canvas.height = g.h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(g.w, g.h);
  for (let i = 0; i < g.p.length; i++) {
    const c = g.p[i];
    if (!c) continue;
    const [r, gr, b] = rgb(tone ? tone(c) : c);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = gr;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// 90deg counter-clockwise: head ends up on the left, feet on the right
function rotateCCW(g) {
  const out = new Grid(g.h, g.w, 0);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const c = g.p[y * g.w + x];
      if (c) out.p[(g.w - 1 - x) * out.w + y] = c;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ palettes */

const SKINS = ['#ffe6d6', '#f8d0b2', '#eebb92', '#d9a073', '#c08658', '#a26b46', '#87573a', '#6b442d'];
const HAIR_NAT = [
  ['#3d3248', 6], ['#5a3a2c', 5], ['#8a5a3b', 3], ['#b4633a', 2], ['#e08a4a', 1.5], ['#f0c862', 2], ['#f8e6ad', 1],
];
const HAIR_NAT_DEEP = [['#3d3248', 10], ['#463036', 3], ['#f0c862', 0.6], ['#b4633a', 0.4]];
const HAIR_PASTEL = ['#ff9ec7', '#c9b6ff', '#a9dcff', '#a8f0d4'];
const HAIR_OLD = ['#f2eff8', '#bfbace'];
const TOPS = [
  '#ff6fae', '#3b4cca', '#ffe27a', '#c9b6ff', '#c6ef6a', '#a9dcff', '#ffc9a3', '#a8f0d4',
  '#fffdf0', '#b9b4cc', '#4a4766', '#ff8f6b', '#ffcfe3',
];
const BOTTOMS = [
  '#5b7bd5', '#3f55a5', '#4a4766', '#d8b48a', '#3d3a55', '#c9b6ff', '#ff6fae', '#a8f0d4', '#a9dcff', '#b9b4cc', '#ffe27a',
];
const DENIM = ['#5b7bd5', '#3f55a5', '#7f9ce8'];
const SHOES = ['#fffdf0', '#ff6fae', '#3d3a55', '#8b5e3c', '#ff5a5f', '#3b4cca', '#ffe27a', '#c9b6ff'];
const ACCENTS = ['#ff6fae', '#ffe27a', '#a9dcff', '#c9b6ff', '#c6ef6a', '#a8f0d4', '#ffc9a3', '#ff5a5f', '#fffdf0'];
const HATS = ['#ff6fae', '#3b4cca', '#ffe27a', '#c9b6ff', '#a8f0d4', '#ffc9a3', '#a9dcff', '#4a4766', '#ff8f6b'];
const SCARVES = ['#c9b6ff', '#a8f0d4', '#ffc9a3', '#3b4cca', '#ff9ec7', '#fff3d6', '#4a4766', '#a9dcff'];
const PROP_COLORS = ['#ff6fae', '#3b4cca', '#c9b6ff', '#a9dcff', '#a8f0d4', '#ffc9a3', '#ffe27a', '#c6ef6a'];
const CREAM = '#fffdf0';
const GOLD = '#ffe27a';

/* ------------------------------------------------------------------ traits */

const STYLES = [
  'short', 'sidepart', 'bob', 'long', 'afro', 'curly', 'pigtails', 'spacebuns', 'topbun',
  'ponytail', 'spiky', 'buzz', 'bald', 'quiff', 'braids', 'wavy', 'locs', 'curtains',
];
const OUTFITS = ['tee', 'collar', 'hoodie', 'stripes', 'apron', 'dress', 'overalls', 'cardigan', 'sweater'];
const BEANIE_OK = new Set(['short', 'sidepart', 'bob', 'long', 'curly', 'braids', 'wavy', 'locs', 'curtains', 'buzz', 'ponytail']);
const CAP_OK = new Set(['short', 'sidepart', 'bob', 'long', 'ponytail', 'braids', 'wavy', 'locs', 'curtains', 'buzz']);
const BOW_OK = new Set(['bob', 'long', 'wavy', 'curly', 'curtains', 'braids', 'sidepart', 'short', 'ponytail', 'pigtails']);
const BEARD_OK = new Set([
  'short', 'sidepart', 'buzz', 'quiff', 'spiky', 'curly', 'afro', 'locs', 'long', 'curtains', 'topbun', 'ponytail',
]);
const LONG_SLEEVES = new Set(['collar', 'hoodie', 'cardigan', 'sweater']);

function traitsFor(seed) {
  const R = makeRng(seed, 0x4a288caa);
  const T = {};
  T.skinIdx = R.int(SKINS.length);
  T.skin = SKINS[T.skinIdx];
  T.style = R.pick(STYLES);
  T.variant = R.int(3);

  const hatRoll = R.next();
  T.hat = null;
  if (hatRoll < 0.05) T.hat = 'scarf';
  else if (hatRoll < 0.12 && BEANIE_OK.has(T.style)) T.hat = 'beanie';
  else if (hatRoll < 0.18 && CAP_OK.has(T.style)) T.hat = 'cap';
  T.hatColor = R.pick(T.hat === 'scarf' ? SCARVES : HATS);

  const old = T.style === 'bald' ? R.chance(0.6) : R.chance(0.04);
  if (old) T.hairColor = R.pick(HAIR_OLD);
  else if (R.chance(0.22)) T.hairColor = R.pick(HAIR_PASTEL);
  else T.hairColor = R.weighted(T.skinIdx >= 4 ? HAIR_NAT_DEEP : HAIR_NAT);

  T.outfit = R.pick(OUTFITS);
  T.top = R.pick(TOPS);
  T.accent = R.pick(ACCENTS.filter((c) => c !== T.top));
  if (T.outfit === 'dress') {
    T.bottomKind = 'skirt';
    T.bottom = T.top;
  } else if (T.outfit === 'overalls') {
    T.bottomKind = R.chance(0.6) ? 'pants' : 'shorts';
    T.bottom = R.chance(0.65) ? R.pick(DENIM) : R.pick(['#ff6fae', '#c9b6ff', '#a8f0d4', '#ffe27a', '#ffc9a3']);
    if (T.bottom === T.top) T.top = CREAM;
  } else {
    T.bottomKind = R.weighted([['pants', 5], ['shorts', 2.5], ['skirt', 2.5]]);
    T.bottom = R.pick(BOTTOMS.filter((c) => c !== T.top));
  }
  T.shoe = R.pick(SHOES);
  T.socks = R.chance(0.45) ? R.pick([CREAM, CREAM, T.accent]) : null;
  T.sleeves = LONG_SLEEVES.has(T.outfit) ? 'long' : T.outfit === 'stripes' && R.chance(0.5) ? 'long' : 'short';
  T.print = R.pick(['none', 'pocket', 'band', 'heart']);
  T.tie = R.chance(0.4);
  T.apron = R.pick([CREAM, '#ffcfe3', '#a8f0d4', '#ffe27a', '#c9b6ff', '#a9dcff'].filter((c) => c !== T.top));

  T.glasses = R.chance(0.22) ? (R.chance(0.6) ? 'round' : 'square') : null;
  T.glassesColor = R.pick([INK, INK, INK, '#ff6fae', '#3b4cca', '#9a5b3a']);
  T.phones = !T.hat && R.chance(0.1);
  T.phonesColor = R.pick(['#ff6fae', '#3b4cca', '#a9dcff', '#c9b6ff', CREAM, '#ffe27a']);
  T.bow = !T.hat && !T.phones && BOW_OK.has(T.style) && R.chance(0.3);
  T.bowColor = R.pick(['#ff6fae', '#ffe27a', '#a9dcff', '#c9b6ff', '#ff5a5f', '#a8f0d4']);
  const beardP = T.style === 'bald' ? (old ? 0.75 : 0.4) : BEARD_OK.has(T.style) ? 0.14 : 0;
  const pastel = HAIR_PASTEL.includes(T.hairColor);
  T.beard = T.hat !== 'scarf' && !pastel && R.chance(beardP) ? R.weighted([['full', 5], ['goatee', 2], ['mustache', 2]]) : null;
  T.freckles = R.chance(0.15);
  T.blush = R.chance(0.8);
  T.prop = R.pick(PROP_COLORS);
  T.pom = R.chance(0.5) ? CREAM : T.accent;
  return T;
}

function paletteFor(T) {
  const P = {};
  P.skin = T.skin;
  P.skinSh = mix(T.skin, '#9a4f5a', 0.2);
  P.skinHi = light(T.skin, 0.45);
  P.blush = mix(T.skin, '#ff5d8f', luma(T.skin) > 0.55 ? 0.38 : 0.32);
  P.mouth = mix('#e2486f', T.skin, 0.15);
  P.hair = T.hairColor;
  // hair shadows lean plum rather than ink so blondes don't go olive
  P.hairSh = mix(T.hairColor, '#6b3a5e', luma(T.hairColor) < 0.3 ? 0.15 : 0.32);
  P.hairHi = light(T.hairColor, luma(T.hairColor) < 0.35 ? 0.28 : 0.55);
  P.hairTex = luma(T.hairColor) < 0.35 ? light(T.hairColor, 0.16) : dark(T.hairColor, 0.2);
  P.top = T.top;
  P.topSh = dark(T.top, 0.22);
  P.accent = T.accent;
  P.bottom = T.bottom;
  P.bottomSh = dark(T.bottom, 0.22);
  P.shoe = T.shoe;
  P.shoeSh = dark(T.shoe, 0.25);
  P.socks = T.socks;
  P.sleeve = T.top;
  P.collar = luma(T.top) > 0.9 ? '#a9dcff' : CREAM;
  P.hat = T.hatColor;
  P.hatSh = dark(T.hatColor, 0.2);
  P.hatHi = light(T.hatColor, 0.5);
  P.beard = luma(T.hairColor) < 0.3 ? light(T.hairColor, 0.14) : T.hairColor;
  // ink frames vanish against deep skin + dark hair: switch them to gold
  P.glasses = T.glassesColor === INK && luma(T.skin) < 0.45 ? '#ffd36b' : T.glassesColor;
  P.prop = T.prop;
  P.apron = T.apron;
  P.main = T.outfit === 'overalls' ? T.bottom : T.top;
  return P;
}

/* ------------------------------------------------------------------ head */

const SKULL = [
  [4, 7, 14], [5, 5, 16], [6, 4, 17], [7, 4, 17], [8, 4, 17], [9, 4, 17],
  [10, 4, 17], [11, 4, 17], [12, 4, 17], [13, 4, 17], [14, 5, 16],
];

function drawHead(H, B, T, P) {
  const hc = P.hair;
  const hs = P.hairSh;
  for (const [y, a, b] of SKULL) H.row(a, b, y, P.skin);

  const cap = (wide) => {
    H.row(7, 14, 3, hc);
    H.row(5, 16, 4, hc);
    H.row(4, 17, 5, hc);
    H.row(wide ? 3 : 4, wide ? 18 : 17, 6, hc);
  };
  const fringe = (kind, wide) => {
    const a = wide ? 3 : 4;
    const b = MX - a;
    switch (kind) {
      case 'full':
        H.row(a, b, 7, hc);
        H.mset(a, 8, hc);
        break;
      case 'blunt':
        H.row(a, b, 7, hc);
        H.row(a, b, 8, hc);
        break;
      case 'part':
        H.row(a, 9, 7, hc);
        H.row(12, b, 7, hc);
        H.mrow(a, 6, 8, hc);
        H.mset(a, 9, hc);
        break;
      case 'swept':
        H.row(a, b, 7, hc);
        H.row(a, 11, 8, hc);
        H.row(a, 7, 9, hc);
        H.set(a, 10, hc);
        H.set(b, 8, hc);
        break;
      case 'tuft':
        H.row(a, b, 7, hc);
        H.row(6, 9, 8, hc);
        H.set(6, 9, hc);
        H.mset(a, 8, hc);
        break;
      case 'curtain':
        H.row(a, 8, 7, hc);
        H.row(13, b, 7, hc);
        H.mrow(a, 6, 8, hc);
        H.mrow(a, 5, 9, hc);
        break;
      case 'spiky':
        H.row(a, b, 7, hc);
        for (const x of [6, 9, 12, 15]) H.set(x, 8, hc);
        H.mset(a, 8, hc);
        break;
      default: // none: just the temples
        H.mset(a, 7, hc);
    }
  };
  const sides = (y0, y1, x0, x1, c = hc) => {
    for (let y = y0; y <= y1; y++) H.mrow(x0, x1, y, c);
  };
  const texture = (mod, c = P.hairTex) => {
    for (let y = 0; y < H.h; y++) {
      for (let x = -1; x <= MX + 1; x++) {
        if (H.get(x, y) === hc && (x * 5 + y * 3) % mod === 0) H.set(x, y, c);
      }
    }
  };

  let ears = false;
  const style = T.hat === 'scarf' ? 'none' : T.style;
  switch (style) {
    case 'short':
      cap();
      fringe(['tuft', 'full', 'swept'][T.variant]);
      ears = true;
      break;
    case 'sidepart':
      cap();
      fringe('swept');
      H.set(17, 9, hc);
      ears = true;
      break;
    case 'bob':
      cap(true);
      fringe(T.variant === 1 ? 'part' : 'blunt', true);
      sides(8, 14, 3, 5);
      break;
    case 'long':
      cap(true);
      fringe(['part', 'blunt', 'swept'][T.variant], true);
      sides(8, 15, 3, 5);
      B.rect(2, 8, 19, 20, hs);
      for (let y = 12; y <= 19; y++) B.mset(1, y, hs);
      break;
    case 'wavy':
      cap(true);
      fringe(T.variant === 2 ? 'part' : 'swept', true);
      sides(8, 15, 3, 5);
      H.mset(5, 15, null);
      B.rect(2, 8, 19, 20, hs);
      for (let y = 12; y <= 20; y++) B.mset(1, y, hs);
      for (const y of [13, 14, 18, 19]) B.mset(0, y, hs);
      break;
    case 'locs':
      cap(true);
      fringe('part', true);
      sides(8, 16, 2, 5);
      for (let y = 8; y <= 16; y++) {
        H.mset(3, y, hs);
        H.mset(5, y, y > 14 ? null : hs);
      }
      H.mset(2, 16, GOLD);
      H.set(4, 16, GOLD);
      for (let y = 8; y <= 20; y++) {
        for (let x = 1; x <= 20; x++) B.set(x, y, x % 2 ? hs : dark(hs, 0.15));
      }
      break;
    case 'curtains':
      cap();
      fringe('curtain');
      sides(10, 13, 4, 4);
      B.rect(2, 8, 19, 15, hs);
      break;
    case 'afro': {
      const rows = [
        [1, 7, 14], [2, 4, 17], [3, 3, 18], [4, 2, 19], [5, 2, 19], [6, 1, 20], [7, 1, 20],
        [8, 0, 21], [9, 0, 21], [10, 1, 20], [11, 1, 20], [12, 2, 19], [13, 3, 18],
      ];
      for (const [y, a, b] of rows) {
        for (let x = a; x <= b; x++) if (y < 7 || x < 5 || x > 16) H.set(x, y, hc);
      }
      H.mset(5, 7, hc);
      texture(7);
      break;
    }
    case 'curly': {
      const rows = [[2, 6, 15], [3, 4, 17], [4, 3, 18], [5, 2, 19], [6, 2, 19]];
      for (const [y, a, b] of rows) H.row(a, b, y, hc);
      for (let x = 2; x <= 19; x++) if (![7, 10, 11, 14].includes(x)) H.set(x, 7, hc);
      sides(8, 13, 2, 5);
      H.mrow(3, 5, 14, hc);
      H.mrow(3, 4, 15, hc);
      H.mset(1, 9, hc);
      H.mset(1, 10, hc);
      H.mset(1, 13, hc);
      H.mset(5, 1, hc);
      texture(6);
      break;
    }
    case 'pigtails':
      cap();
      fringe('part');
      H.mrow(2, 3, 8, P.accent);
      H.mrow(2, 3, 9, P.accent);
      H.mset(1, 7, hc);
      for (let y = 10; y <= 14; y++) H.mrow(1, 2, y, hc);
      H.mset(2, 15, hc);
      for (const y of [11, 13]) H.mset(2, y, hs);
      break;
    case 'spacebuns':
      cap();
      fringe(T.variant === 1 ? 'full' : 'part');
      B.mrow(4, 6, 1, hc);
      B.mrow(3, 7, 2, hc);
      B.mrow(3, 7, 3, hc);
      B.mset(4, 1, P.hairHi);
      break;
    case 'topbun':
      cap();
      fringe(T.variant === 0 ? 'none' : 'swept');
      H.row(9, 12, 1, hc);
      H.row(8, 13, 2, hc);
      H.row(8, 13, 3, P.accent);
      H.set(9, 1, P.hairHi);
      ears = true;
      break;
    case 'ponytail':
      cap();
      fringe(T.variant === 0 ? 'none' : 'swept');
      B.row(17, 19, 5, hc);
      for (let y = 6; y <= 11; y++) B.row(18, 20, y, hc);
      B.row(18, 19, 12, hc);
      B.set(19, 13, hc);
      for (const y of [8, 10]) B.set(19, y, hs);
      H.set(17, 5, P.accent);
      H.set(17, 6, P.accent);
      ears = true;
      break;
    case 'spiky':
      cap();
      H.row(4, 17, 4, hc);
      for (const [cx, ty] of [[5, 2], [8, 1], [13, 1], [16, 2]]) {
        for (let y = ty; y <= 3; y++) H.row(cx - (y - ty), cx + (y - ty), y, hc);
      }
      fringe('spiky');
      ears = true;
      break;
    case 'buzz':
      H.row(7, 14, 4, hc);
      H.row(5, 16, 5, hc);
      H.row(4, 17, 6, hc);
      H.mset(4, 7, hc);
      texture(4);
      ears = true;
      break;
    case 'bald':
      if (T.variant !== 0) for (let y = 7; y <= 9; y++) H.mset(4, y, hc);
      H.row(8, 9, 5, P.skinHi);
      H.set(7, 6, P.skinHi);
      ears = true;
      break;
    case 'quiff':
      H.row(10, 13, 1, hc);
      H.row(7, 15, 2, hc);
      H.row(6, 16, 3, hc);
      H.row(5, 16, 4, hc);
      H.row(4, 17, 5, hc);
      H.row(4, 17, 6, hc);
      fringe('none');
      H.row(13, 15, 7, hc);
      H.set(14, 8, hc);
      ears = true;
      break;
    case 'braids': {
      // two plaits hanging just outside the face, tied off at the bottom
      cap();
      fringe('part');
      sides(7, 9, 4, 4);
      H.mrow(2, 3, 8, hc);
      const plait = dark(hc, 0.32);
      for (let y = 9; y <= 17; y++) {
        const z = y % 2;
        H.mset(1, y, z ? hc : plait);
        H.mset(2, y, z ? plait : hc);
      }
      H.mrow(1, 2, 18, P.accent);
      H.mrow(1, 2, 19, hc);
      break;
    }
    default:
      break;
  }

  // a soft shine on the upper-left of the hair
  if (style !== 'none' && style !== 'bald') {
    for (const x of luma(hc) < 0.35 ? [6, 7, 8, 9] : [6, 7, 8]) {
      for (let y = 0; y < 10; y++) {
        const c = H.get(x, y);
        if (!c) continue;
        if (c === hc && H.get(x, y + 1) === hc) H.set(x, y + 1, P.hairHi);
        break;
      }
    }
  }

  if (ears) {
    H.mset(3, 10, P.skin);
    H.mset(3, 11, P.skinSh);
  }

  // hats
  if (T.hat === 'beanie') {
    for (let y = 0; y <= 5; y++) for (let x = -1; x <= MX + 1; x++) H.set(x, y, null);
    H.row(9, 12, 1, T.pom);
    H.row(9, 12, 2, T.pom);
    H.set(9, 1, light(T.pom, 0.6));
    H.row(7, 14, 3, P.hat);
    H.row(5, 16, 4, P.hat);
    H.row(4, 17, 5, P.hat);
    H.set(7, 4, P.hatHi);
    H.set(6, 5, P.hatHi);
    for (let y = 6; y <= 7; y++) for (let x = 3; x <= 18; x++) H.set(x, y, x % 2 ? P.hatSh : P.hat);
  } else if (T.hat === 'cap') {
    for (let y = 0; y <= 5; y++) for (let x = -1; x <= MX + 1; x++) H.set(x, y, null);
    // baseball cap: dome with a little button, a visor poking out to the
    // right and its shadow across the forehead
    H.row(10, 11, 1, P.hatSh);
    H.row(8, 13, 2, P.hat);
    H.row(6, 15, 3, P.hat);
    H.row(5, 16, 4, P.hat);
    H.row(4, 17, 5, P.hat);
    H.row(4, 20, 6, P.hatSh);
    H.row(17, 20, 6, dark(P.hat, 0.32));
    H.row(10, 11, 4, CREAM);
    H.set(7, 3, P.hatHi);
    H.set(6, 4, P.hatHi);
    for (let x = 4; x <= 17; x++) H.recolor(x, 7, dark(H.get(x, 7) || P.hat, 0.25));
  } else if (T.hat === 'scarf') {
    // headscarf: wraps the head and chin, drapes over the shoulders; a band
    // of underscarf shows across the forehead
    const sc = P.hat;
    const rows = [[2, 7, 14], [3, 5, 16], [4, 4, 17], [5, 3, 18]];
    for (let y = 6; y <= 14; y++) rows.push([y, 3, 18]);
    rows.push([15, 3, 18], [16, 4, 17], [17, 5, 16]);
    const open = (x, y) => (y === 14 ? x >= 7 && x <= 14 : y >= 8 && y <= 13 && x >= 6 && x <= 15);
    for (const [y, a, b] of rows) for (let x = a; x <= b; x++) if (!open(x, y)) H.set(x, y, sc);
    for (const [y, a, b] of rows) {
      for (let x = a; x <= b; x++) {
        if (open(x, y)) continue;
        if (open(x - 1, y) || open(x + 1, y) || open(x, y + 1)) H.set(x, y, P.hatSh);
      }
    }
    const under = luma(sc) > 0.8 ? '#c9b6ff' : CREAM;
    H.row(6, 15, 7, under);
    H.mset(6, 8, P.skinSh);
    H.row(5, 16, 17, P.hatSh);
    for (const [x, y] of [[12, 15], [13, 16]]) H.set(x, y, P.hatSh);
    H.set(7, 4, P.hatHi);
    H.set(6, 5, P.hatHi);
    H.set(5, 6, P.hatHi);
  }

  // a little shadow under the fringe (skipped on deep skin, where it would
  // just merge face and hair)
  for (let y = 5; y <= 14 && luma(P.skin) > 0.5; y++) {
    for (let x = 4; x <= 17; x++) {
      if (H.get(x, y) !== P.skin) continue;
      const up = H.get(x, y - 1);
      if (up && up !== P.skin && up !== P.skinSh && up !== P.skinHi) H.set(x, y, P.skinSh);
    }
  }

  // facial hair
  if (T.beard) {
    const bc = P.beard;
    if (T.beard === 'full') {
      for (let y = 8; y <= 11; y++) H.mset(4, y, bc);
      H.mrow(4, 5, 12, bc);
      H.mrow(4, 8, 13, bc);
      H.row(5, 16, 14, bc);
      H.row(6, 15, 15, bc);
      H.row(8, 13, 16, bc);
      H.row(8, 13, 12, bc);
      H.row(9, 12, 16, dark(bc, 0.12));
    } else if (T.beard === 'goatee') {
      H.row(9, 12, 12, bc);
      H.row(9, 12, 14, bc);
      H.row(10, 11, 15, bc);
    } else {
      H.row(8, 13, 12, bc);
      H.mset(8, 13, bc);
    }
  }

  // headphones
  if (T.phones) {
    const pc = T.phonesColor;
    const band = dark(pc, 0.18);
    H.row(7, 14, 2, band);
    H.mrow(5, 6, 3, band);
    H.mset(4, 4, band);
    for (let y = 5; y <= 8; y++) H.mset(3, y, band);
    H.mrow(2, 4, 9, pc);
    H.mrow(2, 4, 10, pc);
    H.mrow(2, 4, 11, pc);
    H.mrow(2, 4, 12, pc);
    H.mset(4, 10, dark(pc, 0.25));
    H.mset(4, 11, dark(pc, 0.25));
    H.set(2, 9, light(pc, 0.6));
  }
}

function drawBow(T) {
  const W = new Grid();
  const c = T.bowColor;
  W.row(13, 14, 3, c);
  W.row(16, 17, 3, c);
  W.row(13, 17, 4, c);
  W.set(15, 4, dark(c, 0.25));
  W.row(13, 14, 5, c);
  W.row(16, 17, 5, c);
  W.set(13, 3, light(c, 0.5));
  return W;
}

function drawFace(G, T, P, mood, dy) {
  const at = (x, y) => G.get(x, y + dy);
  const put = (x, y, c) => G.set(x, y + dy, c);
  const both = (x, y, c) => {
    put(x, y, c);
    put(MX - x, y, c);
  };
  const skin = (x, y) => at(x, y) === P.skin || at(x, y) === P.skinSh;

  if (T.freckles && mood !== 'ghost') {
    const f = mix(P.skin, '#8a4a2a', 0.38);
    for (const [x, y] of [[5, 12], [6, 13]]) {
      if (skin(x, y)) put(x, y, f);
      if (skin(MX - x, y)) put(MX - x, y, f);
    }
  } else if ((T.blush || mood === 'lively') && mood !== 'ghost') {
    for (const x of [5, 6, 15, 16]) if (skin(x, 12)) put(x, 12, P.blush);
  }

  // eyes
  if (mood === 'bored') {
    both(6, 10, INK);
    both(7, 10, INK);
    both(7, 11, INK);
  } else if (mood === 'asleep') {
    both(6, 11, INK);
    both(7, 11, INK);
  } else if (mood === 'ghost') {
    both(6, 10, INK);
    both(7, 10, INK);
    both(6, 11, INK);
    both(7, 11, INK);
  } else {
    both(7, 10, INK);
    both(7, 11, INK);
  }

  // mouth
  if (mood === 'lively') {
    G.row(9, 12, 13 + dy, INK);
    put(10, 14, P.mouth);
    put(11, 14, P.mouth);
  } else if (mood === 'awake') {
    put(10, 13, INK);
    put(11, 13, INK);
    if (!T.beard || T.beard === 'goatee') {
      put(9, 12, INK);
      put(12, 12, INK);
    }
  } else if (mood === 'bored') {
    G.row(10, 12, 13 + dy, INK);
  } else if (mood === 'asleep') {
    put(10, 13, dark(P.mouth, 0.2));
    put(11, 13, dark(P.mouth, 0.2));
  } else if (mood === 'ghost') {
    put(10, 12, INK);
    put(11, 12, INK);
    put(9, 13, INK);
    put(12, 13, INK);
  }

  // glasses
  if (T.glasses) {
    const g = P.glasses;
    if (T.glasses === 'round') {
      both(6, 9, g);
      both(7, 9, g);
      both(5, 10, g);
      both(5, 11, g);
      both(8, 10, g);
      both(8, 11, g);
      both(6, 12, g);
      both(7, 12, g);
    } else {
      for (let x = 5; x <= 8; x++) {
        both(x, 9, g);
        both(x, 12, g);
      }
      both(5, 10, g);
      both(5, 11, g);
      both(8, 10, g);
      both(8, 11, g);
    }
    G.row(9, 12, 10 + dy, g);
    both(4, 10, g);
  }
}

/* ------------------------------------------------------------------ body */

function drawLegs(L, T, P, dy, liftL, liftR) {
  const hip = 21 + dy;
  const split = 23 + dy;
  const kind = T.bottomKind;
  for (const [side, lift] of [[0, liftL], [1, liftR]]) {
    const row = (a, b, y, c) => (side ? L.row(MX - b, MX - a, y, c) : L.row(a, b, y, c));
    const shoeBot = 26 - lift;
    const shoeTop = shoeBot - 1;
    for (let y = hip; y < shoeTop; y++) {
      let c = P.skin;
      if (kind === 'pants') c = P.bottom;
      else if (kind === 'shorts' && y <= split) c = P.bottom;
      if (y < split) row(6, 10, y, c);
      else row(7, 9, y, c);
      if (kind === 'pants' && y >= split) row(9, 9, y, P.bottomSh);
    }
    if (kind !== 'pants' && P.socks && shoeTop - 1 > split) row(7, 9, shoeTop - 1, P.socks);
    row(6, 9, shoeTop, P.shoe);
    row(6, 9, shoeBot, P.shoeSh);
    row(7, 7, shoeTop, light(P.shoe, 0.5));
  }
  if (kind === 'pants' || kind === 'shorts') L.row(10, 11, split - 1, P.bottomSh);
  if (kind === 'skirt') {
    const c = P.bottom;
    const pleat = T.outfit !== 'dress';
    L.row(6, 15, hip, c);
    L.row(5, 16, hip + 1, c);
    L.row(5, 16, hip + 2, c);
    if (pleat) for (const x of [7, 10, 14]) L.set(x, hip + 2, P.bottomSh);
    else L.row(5, 16, hip + 2, P.bottomSh);
  }
}

function drawApronSkirt(T, P, dy) {
  const A = new Grid();
  A.rect(8, 21 + dy, 13, 23 + dy, P.apron);
  A.row(9, 12, 22 + dy, dark(P.apron, 0.12));
  return A;
}

function drawTorso(Tr, T, P) {
  const c = P.top;
  const s = P.topSh;
  Tr.row(6, 15, 16, c);
  Tr.rect(7, 17, 14, 20, c);
  const neck = () => {
    Tr.row(9, 12, 16, s);
    Tr.row(10, 11, 16, P.skin);
  };
  switch (T.outfit) {
    case 'tee':
      neck();
      if (T.print === 'pocket') Tr.rect(11, 18, 12, 19, s);
      else if (T.print === 'band') Tr.row(7, 14, 18, P.accent);
      else if (T.print === 'heart') {
        Tr.set(9, 17, P.accent);
        Tr.set(12, 17, P.accent);
        Tr.row(9, 12, 18, P.accent);
        Tr.row(10, 11, 19, P.accent);
      }
      break;
    case 'collar':
      Tr.row(8, 9, 16, P.collar);
      Tr.row(12, 13, 16, P.collar);
      Tr.row(10, 11, 16, P.skin);
      if (T.tie) {
        Tr.row(10, 11, 17, dark(P.accent, 0.15));
        Tr.row(10, 11, 18, P.accent);
        Tr.row(10, 11, 19, P.accent);
      } else {
        Tr.set(10, 17, s);
        Tr.set(10, 19, s);
      }
      break;
    case 'hoodie':
      Tr.row(6, 15, 16, s);
      Tr.row(10, 11, 16, P.skin);
      for (const x of [9, 12]) {
        Tr.set(x, 17, CREAM);
        Tr.set(x, 18, CREAM);
      }
      Tr.row(8, 13, 19, s);
      Tr.set(8, 20, s);
      Tr.set(13, 20, s);
      break;
    case 'stripes':
      neck();
      Tr.row(7, 14, 17, P.accent);
      Tr.row(7, 14, 19, P.accent);
      break;
    case 'apron':
      neck();
      Tr.rect(9, 18, 12, 20, P.apron);
      Tr.set(9, 17, P.apron);
      Tr.set(12, 17, P.apron);
      Tr.row(10, 11, 19, dark(P.apron, 0.12));
      break;
    case 'dress':
      Tr.row(8, 9, 16, CREAM);
      Tr.row(12, 13, 16, CREAM);
      Tr.row(10, 11, 16, P.skin);
      Tr.row(7, 14, 20, s);
      break;
    case 'overalls':
      neck();
      Tr.rect(8, 18, 13, 20, P.bottom);
      Tr.set(8, 17, P.bottom);
      Tr.set(13, 17, P.bottom);
      Tr.set(9, 18, GOLD);
      Tr.set(12, 18, GOLD);
      Tr.row(10, 11, 19, P.bottomSh);
      break;
    case 'cardigan':
      Tr.row(9, 12, 16, P.accent);
      Tr.rect(10, 17, 11, 20, P.accent);
      Tr.set(9, 17, s);
      Tr.set(12, 17, s);
      Tr.set(9, 18, CREAM);
      Tr.set(9, 20, CREAM);
      break;
    case 'sweater':
      Tr.row(8, 13, 16, P.accent);
      Tr.row(10, 11, 16, P.skin);
      for (let x = 7; x <= 14; x++) if (x % 2) Tr.set(x, 20, s);
      Tr.set(9, 17, P.accent);
      Tr.set(12, 17, P.accent);
      Tr.row(9, 12, 18, P.accent);
      Tr.row(10, 11, 19, P.accent);
      break;
    default:
      neck();
  }
}

function drawArms(A, T, P, pose, phase) {
  const long = T.sleeves === 'long';
  const stripe = T.outfit === 'stripes' ? P.accent : null;
  const sleeve = (y) => (stripe && (y === 17 || y === 19) ? stripe : P.sleeve);
  const fore = (y) => (long ? sleeve(y) : P.skin);
  for (const side of [0, 1]) {
    const put = (x, y, c) => A.set(side ? MX - x : x, y, c);
    if (pose === 'type') {
      // forearms point at the keyboard (foreshortened): hands tuck in a pixel
      // and tap up/down alternately, all above WAIST_Y
      const up = (side === 1) === (phase === 0);
      for (let y = 17; y <= 18; y++) {
        put(5, y, sleeve(y));
        put(6, y, sleeve(y));
      }
      if (up) {
        put(6, 19, P.skin);
        put(7, 19, P.skin);
      } else {
        put(5, 19, fore(19));
        put(6, 19, fore(19));
        put(6, 20, P.skin);
        put(7, 20, P.skin);
      }
    } else {
      for (let y = 17; y <= 20; y++) {
        const c = y <= 18 ? sleeve(y) : y === 19 ? fore(y) : P.skin;
        put(5, y, c);
        put(6, y, c);
      }
    }
  }
}

/* ------------------------------------------------------------------ stage */

function drawShell(top) {
  const S = new Grid();
  const y0 = Math.max(1, top - 1);
  const c = '#fff6dc';
  const sh = '#ecd8a6';
  S.row(8, 13, y0, c);
  S.row(6, 15, y0 + 1, c);
  S.row(5, 16, y0 + 2, c);
  S.row(4, 17, y0 + 3, c);
  for (let x = 4; x <= 17; x++) if (x % 3 !== 0) S.set(x, y0 + 4, sh);
  S.row(15, 16, y0 + 2, sh);
  S.set(17, y0 + 3, sh);
  S.set(7, y0 + 1, '#ffffff');
  S.set(6, y0 + 2, '#ffffff');
  S.set(12, y0 + 1, '#f6c9d9');
  S.set(14, y0 + 3, '#f6c9d9');
  return S;
}

function drawCrown(top) {
  const C = new Grid();
  const b = Math.max(3, top + 1);
  const y0 = b - 2;
  const g = GOLD;
  C.set(8, y0, g);
  C.row(10, 11, y0, g);
  C.set(13, y0, g);
  C.row(8, 13, y0 + 1, g);
  C.row(8, 13, b, dark(g, 0.18));
  C.row(10, 11, b, '#ff6fae');
  C.set(8, y0 + 1, '#fff6c8');
  return C;
}

/* ------------------------------------------------------------------ props */

// Held at the right hand (viewer's right). Interior pixels only — the ink
// ring is added by stamp(). The hand (x 15–16, y 20) is redrawn on top.
const PROPS = {
  music: { at: [17, 18], map: ['ccccc', 'cwwwc', 'ckwkc', 'cdddc'] }, // cassette
  camera: { at: [17, 17], map: ['...y.', 'ccccc', 'cwkcc', 'ckkcc', 'ccccc'] },
  game: { at: [17, 16], map: ['cccc', 'cmmc', 'cmmc', 'cccc', 'kcpc', 'cccc'] }, // handheld console
  writing: { at: [17, 16], map: ['....p', 'ccc.y', 'kwc.y', 'ccc.y', 'kcc.n', 'ccc..'] }, // notebook + pencil
  mail: { at: [17, 18], map: ['vwwwv', 'wvwvw', 'wwpww', 'wwwww'] }, // envelope
  '3d': { at: [17, 17], map: ['.TTTT', 'TTTTR', 'LLLLR', 'LLLLR', 'LLLL.'] }, // box/cube, oblique
  social: { at: [17, 16], map: ['...d', 'cccc', 'cssc', 'cssc', 'dddd', 'ckkc', 'cccc'] }, // flip phone
  ai: { at: [17, 15], map: ['..y..', 'yyyyy', '.yyy.', '.y.y.', 'l....', 'l....', 'l....'] }, // star wand
  art: { at: [17, 15], map: ['....p', '....n', '....n', '.aaaa', 'apaya', 'aaab.', '.amaa'] }, // palette + brush
  party: { at: [18, 1], map: ['.cc.', 'cecc', 'cccc', 'cccc', '.cc.', '..d.'], string: true }, // balloon
  web: { at: [17, 17], map: ['pymbb', 'wwwww', 'wllww', 'wwwww', 'wlllw'] }, // browser window
  code: { at: [17, 17], map: ['cggg.', 'cgkgc', 'ccccc', 'cwwwc', 'cwwwc'] }, // floppy disk
};

function drawProp(G, T, P, kind, dy) {
  const def = PROPS[kind];
  if (!def) return;
  const pi = PROP_COLORS.indexOf(P.prop);
  let c = P.prop;
  if (kind === 'mail') c = CREAM;
  else if (kind === 'code') c = ['#3b4cca', '#4a4766', '#ff6fae', '#6f5fd0'][pi % 4];
  else if (kind === '3d') c = ['#ff6fae', '#3b4cca', '#8f7bff', '#4fb3e8'][pi % 4];
  const pal = {
    c, d: dark(c, 0.3), e: light(c, 0.55), k: INK, w: CREAM, g: '#cfcbe0', y: GOLD,
    p: c === '#ff6fae' ? '#3b4cca' : '#ff6fae', m: kind === 'game' ? '#bfe86a' : '#a8f0d4', b: '#3b4cca',
    s: '#a9dcff', l: '#c9b6ff', n: '#c98f5e', v: '#bdb3e6', T: light(c, 0.6), L: c, R: dark(c, 0.38),
    a: '#f3d6a6',
  };
  const L = new Grid();
  const [x0, y0] = def.at;
  def.map.forEach((line, j) => {
    for (let i = 0; i < line.length; i++) if (line[i] !== '.') L.set(x0 + i, y0 + j, pal[line[i]]);
  });
  stamp(G, L, dy);
  if (def.string) {
    // string runs down to the hand without touching the arm's outline
    const pts = [[20, 7], [20, 8], [20, 9], [20, 10], [20, 11], [20, 12], [20, 13], [19, 14], [19, 15], [19, 16], [18, 17], [18, 18], [18, 19]];
    for (const [x, y] of pts) G.set(x, y + dy, '#8f8ab8');
  }
  G.set(15, 20 + dy, P.skin);
  G.set(16, 20 + dy, P.skin);
}

/* ------------------------------------------------------------------ frames */

function renderFrame(T, P, o) {
  const G = new Grid();
  const walk = o.pose === 'walk';
  const bodyDy = walk && o.phase === 1 ? 1 : 0;
  const headDy = bodyDy + (o.pose === 'sleep' ? 1 : 0);

  const H = new Grid();
  const B = new Grid();
  drawHead(H, B, T, P);
  stamp(G, B, headDy);

  const L = new Grid();
  drawLegs(L, T, P, bodyDy, walk && o.phase === 0 ? 1 : 0, walk && o.phase === 1 ? 1 : 0);
  stamp(G, L);
  if (T.outfit === 'apron') stamp(G, drawApronSkirt(T, P, bodyDy));

  const Tr = new Grid();
  drawTorso(Tr, T, P);
  stamp(G, Tr, bodyDy);
  const A = new Grid();
  drawArms(A, T, P, o.pose, o.phase);
  stamp(G, A, bodyDy);

  stamp(G, H, headDy);
  drawFace(G, T, P, o.face, headDy);
  if (T.bow) stamp(G, drawBow(T), headDy);

  const top = H.topIn(7, 14) + headDy;
  if (o.stage === 'hatchling') stamp(G, drawShell(top));
  else if (o.stage === 'shipped') stamp(G, drawCrown(top));

  if ((o.pose === 'stand' || walk) && o.kind) drawProp(G, T, P, o.kind, bodyDy);
  return G;
}

/* ------------------------------------------------------------------ public */

const MOODS = new Set(['lively', 'awake', 'bored', 'asleep', 'ghost']);
const STAGES = new Set(['hatchling', 'growing', 'shipped']);
const people = new Map();
const eggs = new Map();
const CACHE_MAX = 600;

function remember(map, key, value) {
  if (map.size >= CACHE_MAX) map.delete(map.keys().next().value);
  map.set(key, value);
  return value;
}

export function person(seed, opts = {}) {
  seed = Number(seed) >>> 0;
  const o = opts || {};
  const mood = MOODS.has(o.mood) ? o.mood : 'awake';
  const stage = STAGES.has(o.stage) ? o.stage : 'growing';
  const kind = o.kind && Object.prototype.hasOwnProperty.call(PROPS, o.kind) ? o.kind : null;
  // dress-up choices win over the seed; a project's brand colour becomes the outfit
  const traits = o.traits && typeof o.traits === 'object' ? o.traits : null;
  const outfitColor = /^#[0-9a-f]{6}$/i.test(o.outfitColor || '') ? o.outfitColor.toLowerCase() : null;
  const key = `${seed}|${mood}|${stage}|${kind}|${traits ? JSON.stringify(traits) : ''}|${outfitColor || ''}`;
  const hit = people.get(key);
  if (hit) return hit;

  const T = { ...traitsFor(seed), ...(traits || {}) };
  if (outfitColor && !(traits && 'top' in traits)) {
    if (T.outfit === 'overalls') T.bottom = outfitColor;
    else T.top = outfitColor;
    if (T.outfit === 'dress') T.bottom = T.top;
    if (T.accent === outfitColor) T.accent = CREAM;
  }
  const P = paletteFor(T);
  const tone = mood === 'ghost' ? ghostly : null;
  const frame = (pose, phase = 0, face = mood) => renderFrame(T, P, { pose, phase, face, stage, kind });
  const out = {
    stand: toCanvas(frame('stand'), tone),
    walk: [toCanvas(frame('walk', 0), tone), toCanvas(frame('walk', 1), tone)],
    type: [toCanvas(frame('type', 0), tone), toCanvas(frame('type', 1), tone)],
    sleep: toCanvas(frame('sleep', 0, 'asleep'), tone),
    lie: toCanvas(rotateCCW(frame('lie', 0, 'asleep')), tone),
    color: tone ? tone(P.main) : P.main,
  };
  return remember(people, key, out);
}

// for the dress-up window: what a seed looks like, and every choice there is
export const traitsOf = (seed) => ({ ...traitsFor(Number(seed) >>> 0) });
export const TRAIT_CHOICES = {
  skin: SKINS,
  style: STYLES,
  hairColor: [...HAIR_NAT.map(([c]) => c), ...HAIR_PASTEL, ...HAIR_OLD],
  hat: [null, 'beanie', 'cap', 'scarf'],
  hatColor: HATS,
  outfit: OUTFITS,
  top: TOPS,
  bottomKind: ['pants', 'shorts', 'skirt'],
  bottom: [...BOTTOMS, ...DENIM],
  shoe: SHOES,
  glasses: [null, 'round', 'square'],
  beard: [null, 'full', 'goatee', 'mustache'],
  extras: ['phones', 'bow', 'freckles', 'blush'],
};

/* ------------------------------------------------------------------ eggs */

const EGG_ROWS = [
  [1, 4, 6], [2, 3, 7], [3, 2, 8], [4, 2, 8], [5, 1, 9], [6, 1, 9],
  [7, 1, 9], [8, 1, 9], [9, 1, 9], [10, 1, 9], [11, 2, 8], [12, 3, 7],
];
const EGG_BASES = ['#ffc4dd', '#fff0a8', '#ddd0ff', '#dff5a8', '#cdeaff', '#ffd9bf', '#c8f5e2', '#fff3dc'];
const EGG_INKS = ['#ff6fae', '#7b8cff', '#f5c518', '#a78bff', '#8fd14f', '#5fb8f0', '#ff9a6b', '#4fd1a5'];
const EGG_PATTERNS = ['spots', 'stripes', 'zigzag', 'hearts'];

export function egg(seed, opts = {}) {
  seed = Number(seed) >>> 0;
  const cold = !!(opts && opts.cold);
  const key = `${seed}|${cold}`;
  const hit = eggs.get(key);
  if (hit) return hit;

  const R = makeRng(seed, 0xac0d51fb);
  const bi = R.int(EGG_BASES.length);
  let pi = R.int(EGG_INKS.length);
  if (pi === bi) pi = (pi + 3) % EGG_INKS.length;
  const pattern = R.pick(EGG_PATTERNS);
  const flip = R.chance(0.5);

  let base = EGG_BASES[bi];
  let ink = EGG_INKS[pi];
  if (cold) {
    base = '#dcefff';
    ink = '#b3cbe3';
  }
  const shade = cold ? '#a9c3de' : dark(base, 0.16);

  const E = new Grid(EGG_W, EGG_H, 0);
  for (const [y, a, b] of EGG_ROWS) E.row(a, b, y, base);
  const dot = (x, y) => E.recolor(flip ? 10 - x : x, y, ink);

  if (pattern === 'spots') {
    for (const [x, y] of [[3, 3], [6, 5], [7, 5], [2, 7], [5, 8], [8, 9], [3, 10], [4, 10], [6, 11]]) dot(x, y);
  } else if (pattern === 'stripes') {
    for (let x = 0; x < EGG_W; x++) {
      E.recolor(x, 5, ink);
      E.recolor(x, 9, ink);
      if (x % 2) E.recolor(x, 7, ink);
    }
  } else if (pattern === 'zigzag') {
    const wave = [0, 1, 2, 1];
    for (let x = 0; x < EGG_W; x++) {
      const y = 6 + wave[(x + (flip ? 2 : 0)) % 4];
      E.recolor(x, y, ink);
      E.recolor(x, y + 1, ink);
    }
    for (const x of [3, 7]) E.recolor(x, 3 + (x === 7 ? 1 : 0), ink);
    E.recolor(5, 11, ink);
  } else {
    // one plump heart in the middle and a couple of dots
    for (const [x, y] of [[4, 6], [6, 6], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [4, 8], [5, 8], [6, 8], [5, 9]]) {
      E.recolor(x, y, ink);
    }
    E.recolor(4, 6, ink);
    dot(3, 3);
    dot(7, 11);
    dot(7, 4);
  }

  // rim shade on the lower right
  for (const [y, a, b] of EGG_ROWS) {
    for (let x = a; x <= b; x++) {
      const c = E.get(x, y);
      if (c !== base) continue;
      if (!E.get(x + 1, y) || !E.get(x, y + 1)) E.set(x, y, shade);
    }
  }
  E.set(3, 3, '#ffffff');
  E.set(3, 4, '#ffffff');
  E.set(4, 2, cold ? '#ffffff' : light(base, 0.6));

  if (cold) {
    // frost: a white crust on top plus a couple of sparkles
    E.row(4, 6, 1, '#ffffff');
    E.row(3, 7, 2, '#f4fbff');
    for (const [x, y] of [[2, 3], [8, 3], [5, 3]]) E.recolor(x, y, '#f4fbff');
    E.set(7, 7, '#ffffff');
    E.set(2, 9, '#ffffff');
  }

  const G = new Grid(EGG_W, EGG_H, 0);
  stamp(G, E);
  return remember(eggs, key, toCanvas(G, null));
}
