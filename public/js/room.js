// The studio: a cosy side-view pixel room the brainchildren live in.
//
// layoutRoom(W, H) works out where everything goes (a pure function, integer
// scene pixels, origin top-left). paintRoom(back, front, layout, state) paints
// the whole room on `back` and, on `front`, only the desk and sofa fronts that
// hide a seated person below the waist. The app stacks:
//   back -> seated people -> front -> walking people -> ghosts.
//
// Everything that never changes is painted once per size into offscreen
// canvases, so a repaint is one drawImage plus the live bits: the sky, the
// clock hands, the calendar, the monitors and chairs, the little counters and
// the lighting.

const INK = '#2b2a5e';
const SOFT = '#6c6896';
const CEIL = 5; // ceiling strip height
const MIN_GAP = 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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

// one fill, one highlight, one shadow per material
const mat = (f, hi, lo) => ({ f, hi, lo });
const MAT = {
  sky: mat('#a9dcff', '#d8f0ff', '#78b0e2'),
  pink: mat('#ffb5d2', '#ffdcea', '#e589b1'),
  butter: mat('#ffe28a', '#fff4c4', '#e5bd5a'),
  mint: mat('#a6ecd0', '#d6fbea', '#6fc6a4'),
  lilac: mat('#c9b6ff', '#e6dcff', '#9a85dc'),
  cream: mat('#fff4e4', '#ffffff', '#e4cfb4'),
  wood: mat('#eab27f', '#f7d1a3', '#c98a59'),
  peach: mat('#ffc6a1', '#ffe2cc', '#e89c75'),
  white: mat('#f8f6ff', '#ffffff', '#d3cdee'),
  leaf: mat('#8ed49f', '#c6f0c9', '#5aa878'),
  straw: mat('#f0cd8a', '#fde6b6', '#c99652'),
  navy: mat('#7a83e6', '#aab1ff', '#5a61c2'),
  rose: mat('#f07fae', '#ffb0cf', '#cc5b8c'),
};
const SPINES = [MAT.pink, MAT.sky, MAT.mint, MAT.butter, MAT.lilac, MAT.peach, MAT.navy, MAT.rose];

const C = {
  ceil: '#c3b3f4',
  ceilHi: '#efe9ff',
  ceilLo: '#a490dc',
  wall: '#d9cbff',
  wallShade: '#cdbdf8',
  wallDot: '#e5dbff',
  wallDot2: '#cfc0fa',
  railHi: '#fff7fb',
  rail: '#ffe1ee',
  railLo: '#d6a2c1',
  wains: '#f6c2db',
  wainsLo: '#e9a9c8',
  wainsHi: '#fcd5e7',
  baseHi: '#fff6fa',
  base: '#fbe3ee',
  baseLo: '#d39ebb',
  woodA: '#e3a974',
  woodB: '#dea06c',
  woodC: '#e8b07c',
  woodHi: '#f1c595',
  woodSeam: '#ca8b58',
  woodGrain: '#d49563',
  shadow: '#c5874f',
  shadow2: '#d29763',
  frame: '#fff6ea',
  frameHi: '#ffffff',
  frameLo: '#e6d2bb',
  paper: '#fffdf6',
  shelfBack: '#d79a6a',
  board: '#fdfcff',
  boardLine: '#ebe8fb',
};

// wallpaper palettes, each with its own matching wainscot ('lilac' = the
// original room)
const wallPal = (ceil, ceilHi, ceilLo, wall, wallShade, wallDot, wallDot2, railHi, rail, railLo, wains, wainsLo, wainsHi, baseHi, base, baseLo) => ({
  ceil, ceilHi, ceilLo, wall, wallShade, wallDot, wallDot2, railHi, rail, railLo, wains, wainsLo, wainsHi, baseHi, base, baseLo,
});
const WALLS = {
  lilac: wallPal(C.ceil, C.ceilHi, C.ceilLo, C.wall, C.wallShade, C.wallDot, C.wallDot2, C.railHi, C.rail, C.railLo, C.wains, C.wainsLo, C.wainsHi, C.baseHi, C.base, C.baseLo),
  mint: wallPal('#a9dcc6', '#e6fbf1', '#86c3a9', '#c8f0de', '#bbe8d3', '#dcf9ec', '#b4e3cd', '#ffffff', '#f1ecff', '#a99ad8', '#d7caff', '#c4b4f2', '#e5dcff', '#ffffff', '#efe9ff', '#a796d6'),
  peach: wallPal('#f5c1a6', '#fff0e6', '#d9a084', '#ffdcc8', '#f9cfb9', '#ffe9dc', '#f5c8b0', '#ffffff', '#eaf5ff', '#8fb3d8', '#c2e0fb', '#a9cff3', '#d6ebff', '#ffffff', '#e4f1ff', '#8daed2'),
  sky: wallPal('#add0f0', '#ebf6ff', '#88b0d8', '#cfe6ff', '#c2dcf7', '#e2f1ff', '#bad6f3', '#fffdf2', '#fff6d8', '#d4b06a', '#ffe7a8', '#f2d088', '#fff1c8', '#fffdf2', '#fff3cf', '#ccab62'),
  butter: wallPal('#f0da96', '#fffbe8', '#d3b96e', '#fff0bf', '#f9e6ae', '#fff8dc', '#f3e0a2', '#ffffff', '#ecfbf3', '#7cbc9f', '#bcebd5', '#a2dbc1', '#d1f5e4', '#ffffff', '#e5f8ee', '#79b699'),
  cocoa: wallPal('#c39e8b', '#f2dfd3', '#a47e6c', '#dcbcaa', '#d2b09d', '#e8cfc0', '#cca693', '#fffaf4', '#fff1e4', '#b48e79', '#f2dfcc', '#e3c7af', '#faeddf', '#fffaf4', '#f6e6d6', '#ae8671'),
};
// floors: the planks/tiles/mats plus the matching contact shadow
const FLOORS = {
  wood: { kind: 'wood', shadow: C.shadow, shadow2: C.shadow2 },
  checker: { kind: 'checker', a: '#fff1f6', b: '#f8d3e4', hi: '#ffffff', seam: '#ebbcd2', shadow: '#d8a5bd', shadow2: '#e6bccf' },
  carpet: { kind: 'carpet', f: '#c8d6fa', hi: '#dbe5ff', lo: '#b5c5ef', seam: '#a9bae6', shadow: '#9cadd9', shadow2: '#b0bfe8' },
  tatami: { kind: 'tatami', f: '#e1e6ad', hi: '#eef1c9', lo: '#d4d99c', edge: '#aaa5e4', shadow: '#b7bd7e', shadow2: '#cacf93' },
};
let WP = WALLS.lilac; // the palettes in use while baking
let FP = FLOORS.wood;

// tiny 3x5 pixel font
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100110101010', 7: '111001010010010',
  8: '010101010101010', 9: '010101011001110',
  '+': '000010111010000', '-': '000000111000000', '!': '010010010000010', '.': '000000000000010',
  ' ': '000000000000000',
};
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// small hand-drawn sprites ('.' = transparent)
const HEART9 = ['.kkk.kkk.', 'khhpkpppk', 'khppppppk', 'kppppppok', '.kpppppk.', '..kppok..', '...kpk...', '....k....'];
const HEART7 = ['.kk.kk.', 'khpkppk', 'kpppppk', '.kpppk.', '..kpk..', '...k...'];
const BULB = [
  '..kkkkk..',
  '.khhyyyk.',
  'khhyyyyyk',
  'khyyyyyyk',
  'kyyyyyyyk',
  'kyyyyyyok',
  '.kyyyyok.',
  '..kyyok..',
  '..kkkkk..',
  '..kgggk..',
  '..kkkkk..',
  '..kgggk..',
  '...kkk...',
];
const HOURGLASS = ['kkkkkkk', '.kyyyk.', '.kgyyk.', '..kyk..', '...k...', '..kgk..', '.kgygk.', '.kyyyk.', 'kkkkkkk'];
const TROPHY = ['kkkkk', 'khyyk', 'kyyok', '.kok.', '..k..', '.kyk.', '.kkk.'];
const STAR5 = ['..k..', '.kyk.', 'kyyyk', '.kyk.', '.k.k.'];
const MUG = ['kkkk..', 'khpkk.', 'kppk.k', 'kppkk.', '.kk...'];
const FISH = ['.ppp.p', 'pkpppp', '.ppp.p'];

// ------------------------------------------------------------------ layout

const CHAIR_AW = 5; // your armchair: two arms around a 22px cushion
const CHAIR_W = CHAIR_AW * 2 + 22;

function plan(W, lv, chair = true) {
  const narrow = lv === 0;
  const dw = narrow ? 36 : lv < 4 ? 40 : lv < 6 ? 44 : lv < 9 ? 46 : 48;
  const ss = lv < 5 ? 20 : 21; // sofa seat pitch: three 20px sitters fit between the arms
  const aw = narrow ? 6 : 7;
  const items = [];
  const add = (id, w, gw) => items.push({ id, w, gw });
  add('door', narrow ? 24 : 26, 0.6);
  if (lv >= 8) add('coat', 12, 0.4);
  if (lv >= 4) add('plantA', 12, 0.5);
  add('fridge', narrow ? 20 : 22, lv >= 4 ? 0.5 : 1);
  add('bin', narrow ? 9 : 10, 0.4);
  add('cabinet', narrow ? 38 : 20, 0.4);
  if (chair) add('chair', CHAIR_W, 0.7);
  add('desk0', dw, 1.2);
  add('desk1', dw, 0.5);
  add('desk2', dw, 0.5);
  if (lv >= 2) add('plantB', 10, 0.8);
  if (lv >= 9) add('sideTable', 18, 0.5);
  add('sofa', ss * 3 + aw * 2 + 2, lv >= 9 ? 0.4 : lv >= 2 ? 0.7 : 1.2);
  if (lv >= 5) add('lamp', 10, 0.3);
  if (!narrow) add('nest', 46, lv >= 5 ? 0.6 : 1);
  if (lv >= 7) add('aquarium', 30, 0.8);
  if (lv >= 3) add('bookshelf', 30, 0.8);
  if (lv >= 6) add('plantC', 14, 0.4);
  const used = items.reduce((s, it) => s + it.w, 0) + (items.length + 1) * MIN_GAP;
  const wsum = items.reduce((s, it) => s + it.gw, 0) + 0.6;
  return { lv, narrow, dw, ss, aw, items, slack: W - used, wsum };
}

function pickPlan(W) {
  if (W < 380) {
    // the tiniest rooms can't fit the armchair against the wall: it stands
    // on the floor in front of the door instead
    const p = plan(W, 0);
    return p.slack >= 2 ? p : plan(W, 0, false);
  }
  // the richest set of furniture that still leaves comfortable gaps
  for (let lv = 9; lv > 1; lv--) {
    const p = plan(W, lv);
    if (p.slack / p.wsum >= (lv >= 9 ? 12 : lv >= 8 ? 10 : 6.5)) return p;
  }
  return plan(W, 1);
}

// a summed-area table of where the rects (grown by m) cover the wall, so
// any 'is this rect clear?' question is answered in constant time
function occupancy(W, H, rects, m) {
  const grid = new Uint8Array(W * H);
  for (const r of rects) {
    const x0 = Math.max(0, r.x - m);
    const x1 = Math.min(W, r.x + r.w + m);
    for (let y = Math.max(0, r.y - m), y1 = Math.min(H, r.y + r.h + m); y < y1; y++) if (x1 > x0) grid.fill(1, y * W + x0, y * W + x1);
  }
  const W1 = W + 1;
  const sat = new Int32Array(W1 * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += grid[y * W + x];
      sat[(y + 1) * W1 + x + 1] = sat[y * W1 + x + 1] + row;
    }
  }
  return (r) =>
    r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H &&
    sat[(r.y + r.h) * W1 + r.x + r.w] - sat[r.y * W1 + r.x + r.w] - sat[(r.y + r.h) * W1 + r.x] + sat[r.y * W1 + r.x] === 0;
}

const overlaps = (a, b, m = 0) =>
  a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

export function layoutRoom(W, H) {
  W = Math.round(W);
  H = Math.round(H);
  const floorY = clamp(Math.round(100 + (H - 170) * 0.4), 84, H - 52);
  const base = floorY + 9; // front edge of the furniture standing on the floor
  const sy = base - 3; // feet of anyone sitting at a desk or on the sofa
  const railY = floorY - 21; // top of the wainscot
  const p = pickPlan(W);
  const { lv, narrow, dw, ss, aw } = p;

  const pos = {};
  let cw = 0;
  let sum = 0;
  p.items.forEach((it, i) => {
    cw += it.gw;
    pos[it.id] = { x: sum + (i + 1) * MIN_GAP + Math.round((p.slack * cw) / p.wsum), w: it.w };
    sum += it.w;
  });

  const parts = { lv, narrow, base, sy, floorY, railY };
  const taken = []; // wall rectangles already used
  const furn = []; // what stands in front of the wall
  const box = (x, y, w, h) => furn.push({ x, y, w, h });

  // door (set into the back wall), the studio's name sign over it and the
  // clock above that
  const dh = Math.min(58, floorY - CEIL - 42);
  const door = { x: pos.door.x, y: floorY - dh, w: pos.door.w, h: dh };
  parts.door = door;
  const dcx = door.x + (door.w >> 1);
  const sgw = W >= 420 ? 46 : narrow ? 36 : 40;
  const sign = { x: clamp(dcx - (sgw >> 1), 2, W - 2 - sgw), y: door.y - 14, w: sgw, h: 11 };
  parts.sign = sign;
  const clock = { cx: dcx, cy: Math.max(CEIL + 11, sign.y - 10) };
  parts.clock = clock;
  const clockR = { x: clock.cx - 7, y: clock.cy - 8, w: 15, h: 16 };
  taken.push({ x: door.x - 2, y: door.y, w: door.w + 4, h: dh }, clockR, { x: sign.x - 1, y: sign.y - 1, w: sign.w + 2, h: sign.h + 2 });

  const fridge = { x: pos.fridge.x, w: pos.fridge.w, h: narrow ? 42 : 46 };
  fridge.top = base - fridge.h;
  parts.fridge = fridge;
  const bin = { x: pos.bin.x, w: pos.bin.w, h: narrow ? 11 : 12 };
  bin.top = base - bin.h;
  parts.bin = bin;
  const cab = { x: pos.cabinet.x, w: pos.cabinet.w, h: narrow ? 24 : 34, lateral: narrow };
  cab.top = base - cab.h;
  parts.cabinet = cab;
  if (lv >= 2) parts.printer = { x: cab.x + 1, y: cab.top - 6, w: cab.w - 2 };
  box(fridge.x, fridge.top - 1, fridge.w, fridge.h + 1);
  box(bin.x - 1, bin.top - 6, bin.w + 2, bin.h + 6);
  box(cab.x, parts.printer ? cab.top - 10 : cab.top, cab.w, base - cab.top + 10);

  // the incubator: on its own little table, or on the low cabinet when narrow
  let nest;
  if (narrow) {
    nest = { cx: cab.x + (cab.w >> 1), ty: cab.top - 8, onCab: true, poleX: cab.x + cab.w - 3, poleBase: cab.top };
  } else {
    const nx = pos.nest.x;
    const stTop = base - 12;
    nest = { cx: nx + 23, ty: stTop - 8, onCab: false, stand: { x: nx + 3, y: stTop, w: 40 }, poleX: nx + 41, poleBase: stTop };
  }
  nest.lampTop = nest.ty - 23;
  nest.slots = [
    ...[-3, 9, -15].map((o) => ({ x: nest.cx + o, y: nest.ty + 5 })),
    ...[3, -9, 15].map((o) => ({ x: nest.cx + o, y: nest.ty + 9 })),
  ];
  parts.nest = nest;
  // the heat lamp (dome, arm and pole) and the bowl below it
  box(nest.cx - 8, nest.lampTop - 1, nest.poleX + 2 - (nest.cx - 8), base - nest.lampTop + 1);
  box(nest.cx - 24, nest.ty - 2, 48, base - nest.ty + 2);
  const nestR = { x: nest.cx - 23, y: nest.lampTop, w: 46, h: (narrow ? cab.top + 2 : base) - nest.lampTop };
  furn.push(nestR);

  const y0 = sy - 17; // desk tops
  parts.desks = [0, 1, 2].map((i) => {
    const { x } = pos['desk' + i];
    const mon = { x: x + (narrow ? 1 : 2), w: narrow ? 12 : 14 };
    // the desk, its monitor, and a cat (any pose) napping on top of it
    box(x, y0 - 16, dw, base - (y0 - 16));
    box(mon.x + (mon.w >> 1) - 8, y0 - 26, 16, 12);
    return {
      i,
      x,
      w: dw,
      sx: x + (narrow ? 24 : 28),
      mon,
      screen: { x: mon.x + 3, y: y0 - 12, w: mon.w - 5, h: 7 },
      cat: { x: mon.x + (mon.w >> 1), y: y0 - 14 },
      acc: dw >= 44 ? ['mug', 'lamp', 'plant'][i] : null,
    };
  });

  const so = pos.sofa;
  const sofa = { x: so.x, w: so.w, aw, ss };
  sofa.seats = [0, 1, 2].map((k) => ({ x: so.x + aw + 1 + (ss >> 1) + ss * k, y: sy }));
  parts.sofa = sofa;
  box(sofa.x, sy - 34, sofa.w, base - sy + 34);

  // your spot: an armchair between the cabinet and the desks, or (in the
  // tiniest rooms) out on the floor in front of the door
  const chair = pos.chair
    ? { x: pos.chair.x, w: CHAIR_W, y: sy, floor: false }
    : { x: clamp(dcx - (CHAIR_W >> 1), 2, W - 2 - CHAIR_W), w: CHAIR_W, y: base + 6, floor: true };
  chair.cx = chair.x + CHAIR_AW + 11;
  parts.chair = chair;
  box(chair.x, chair.y - 34, chair.w, 37);

  // rug in front of the sofa, with nap spots on it
  const rw = so.w + (narrow ? 16 : 24);
  const rh = clamp(Math.round((H - base) * 0.34), 16, 26);
  const rx = clamp(Math.round(so.x + so.w / 2 - rw / 2), 3, W - 3 - rw);
  const rug = { x: rx, y: base + 4, w: rw, h: rh };
  parts.rug = rug;
  const rcx = rx + (rw >> 1);
  const half = rw / 2;
  const backY = rug.y + Math.round(rh * 0.45);
  const frontY = rug.y + rh - 1;
  const naps = [];
  for (const o of [-15, 15]) if (Math.abs(o) + 14 <= half) naps.push({ x: rcx + o, y: backY });
  naps.push({ x: rcx, y: frontY });
  if (44 <= half) naps.push({ x: rcx - 30, y: frontY }, { x: rcx + 30, y: frontY });

  if (pos.bookshelf) {
    const bh = clamp(base - CEIL - 34, 54, 70);
    parts.bookshelf = { x: pos.bookshelf.x, w: 30, top: base - bh };
    taken.push({ x: pos.bookshelf.x - 2, y: base - bh - 10, w: 36, h: bh + 10 });
  }
  if (pos.aquarium) {
    parts.aquarium = { x: pos.aquarium.x, w: 30, top: base - 31 };
    box(pos.aquarium.x, base - 32, 30, 32);
  }
  if (pos.lamp) {
    parts.lamp = { x: pos.lamp.x, w: 10, top: base - 52 };
    taken.push({ x: pos.lamp.x - 2, y: base - 52, w: 14, h: 52 });
  }
  if (pos.coat) {
    parts.coat = { x: pos.coat.x, w: 12, top: base - 57 };
    taken.push({ x: pos.coat.x - 3, y: base - 57, w: 18, h: 57 });
  }
  if (pos.sideTable) {
    parts.sideTable = { x: pos.sideTable.x, w: 18 };
    box(pos.sideTable.x, base - 26, 18, 26);
  }
  parts.plants = [];
  if (pos.plantA) parts.plants.push({ kind: 'monstera', x: pos.plantA.x, w: 12 });
  if (pos.plantB) parts.plants.push({ kind: 'snake', x: pos.plantB.x, w: 10 });
  if (pos.plantC) parts.plants.push({ kind: 'fern', x: pos.plantC.x, w: 14 });
  for (const pl of parts.plants) box(pl.x - 2, base - 38, pl.w + 4, 38);

  // window above the sofa (a little grander in wide rooms)
  const scx = so.x + so.w / 2;
  let ww = narrow ? so.w - 12 : clamp(so.w + 4 + Math.max(0, Math.round((W - 540) * 0.14)), 52, 104);
  ww = Math.min(ww, 2 * Math.floor(W - 10 - scx), 2 * Math.floor(scx - 10));
  ww -= ww % 2;
  const wBottom = sy - 40;
  let wy = CEIL + 11;
  let wh = wBottom - wy;
  if (wh > 84) {
    wh = 84;
    wy = wBottom - wh;
  }
  const win = { x: Math.round(scx - ww / 2), y: wy, w: ww, h: wh };
  {
    const ix = win.x + 3;
    const iy = win.y + 3;
    const iw = ww - 6;
    const ih = wh - 6;
    const mx = win.x + (ww >> 1) - 1;
    const my = iy + Math.round(ih * 0.42);
    win.inner = { x: ix, y: iy, w: iw, h: ih };
    win.mx = mx;
    win.my = my;
    win.panes = [
      { x: ix, y: iy, w: mx - ix, h: my - iy },
      { x: mx + 2, y: iy, w: ix + iw - mx - 2, h: my - iy },
      { x: ix, y: my + 2, w: mx - ix, h: iy + ih - my - 2 },
      { x: mx + 2, y: my + 2, w: ix + iw - mx - 2, h: iy + ih - my - 2 },
    ];
  }
  parts.window = win;
  taken.push({ x: win.x - 10, y: win.y - 6, w: ww + 20, h: wh + 12 });

  // whiteboard above the desks, high enough for a cat to nap on a monitor
  const gx0 = parts.desks[0].x;
  const gx1 = parts.desks[2].x + dw;
  const bw = clamp(Math.round((gx1 - gx0) * 0.62), 64, 128);
  const bBottom = sy - 40;
  const bh = clamp(bBottom - (CEIL + 12), 30, W >= 600 ? 56 : 52);
  const board = { x: Math.round((gx0 + gx1) / 2 - bw / 2), y: bBottom - bh, w: bw, h: bh };
  {
    // left: a clean patch for the user's own words over the little chart;
    // right: a column of pinned notes
    const ix = board.x + 4;
    const iy = board.y + 4;
    const iw = bw - 8;
    const ih = bh - 8;
    const lw = Math.round(iw * 0.6);
    const th = clamp(Math.round(ih * 0.42), 12, 22);
    board.text = { x: ix + 2, y: iy + 2, w: lw - 4, h: th };
    board.chart = { x: ix + 3, top: iy + th + 6, base: iy + ih - 3, w: lw - 3 };
    const nx = ix + lw + 1;
    const room = ix + iw - nx;
    const pins = [];
    if (room >= 32) {
      const gx = nx + ((room - 31) >> 1);
      const ry = iy + clamp(ih - 15, 14, 19);
      pins.push({ x: gx, y: iy + 1 }, { x: gx + 17, y: iy + 3 }, { x: gx + 1, y: ry }, { x: gx + 16, y: ry + 2 });
    } else {
      const gx = nx + Math.max(0, (room - 14) >> 1);
      const step = Math.min(15, Math.floor((ih - 13) / 2));
      for (let k = 0; k < 3; k++) pins.push({ x: gx + (k === 1 && gx + 15 <= ix + iw ? 1 : 0), y: iy + 1 + k * step });
    }
    board.pins = pins;
  }
  parts.board = board;
  taken.push({ x: board.x, y: board.y, w: bw, h: bh + 2 });

  const fitsWall = (r) =>
    r.y - 4 >= CEIL + 4 && r.x >= 2 && r.x + r.w <= W - 2 && !taken.some((o) => overlaps(r, o, 3));
  const isFree = (r, m, top = CEIL + 8) =>
    r.x >= 2 && r.x + r.w <= W - 2 && r.y >= top && r.y + r.h <= railY && !taken.some((o) => overlaps(r, o, m)) && !furn.some((o) => overlaps(r, o, m));

  // a little floating bookshelf when there's no room for a standing one
  if (!parts.bookshelf) {
    const binR = bin.x + bin.w + 2;
    let x0 = fridge.x - 2;
    const nestL = narrow ? nest.cx - 24 : W; // the incubator's lamp sits beside it on narrow walls
    let sw = Math.min(34, binR - x0, nestL - x0);
    const bottom = fridge.top - 7;
    let sh = bottom - 25 >= CEIL + 8 ? 25 : 13;
    const clash = () => overlaps({ x: x0, y: bottom - sh, w: sw, h: sh }, sign, 3) || overlaps({ x: x0, y: bottom - sh, w: sw, h: sh }, clockR, 3);
    if (clash()) sh = 13;
    if (clash()) {
      x0 = sign.x + sign.w + 4;
      sw = Math.min(34, Math.max(binR, x0 + 24) - x0, nestL - x0);
    }
    parts.shelf = { x: x0, y: bottom - sh, w: sw, h: sh, tiers: sh > 13 ? 2 : 1 };
    taken.push(parts.shelf);
  }

  // the shelf of things you've earned: a cubby (trophies over "lessons"
  // books) with the record player on top, hung over your armchair when it
  // fits there, else on the nearest free bit of wall
  {
    const UH = 26;
    const TOP = 14; // the record player and its note
    let best = null;
    if (!chair.floor) {
      search: for (const uw of [36, 34, 32]) {
        for (let dy = 0; dy <= 26; dy += 2) {
          for (const dx of [0, -2, 2, -4, 4, -6, 6, -8, 8, -10, 10]) {
            const r = { x: Math.round(chair.cx + dx - uw / 2), y: chair.y - 37 - dy - UH - TOP, w: uw, h: UH + TOP };
            if (isFree(r, 3)) {
              best = r;
              break search;
            }
          }
        }
      }
    }
    for (const m of [3, 2]) {
      if (best) break;
      const yMin = m === 3 ? CEIL + 9 : CEIL + 6;
      const clear = occupancy(W, railY + 1, [...taken, ...furn], m);
      let bs = Infinity;
      for (const uw of [36, 34, 32, 30]) {
        const r = { x: 0, y: 0, w: uw, h: UH + TOP };
        for (let y = yMin; y + UH + TOP <= railY - 2; y++) {
          for (let x = 2; x + uw <= W - 2; x++) {
            const score = Math.abs(x + uw / 2 - chair.cx) + Math.abs(y + UH + TOP - (railY - 8)) * 0.6 + (36 - uw) * 3;
            if (score >= bs) continue;
            r.x = x;
            r.y = y;
            if (clear(r)) {
              bs = score;
              best = { ...r };
            }
          }
        }
      }
    }
    if (!best) best = { x: clamp(chair.cx - 15, 2, W - 32), y: CEIL + 9, w: 30, h: UH + TOP };
    const e = { x: best.x, y: best.y + TOP, w: best.w, h: UH };
    e.rec = { x: e.x + 2, y: e.y - 7, w: 15, h: 7 };
    parts.earned = e;
    taken.push(best);
  }

  // wall calendar: over the cabinet or the little shelf if it fits, else
  // beside the whiteboard (narrow rooms try the shelf first, which keeps the
  // wall over the incubator free)
  const calW = 19;
  const calH = 24;
  const cabTopAll = narrow ? nest.lampTop : parts.printer ? cab.top - 9 : cab.top;
  const cands = [
    { x: cab.x + (cab.w >> 1) - 9, y: cabTopAll - 8 - calH, w: calW, h: calH },
    { x: board.x - 7 - calW, y: board.y + 4, w: calW, h: calH },
    { x: board.x + board.w + 7, y: board.y + 4, w: calW, h: calH },
  ];
  if (parts.shelf) {
    const sh = parts.shelf;
    const clear = sign.x + sign.w + 5; // keep clear of the name sign
    const over = [sh.x + ((sh.w - calW) >> 1), sh.x + sh.w - calW - 1, sh.x + sh.w + 2].map((x) => ({ x: Math.max(x, clear), y: sh.y - 4 - calH, w: calW, h: calH }));
    cands.splice(narrow ? 0 : 1, 0, ...over);
  }
  parts.calendar = cands.find((r) => fitsWall({ x: r.x, y: r.y - 5, w: r.w + 3, h: r.h + 5 }) && isFree(r, 2)) || cands[cands.length - 2];
  taken.push({ x: parts.calendar.x, y: parts.calendar.y - 5, w: calW + 3, h: calH + 5 });

  // posters, only where they fit
  parts.posters = [];
  const poster = (kind, w, h, cx, bottom) => {
    const r = { kind, x: Math.round(cx - w / 2), y: bottom - h, w, h };
    if (fitsWall(r) && isFree(r, 2)) {
      parts.posters.push(r);
      taken.push(r);
    }
  };
  if (lv >= 3) poster('ideas', 25, 29, fridge.x + fridge.w / 2, fridge.top - 8);
  if (lv >= 1) poster('heart', 19, 23, nest.cx, nest.lampTop - 7);
  if (lv >= 7 && parts.aquarium) poster('frame', 17, 14, parts.aquarium.x + 15, parts.aquarium.top - 9);

  // wide rooms get a photo garland and a hanging plant in the emptiest bits
  // of wall (between the whiteboard and the window, then past the window)
  if (lv >= 5) {
    const gapL = board.x + board.w + 8;
    const gapR = win.x - 10 - 8;
    if (gapR - gapL >= 46) {
      const gw = Math.min(76, gapR - gapL);
      const r = { kind: 'garland', x: Math.round((gapL + gapR) / 2 - gw / 2), y: board.y + 2, w: gw, h: 15 };
      if (fitsWall(r)) {
        parts.posters.push(r);
        taken.push(r);
      }
    }
    const tries = [win.x + win.w + 10 + 12, gapL + 10, win.x - 10 - 12];
    for (const hx of tries) {
      const r = { kind: 'hanging', x: hx - 7, y: CEIL + 9, w: 15, h: 40 };
      if (fitsWall(r) && isFree(r, 2)) {
        parts.posters.push(r);
        taken.push(r);
        break;
      }
    }
  }

  // string lights along the ceiling
  const nSw = Math.max(2, Math.round(W / (narrow ? 50 : 64)));
  const seg = W / nSw;
  const bulbs = [];
  let k = 0;
  for (let i = 0; i < nSw; i++) {
    for (let bx = Math.round(i * seg + 5); bx < (i + 1) * seg - 3; bx += 8) {
      const t = (bx - i * seg) / seg;
      bulbs.push({ x: bx, y: CEIL + 2 + Math.round(20 * t * (1 - t)), c: k++ % 5 });
    }
  }
  parts.lights = { n: nSw, seg, bulbs };

  // ---------------------------------------------------------- the contract
  const hotspots = [];
  const hs = (id, x, y, w, h) => hotspots.push({ id, x, y, w, h });
  hs('board', board.x, board.y, board.w, board.h + 2);
  hs('fridge', fridge.x, fridge.top, fridge.w, fridge.h);
  hs('bin', bin.x - 1, bin.top - 4, bin.w + 2, bin.h + 4);
  const cal = parts.calendar;
  hs('calendar', cal.x, cal.y - 5, cal.w + 3, cal.h + 5);
  if (narrow) {
    hs('cabinet', cab.x, cab.top + 2, cab.w, base - cab.top - 2);
  } else {
    const ct = parts.printer ? parts.printer.y - 3 : cab.top;
    hs('cabinet', cab.x, ct, cab.w, base - ct);
  }
  hs('nest', nestR.x, nestR.y, nestR.w, nestR.h);
  const chairTop = chair.y - 33;
  hs('door', door.x, door.y, door.w, chair.floor ? chairTop - 1 - door.y : door.h + 4);
  for (const d of parts.desks) hs('desk' + d.i, d.x, sy - 33, d.w, base - (sy - 33));
  hs('sofa', sofa.x, sy - 33, sofa.w, base - (sy - 33));
  hs('window', win.x - 8, win.y - 5, win.w + 16, win.h + 9);
  hs('clock', clock.cx - 7, clock.cy - 7, 15, 15);
  if (parts.bookshelf) {
    const b = parts.bookshelf;
    hs('shelf', b.x, b.top - 8, b.w, base - b.top + 8);
  } else {
    const s = parts.shelf;
    hs('shelf', s.x, s.y, s.w, s.h + 3);
  }
  {
    // your armchair, kept clear of its neighbours' hotspots
    let cl = chair.x;
    let cr = chair.x + chair.w;
    const ch = { x: cl, y: chairTop, w: chair.w, h: 36 };
    for (const o of hotspots) {
      if (o.id === 'window' || !overlaps(ch, o)) continue;
      if (o.x + o.w / 2 < chair.cx) cl = Math.max(cl, o.x + o.w);
      else cr = Math.min(cr, o.x);
    }
    hs('chair', cl, chairTop, cr - cl, Math.min(36, H - chairTop));
  }
  hs('sign', sign.x, sign.y, sign.w, sign.h);
  const e = parts.earned;
  hs('trophies', e.x, e.y, e.w, e.h);
  hs('record', e.rec.x - 1, e.rec.y - 3, e.rec.w + 2, e.rec.h + 3);

  // free bits of wallpaper for the user's own notes and polaroids: pack in
  // as many as fit, keep up to 8 spread around the room, then ease each one
  // towards the middle of its patch of wall
  let wallSpots = [];
  {
    const block = [...taken, ...furn, ...hotspots.filter((o) => o.id !== 'window'), ...parts.posters];
    const top = CEIL + 12; // below the string lights
    const clear = occupancy(W, railY - 1, block, 2);
    const free = (r) => r.x >= 3 && r.x + r.w <= W - 3 && r.y >= top && clear(r);
    const pack = (S, gap) => {
      const got = [];
      const r = { x: 0, y: 0, w: S, h: S };
      for (let x = 3; x + S <= W - 3; x++) {
        for (let y = top; y + S <= railY - 2; y++) {
          r.x = x;
          r.y = y;
          if (free(r) && !got.some((o) => overlaps(r, o, gap))) got.push({ ...r });
        }
      }
      return got;
    };
    let best = [];
    for (const [S, gap] of [[18, 4], [16, 4], [16, 2]]) {
      const got = pack(S, gap);
      if (got.length > best.length) best = got;
      if (best.length >= 4) break;
    }
    // how far a spot is from anything else on the wall (up to 8px)
    const probe = { x: 0, y: 0, w: 0, h: 0 };
    const clearance = (r) => {
      let c = 0;
      for (; c < 8; c++) {
        probe.x = r.x - c - 1;
        probe.y = r.y - c - 1;
        probe.w = r.w + 2 * c + 2;
        probe.h = r.h + 2 * c + 2;
        if (!free(probe)) break;
      }
      return c;
    };
    if (best.length > 8) {
      const pool = best.map((r) => ({ r, c: clearance(r) }));
      pool.sort((a, b) => b.c - a.c);
      const pick = [pool.shift().r];
      while (pick.length < 8) {
        let bi = -1;
        let bs = -Infinity;
        pool.forEach((p, i) => {
          let d = Infinity;
          for (const o of pick) d = Math.min(d, Math.hypot(p.r.x - o.x, (p.r.y - o.y) * 1.6));
          const sc = d + p.c * 4;
          if (sc > bs) {
            bs = sc;
            bi = i;
          }
        });
        pick.push(pool.splice(bi, 1)[0].r);
      }
      best = pick;
    }
    // ease towards the middle of the free patch
    for (const r of best) {
      for (let pass = 0; pass < 2; pass++) {
        let bc = clearance(r);
        let bm = null;
        const q = { x: 0, y: 0, w: r.w, h: r.h };
        for (let dx = -6; dx <= 6; dx++) {
          for (let dy = -6; dy <= 6; dy++) {
            q.x = r.x + dx;
            q.y = r.y + dy;
            if (!free(q) || best.some((o) => o !== r && overlaps(q, o, 3))) continue;
            const c = clearance(q);
            if (c > bc || (c === bc && bm && Math.abs(dx) + Math.abs(dy) < Math.abs(bm.dx) + Math.abs(bm.dy))) {
              bc = c;
              bm = { dx, dy };
            }
          }
        }
        if (!bm) break;
        r.x += bm.dx;
        r.y += bm.dy;
      }
    }
    wallSpots = best.sort((a, b) => a.x - b.x || a.y - b.y);
  }
  parts.wallSpots = wallSpots;

  // a town meeting: two loose rows on the floor, facing the whiteboard
  const walk = { left: 6, right: W - 6, top: base + 7, bottom: H - 3 };
  const meeting = [];
  {
    const mcx = board.x + (board.w >> 1);
    const depth = walk.bottom - walk.top;
    const r1 = walk.top + clamp(Math.round(depth * 0.1), 3, 7);
    const r2 = r1 + clamp(Math.round(depth * 0.22), 10, 15);
    const n1 = W < 420 ? 4 : 5;
    const jr = rng(W * 31 + H);
    [
      [r1, n1],
      [r2, n1 + 1],
    ].forEach(([ry, n]) => {
      for (let i = 0; i < n; i++) {
        const x = Math.round(mcx + (i - (n - 1) / 2) * 23 + jr() * 4 - 2);
        meeting.push({ x: clamp(x, walk.left + 10, walk.right - 10), y: ry + Math.round(jr() * 2 - 1) });
      }
    });
  }

  return {
    W,
    H,
    floorY,
    walk,
    desks: parts.desks.map((d) => ({ seat: { x: d.sx, y: sy }, screen: { ...d.screen }, cat: { ...d.cat } })),
    sofa: { seats: sofa.seats.map((s) => ({ ...s })) },
    chair: { x: chair.cx, y: chair.y },
    naps,
    nest: { slots: nest.slots.map((s) => ({ ...s })) },
    ghosts: { left: 14, right: W - 14, top: Math.max(CEIL + 36, floorY - 30), bottom: base + 12 },
    sign: { ...sign },
    boardText: { ...board.text },
    boardPins: board.pins.map((q) => ({ ...q })),
    wallSpots: wallSpots.map((r) => ({ ...r })),
    meeting,
    hotspots,
    parts,
  };
}

// ------------------------------------------------------------ pixel tools

// Two targets: while building the cached static layers everything is written
// straight into a pixel buffer (thousands of single pixels would be slow as
// fillRect calls); the live bits are painted on the canvas context `g`.
let g = null; // the context being painted
let buf = null; // { w, h, px: Uint32Array } while building a static layer

const colors = new Map();
let lastC = '';
let lastV = null;
function rgbaOf(c) {
  if (c === lastC) return lastV;
  let v = colors.get(c);
  if (v) {
    lastC = c;
    lastV = v;
    return v;
  }
  if (c[0] === '#') v = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 1];
  else {
    const n = c.match(/[\d.]+/g).map(Number);
    v = [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
  }
  v.packed = ((255 << 24) | (v[2] << 16) | (v[1] << 8) | v[0]) >>> 0;
  colors.set(c, v);
  return v;
}
function bufRect(x, y, w, h, c) {
  const { w: BW, h: BH, px } = buf;
  y -= buf.oy;
  if (w === 1 && h === 1) {
    // the common case: one pixel
    const v = rgbaOf(c);
    if (v[3] >= 1) {
      if (x >= 0 && y >= 0 && x < BW && y < BH) px[y * BW + x] = v.packed;
      return;
    }
  }
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(BW, x + w);
  const y1 = Math.min(BH, y + h);
  if (x1 <= x0 || y1 <= y0) return;
  const v = rgbaOf(c);
  if (v[3] >= 1) {
    for (let yy = y0; yy < y1; yy++) px.fill(v.packed, yy * BW + x0, yy * BW + x1);
    return;
  }
  // source-over blending for the few translucent touches (glints, tape)
  const a = v[3];
  for (let yy = y0; yy < y1; yy++) {
    for (let i = yy * BW + x0, e = yy * BW + x1; i < e; i++) {
      const d = px[i];
      const da = (d >>> 24) / 255;
      const oa = a + da * (1 - a);
      const mix = (s, dc) => Math.round((s * a + dc * da * (1 - a)) / oa);
      px[i] =
        ((Math.round(oa * 255) << 24) | (mix(v[2], (d >>> 16) & 255) << 16) | (mix(v[1], (d >>> 8) & 255) << 8) | mix(v[0], d & 255)) >>> 0;
    }
  }
}
function clearArea(x, y, w, h) {
  if (!buf) return g.clearRect(x, y, w, h);
  const { w: BW, h: BH, px } = buf;
  y -= buf.oy;
  for (let yy = Math.max(0, y); yy < Math.min(BH, y + h); yy++) px.fill(0, yy * BW + Math.max(0, x), yy * BW + Math.min(BW, x + w));
}

function R(x, y, w, h, c) {
  if (w > 0 && h > 0) {
    if (buf) return bufRect(x, y, w, h, c);
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  }
}
function P(x, y, c) {
  if (buf) return bufRect(x, y, 1, 1, c);
  g.fillStyle = c;
  g.fillRect(x, y, 1, 1);
}
function line(x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (;;) {
    P(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) {
      e += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      e += dx;
      y0 += sy;
    }
  }
}
// filled ellipse inscribed in the pixel box [x, x+w) x [y, y+h)
function ell(x, y, w, h, c) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  for (let yy = y; yy < y + h; yy++) {
    const d = (yy + 0.5 - cy) / ry;
    const half = rx * Math.sqrt(Math.max(0, 1 - d * d));
    const x0 = Math.ceil(cx - half - 0.5);
    const x1 = Math.floor(cx + half - 0.5);
    if (x1 >= x0) R(x0, yy, x1 - x0 + 1, 1, c);
  }
}
const inEll = (px, py, x, y, w, h) => {
  const dx = (px + 0.5 - (x + w / 2)) / (w / 2);
  const dy = (py + 0.5 - (y + h / 2)) / (h / 2);
  return dx * dx + dy * dy <= 1;
};
// outlined box with rounded corners (r = 0, 1 or 2) and simple shading
function rb(x, y, w, h, M, r = 1, left = true) {
  if (r === 0) R(x, y, w, h, INK);
  else if (r === 1) {
    R(x + 1, y, w - 2, h, INK);
    R(x, y + 1, w, h - 2, INK);
  } else {
    R(x + 2, y, w - 4, h, INK);
    R(x + 1, y + 1, w - 2, h - 2, INK);
    R(x, y + 2, w, h - 4, INK);
  }
  const k = r === 2 ? 1 : 0;
  R(x + 1 + k, y + 1, w - 2 - 2 * k, h - 2, M.f);
  R(x + 1, y + 1 + k, w - 2, h - 2 - 2 * k, M.f);
  R(x + 1 + k, y + 1, w - 2 - 2 * k, 1, M.hi);
  if (left) R(x + 1, y + 2, 1, h - 4 - k, M.hi);
  R(x + 1 + k, y + h - 2, w - 2 - 2 * k, 1, M.lo);
  R(x + w - 2, y + 1 + k + 1, 1, h - 3 - 2 * k, M.lo);
}
function spr(rows, x, y, pal) {
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j];
    for (let i = 0; i < row.length; i++) {
      const c = pal[row[i]];
      if (c) P(x + i, y + j, c);
    }
  }
}
function text(str, x, y, c, s = 1) {
  for (const ch of str) {
    const bits = FONT[ch] || FONT[' '];
    for (let i = 0; i < 15; i++) if (bits[i] === '1') R(x + (i % 3) * s, y + Math.floor(i / 3) * s, s, s, c);
    x += 4 * s;
  }
}
const textW = (str, s = 1) => str.length * 4 * s - s;
function shadow(x, w, y) {
  R(x, y, w, 1, FP.shadow);
  R(x + 1, y + 1, w - 2, 1, FP.shadow2);
}
// a leaf: a rotated ellipse with its own outline, so leaves in front read
// clearly against the ones behind
function leaf(cx, cy, len, wid, ang, M, banded = false) {
  const a = len / 2;
  const b = wid / 2;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const ext = Math.ceil(a + 1.5);
  const lit = sa - ca > 0;
  for (let py = Math.floor(cy - ext); py <= cy + ext; py++) {
    for (let px = Math.floor(cx - ext); px <= cx + ext; px++) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      const u = dx * ca + dy * sa;
      const v = -dx * sa + dy * ca;
      const q = (u / a) ** 2 + (v / b) ** 2;
      if (q <= 1) {
        let c = M.f;
        if (banded) c = (py & 3) === 0 ? M.hi : (py & 3) === 2 ? M.lo : M.f;
        else if (Math.abs(v) < 0.5 && u < a - 1.5) c = M.lo;
        else if (v > 0 === lit && Math.abs(v) > b * 0.45) c = M.hi;
        else if (v > 0 !== lit && Math.abs(v) > b * 0.55) c = M.lo;
        P(px, py, c);
      } else if ((u / (a + 1)) ** 2 + (v / (b + 1)) ** 2 <= 1) P(px, py, INK);
    }
  }
}
function pot(x, y, w, h, M) {
  R(x, y + 2, w, h - 2, INK);
  R(x + 1, y + 3, w - 2, h - 4, M.f);
  R(x + w - 2, y + 3, 1, h - 4, M.lo);
  R(x + 1, y + h - 2, w - 2, 1, M.lo);
  R(x - 1, y, w + 2, 3, INK);
  R(x, y + 1, w, 1, M.hi);
}
function disc(cx, cy, r) {
  for (let dy = -r; dy <= r; dy++) {
    const hw = Math.floor(Math.sqrt((r + 0.5) ** 2 - dy * dy));
    g.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
  }
}
// a stepped glow (three discs), drawn from a small cached sprite
const glows = new Map();
function glow(cx, cy, r, c) {
  const key = r + c;
  let sp = glows.get(key);
  if (!sp) {
    sp = canvas(r * 2 + 1, r * 2 + 1);
    const prev = g;
    g = sp.getContext('2d');
    g.fillStyle = c;
    for (const k of [1, 0.66, 0.36]) disc(r, r, Math.max(1, Math.round(r * k)));
    g = prev;
    glows.set(key, sp);
  }
  g.drawImage(sp, cx - r, cy - r);
}

// --------------------------------------------------------- the back wall

function paintWall(L) {
  const { W, floorY } = L;
  const railY = floorY - 21;
  R(0, 0, W, CEIL, WP.ceil);
  R(0, CEIL - 2, W, 1, WP.ceilHi);
  R(0, CEIL - 1, W, 1, WP.ceilLo);
  R(0, CEIL, W, railY - CEIL, WP.wall);
  R(0, CEIL, W, 1, WP.wallShade);
  // wallpaper: tiny sparkles on a diamond lattice, with dots between
  for (let y = CEIL + 6, row = 0; y < railY - 4; y += 9, row++) {
    for (let x = (row & 1) * 9 + 4; x < W + 2; x += 18) {
      P(x, y - 1, WP.wallDot);
      P(x - 1, y, WP.wallDot);
      P(x + 1, y, WP.wallDot);
      P(x, y + 1, WP.wallDot);
      P(x + 9, y, WP.wallDot2);
    }
  }
  // chair rail and wainscot
  R(0, railY, W, 1, WP.railHi);
  R(0, railY + 1, W, 1, WP.rail);
  R(0, railY + 2, W, 1, WP.railLo);
  R(0, railY + 3, W, floorY - railY - 7, WP.wains);
  for (let x = 2; x < W; x += 6) {
    R(x, railY + 3, 1, floorY - railY - 7, WP.wainsLo);
    R(x + 1, railY + 3, 1, floorY - railY - 7, WP.wainsHi);
  }
  R(0, railY + 3, W, 1, WP.wainsLo);
  // skirting board
  R(0, floorY - 4, W, 1, WP.baseHi);
  R(0, floorY - 3, W, 2, WP.base);
  R(0, floorY - 1, W, 1, WP.baseLo);
}

function paintFloor(L) {
  if (FP.kind === 'checker') return paintChecker(L);
  if (FP.kind === 'carpet') return paintCarpet(L);
  if (FP.kind === 'tatami') return paintTatami(L);
  const { W, H, floorY } = L;
  const r = rng(1234);
  const tones = [C.woodA, C.woodB, C.woodC];
  let y = floorY;
  let row = 0;
  while (y < H) {
    const h = Math.min(H - y, 5 + (row > 2 ? 1 : 0) + (row > 6 ? 1 : 0));
    let x = -Math.floor(r() * 30);
    let t = row;
    while (x < W) {
      const len = 26 + Math.floor(r() * 24);
      R(x, y, len, h, tones[t++ % 3]);
      R(x, y, len, 1, C.woodHi);
      R(x + len - 1, y + 1, 1, h - 1, C.woodSeam);
      if (r() < 0.55 && h > 4) R(x + 4 + Math.floor(r() * (len - 12)), y + 2 + Math.floor(r() * (h - 4)), 3 + Math.floor(r() * 4), 1, C.woodGrain);
      x += len;
    }
    R(0, y + h - 1, W, 1, C.woodSeam);
    y += h;
    row++;
  }
  R(0, floorY, W, 1, C.shadow);
}

// rows that get a little deeper towards the front, like the planks
const floorRows = (L, f) => {
  const rows = [];
  for (let y = L.floorY, row = 0; y < L.H; row++) {
    const h = Math.min(L.H - y, f(row));
    rows.push({ y, h, row });
    y += h;
  }
  return rows;
};

// soft pastel tiles, laid square
function paintChecker(L) {
  const { W, floorY } = L;
  const F = FP;
  const tw = 14;
  for (const { y, h, row } of floorRows(L, (r) => 7 + Math.min(5, r))) {
    for (let x = -5, c = 0; x < W; x += tw, c++) {
      R(x, y, tw, h, (c + row) & 1 ? F.a : F.b);
      if ((c + row) & 1) R(x + 1, y + 1, tw - 2, 1, F.hi);
    }
    R(0, y + h - 1, W, 1, F.seam);
  }
  R(0, floorY, W, 1, F.shadow);
}

// a fluffy carpet: one colour with a soft stipple
function paintCarpet(L) {
  const { W, H, floorY } = L;
  const F = FP;
  R(0, floorY, W, H - floorY, F.f);
  const r = rng(4321);
  const n = Math.round((W * (H - floorY)) / 9);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(r() * W);
    const y = floorY + 1 + Math.floor(r() * (H - floorY - 1));
    P(x, y, r() < 0.55 ? F.hi : F.lo);
    if (r() < 0.25) P(x + 1, y, F.hi);
  }
  R(0, floorY + 1, W, 1, F.lo);
  R(0, floorY, W, 1, F.shadow);
}

// woven mats in staggered rows, a cloth edge along each row
function paintTatami(L) {
  const { W, floorY } = L;
  const F = FP;
  for (const { y, h, row } of floorRows(L, (r) => 9 + Math.min(5, r))) {
    const mw = 2 * (h + 14);
    const off = row & 1 ? -(mw >> 1) : -6;
    for (let x = off; x < W; x += mw) {
      R(x, y, mw, h, F.f);
      for (let yy = y + 3; yy < y + h - 1; yy += 3) R(x + 2, yy, mw - 4, 1, F.lo);
      R(x + 1, y + 1, mw - 2, 1, F.hi);
      R(x + mw - 1, y + 1, 1, h - 1, F.lo);
    }
    R(0, y, W, 1, F.edge);
  }
  R(0, floorY, W, 1, F.shadow);
}

function paintWindow(L, opts) {
  const wn = L.parts.window;
  const { x, y, w, h } = wn;
  R(x, y, w, h, INK);
  R(x + 1, y + 1, w - 2, h - 2, C.frame);
  R(x + 1, y + 1, w - 2, 1, C.frameHi);
  R(x + w - 2, y + 2, 1, h - 3, C.frameLo);
  R(x + 2, y + 2, w - 4, h - 4, INK);
  // muntins
  R(wn.mx, wn.inner.y, 2, wn.inner.h, C.frame);
  R(wn.mx + 1, wn.inner.y, 1, wn.inner.h, C.frameLo);
  R(wn.inner.x, wn.my, wn.inner.w, 2, C.frame);
  R(wn.inner.x, wn.my + 1, wn.inner.w, 1, C.frameLo);
  // the panes are holes: the live sky is painted underneath
  for (const p of wn.panes) clearArea(p.x, p.y, p.w, p.h);
  // a soft glint on the glass
  const glint = 'rgba(255,255,255,0.4)';
  const p0 = wn.panes[0];
  for (let i = 0; i < 4; i++) P(p0.x + 3 + i, p0.y + 6 - i, glint);
  for (let i = 0; i < 2; i++) P(p0.x + 3 + i, p0.y + 9 - i, glint);
  // sill
  R(x - 3, y + h - 1, w + 6, 4, INK);
  R(x - 2, y + h, w + 4, 1, C.frameHi);
  R(x - 2, y + h + 1, w + 4, 1, C.frame);
  // the revival plant on the sill once there's something to revive, else
  // a tiny succulent
  if (opts.earned) paintRevivalPlant(x + w - 13, y + h - 1, Number(opts.earned.plant) || 0);
  else if (w >= 56) {
    const px = x + w - 13;
    const py = y + h - 5;
    leaf(px + 1, py - 2, 5, 3, -2.2, MAT.leaf);
    leaf(px + 5, py - 2, 5, 3, -0.9, MAT.leaf);
    leaf(px + 3, py - 3, 6, 3, -1.57, MAT.leaf);
    pot(px, py, 7, 5, MAT.peach);
  }
  // rod, valance and curtains
  const cw = w >= 70 ? 10 : 8;
  const rodY = y - 4;
  R(x - cw + 1, rodY, w + 2 * cw - 2, 1, INK);
  for (const fx of [x - cw - 1, x + w + cw - 2]) {
    R(fx, rodY - 1, 3, 3, INK);
    P(fx + 1, rodY, MAT.butter.f);
  }
  curtain(x - cw + 2, rodY + 1, cw, y + h + 5, y + Math.round(h * 0.58), false);
  curtain(x + w - 2, rodY + 1, cw, y + h + 5, y + Math.round(h * 0.58), true);
  // scalloped valance
  const M = MAT.pink;
  const vx = x - 3;
  const vw = w + 6;
  R(vx, rodY + 1, vw, 4, INK);
  R(vx + 1, rodY + 1, vw - 2, 3, M.f);
  R(vx + 1, rodY + 1, vw - 2, 1, M.hi);
  for (let sx = vx + 1; sx < vx + vw - 3; sx += 5) {
    R(sx, rodY + 5, 4, 1, INK);
    R(sx + 1, rodY + 4, 2, 1, M.f);
    R(sx + 1, rodY + 6, 2, 1, INK);
    R(sx, rodY + 4, 1, 1, M.lo);
    R(sx + 3, rodY + 4, 1, 1, M.lo);
    R(sx + 1, rodY + 5, 2, 1, M.lo);
  }
}

function curtain(px, top, cw, bottom, tieY, right) {
  const M = MAT.pink;
  for (let y = top; y < bottom; y++) {
    const d = Math.abs(y - tieY);
    const pinch = d < 6 ? Math.round((6 - d) * 0.6) : 0;
    const wRow = cw - pinch;
    // the outer edge stays put; the inner edge gathers in towards the tie
    const left = right ? px + cw - wRow : px;
    R(left, y, wRow, 1, M.f);
    for (let f = 3; f < wRow - 1; f += 3) P(right ? left + wRow - 1 - f : left + f, y, M.lo);
    P(right ? left + 1 : left + wRow - 2, y, M.hi);
    P(left, y, INK);
    P(left + wRow - 1, y, INK);
  }
  R(px, bottom - 1, cw, 1, INK);
  // tie-back
  const tw = cw - 4;
  const tl = right ? px + 4 : px;
  R(tl, tieY - 1, tw, 3, INK);
  R(tl + 1, tieY, tw - 2, 1, MAT.butter.f);
}

function paintBoard(L) {
  const { x, y, w, h } = L.parts.board;
  R(x, y, w, h, INK);
  R(x + 1, y + 1, w - 2, h - 2, MAT.lilac.f);
  R(x + 1, y + 1, w - 2, 1, MAT.lilac.hi);
  R(x + 1, y + 2, 1, h - 4, MAT.lilac.hi);
  R(x + w - 2, y + 2, 1, h - 3, MAT.lilac.lo);
  R(x + 1, y + h - 2, w - 2, 1, MAT.lilac.lo);
  R(x + 3, y + 3, w - 6, h - 6, INK);
  R(x + 4, y + 4, w - 8, h - 8, C.board);
  R(x + 4, y + h - 5, w - 8, 1, C.boardLine);
  R(x + w - 5, y + 4, 1, h - 8, C.boardLine);
  // marker tray
  R(x + 4, y + h - 1, w - 8, 3, INK);
  R(x + 5, y + h - 1, w - 10, 1, MAT.white.hi);
  R(x + 5, y + h, w - 10, 1, MAT.white.lo);
  R(x + 8, y + h - 2, 5, 1, '#ff8fbf');
  P(x + 13, y + h - 2, INK);
  R(x + 15, y + h - 2, 5, 1, '#78b0e2');
  P(x + 20, y + h - 2, INK);
  // the top left stays clean for the user's own words; sticky notes sit where
  // pinned notes go (a pinned note covers its painted one)
  const pins = L.parts.board.pins;
  [MAT.butter, MAT.pink, MAT.mint].forEach((M, i) => {
    const q = pins[i];
    if (q) note(q.x + 2, q.y + 2, M);
  });
}
function note(x, y, M) {
  R(x, y, 10, 9, M.f);
  R(x, y + 8, 10, 1, M.lo);
  R(x + 9, y + 1, 1, 8, M.lo);
  R(x + 2, y + 3, 6, 1, SOFT);
  R(x + 2, y + 5, 4, 1, SOFT);
  P(x + 4, y, '#ff6fae');
  P(x + 5, y, '#ff6fae');
}

function paintCalendarPaper(L) {
  const { x, y, w, h } = L.parts.calendar;
  const nx = x + (w >> 1);
  P(nx, y - 4, INK);
  line(x + 3, y - 1, nx, y - 4, SOFT);
  line(x + w - 4, y - 1, nx, y - 4, SOFT);
  // a page peeking under the top one
  R(x + 1, y + 1, w, h, WP.wallShade);
  R(x, y, w, h, INK);
  R(x + 1, y + 1, w - 2, 7, MAT.pink.f);
  R(x + 1, y + 1, w - 2, 1, MAT.pink.hi);
  R(x + 1, y + 8, w - 2, 1, INK);
  R(x + 1, y + 9, w - 2, h - 10, C.paper);
  R(x + w - 2, y + 9, 1, h - 10, MAT.cream.lo);
  // rings
  R(x + 4, y - 1, 1, 3, INK);
  R(x + w - 5, y - 1, 1, 3, INK);
  // week dots
  for (let i = 0; i < 7; i++) P(x + 3 + i * 2, y + h - 3, i === 6 ? '#ff8fbf' : '#c9b6ff');
}

function paintClockFace(L) {
  const { cx, cy } = L.parts.clock;
  ell(cx - 7, cy - 7, 15, 15, INK);
  ell(cx - 6, cy - 6, 13, 13, MAT.butter.f);
  ell(cx - 5, cy - 5, 11, 11, C.paper);
  P(cx - 4, cy - 6, MAT.butter.hi);
  P(cx - 5, cy - 5, MAT.butter.hi);
  for (const [dx, dy] of [[0, -4], [4, 0], [0, 4], [-4, 0]]) P(cx + dx, cy + dy, SOFT);
  // little feet on top, like an alarm clock hung on the wall
  P(cx, cy - 8, INK);
}

function paintShelfWall(L) {
  const s = L.parts.shelf;
  if (!s) return;
  const r = rng(91);
  const planks = s.tiers === 2 ? [s.y + 11, s.y + s.h - 2] : [s.y + s.h - 2];
  planks.forEach((py, i) => {
    // contents
    const bx = s.x + 2;
    if (i === 0) {
      // a small plant on the top shelf
      const px = s.x + s.w - 8;
      leaf(px + 1, py - 6, 6, 3, -2.1, MAT.leaf);
      leaf(px + 5, py - 6, 6, 3, -1.0, MAT.leaf);
      leaf(px + 3, py - 7, 7, 3, -1.57, MAT.leaf);
      pot(px, py - 4, 6, 4, MAT.pink);
      books(bx, py, px - 2 - bx, 9, r);
    } else {
      const ex = s.x + s.w - 7;
      books(bx, py, ex - 2 - bx, 9, r);
      ell(ex - 1, py - 6, 6, 6, INK);
      ell(ex, py - 5, 4, 4, MAT.sky.f);
      P(ex + 1, py - 4, '#ffffff');
      R(ex, py - 1, 4, 1, INK);
    }
    // plank + brackets
    R(s.x, py, s.w, 3, INK);
    R(s.x + 1, py, s.w - 2, 1, MAT.wood.hi);
    R(s.x + 1, py + 1, s.w - 2, 1, MAT.wood.f);
    for (const bx2 of [s.x + 3, s.x + s.w - 5]) {
      R(bx2, py + 3, 2, 1, SOFT);
      P(bx2, py + 4, SOFT);
    }
  });
}

// a row of book spines standing on `floor`
function books(x0, floor, width, maxH, r) {
  let bx = x0;
  const end = x0 + width;
  while (bx < end) {
    const roll = r();
    if (roll < 0.1 && end - bx >= 7) {
      // a little stack lying down
      const n = 2 + Math.floor(r() * 2);
      for (let j = 0; j < n; j++) {
        const M = SPINES[Math.floor(r() * SPINES.length)];
        const sw = 6 - (j & 1);
        R(bx, floor - 2 * (j + 1), sw, 2, M.f);
        R(bx, floor - 2 * (j + 1) + 1, sw, 1, M.lo);
        P(bx, floor - 2 * (j + 1), M.hi);
      }
      bx += 7;
      continue;
    }
    const bw = r() < 0.6 ? 2 : 3;
    if (bx + bw > end) break;
    const bh = Math.max(4, Math.min(maxH, 5 + Math.floor(r() * (maxH - 3))));
    const M = SPINES[Math.floor(r() * SPINES.length)];
    R(bx, floor - bh, bw, bh, M.f);
    R(bx, floor - bh, 1, bh, M.lo);
    R(bx, floor - bh, bw, 1, M.lo);
    R(bx + (bw > 2 ? 1 : 0), floor - bh + 2, bw - (bw > 2 ? 1 : 0), 1, M.hi);
    bx += bw;
  }
}

function paintPosters(L) {
  for (const p of L.parts.posters) {
    const { x, y, w, h } = p;
    if (p.kind === 'ideas') {
      R(x, y, w, h, INK);
      R(x + 1, y + 1, w - 2, h - 2, '#fff3c4');
      R(x + 2, y + 2, w - 4, h - 4, '#ffe9a6');
      R(x + 3, y + 3, w - 6, h - 6, '#fff7d6');
      const bx = x + ((w - 9) >> 1);
      spr(BULB, bx, y + 4, { k: INK, h: '#fffbe6', y: MAT.butter.f, o: MAT.butter.lo, g: MAT.lilac.f });
      // rays
      for (const [dx, dy, c] of [[-3, 2, '#ff8fbf'], [-2, 0, '#ff8fbf'], [11, 2, '#78b0e2'], [10, 0, '#78b0e2'], [-3, 5, '#c9b6ff'], [11, 5, '#c9b6ff']]) {
        P(bx + dx, y + 4 + dy, c);
        P(bx + dx + (dx < 0 ? 1 : -1), y + 4 + dy, c);
      }
      text('IDEAS', x + ((w - textW('IDEAS')) >> 1), y + h - 8, '#e05c97');
      // tape
      R(x - 1, y - 1, 4, 2, 'rgba(255,255,255,0.75)');
      R(x + w - 3, y - 1, 4, 2, 'rgba(255,255,255,0.75)');
    } else if (p.kind === 'heart') {
      R(x, y, w, h, INK);
      R(x + 1, y + 1, w - 2, h - 2, '#cfeaff');
      R(x + 1, y + h - 6, w - 2, 5, '#b9e0ff');
      for (let i = 0; i < w - 2; i++) if (i % 4 === 1) P(x + 1 + i, y + h - 7, '#b9e0ff');
      spr(HEART9, x + ((w - 9) >> 1), y + 6, { k: INK, h: '#ffdcea', p: '#ff8fbf', o: '#e05c97' });
      for (const [dx, dy] of [[3, 3], [w - 5, 4], [4, 15]]) {
        P(x + dx, y + dy, '#ffe27a');
        P(x + dx - 1, y + dy, '#fff3c4');
        P(x + dx + 1, y + dy, '#fff3c4');
        P(x + dx, y + dy - 1, '#fff3c4');
        P(x + dx, y + dy + 1, '#fff3c4');
      }
      R(x + w / 2 - 1, y - 1, 3, 2, '#ff6fae');
    } else if (p.kind === 'frame') {
      R(x, y, w, h, INK);
      R(x + 1, y + 1, w - 2, h - 2, MAT.wood.f);
      R(x + 1, y + 1, w - 2, 1, MAT.wood.hi);
      R(x + 2, y + 2, w - 4, h - 4, INK);
      R(x + 3, y + 3, w - 6, h - 6, '#cfeaff');
      // a tiny landscape: hill and sun
      R(x + 3, y + h - 6, w - 6, 3, MAT.mint.f);
      R(x + 6, y + h - 7, 6, 1, MAT.mint.f);
      P(x + w - 6, y + 4, '#ffe27a');
      P(x + w - 5, y + 4, '#ffe27a');
    } else if (p.kind === 'garland') {
      paintGarland(p);
    } else if (p.kind === 'hanging') {
      paintHangingPlant(p);
    }
  }
}

// a string of little photos pegged across the wall
function paintGarland(p) {
  const { x, w, y } = p;
  const sag = (t) => y + 1 + Math.round(16 * t * (1 - t));
  for (let i = 0; i < w; i++) P(x + i, sag(i / (w - 1)), SOFT);
  R(x - 1, y, 2, 2, '#ff6fae');
  R(x + w - 1, y, 2, 2, '#ff6fae');
  const n = Math.max(2, Math.floor((w - 6) / 12));
  const step = (w - 6) / n;
  const pics = [MAT.sky, MAT.pink, MAT.mint, MAT.butter, MAT.lilac, MAT.peach];
  for (let i = 0; i < n; i++) {
    const cx = Math.round(x + 3 + step * (i + 0.5));
    const top = sag((cx - x) / (w - 1)) + 1 + (i & 1);
    R(cx - 4, top, 8, 9, INK);
    R(cx - 3, top + 1, 6, 7, '#ffffff');
    const M = pics[i % pics.length];
    R(cx - 2, top + 2, 4, 4, M.f);
    R(cx - 2, top + 5, 4, 1, M.lo);
    P(cx - 1, top + 3, M.hi);
    P(cx, top - 1, MAT.butter.lo);
    P(cx, top, MAT.butter.f);
  }
}

// a little pot hanging from the ceiling with vines trailing down
function paintHangingPlant(p) {
  const cx = p.x + 7;
  const py = CEIL + 22;
  P(cx, CEIL, INK);
  P(cx, CEIL + 1, INK);
  line(cx, CEIL + 2, cx - 5, py, SOFT);
  line(cx, CEIL + 2, cx + 5, py, SOFT);
  const M = MAT.leaf;
  leaf(cx - 4, py - 2, 7, 3, -2.5, M);
  leaf(cx + 4, py - 2, 7, 3, -0.6, M);
  leaf(cx, py - 4, 7, 3, -1.57, M);
  ell(cx - 7, py - 1, 15, 10, INK);
  ell(cx - 6, py, 13, 8, MAT.peach.f);
  R(cx - 6, py, 13, 3, INK);
  R(cx - 5, py + 1, 11, 1, MAT.peach.hi);
  R(cx - 4, py + 4, 9, 1, MAT.peach.lo);
  P(cx + 3, py + 6, MAT.peach.lo);
  const vine = (vx, len, dir) => {
    for (let j = 0; j < len; j += 3) {
      const lx = vx + ((j / 3) & 1 ? dir : 0);
      ell(lx - 1, py + 6 + j, 4, 4, INK);
      ell(lx, py + 7 + j, 2, 2, (j / 3) & 1 ? M.hi : M.f);
    }
  };
  vine(cx - 5, 15, -1);
  vine(cx + 4, 10, 1);
}

function paintDoor(L) {
  const { x, y, w, h } = L.parts.door;
  // frame
  R(x, y, w, h, INK);
  R(x + 1, y + 1, w - 2, h - 1, C.frame);
  R(x + 1, y + 1, w - 2, 1, C.frameHi);
  R(x + w - 2, y + 2, 1, h - 2, C.frameLo);
  // door
  const sx = x + 3;
  const sY = y + 3;
  const sw = w - 6;
  const sh = h - 3;
  const D = MAT.sky;
  R(sx - 1, sY - 1, sw + 2, sh + 1, INK);
  R(sx, sY, sw, sh, D.f);
  R(sx, sY, sw, 1, D.hi);
  R(sx, sY + 1, 1, sh - 1, D.hi);
  R(sx + sw - 1, sY + 1, 1, sh - 1, D.lo);
  // round window
  const wx = sx + ((sw - 10) >> 1);
  ell(wx, sY + 4, 10, 10, INK);
  ell(wx + 1, sY + 5, 8, 8, '#e9f7ff');
  ell(wx + 4, sY + 8, 4, 4, '#cfeaff');
  P(wx + 3, sY + 7, '#ffffff');
  P(wx + 2, sY + 8, '#ffffff');
  // lower panel (inset)
  const py = sY + 19;
  const ph = sh - 25;
  if (ph > 6) {
    R(sx + 3, py, sw - 6, ph, D.lo);
    R(sx + 4, py + 1, sw - 7, ph - 1, D.hi);
    R(sx + 4, py + 1, sw - 8, ph - 2, D.f);
  }
  // little heart sign between window and panel
  spr(HEART7, sx + ((sw - 7) >> 1), sY + 15 - 2, { k: INK, h: '#ffdcea', p: '#ff8fbf', o: '#e05c97' });
  // knob
  const ky = sY + Math.round(sh * 0.55);
  R(sx + sw - 5, ky, 3, 3, INK);
  P(sx + sw - 4, ky + 1, MAT.butter.f);
}

function paintLights(L) {
  const { n, seg, bulbs } = L.parts.lights;
  for (let i = 0; i < n; i++) {
    const x0 = Math.round(i * seg);
    const x1 = Math.round((i + 1) * seg);
    P(x0, CEIL, INK);
    for (let x = x0; x < x1; x++) {
      const t = (x - i * seg) / seg;
      P(x, CEIL + 1 + Math.round(20 * t * (1 - t)), SOFT);
    }
  }
  for (const b of bulbs) paintBulb(b, false);
}
const BULB_COLS = ['#ff9ec7', '#ffe27a', '#8fd0ff', '#8fe3bf', '#c9a8ff'];
function paintBulb(b, on) {
  R(b.x, b.y, 2, 1, INK);
  R(b.x, b.y + 1, 2, 2, BULB_COLS[b.c]);
  P(b.x, b.y + 1, on ? '#fffbea' : '#ffffff');
}

// ------------------------------------------------------------ the floor

function paintRug(L) {
  const { x, y, w, h } = L.parts.rug;
  for (let yy = y + 2; yy < y + h - 2; yy += 2) {
    P(x - 1, yy, C.frame);
    P(x + w, yy, C.frame);
  }
  R(x + 1, y, w - 2, h, MAT.lilac.lo);
  R(x, y + 1, w, h - 2, MAT.lilac.lo);
  R(x + 1, y + 1, w - 2, h - 2, C.frame);
  R(x + 3, y + 2, w - 6, h - 4, MAT.lilac.f);
  R(x + 4, y + 3, w - 8, 1, MAT.lilac.hi);
  R(x + 4, y + h - 4, w - 8, 1, MAT.lilac.hi);
  // a row of little diamonds down the middle
  const my = y + (h >> 1);
  for (let xx = x + 8; xx < x + w - 8; xx += 8) {
    P(xx, my - 1, '#ff9ec7');
    P(xx - 1, my, '#ff9ec7');
    P(xx + 1, my, '#ff9ec7');
    P(xx, my + 1, '#ff9ec7');
    P(xx, my, '#ffe27a');
    P(xx + 4, my, MAT.lilac.hi);
  }
}

function paintFridge(L) {
  const { x, w, h, top } = L.parts.fridge;
  const base = L.parts.base;
  const M = MAT.mint;
  shadow(x, w, base);
  R(x + 2, top, w - 4, h, INK);
  R(x + 1, top + 1, w - 2, h - 1, INK);
  R(x, top + 2, w, h - 2, INK);
  R(x + 2, top + 1, w - 4, h - 2, M.f);
  R(x + 1, top + 2, w - 2, h - 3, M.f);
  R(x + 2, top + 1, w - 4, 1, M.hi);
  R(x + 1, top + 2, 1, h - 6, M.hi);
  R(x + w - 2, top + 2, 1, h - 6, M.lo);
  R(x + 3, top + 3, 1, 4, '#ffffff');
  // freezer split
  const fy = top + (h > 44 ? 14 : 13);
  R(x + 1, fy, w - 2, 1, INK);
  R(x + 2, fy + 1, w - 4, 1, M.hi);
  R(x + 2, fy - 1, w - 4, 1, M.lo);
  // plinth
  R(x + 1, base - 4, w - 2, 1, INK);
  R(x + 1, base - 3, w - 2, 2, M.lo);
  R(x + 3, base - 3, w - 6, 1, SOFT);
  // handles
  handle(x + 3, fy - 7, 5);
  handle(x + 3, fy + 3, 9);
  // magnets: a heart and a note
  spr(HEART7, x + w - 9, fy + 6, { k: INK, h: '#ffdcea', p: '#ff8fbf', o: '#e05c97' });
  R(x + w - 10, fy + 14, 7, 8, INK);
  R(x + w - 9, fy + 15, 5, 6, C.paper);
  R(x + w - 8, fy + 17, 3, 1, SOFT);
  R(x + w - 8, fy + 19, 2, 1, SOFT);
  P(x + w - 7, fy + 14, MAT.sky.f);
}
function handle(x, y, len) {
  R(x, y, 3, len, INK);
  R(x + 1, y + 1, 1, len - 2, '#ffffff');
}

function paintBin(L) {
  const { x, w, h, top } = L.parts.bin;
  const base = L.parts.base;
  shadow(x, w, base);
  const by = top + 2;
  for (let i = 0; i < base - by; i++) {
    const inset = i >= (base - by) / 2 ? 1 : 0;
    R(x + inset, by + i, w - 2 * inset, 1, INK);
  }
  for (let py = by; py < base - 1; py++) {
    const inset = py - by >= (base - by) / 2 ? 1 : 0;
    for (let px = x + 1 + inset; px < x + w - 1 - inset; px++) {
      const mesh = (px + py) % 3 === 0 || (px - py + 300) % 3 === 0;
      P(px, py, mesh ? MAT.lilac.lo : '#f1edff');
    }
  }
  binRim(L);
}
function binRim(L) {
  const { x, w, top } = L.parts.bin;
  R(x - 1, top, w + 2, 3, INK);
  R(x, top + 1, w, 1, '#ffffff');
}

function paintCabinet(L) {
  const c = L.parts.cabinet;
  const base = L.parts.base;
  const { x, w, h, top } = c;
  const M = MAT.butter;
  shadow(x, w, base);
  R(x, top, w, h, INK);
  R(x + 1, top + 1, w - 2, h - 2, M.f);
  R(x + 1, top + 1, w - 2, 2, M.hi);
  R(x + 1, top + 3, w - 2, 1, M.lo);
  R(x + w - 2, top + 4, 1, h - 5, M.lo);
  const n = c.lateral ? 2 : 3;
  const dh = Math.floor((h - 6) / n);
  const cx = x + (w >> 1);
  for (let i = 0; i < n; i++) {
    const dy = top + 4 + i * dh;
    R(x + 2, dy, w - 4, dh - 1, M.lo);
    R(x + 3, dy + 1, w - 6, dh - 3, M.f);
    R(x + 3, dy + 1, w - 6, 1, M.hi);
    R(cx - 3, dy + 1, 6, 3, INK);
    R(cx - 2, dy + 2, 4, 1, C.paper);
    R(cx - 2, dy + dh - 4, 4, 1, INK);
  }
  R(x + 1, base - 3, w - 2, 2, M.lo);
  if (L.parts.printer) paintPrinter(L);
}

function paintPrinter(L) {
  const { x, y, w } = L.parts.printer;
  // paper waiting in the feeder
  R(x + 4, y - 3, w - 8, 4, INK);
  R(x + 5, y - 2, w - 10, 3, '#ffffff');
  R(x + 6, y - 1, w - 13, 1, '#d9d4f2');
  // body
  R(x, y, w, 9, INK);
  R(x + 1, y + 1, w - 2, 7, MAT.white.f);
  R(x + 1, y + 1, w - 2, 1, MAT.white.hi);
  R(x + 1, y + 5, w - 2, 3, MAT.lilac.f);
  R(x + 1, y + 7, w - 2, 1, MAT.lilac.lo);
  R(x + 3, y + 4, w - 6, 1, INK);
  // a printed page sliding out
  R(x + 4, y + 5, w - 8, 2, '#ffffff');
  R(x + 5, y + 5, w - 11, 1, '#d9d4f2');
  P(x + w - 4, y + 2, '#56c79a');
  P(x + w - 6, y + 2, '#ff8fbf');
}

function paintNest(L) {
  const n = L.parts.nest;
  const base = L.parts.base;
  const { cx, ty } = n;
  if (n.stand) {
    const s = n.stand;
    shadow(s.x + 2, s.w - 4, base);
    // legs and a lower rail
    for (const lx of [s.x + 4, s.x + s.w - 7]) {
      R(lx, s.y + 3, 3, base - s.y - 3, INK);
      R(lx + 1, s.y + 3, 1, base - s.y - 4, MAT.wood.f);
    }
    R(s.x + 6, base - 6, s.w - 12, 3, INK);
    R(s.x + 6, base - 5, s.w - 12, 1, MAT.wood.lo);
    rb(s.x, s.y, s.w, 5, MAT.wood, 1);
    // a little heart tag hanging off the edge
    line(s.x + 8, s.y + 5, s.x + 8, s.y + 7, SOFT);
    spr(HEART7, s.x + 5, s.y + 7, { k: INK, h: '#ffdcea', p: '#ff8fbf', o: '#e05c97' });
  }
  // heat lamp: pole, arm and dome
  const px = n.poleX;
  const armY = ty - 22;
  R(px - 1, n.poleBase - 2, 3, 2, INK);
  R(px, armY, 1, n.poleBase - armY, INK);
  R(cx + 1, armY, px - cx - 1, 1, INK);
  R(px - 1, armY - 1, 3, 3, INK);
  P(px, armY, MAT.butter.f);
  // dome shade rows armY+1 .. armY+5
  const sh = [
    [6, false],
    [10, false],
    [12, false],
    [14, false],
    [14, true],
  ];
  sh.forEach(([wd, rim], i) => {
    const yy = armY + 1 + i;
    const x0 = cx - (wd >> 1);
    R(x0, yy, wd, 1, INK);
    if (!rim && i > 0) {
      R(x0 + 1, yy, wd - 2, 1, i === 1 ? MAT.butter.hi : MAT.butter.f);
      P(x0 + wd - 2, yy, MAT.butter.lo);
    } else if (i === 0) R(x0 + 1, yy, wd - 2, 1, INK);
  });
  R(cx - 1, armY, 2, 1, INK);
  // the nest bowl
  const x0 = cx - 22;
  const nw = 44;
  ell(x0 - 1, ty - 1, nw + 2, 14, INK);
  for (let py = ty; py < ty + 12; py++) {
    for (let px2 = x0; px2 < x0 + nw; px2++) {
      if (!inEll(px2, py, x0, ty, nw, 12)) continue;
      if (inEll(px2, py, x0 + 4, ty + 1, nw - 8, 8)) continue;
      const s1 = (px2 * 2 + py * 3) % 7 === 0;
      const s2 = (px2 - py * 2 + 700) % 9 === 0;
      P(px2, py, s1 ? MAT.straw.lo : s2 ? MAT.straw.hi : MAT.straw.f);
    }
  }
  // soft cushion inside
  ell(x0 + 4, ty + 1, nw - 8, 8, INK);
  ell(x0 + 5, ty + 2, nw - 10, 6, '#ffd6e6');
  R(x0 + 12, ty + 2, nw - 24, 1, '#ffeef5');
  // straw wisps
  for (const [dx, dy] of [[-1, 4], [-2, 5], [nw, 5], [nw + 1, 4], [6, 12], [nw - 8, 12]]) P(x0 + dx, ty + dy, MAT.straw.lo);
}

function paintBookshelf(L) {
  const b = L.parts.bookshelf;
  if (!b) return;
  const base = L.parts.base;
  const { x, w, top } = b;
  const h = base - top;
  const Wd = MAT.wood;
  shadow(x, w, base);
  R(x, top, w, h, INK);
  R(x + 1, top + 1, w - 2, h - 2, Wd.f);
  R(x + 1, top + 1, w - 2, 1, Wd.hi);
  R(x + 1, top + 2, 1, h - 4, Wd.hi);
  R(x + w - 2, top + 2, 1, h - 3, Wd.lo);
  const ix = x + 3;
  const iw = w - 6;
  const iy = top + 4;
  const ibot = base - 5;
  R(ix - 1, iy - 1, iw + 2, ibot - iy + 1, INK);
  const ns = Math.max(2, Math.round((ibot - iy) / 14));
  const ch = (ibot - iy) / ns;
  const r = rng(77);
  for (let s = 0; s < ns; s++) {
    const y0 = Math.round(iy + s * ch);
    const y1 = Math.round(iy + (s + 1) * ch) - (s < ns - 1 ? 2 : 1);
    R(ix, y0, iw, y1 - y0, C.shelfBack);
    R(ix, y0, iw, 1, MAT.wood.lo);
    // a trinket on some shelves
    let bx = ix;
    if (s === 1) {
      // tiny photo frame
      R(bx + 1, y1 - 7, 6, 7, INK);
      R(bx + 2, y1 - 6, 4, 5, '#ffdcea');
      P(bx + 3, y1 - 4, '#ff8fbf');
      P(bx + 4, y1 - 4, '#ff8fbf');
      bx += 8;
    }
    let ex = ix + iw;
    if (s === 0) {
      // a little potted cactus
      const cx = ex - 5;
      R(cx, y1 - 8, 3, 5, INK);
      P(cx + 1, y1 - 7, MAT.leaf.f);
      P(cx + 1, y1 - 6, MAT.leaf.hi);
      P(cx + 1, y1 - 5, MAT.leaf.f);
      P(cx - 1, y1 - 6, INK);
      P(cx + 3, y1 - 7, INK);
      pot(cx - 1, y1 - 4, 5, 4, MAT.peach);
      ex -= 7;
    }
    if (s === ns - 1 && ns > 2) {
      // a ball on a stand
      const cx = ex - 6;
      ell(cx, y1 - 7, 6, 6, INK);
      ell(cx + 1, y1 - 6, 4, 4, MAT.sky.f);
      P(cx + 2, y1 - 5, '#ffffff');
      R(cx + 1, y1 - 1, 4, 1, INK);
      ex -= 8;
    }
    books(bx, y1, ex - bx, Math.min(y1 - y0 - 1, 11), r);
    if (s < ns - 1) {
      R(ix, y1, iw, 1, Wd.hi);
      R(ix, y1 + 1, iw, 1, INK);
    }
  }
  R(x + 1, base - 4, w - 2, 3, Wd.lo);
  R(x + 1, base - 4, w - 2, 1, Wd.f);
  // trailing plant on top
  const px = x + w - 11;
  const M = MAT.leaf;
  const vines = [
    [x + w - 2, top + 2],
    [x + w, top + 6],
    [x + w - 1, top + 10],
    [x + w + 1, top + 14],
    [x + w, top + 19],
  ];
  for (const [vx, vy] of vines) {
    ell(vx - 1, vy - 1, 5, 4, INK);
    ell(vx, vy, 3, 2, M.f);
    P(vx, vy, M.hi);
  }
  leaf(px + 1, top - 6, 7, 4, -2.4, M);
  leaf(px + 8, top - 6, 7, 4, -0.6, M);
  leaf(px + 4, top - 8, 8, 4, -1.6, M);
  pot(px, top - 5, 9, 5, MAT.pink);
}

function paintAquarium(L) {
  const a = L.parts.aquarium;
  if (!a) return;
  const base = L.parts.base;
  const { x, w, top } = a;
  const st = base - 14;
  shadow(x, w, base);
  // stand
  rb(x + 1, st, w - 2, 14, MAT.lilac, 0);
  R(x + (w >> 1), st + 3, 1, 9, INK);
  P(x + (w >> 1) - 2, st + 7, INK);
  P(x + (w >> 1) + 2, st + 7, INK);
  // tank
  const th = st - top + 1;
  R(x, top, w, th, INK);
  R(x + 1, top + 1, w - 2, 2, MAT.white.f);
  R(x + 1, top + 3, w - 2, th - 4, '#bfe8ff');
  R(x + 1, top + 3, w - 2, 1, '#e6f8ff');
  R(x + 1, top + 4, w - 2, 1, '#d4f1ff');
  R(x + 1, st - 3, w - 2, 3, '#ffe7a8');
  for (let i = x + 2; i < x + w - 2; i += 4) P(i, st - 2, '#f0cd8a');
  // weed
  for (const [sx, hh] of [[x + 4, 8], [x + 6, 6], [x + w - 7, 9]]) {
    for (let j = 0; j < hh; j++) P(sx + ((j >> 1) & 1), st - 3 - j, j % 3 ? MAT.leaf.f : MAT.leaf.lo);
  }
  // pebble
  ell(x + w - 15, st - 6, 7, 4, INK);
  ell(x + w - 14, st - 5, 5, 2, MAT.lilac.f);
  // fish
  spr(FISH, x + 9, top + 8, { p: MAT.pink.f, k: INK });
  spr(FISH.map((r2) => [...r2].reverse().join('')), x + w - 13, top + 12, { p: MAT.butter.f, k: INK });
  P(x + 8, top + 6, '#ffffff');
  P(x + 7, top + 4, '#ffffff');
  R(x + 2, top + 6, 1, 4, 'rgba(255,255,255,0.7)');
}

function paintFloorLamp(L) {
  const l = L.parts.lamp;
  if (!l) return;
  const base = L.parts.base;
  const cx = l.x + 5;
  shadow(cx - 4, 9, base);
  R(cx - 4, base - 3, 9, 3, INK);
  R(cx - 3, base - 2, 7, 1, MAT.cream.f);
  R(cx, l.top + 7, 1, base - 3 - (l.top + 7), INK);
  for (let i = 0; i < 8; i++) {
    const hw = 3 + (i >> 1);
    R(cx - hw, l.top + i, hw * 2 + 1, 1, INK);
    if (i > 0 && i < 7) {
      R(cx - hw + 1, l.top + i, hw * 2 - 1, 1, i < 3 ? MAT.pink.hi : MAT.pink.f);
      P(cx + hw - 1, l.top + i, MAT.pink.lo);
    }
  }
  R(cx - 1, l.top + 8, 3, 1, INK);
}
// after dark the shade glows from inside
function paintFloorLampLit(L) {
  const l = L.parts.lamp;
  if (!l) return;
  const cx = l.x + 5;
  for (let i = 1; i < 7; i++) {
    const hw = 3 + (i >> 1);
    R(cx - hw + 1, l.top + i, hw * 2 - 1, 1, i < 3 ? '#fff6fa' : '#ffdbe9');
  }
  R(cx - 2, l.top + 8, 5, 1, '#fff2b8');
}

function paintCoat(L) {
  const c = L.parts.coat;
  if (!c) return;
  const base = L.parts.base;
  const cx = c.x + 6;
  const top = c.top + 6;
  shadow(cx - 5, 11, base);
  line(cx, base - 7, cx - 5, base - 1, INK);
  line(cx, base - 7, cx + 5, base - 1, INK);
  R(cx - 1, top, 3, base - 6 - top, INK);
  R(cx, top + 1, 1, base - 8 - top, MAT.wood.f);
  R(cx - 1, top - 2, 3, 2, INK);
  line(cx - 1, top + 3, cx - 4, top + 1, INK);
  line(cx + 1, top + 3, cx + 4, top + 1, INK);
  // a beret on top
  ell(cx - 6, top - 6, 13, 6, INK);
  ell(cx - 5, top - 5, 11, 4, MAT.pink.f);
  R(cx - 3, top - 5, 5, 1, MAT.pink.hi);
  P(cx, top - 7, INK);
  // a striped scarf on the right hook
  R(cx + 2, top + 1, 5, 23, INK);
  for (let row = 0; row < 21; row++) R(cx + 3, top + 2 + row, 3, 1, ((row / 3) | 0) % 2 ? MAT.cream.f : MAT.mint.f);
  P(cx + 3, top + 24, MAT.mint.lo);
  P(cx + 5, top + 24, MAT.mint.lo);
  // a tote bag on the left hook
  line(cx - 8, top + 10, cx - 4, top + 2, INK);
  line(cx - 3, top + 10, cx - 4, top + 2, INK);
  rb(cx - 10, top + 10, 9, 10, MAT.butter, 1);
  spr(HEART7, cx - 9, top + 13, { k: '#e05c97', h: MAT.butter.f, p: MAT.butter.f, o: MAT.butter.f });
}

const NOTE = ['..kk.', '..k.k', '..k..', '.kk..', 'kkk..', '.k...'];
function paintSideTable(L) {
  const t = L.parts.sideTable;
  if (!t) return;
  const base = L.parts.base;
  const { x, w } = t;
  const st = base - 15;
  shadow(x + 1, w - 2, base);
  for (const lx of [x + 2, x + w - 5]) {
    R(lx, st + 3, 3, base - st - 3, INK);
    R(lx + 1, st + 3, 1, base - st - 4, MAT.wood.f);
  }
  R(x + 3, base - 6, w - 6, 2, INK);
  rb(x, st, w, 4, MAT.wood, 1);
  // a little teapot and a cup
  const tx = x + 3;
  const ty = st - 1; // what stands on the table stands on this row
  ell(tx, ty - 7, 9, 8, INK);
  ell(tx + 1, ty - 6, 7, 6, MAT.mint.f);
  R(tx + 2, ty - 5, 2, 1, MAT.mint.hi);
  R(tx + 5, ty - 3, 2, 1, MAT.mint.lo);
  R(tx + 3, ty - 9, 3, 2, INK);
  P(tx + 4, ty - 9, MAT.pink.f);
  line(tx - 2, ty - 5, tx, ty - 3, INK); // spout
  P(tx + 9, ty - 5, INK); // handle
  P(tx + 9, ty - 3, INK);
  P(tx + 10, ty - 4, INK);
  R(tx + 11, ty - 3, 4, 3, INK);
  R(tx + 12, ty - 3, 2, 2, MAT.pink.f);
  R(tx + 12, ty - 3, 2, 1, MAT.pink.hi);
}

// ------------------------------------------------------- the new corner

// the blank name board over the door (the app writes the name on it)
function paintSign(L) {
  const { x, y, w, h } = L.parts.sign;
  // two little nails
  P(x + 5, y - 1, SOFT);
  P(x + w - 6, y - 1, SOFT);
  R(x + 1, y, w - 2, h, INK);
  R(x, y + 1, w, h - 2, INK);
  R(x + 1, y + 1, w - 2, h - 2, MAT.wood.f);
  R(x + 1, y + 1, w - 2, 1, MAT.wood.hi);
  R(x + 1, y + h - 2, w - 2, 1, MAT.wood.lo);
  R(x + 2, y + 2, w - 4, h - 4, '#fff6e8');
  R(x + 2, y + h - 3, w - 4, 1, MAT.cream.lo);
  // tiny hearts at the ends of the board
  for (const hx of [x + 1, x + w - 2]) {
    P(hx, y + (h >> 1), '#ff8fbf');
  }
}

// your armchair; the seat cushion, skirt and arms go on the front layer
function paintChair(L, front) {
  const c = L.parts.chair;
  const { x, w, y } = c;
  const aw = CHAIR_AW;
  const M = MAT.peach;
  const ix = x + aw;
  if (!front) {
    shadow(x + 1, w - 2, y + 3);
    // a round, tufted back with a knitted throw over it
    rb(ix - 1, y - 33, 24, 20, M, 2);
    R(ix + 2, y - 31, 18, 1, M.hi);
    for (const bx of [ix + 6, ix + 11, ix + 16]) P(bx, y - 26, M.lo);
    const T = MAT.lilac;
    R(ix + 14, y - 33, 7, 1, INK);
    for (let r2 = 0; r2 < 12; r2++) {
      const wdt = r2 < 1 ? 5 : 6;
      R(ix + 15, y - 32 + r2, wdt, 1, ((r2 / 2) | 0) % 2 ? T.f : MAT.cream.f);
      P(ix + 14, y - 32 + r2, INK);
      P(ix + 15 + wdt, y - 32 + r2, INK);
    }
    for (let i = 0; i < 6; i += 2) P(ix + 15 + i, y - 20, T.lo);
  }
  // seat cushion
  rb(ix, y - 17, 22, 9, M, 1, false);
  R(ix + 1, y - 16, 20, 2, M.hi);
  // skirt
  R(ix, y - 9, 22, 10, INK);
  R(ix + 1, y - 8, 20, 8, M.lo);
  R(ix + 1, y - 8, 20, 1, M.f);
  for (let sx = ix + 3; sx < ix + 20; sx += 4) P(sx, y - 3, M.f);
  // feet
  for (const fx of [x + 2, x + w - 5]) {
    R(fx, y, 3, 3, INK);
    P(fx + 1, y + 1, MAT.wood.f);
  }
  // arms
  for (const ax of [x, x + w - aw - 1]) {
    rb(ax, y - 24, aw + 1, 25, M, 2);
    R(ax + 2, y - 22, aw - 3, 1, '#ffffff');
    R(ax + 1, y - 19, aw - 1, 1, M.lo);
  }
}

// the earned shelf: trophies on top, "lessons" books below, and the record
// player standing on it
function paintEarned(L, earned) {
  const e = L.parts.earned;
  const { x, y, w, h } = e;
  const F = MAT.pink;
  const back = '#fff7fb';
  // cubby
  R(x, y, w, h, INK);
  R(x + 1, y + 1, w - 2, h - 2, F.f);
  R(x + 1, y + 1, w - 2, 1, F.hi);
  R(x + w - 2, y + 2, 1, h - 3, F.lo);
  const ix = x + 3;
  const iw = w - 6;
  const tTop = y + 3; // trophy compartment rows tTop .. y+12
  const mid = y + 13; // divider
  const bTop = y + 16; // book compartment rows bTop .. y+h-4
  const bBot = y + h - 3;
  R(ix - 1, tTop - 1, iw + 2, mid - tTop + 1, INK);
  R(ix, tTop, iw, mid - tTop, back);
  R(ix, tTop, iw, 1, '#f6e3ee');
  R(ix - 1, bTop - 1, iw + 2, bBot - bTop + 1, INK);
  R(ix, bTop, iw, bBot - bTop, back);
  R(ix, bTop, iw, 1, '#f6e3ee');
  R(x + 1, mid, w - 2, 1, F.hi);
  R(x + 1, bBot, w - 2, 1, F.hi);
  const has = earned && typeof earned === 'object';
  const nt = has ? clamp(Math.floor(Number(earned.trophies) || 0), 0, 6) : 0;
  const nb = has ? clamp(Math.floor(Number(earned.books) || 0), 0, 8) : 0;
  // trophies stand on the divider
  const TC = [MAT.butter, MAT.white, MAT.peach, MAT.butter, MAT.mint, MAT.sky];
  if (nt) {
    const pitch = nt > 1 ? Math.min(7, Math.floor((iw - 5) / (nt - 1))) : 0;
    const tw = (nt - 1) * pitch + 5;
    let tx = ix + ((iw - tw) >> 1);
    for (let i = 0; i < nt; i++) {
      const M = TC[i];
      const up = i & 1; // every other one stands on a little plinth
      if (up) R(tx + 1, mid - 1, 3, 1, F.lo);
      spr(TROPHY, tx, mid - 7 - up, { k: INK, h: M.hi, y: M.f, o: M.lo });
      tx += pitch;
    }
  } else {
    // empty for now: a dotted outline where the first trophy will go
    for (let i = 0; i < 5; i += 2) P(ix + (iw >> 1) - 2 + i, mid - 1, '#efd2e2');
  }
  // lessons: one book per few ideas let go, each with a ribbon
  if (nb) {
    const sw = iw >= nb * 3 + 6 ? 3 : 2;
    let bx = ix + 1;
    const r = rng(nb * 13 + 5);
    for (let i = 0; i < nb; i++) {
      const M = SPINES[(i * 3 + 1) % SPINES.length];
      const bh = 7 + Math.floor(r() * 2);
      R(bx, bBot - bh, sw, bh, M.f);
      R(bx, bBot - bh, 1, bh, M.lo);
      R(bx, bBot - bh, sw, 1, INK);
      P(bx + sw - 1, bBot - bh + 2, M.hi);
      // the ribbon hangs out of the bottom of the page block
      P(bx + (sw >> 1), bBot - 2, '#ff6fae');
      P(bx + (sw >> 1), bBot, '#ff6fae');
      bx += sw;
    }
    // and a heart bookend
    if (bx + 8 <= ix + iw) spr(HEART7.slice(0, 5), bx + 1, bBot - 5, { k: INK, h: '#ffdcea', p: '#ff8fbf', o: '#e05c97' });
  }
  // the record player on top
  const p = e.rec;
  R(p.x + 1, p.y + 2, p.w - 2, 5, INK);
  R(p.x, p.y + 3, p.w, 3, INK);
  R(p.x + 1, p.y + 3, p.w - 2, 3, MAT.butter.f);
  R(p.x + 2, p.y + 3, p.w - 4, 1, MAT.butter.hi);
  R(p.x + 1, p.y + 5, p.w - 2, 1, MAT.butter.lo);
  P(p.x + 3, p.y + 4, INK);
  P(p.x + 5, p.y + 4, '#ff8fbf');
  // platter (empty until it plays)
  ell(p.x + 1, p.y, 10, 4, INK);
  ell(p.x + 2, p.y + 1, 8, 2, MAT.lilac.f);
  // tonearm
  R(p.x + p.w - 3, p.y - 1, 2, 3, INK);
  line(p.x + p.w - 3, p.y, p.x + p.w - 5, p.y + 2, SOFT);
  // a record sleeve leaning on the right
  const sx = p.x + p.w + 2;
  if (sx + 8 <= x + w) {
    R(sx, p.y - 1, 8, 8, INK);
    R(sx + 1, p.y, 6, 6, MAT.sky.f);
    R(sx + 1, p.y, 6, 1, MAT.sky.hi);
    ell(sx + 2, p.y + 1, 4, 4, '#ffffff');
    P(sx + 3, p.y + 2, '#ff8fbf');
  }
}

// while music plays: a record spinning and a note drifting up
function paintRecordLive(L, on) {
  const p = L.parts.earned.rec;
  if (!on) return;
  ell(p.x + 1, p.y - 1, 10, 5, INK);
  ell(p.x + 2, p.y, 8, 3, '#3a3874');
  R(p.x + 4, p.y, 3, 1, '#5a57a3');
  R(p.x + 5, p.y + 1, 2, 1, MAT.pink.f);
  // the arm swings onto the record
  line(p.x + p.w - 3, p.y, p.x + p.w - 6, p.y + 1, INK);
  P(p.x + 1, p.y + 4, '#7dffc0');
  spr(NOTE, p.x + 3, p.y - 7, { k: '#e05c97' });
}

// the revival plant on the window sill: 0 = a sprout ... 5 = lush, in flower
function paintRevivalPlant(px, sill, stage) {
  const M = MAT.leaf;
  const cx = px + 3;
  const top = sill - 4; // pot top row
  const st = clamp(Math.floor(stage), 0, 5);
  const stem = [2, 4, 6, 8, 11, 13][st];
  if (st >= 1) R(cx, top - stem, 1, stem, M.lo);
  else R(cx, top - 2, 1, 2, M.lo);
  const lv = [
    [[-2, 2, 4, 2, -2.6], [2, 2, 4, 2, -0.5]],
    [[-2, 3, 5, 3, -2.6], [3, 4, 5, 3, -0.5]],
    [[-3, 3, 6, 3, -2.7], [3, 4, 6, 3, -0.45], [0, 6, 5, 3, -1.57]],
    [[-4, 3, 7, 3, -2.8], [4, 4, 7, 3, -0.35], [-3, 7, 6, 3, -2.3], [3, 8, 6, 3, -0.8], [0, 9, 5, 3, -1.57]],
    [[-5, 3, 7, 4, -2.8], [5, 4, 7, 4, -0.3], [-4, 7, 7, 3, -2.4], [4, 8, 7, 3, -0.7], [-2, 11, 6, 3, -2.0], [2, 11, 6, 3, -1.1]],
    [[-6, 3, 8, 4, -2.9], [6, 4, 8, 4, -0.25], [-5, 7, 7, 4, -2.5], [5, 8, 7, 4, -0.6], [-3, 11, 7, 3, -2.1], [3, 11, 7, 3, -1.0]],
  ][st];
  for (const [dx, dy, len, wid, ang] of lv) leaf(cx + dx + 0.5, top - dy, len, wid, ang, M);
  if (st >= 4) {
    // a bloom on its own stem, leaning out to the side
    const bx = cx + 3;
    const by = top - stem + (st === 4 ? 1 : -1);
    line(cx, top - stem + 5, bx, by + 2, M.lo);
    if (st === 4) {
      ell(bx - 1, by - 1, 4, 5, INK);
      R(bx, by, 2, 3, '#ff9ec7');
      P(bx, by, '#ffd0e4');
    } else {
      ell(bx - 3, by - 3, 8, 7, INK);
      ell(bx - 2, by - 2, 6, 5, '#ff9ec7');
      R(bx - 1, by - 2, 2, 1, '#ffd0e4');
      P(bx - 2, by, '#ffd0e4');
      P(bx + 2, by + 1, '#f07fae');
      R(bx, by, 2, 1, '#ffe27a');
      P(bx + 1, by - 1, '#f07fae');
    }
  }
  pot(px, sill - 4, 7, 5, MAT.peach);
  if (st === 0) P(px + 5, sill - 2, '#ff8fbf'); // a little heart sticker on the pot
}

// --------------------------------------------------------------- seasons

function seasonOf(now, dayOffset) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Math.round(dayOffset || 0));
  const m = d.getMonth();
  const season = m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';
  return { season, month: m, key: m === 9 ? 'oct' : m === 11 ? 'dec' : season };
}

function pumpkin(x, bottom, big) {
  const w = big ? 9 : 7;
  const h = big ? 6 : 5;
  const y = bottom - h;
  ell(x, y, w, h, INK);
  ell(x + 1, y + 1, w - 2, h - 2, '#ffb36b');
  R(x + 2, y + 1, 1, h - 2, '#f39a4c');
  R(x + w - 3, y + 1, 1, h - 2, '#f39a4c');
  P(x + 2, y + 1, '#ffd2a3');
  R(x + (w >> 1), y - 2, 1, 2, INK);
  P(x + (w >> 1) + 1, y - 2, MAT.leaf.f);
  P(x + (w >> 1) + 2, y - 3, MAT.leaf.f);
}

// little indoor touches that change with the month
function paintSeasonStatic(L, sk) {
  const wn = L.parts.window;
  const sill = wn.y + wn.h - 1;
  const sx = wn.x + 4;
  const door = L.parts.door;
  const ds = { x: door.x + 3, y: door.y + 3, w: door.w - 6, h: door.h - 3 };
  const panel = { x: ds.x + 3, y: ds.y + 19, w: ds.w - 6, h: ds.h - 25 };
  if (sk === 'oct') {
    pumpkin(sx, sill, false);
    if (!L.parts.chair.floor) pumpkin(door.x + door.w - 11, L.floorY + 6, true);
  } else if (sk === 'spring') {
    // a bud vase with two blossoms
    R(sx + 1, sill - 6, 5, 6, INK);
    R(sx + 2, sill - 5, 3, 4, '#d8f0ff');
    P(sx + 2, sill - 5, '#ffffff');
    line(sx + 3, sill - 7, sx + 1, sill - 11, MAT.leaf.lo);
    line(sx + 3, sill - 7, sx + 5, sill - 12, MAT.leaf.lo);
    for (const [fx, fy, c] of [[sx + 1, sill - 12, '#ff9ec7'], [sx + 5, sill - 13, '#ffe27a']]) {
      ell(fx - 2, fy - 1, 5, 4, INK);
      R(fx - 1, fy, 3, 2, c);
      P(fx, fy, '#ffffff');
    }
    leaf(sx + 6, sill - 9, 4, 2, -0.4, MAT.leaf);
  } else if (sk === 'dec' && panel.h >= 12) {
    // a small wreath on the door
    const cx = panel.x + (panel.w >> 1);
    const cy = panel.y + Math.min(8, panel.h >> 1);
    ell(cx - 6, cy - 6, 13, 13, INK);
    ell(cx - 5, cy - 5, 11, 11, MAT.leaf.f);
    ell(cx - 3, cy - 3, 7, 7, INK);
    ell(cx - 2, cy - 2, 5, 5, MAT.sky.f);
    for (const [dx, dy] of [[-4, -2], [3, -4], [4, 2], [-2, 4], [0, -5]]) P(cx + dx, cy + dy, MAT.leaf.hi);
    for (const [dx, dy] of [[-4, 1], [2, -4], [3, 4]]) P(cx + dx, cy + dy, '#ff6f8e');
    R(cx - 2, cy + 4, 5, 2, '#ff6fae');
    P(cx, cy + 5, INK);
    P(cx - 2, cy + 6, '#ff6fae');
    P(cx + 2, cy + 6, '#ff6fae');
  } else if (sk === 'summer' && panel.h >= 14) {
    // an ice-lolly poster taped to the door
    const pw = Math.min(11, panel.w - 2);
    const px = panel.x + ((panel.w - pw) >> 1);
    const py = panel.y + 1;
    R(px, py, pw, 13, INK);
    R(px + 1, py + 1, pw - 2, 11, '#fff8e6');
    const lx = px + (pw >> 1) - 2;
    R(lx, py + 2, 5, 6, INK);
    R(lx + 1, py + 3, 3, 2, '#ff9ec7');
    R(lx + 1, py + 5, 3, 2, '#ffe27a');
    P(lx + 1, py + 3, '#ffd0e4');
    R(lx + 2, py + 8, 1, 3, MAT.wood.f);
    R(px - 1, py - 1, 3, 2, 'rgba(255,255,255,0.75)');
  }
}

function paintPlants(L) {
  const base = L.parts.base;
  for (const p of L.parts.plants) {
    const { x } = p;
    const M = MAT.leaf;
    if (p.kind === 'monstera') {
      shadow(x + 1, 10, base);
      const sx = x + 6;
      const sy = base - 9;
      const leaves = [
        [x + 1, base - 15, 9, 5, -2.8],
        [x + 11, base - 16, 9, 5, -0.35],
        [x + 2, base - 22, 10, 6, -2.3],
        [x + 10, base - 24, 10, 6, -0.85],
        [x + 5, base - 30, 10, 6, -1.85],
      ];
      for (const [lx, ly] of leaves) line(sx, sy, Math.round(lx), Math.round(ly), M.lo);
      for (const [lx, ly, len, wid, ang] of leaves) {
        leaf(lx, ly, len, wid, ang, M);
      }
      pot(x + 2, base - 9, 8, 9, MAT.pink);
    } else if (p.kind === 'snake') {
      shadow(x, 10, base);
      const blades = [
        [x + 2, base - 15, 14, 3, -1.75],
        [x + 8, base - 14, 12, 3, -1.35],
        [x + 4, base - 19, 20, 4, -1.62],
        [x + 6, base - 17, 16, 3, -1.5],
      ];
      for (const [lx, ly, len, wid, ang] of blades) leaf(lx, ly, len, wid, ang, MAT.mint, true);
      pot(x + 1, base - 8, 8, 8, MAT.butter);
    } else if (p.kind === 'fern') {
      shadow(x + 1, 12, base);
      const cx = x + 7;
      const cy = base - 8;
      for (let i = 0; i < 7; i++) {
        const ang = -Math.PI + 0.25 + (i * (Math.PI - 0.5)) / 6;
        const r = i === 3 ? 9 : 7;
        leaf(cx + Math.cos(ang) * r, cy - 2 + Math.sin(ang) * r, 9, 4, ang, M);
      }
      pot(x + 3, base - 8, 9, 8, MAT.sky);
    }
  }
}

// ------------------------------------------------------- desks and sofa

const DESK_LOOK = [
  { acc: MAT.pink, chair: MAT.sky },
  { acc: MAT.mint, chair: MAT.pink },
  { acc: MAT.sky, chair: MAT.butter },
];

function paintDesk(L, d, front) {
  const { sy, base } = L.parts;
  const { x, w, sx } = d;
  const look = DESK_LOOK[d.i];
  const y0 = sy - 17;
  const T = MAT.wood;
  const B = MAT.cream;
  if (!front) {
    shadow(x + 1, w - 2, base);
    paintMonitorCase(L, d);
    paintDeskAccessory(L, d);
  }
  // body
  const bx = x + 2;
  const bw = w - 4;
  const by = y0 + 4;
  const bh = base - by;
  R(bx, by, bw, bh, INK);
  const pw = d.mon.w + 1;
  // pedestal with two drawers, under the monitor
  const A = look.acc;
  const dr = [
    [by + 1, 6],
    [by + 8, bh - 9],
  ];
  for (const [dy, dh] of dr) {
    R(bx + 1, dy, pw - 2, dh, A.f);
    R(bx + 1, dy, pw - 2, 1, A.hi);
    R(bx + 1, dy + dh - 1, pw - 2, 1, A.lo);
    R(bx + pw - 2, dy + 1, 1, dh - 2, A.lo);
    R(bx + (pw >> 1) - 2, dy + 2, 4, 1, INK);
  }
  // knee space: a recessed modesty panel and a leg
  const kx = bx + pw;
  const kw = bw - pw - 1;
  R(kx, by + 1, kw, bh - 2, B.lo);
  R(kx, by + 1, kw, 1, B.f);
  R(kx + 2, by + 4, kw - 7, 1, B.f);
  R(bx + bw - 5, by + 1, 1, bh - 2, INK);
  R(bx + bw - 4, by + 1, 3, bh - 2, B.f);
  R(bx + bw - 4, by + 1, 1, bh - 2, B.hi);
  // top slab
  R(x, y0, w, 5, INK);
  R(x + 1, y0 + 1, w - 2, 2, T.hi);
  R(x + 1, y0 + 3, w - 2, 1, T.f);
  P(x + w - 2, y0 + 3, T.lo);
  // keyboard and mouse in front of the seat
  R(sx - 6, y0 + 1, 11, 1, '#fbfaff');
  R(sx - 6, y0 + 2, 11, 1, '#c9c2ec');
  for (let i = 0; i < 5; i++) P(sx - 5 + i * 2, y0 + 1, '#ddd7f6');
  R(sx + 7, y0 + 1, 2, 1, '#fbfaff');
  R(sx + 7, y0 + 2, 2, 1, '#c9c2ec');
  if (!front) paintMonitorFoot(L, d);
}

function paintMonitorFoot(L, d) {
  const y0 = L.parts.sy - 17;
  const { x: mx, w: mw } = d.mon;
  const cxm = mx + (mw >> 1);
  R(cxm - 3, y0 + 1, 7, 2, INK);
  R(cxm - 2, y0 + 1, 5, 1, MAT.lilac.hi);
  R(cxm - 1, y0 - 3, 3, 4, INK);
  R(cxm, y0 - 3, 1, 3, MAT.lilac.f);
}

function paintMonitorCase(L, d) {
  const y0 = L.parts.sy - 17;
  const { x: mx, w: mw } = d.mon;
  const M = MAT.lilac;
  R(mx, y0 - 14, mw, 11, INK);
  R(mx + 1, y0 - 13, mw - 2, 9, M.f);
  R(mx + 1, y0 - 13, 1, 9, M.lo);
  R(mx + 2, y0 - 13, mw - 3, 1, M.hi);
  P(mx + mw - 3, y0 - 5, '#56c79a');
}

function paintScreen(L, d, on) {
  const y0 = L.parts.sy - 17;
  const { x: mx, w: mw } = d.mon;
  const sx = mx + 3;
  const sY = y0 - 12;
  const sw = mw - 5;
  const sh = 7;
  if (on) {
    R(sx, sY, sw, sh, '#e3f4ff');
    R(sx, sY, sw, 1, '#c9b6ff');
    const r = rng(17 + d.i * 31);
    const cols = ['#ff8fbf', '#7a83e6', '#4fbf8f', '#e0a43a', '#b58cf0'];
    for (let row = 2; row < sh; row += 2) {
      let cx = sx + Math.floor(r() * 3);
      while (cx < sx + sw - 1) {
        const len = 1 + Math.floor(r() * 3);
        R(cx, sY + row, Math.min(len, sx + sw - cx), 1, cols[Math.floor(r() * cols.length)]);
        cx += len + 1;
        if (r() < 0.3) break;
      }
    }
    P(sx + sw - 2, sY + sh - 1, INK);
  } else {
    R(sx, sY, sw, sh, '#3a3874');
    P(sx + 1, sY + 3, '#5a57a3');
    P(sx + 2, sY + 2, '#5a57a3');
    P(sx + 3, sY + 1, '#5a57a3');
    P(sx + 2, sY + 4, '#4a4790');
    P(sx + 3, sY + 3, '#4a4790');
    // a sticky note on the bezel
    R(mx + mw - 4, y0 - 15, 4, 4, MAT.butter.f);
    R(mx + mw - 4, y0 - 12, 4, 1, MAT.butter.lo);
    R(mx + mw - 3, y0 - 14, 2, 1, SOFT);
  }
}

function paintDeskAccessory(L, d) {
  const y0 = L.parts.sy - 17;
  const ax = d.x + d.w - 6;
  if (d.acc === 'mug') {
    spr(MUG, ax, y0 - 3, { k: INK, p: MAT.pink.f, h: MAT.pink.hi });
  } else if (d.acc === 'lamp') {
    const lx = d.x + d.w - 4;
    R(lx - 2, y0, 5, 2, INK);
    R(lx - 1, y0, 3, 1, MAT.butter.f);
    R(lx, y0 - 9, 1, 9, INK);
    line(lx, y0 - 9, lx - 3, y0 - 12, INK);
    R(lx - 8, y0 - 15, 7, 3, INK);
    R(lx - 7, y0 - 14, 5, 1, MAT.butter.f);
    P(lx - 7, y0 - 15, INK);
  } else if (d.acc === 'plant') {
    leaf(ax + 1, y0 - 5, 5, 3, -2.2, MAT.leaf);
    leaf(ax + 5, y0 - 5, 5, 3, -0.9, MAT.leaf);
    leaf(ax + 3, y0 - 6, 6, 3, -1.57, MAT.leaf);
    pot(ax, y0 - 3, 6, 4, MAT.sky);
  }
}

function paintChairBehind(L, d) {
  const { sy } = L.parts;
  rb(d.sx - 8, sy - 28, 16, 11, DESK_LOOK[d.i].chair, 2);
  R(d.sx - 5, sy - 23, 10, 1, DESK_LOOK[d.i].chair.lo);
}

function paintChairOut(L, d) {
  const { base } = L.parts;
  const M = DESK_LOOK[d.i].chair;
  const cx = d.sx + 3;
  const b = base + 3; // pushed out a little in front of the desk
  // wheels and star base
  R(cx - 7, b - 2, 15, 1, INK);
  for (const wx of [cx - 7, cx - 1, cx + 6]) R(wx, b - 1, 2, 2, INK);
  R(cx - 1, b - 6, 3, 4, INK);
  P(cx, b - 5, SOFT);
  // seat, seen past the back
  rb(cx - 8, b - 9, 17, 4, M, 1, false);
  // backrest
  rb(cx - 6, b - 19, 13, 11, M, 2);
  R(cx - 3, b - 14, 7, 1, M.lo);
}

function paintSofa(L, front) {
  const { sy, base } = L.parts;
  const s = L.parts.sofa;
  const { x, w, aw, ss } = s;
  const M = MAT.sky;
  const ix = x + aw;
  if (!front) {
    shadow(x + 1, w - 2, base);
    for (let k = 0; k < 3; k++) rb(ix + k * ss, sy - 33, ss + 1 + (k === 2 ? 1 : 0), 19, M, 2);
    for (let k = 0; k < 3; k++) P(ix + k * ss + (ss >> 1), sy - 25, M.lo);
    // pillows
    spr(HEART9, ix + 2, sy - 25, { k: INK, h: MAT.butter.hi, p: MAT.butter.f, o: MAT.butter.lo });
    rb(x + w - aw - 11, sy - 26, 10, 9, MAT.pink, 2);
    P(x + w - aw - 6, sy - 22, MAT.pink.lo);
  }
  // seat cushions
  for (let k = 0; k < 3; k++) {
    const cx0 = ix + k * ss;
    rb(cx0, sy - 17, ss + 1 + (k === 2 ? 1 : 0), 9, M, 1, false);
    R(cx0 + 1, sy - 16, ss - 1, 2, M.hi);
  }
  // skirt
  R(ix, sy - 9, 3 * ss + 2, base - 2 - (sy - 9), INK);
  R(ix + 1, sy - 8, 3 * ss, base - 4 - (sy - 9), M.lo);
  R(ix + 1, sy - 8, 3 * ss, 1, M.f);
  // feet
  for (const fx of [x + 2, x + w - 5]) {
    R(fx, base - 3, 3, 3, INK);
    P(fx + 1, base - 2, MAT.wood.f);
  }
  // arms
  const ah = base - 2 - (sy - 24);
  rb(x, sy - 24, aw + 1, ah, M, 2);
  rb(x + w - aw - 1, sy - 24, aw + 1, ah, M, 2);
  for (const ax of [x, x + w - aw - 1]) {
    R(ax + 2, sy - 22, aw - 3, 1, '#ffffff');
    R(ax + 1, sy - 19, aw - 1, 1, M.lo);
  }
}

// ------------------------------------------------------------- live bits

const SKY = {
  day: { bands: ['#8ccfff', '#9fd8ff', '#b3e1ff', '#c8eaff'], far: '#c6c4f0', near: '#aaa5df', win: '#d7d4f6', lit: 0, cloud: '#ffffff', cloudLo: '#deeeff' },
  dawn: { bands: ['#a9b5f2', '#d6b2e6', '#ffc5c5', '#ffe0b8'], far: '#c8aee0', near: '#a993cf', win: '#ffe9b5', lit: 0.15, cloud: '#fff1f6', cloudLo: '#f7cfe0' },
  golden: { bands: ['#b29ff0', '#e7a3d6', '#ffb6a5', '#ffd79a'], far: '#cf9ec9', near: '#a885bd', win: '#ffe7a8', lit: 0.3, cloud: '#ffe3ee', cloudLo: '#f4b8cf' },
  dusk: { bands: ['#4c4a9c', '#7262b4', '#b278b6', '#e698b2'], far: '#6a5aa6', near: '#4a4288', win: '#ffe27a', lit: 0.55 },
  night: { bands: ['#1f2152', '#252a60', '#2d336e', '#363c7a'], far: '#30356f', near: '#22265a', win: '#ffe27a', lit: 0.45 },
};

function phaseOf(now) {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < 5.5 || h >= 20.75) return 'night';
  if (h < 7) return 'dawn';
  if (h < 17.5) return 'day';
  if (h < 19.5) return 'golden';
  return 'dusk';
}

function makeCity(iw, ih) {
  const r = rng(iw * 131 + ih * 7);
  const far = [];
  const near = [];
  for (let x = -2; x < iw; ) {
    const w = 4 + Math.floor(r() * 6);
    far.push({ x, w, h: Math.round(ih * (0.26 + r() * 0.22)), seed: Math.floor(r() * 1e6) });
    x += w + (r() < 0.3 ? 1 : 0);
  }
  for (let x = -1; x < iw; ) {
    const w = 5 + Math.floor(r() * 6);
    near.push({ x, w, h: Math.round(ih * (0.12 + r() * 0.2)), seed: Math.floor(r() * 1e6), roof: r() });
    x += w + 1 + Math.floor(r() * 3);
  }
  const stars = [];
  const n = Math.max(6, Math.round((iw * ih) / 70));
  for (let i = 0; i < n; i++) stars.push({ x: Math.floor(r() * iw), y: Math.floor(r() * ih * 0.6), big: r() < 0.15, warm: r() < 0.5 });
  return { far, near, stars };
}

function cloud(x, y, c, lo) {
  ell(x, y + 2, 7, 4, c);
  ell(x + 3, y, 8, 6, c);
  ell(x + 8, y + 1, 7, 5, c);
  R(x + 1, y + 5, 13, 1, lo);
}

// ----------------------------------------------------- the view outside

const VIEWS = new Set(['city', 'beach', 'mountains', 'rain', 'stars', 'space', 'garden']);
const STARRY = ['#14163e', '#191c4c', '#20245a', '#282d68'];
const SPACE = ['#170f3a', '#1d1348', '#241755', '#2c1b61'];
const RAIN = {
  day: ['#9ca8c6', '#aab4ce', '#b8c1d7', '#c6cddf'],
  dawn: ['#a7a6c6', '#b6b0cb', '#c6bbcf', '#d3c6d4'],
  golden: ['#a99bbd', '#b8a6c3', '#c7b1c6', '#d3bdca'],
  dusk: ['#494a78', '#545585', '#5f6192', '#6a6c9d'],
  night: ['#22254a', '#282c54', '#2f335e', '#373b68'],
};
// the scenery takes on the light of the hour
const PHASE_TINT = { dawn: ['#ffb3c1', 0.16], golden: ['#ff9d7e', 0.22], dusk: ['#3d3a8e', 0.48], night: ['#181a48', 0.64] };
const toned = new Map();
function tone(c, ph) {
  const t = PHASE_TINT[ph];
  if (!t) return c;
  const key = c + ph;
  let v = toned.get(key);
  if (!v) {
    const A = rgbaOf(c);
    const B = rgbaOf(t[0]);
    const m = (i) => Math.round(A[i] + (B[i] - A[i]) * t[1]).toString(16).padStart(2, '0');
    v = `#${m(0)}${m(1)}${m(2)}`;
    toned.set(key, v);
  }
  return v;
}

// scenery shapes per window size, made once
const geos = new Map();
function geoFor(iw, ih) {
  const key = `${iw}x${ih}`;
  let geo = geos.get(key);
  if (!geo) {
    geo = { city: makeCity(iw, ih) };
    const r = rng(iw * 977 + ih * 31);
    const pts = (n, y0, y1) => Array.from({ length: n }, () => ({ x: Math.floor(r() * iw), y: Math.floor(y0 + r() * (y1 - y0)), k: r() }));
    // mountain ridges: a few peaks, each a straight-sided cone
    const ridge = (n, lo, hi, slope) => {
      const peaks = Array.from({ length: n }, (_, i) => ({ x: Math.round(((i + 0.2 + r() * 0.6) * iw) / n), h: Math.round(ih * (lo + r() * (hi - lo))) }));
      return { peaks, hs: Array.from({ length: iw }, (_, x) => Math.max(...peaks.map((p) => p.h - Math.abs(x - p.x) * slope))) };
    };
    geo.far = ridge(Math.max(2, Math.round(iw / 26)), 0.46, 0.64, 0.95);
    geo.mid = ridge(Math.max(3, Math.round(iw / 18)), 0.28, 0.4, 1.15);
    geo.hillPhase = r() * 6;
    geo.pines = pts(Math.max(3, Math.round(iw / 14)), 0, 1).map((q) => q.x).sort((a, b) => a - b);
    geo.glints = pts(Math.round(iw / 5), 0, 1);
    geo.sea = pts(Math.round(iw / 4), 0, 1);
    geo.flowers = pts(Math.round(iw / 5), 0, 1);
    geo.stars = pts(Math.max(14, Math.round((iw * ih) / 32)), 0, ih * 0.85);
    geo.rain = pts(Math.max(12, Math.round((iw * ih) / 60)), 0, ih);
    geo.drops = pts(Math.max(4, Math.round(iw / 12)), 2, ih - 3);
    geo.flakes = pts(Math.max(12, Math.round((iw * ih) / 55)), 0, ih);
    geo.leaves = pts(Math.max(4, Math.round(iw / 14)), 0, ih);
    geo.drift = Array.from({ length: iw }, (_, x) => 2 + Math.round(1.2 + Math.sin(x * 0.35 + 1) + Math.sin(x * 0.13)));
    geos.set(key, geo);
    if (geos.size > 12) geos.delete(geos.keys().next().value);
  }
  return geo;
}

function skyBands(bands, iw, ih) {
  const n = bands.length;
  for (let i = 0; i < n; i++) {
    const y0 = Math.round((i * ih) / n);
    const y1 = Math.round(((i + 1) * ih) / n);
    R(0, y0, iw, y1 - y0, bands[i]);
    if (i) {
      g.fillStyle = bands[i - 1];
      for (let x = y0 & 1; x < iw; x += 2) g.fillRect(x, y0, 1, 1);
    }
  }
}

function starField(geo, ih, limit, bright) {
  for (const s of geo.stars) {
    if (s.y > ih * limit) continue;
    if (s.k < (bright ? 0.12 : 0.15)) {
      P(s.x - 1, s.y, '#7f88d6');
      P(s.x + 1, s.y, '#7f88d6');
      P(s.x, s.y - 1, '#7f88d6');
      P(s.x, s.y + 1, '#7f88d6');
    } else if (!bright && s.k > 0.75) continue;
    P(s.x, s.y, s.k < 0.5 ? '#fff6d8' : '#d6dcff');
  }
}

function moon(x, y, bg) {
  ell(x - 1, y - 1, 9, 9, '#2f3672');
  ell(x, y, 7, 7, '#fff3c4');
  ell(x + 2, y - 1, 7, 7, bg);
}

// the sun, moon, stars and clouds over an ordinary landscape
function skyBody(iw, ih, now, ph, geo, season, bands) {
  const S = SKY[ph];
  const hr = now.getHours() + now.getMinutes() / 60;
  if (ph === 'night' || ph === 'dusk') {
    starField(geo, ih, ph === 'dusk' ? 0.3 : 0.6, false);
    if (ph === 'night') moon(Math.round(iw * 0.7), 3, bands[0]);
    return;
  }
  if (ph === 'day') {
    const t = clamp((hr - 7) / 10.5, 0, 1);
    const sx = 2 + Math.round(t * (iw - 11));
    const sy = 2 + Math.round(5 * Math.abs(t - 0.5) * 2);
    if (season === 'summer') {
      // a big bright summer sun
      for (const [dx, dy] of [[3, -3], [3, 10], [-3, 3], [10, 3], [-1, -1], [8, -1], [-1, 8], [8, 8]]) P(sx + dx, sy + dy, '#ffe9a0');
      ell(sx - 2, sy - 2, 11, 11, '#fff6c8');
      ell(sx - 1, sy - 1, 9, 9, '#ffe27a');
      ell(sx + 1, sy + 1, 4, 4, '#fffbe6');
    } else {
      ell(sx - 1, sy - 1, 9, 9, '#fff6c8');
      ell(sx, sy, 7, 7, '#ffe27a');
      ell(sx + 1, sy + 1, 3, 3, '#fffbe6');
    }
  } else {
    const sx = Math.round(iw * (ph === 'dawn' ? 0.2 : 0.3));
    const sy = Math.round(ih * 0.48);
    ell(sx - 2, sy - 2, 13, 13, ph === 'dawn' ? '#ffe9c4' : '#ffd0a0');
    ell(sx, sy, 9, 9, ph === 'dawn' ? '#fff0a8' : '#ffc27a');
  }
  const mins = now.getHours() * 60 + now.getMinutes();
  const span = iw + 24;
  for (const [off, yy] of [[0, 0.1], [0.55, 0.27]]) {
    const cx0 = -14 + ((Math.floor(mins / 4) + Math.round(off * span)) % span);
    cloud(cx0, Math.round(ih * yy), S.cloud, S.cloudLo);
  }
}

function cityScape(iw, ih, now, ph, geo, ax, ay, muted) {
  const S = SKY[ph];
  const c = geo.city;
  const far = muted ? tone('#8f97b8', ph) : S.far;
  for (const b of c.far) {
    R(b.x, ih - b.h, b.w, b.h, far);
    if (S.lit) {
      const r = rng(b.seed + now.getHours() * 7919);
      for (let wy = ih - b.h + 3; wy < ih - 2; wy += 4) {
        for (let wx = b.x + 1; wx < b.x + b.w - 1; wx += 3) if (r() < S.lit * 0.35) P(wx, wy, muted ? '#a8945e' : '#b9a35a');
      }
    }
  }
  if (muted) return;
  for (const b of c.near) {
    const bx = b.x;
    const by = ih - b.h;
    R(bx, by, b.w, b.h, S.near);
    if (b.roof < 0.25) R(bx + (b.w >> 1), by - 2, 1, 2, S.near);
    else if (b.roof > 0.8) R(bx + 1, by - 1, b.w - 2, 1, S.near);
    const r = rng(b.seed + now.getHours() * 7919);
    for (let wy = by + 2; wy < ih - 1; wy += 3) {
      for (let wx = bx + 1; wx < bx + b.w - 1; wx += 2) {
        if (S.lit) {
          if (r() < S.lit) P(wx, wy, S.win);
        } else if ((wx + ax + wy + ay) % 4 === 0) P(wx, wy, S.win);
      }
    }
  }
}

function beachScape(iw, ih, ph, geo) {
  const dark = ph === 'night' || ph === 'dusk';
  const hy = Math.round(ih * 0.56);
  const sandY = Math.round(ih * 0.8);
  const sea = ['#5db3df', '#74c3e7', '#8fd2ee'];
  const sh = sandY - hy;
  for (let i = 0; i < 3; i++) R(0, hy + Math.round((i * sh) / 3), iw, Math.round(((i + 1) * sh) / 3) - Math.round((i * sh) / 3), tone(sea[i], ph));
  R(0, hy, iw, 1, tone('#c3e8f8', ph));
  const glint = dark ? '#8f9ad8' : tone('#ffffff', ph);
  for (const q of geo.sea) {
    const y = hy + 2 + Math.floor(q.k * (sh - 3));
    R(q.x, y, 2 + (q.x & 1), 1, glint);
  }
  // the sun (or moon) on the water
  const lx = dark ? Math.round(iw * 0.7) + 3 : ph === 'day' ? -1 : Math.round(iw * (ph === 'dawn' ? 0.2 : 0.3)) + 4;
  if (lx >= 0 && ph !== 'dusk') {
    const c = dark ? '#d9d2a6' : '#ffd88f';
    for (let y = hy + 1, i = 0; y < sandY; y += 2, i++) R(lx - 2 + (i & 1), y, 3 + (i & 1), 1, c);
  }
  // a sailboat on the horizon
  const bx = Math.round(iw * 0.2);
  R(bx, hy - 1, 6, 1, tone('#ffffff', ph));
  R(bx + 1, hy, 4, 1, tone('#e48ab0', ph));
  for (let i = 0; i < 4; i++) R(bx + 3, hy - 5 + i, 1 + (i >> 1), 1, tone('#ffffff', ph));
  // sand, with the foam line
  R(0, sandY, iw, ih - sandY, tone('#ffe4ad', ph));
  for (let x = 0; x < iw; x++) if ((x >> 1) % 3 !== 0) P(x, sandY, tone('#ffffff', ph));
  R(0, sandY + 1, iw, 1, tone('#f2cf8e', ph));
  for (const q of geo.flowers) P(q.x, sandY + 3 + Math.floor(q.k * Math.max(1, ih - sandY - 4)), tone('#f0c886', ph));
  // a striped umbrella
  const ux = Math.round(iw * 0.74);
  const top = sandY - 6;
  R(ux, top + 2, 1, ih - top - 3, tone('#c98a59', ph));
  const rows = [3, 5, 7];
  rows.forEach((wd, i) => {
    for (let k = 0; k < wd * 2 + 1; k++) P(ux - wd + k, top - 2 + i, tone(((k + i) >> 1) & 1 ? '#ffffff' : '#ff8fbf', ph));
  });
}

function mountainScape(iw, ih, ph, geo) {
  const far = tone('#c9c3f0', ph);
  const snow = tone('#ffffff', ph);
  for (let x = 0; x < iw; x++) {
    const h = Math.round(geo.far.hs[x]);
    if (h > 0) R(x, ih - h, 1, h, far);
  }
  for (const pk of geo.far.peaks) {
    for (let dy = 0; dy < 4; dy++) {
      const half = Math.floor(dy * 0.95);
      R(pk.x - half, ih - pk.h + dy, half * 2 + 1, 1, snow);
    }
    P(pk.x - 2, ih - pk.h + 4, snow);
    P(pk.x + 1, ih - pk.h + 4, snow);
  }
  const mid = tone('#9eafe6', ph);
  const midHi = tone('#b3c1ee', ph);
  for (let x = 0; x < iw; x++) {
    const h = Math.round(geo.mid.hs[x]);
    if (h > 0) R(x, ih - h, 1, h, mid);
  }
  for (const pk of geo.mid.peaks) for (let dy = 1; dy < 6; dy++) P(pk.x - Math.floor(dy * 1.15), ih - pk.h + dy, midHi);
  const hill = tone('#a3dcb4', ph);
  const hillHi = tone('#c2ecc9', ph);
  const hb = Math.round(ih * 0.14);
  const hh = (x) => hb + Math.round(2 * Math.sin(x * 0.12 + geo.hillPhase) + Math.sin(x * 0.31));
  for (let x = 0; x < iw; x++) {
    const h = hh(x);
    R(x, ih - h, 1, h, hill);
    P(x, ih - h, hillHi);
  }
  const pine = tone('#6dbf8d', ph);
  const pineLo = tone('#57a979', ph);
  for (const px of geo.pines) {
    const by = ih - hh(px) + 2;
    for (let i = 0; i < 7; i++) {
      const half = (i >> 1) + (i > 4 ? 0 : 0);
      R(px - half, by - 8 + i, half * 2 + 1, 1, i & 1 ? pineLo : pine);
    }
    R(px, by - 1, 1, 2, tone('#a5765a', ph));
  }
}

function gardenScape(iw, ih, ph, geo) {
  const gy = Math.round(ih * 0.8);
  // a round tree on the left
  const tx = Math.round(iw * 0.2);
  const cw = clamp(Math.round(iw * 0.36), 14, 30);
  const ch = clamp(Math.round(ih * 0.4), 12, 26);
  const ty = gy - 6 - ch;
  R(tx - 1, ty + ch - 4, 3, gy - (ty + ch - 4), tone('#b98261', ph));
  ell(tx - (cw >> 1), ty, cw, ch, tone('#8fd4a0', ph));
  ell(tx - (cw >> 1) + 2, ty + 1, cw - 7, ch - 6, tone('#a9e3b5', ph));
  ell(tx - (cw >> 1) + 4, ty + 2, Math.max(3, cw >> 2), Math.max(2, ch >> 2), tone('#c9f2d0', ph));
  for (let i = 0; i < 4; i++) P(tx - 4 + i * 3, ty + ch - 3 - (i & 1), tone('#6fbf8a', ph));
  // hedge
  const hedge = tone('#7fcf98', ph);
  const hedgeHi = tone('#9ddcae', ph);
  for (let x = 0; x < iw; x++) {
    const h = 6 + Math.round(1.5 + 1.5 * Math.sin(x * 0.55));
    R(x, gy - h, 1, h, hedge);
    if ((x & 3) === 1) P(x, gy - h + 1, hedgeHi);
  }
  // a white picket fence
  const post = tone('#ffffff', ph);
  const postLo = tone('#d9d4f0', ph);
  R(0, gy - 6, iw, 1, post);
  R(0, gy - 3, iw, 1, post);
  for (let x = 1; x < iw; x += 5) {
    R(x, gy - 8, 3, 9, post);
    P(x + 1, gy - 9, post);
    R(x + 2, gy - 7, 1, 8, postLo);
  }
  // grass and flowers
  R(0, gy, iw, ih - gy, tone('#a9e3a8', ph));
  R(0, gy, iw, 1, tone('#c7f0c4', ph));
  const fc = ['#ff9ec7', '#ffe27a', '#c9b6ff', '#ffffff'];
  for (const q of geo.flowers) {
    const fy = gy + 2 + Math.floor(q.k * Math.max(1, ih - gy - 3));
    P(q.x, fy + 1, tone('#6fbf8a', ph));
    P(q.x, fy, tone(fc[Math.floor(q.k * 40) % 4], ph));
  }
}

function rainScape(iw, ih, now, ph, geo, ax, ay) {
  const dark = ph === 'night' || ph === 'dusk';
  // a low cloud bank
  const cb = RAIN[ph][0];
  for (let i = 0; i < iw; i += 9) ell(i - 4, -4 + ((i / 9) & 1) * 2, 14, 9, cb);
  cityScape(iw, ih, now, ph, geo, ax, ay, true);
  const streak = dark ? '#5f679c' : '#dfe5f3';
  const b = Math.floor((now.getHours() * 60 + now.getMinutes()) / 4);
  for (const q of geo.rain) {
    const y = (q.y + b * 5) % ih;
    P(q.x, y, streak);
    P(q.x, y + 1, streak);
    P(q.x - 1, y + 2, streak);
  }
  // drops on the glass
  for (const q of geo.drops) {
    P(q.x, q.y, dark ? '#9aa3d4' : '#f4f7ff');
    P(q.x, q.y + 1, dark ? '#5a6296' : '#9ba7c8');
  }
}

function starScape(iw, ih, geo) {
  // a soft band of nebula
  for (let x = 0; x < iw; x++) {
    const y = Math.round(ih * 0.62 - x * 0.45);
    for (let k = -3; k <= 3; k++) if (((x + k) & 1) === 0 && y + k > 0) P(x, y + k, Math.abs(k) < 2 ? '#34307a' : '#2a2a6c');
  }
  starField(geo, ih, 0.85, true);
  moon(Math.round(iw * 0.74), Math.round(ih * 0.1), STARRY[0]);
  // a shooting star
  const sx = Math.round(iw * 0.22);
  const sy = Math.round(ih * 0.14);
  ['#ffffff', '#ffffff', '#d6d6ff', '#a9a9e6', '#7e80c8', '#5b5ea8'].forEach((c, i) => P(sx - i, sy + (i >> 1), c));
  // hills with a little lit cabin
  const hb = Math.round(ih * 0.12);
  for (let x = 0; x < iw; x++) {
    const h = hb + Math.round(2 * Math.sin(x * 0.09 + 1) + Math.sin(x * 0.27));
    R(x, ih - h, 1, h, '#101233');
  }
  const cx = Math.round(iw * 0.62);
  const cy = ih - hb - 3;
  R(cx, cy, 6, 4, '#101233');
  for (let i = 0; i < 4; i++) R(cx - 1 + i, cy - 1 - i, 8 - 2 * i, 1, '#101233');
  P(cx + 2, cy + 1, '#ffe27a');
  P(cx + 3, cy + 1, '#ffd36b');
}

function spaceScape(iw, ih, geo) {
  starField(geo, ih, 1, true);
  for (const q of geo.sea) P(q.x, Math.floor(q.k * ih), q.k < 0.5 ? '#ff9ec7' : '#8fd0ff');
  // a ringed planet
  const r = clamp(Math.round(Math.min(iw, ih) * 0.16), 5, 10);
  const cx = Math.round(iw * 0.34);
  const cy = Math.round(ih * 0.5);
  const ring = (front) => {
    for (let x = -r * 2; x <= r * 2; x++) {
      const t = x / (r * 2);
      const dy = Math.round(Math.sqrt(Math.max(0, 1 - t * t)) * r * 0.42);
      const y = front ? cy + dy : cy - dy;
      if (!front && Math.abs(x) < r) continue;
      P(cx + x, y, '#c9b6ff');
      P(cx + x, y + 1, '#9a85dc');
    }
  };
  ring(false);
  ell(cx - r, cy - r, r * 2 + 1, r * 2 + 1, '#ffc6a1');
  for (let y = -r + 2; y < r; y += 3) R(cx - r + 1 + (y & 1), cy + y, r * 2 - 1, 1, '#f4a985');
  ell(cx - r + 2, cy - r + 2, Math.max(2, r - 1), Math.max(2, r - 2), '#ffe2cc');
  ring(true);
  // a small blue moon and a far pink one
  const mx = Math.round(iw * 0.78);
  const my = Math.round(ih * 0.26);
  ell(mx - 3, my - 3, 7, 7, '#a9dcff');
  ell(mx - 1, my - 1, 4, 4, '#d8f0ff');
  P(mx + 2, my + 2, '#78b0e2');
  ell(Math.round(iw * 0.66), Math.round(ih * 0.76), 3, 3, '#ffb5d2');
}

// what the season is doing outside
function seasonOutside(iw, ih, now, ph, geo, season, view) {
  if (view === 'space') return;
  const dark = ph === 'night' || ph === 'dusk';
  const b = Math.floor((now.getHours() * 60 + now.getMinutes()) / 4);
  if (season === 'winter') {
    if (view !== 'rain') {
      for (const q of geo.flakes) {
        const x = (q.x + (b % 7)) % iw;
        const y = (q.y + b * 3) % ih;
        const c = dark ? '#dfe4ff' : '#ffffff';
        if (q.k < 0.15) {
          P(x - 1, y, c);
          P(x + 1, y, c);
          P(x, y - 1, c);
          P(x, y + 1, c);
        } else P(x, y, c);
      }
    }
    const snow = dark ? '#cfd5f2' : '#ffffff';
    const shade = dark ? '#a9b0d8' : '#dfe9f7';
    for (let x = 0; x < iw; x++) {
      const h = geo.drift[x];
      R(x, ih - h, 1, h, snow);
      P(x, ih - 1, shade);
    }
  } else if (season === 'autumn') {
    const cols = ['#ff9d5c', '#ffc35c', '#f07f6a', '#e7a04b'];
    geo.leaves.forEach((q, i) => {
      const x = (q.x + b * 2) % iw;
      const y = (q.y + b * 3) % (ih - 3);
      const c = tone(cols[i % 4], ph);
      R(x, y, 2, 2, c);
      P(x + ((b + i) & 1), y + 1, tone('#c76b3f', ph));
    });
    for (let i = 0; i < 4; i++) {
      const x = Math.round(((i + 0.5) * iw) / 4 + (i & 1 ? 3 : -2));
      R(x, ih - 1, 3, 1, tone(cols[i], ph));
      P(x + 1, ih - 2, tone(cols[(i + 1) % 4], ph));
    }
  } else if (season === 'spring') {
    // a blossom branch reaching in from the corner, petals on the air
    const twig = tone('#a8735a', ph);
    const ex = Math.round(iw * 0.32);
    const ey = Math.round(ih * 0.16);
    line(0, 1, ex, ey, twig);
    line(Math.round(ex * 0.5), Math.round(ey * 0.5) + 1, Math.round(ex * 0.62), ey + 4, twig);
    const pk = tone('#ffc1dc', ph);
    const pkLo = tone('#f59bc2', ph);
    for (const [fx, fy] of [[ex, ey], [Math.round(ex * 0.62), ey + 5], [Math.round(ex * 0.35), Math.round(ey * 0.35) + 1], [Math.round(ex * 0.8), Math.round(ey * 0.8) - 2]]) {
      R(fx - 1, fy, 3, 1, pk);
      R(fx, fy - 1, 1, 3, pk);
      P(fx + 1, fy + 1, pkLo);
      P(fx, fy, tone('#ffffff', ph));
    }
    geo.leaves.forEach((q, i) => {
      if (i & 1) return;
      P((q.x + b * 2) % iw, (q.y + b * 2) % ih, pk);
    });
  }
}

// paint the whole view into its own little canvas (cached per 4 minutes)
const skies = new Map();
function viewCanvas(L, now, ph, view, season) {
  const inner = L.parts.window.inner;
  const bucket = Math.floor((now.getHours() * 60 + now.getMinutes()) / 4);
  const key = `${L.W}x${L.H}|${view}|${ph}|${season}|${bucket}`;
  let c = skies.get(key);
  if (c) return c;
  const { w: iw, h: ih } = inner;
  c = canvas(iw, ih);
  const prev = g;
  g = c.getContext('2d');
  const geo = geoFor(iw, ih);
  const bands = view === 'stars' ? STARRY : view === 'space' ? SPACE : view === 'rain' ? RAIN[ph] : SKY[ph].bands;
  skyBands(bands, iw, ih);
  if (view === 'stars') starScape(iw, ih, geo);
  else if (view === 'space') spaceScape(iw, ih, geo);
  else if (view === 'rain') rainScape(iw, ih, now, ph, geo, inner.x, inner.y);
  else {
    skyBody(iw, ih, now, ph, geo, season, bands);
    if (view === 'beach') beachScape(iw, ih, ph, geo);
    else if (view === 'mountains') mountainScape(iw, ih, ph, geo);
    else if (view === 'garden') gardenScape(iw, ih, ph, geo);
    else cityScape(iw, ih, now, ph, geo, inner.x, inner.y, false);
  }
  seasonOutside(iw, ih, now, ph, geo, season, view);
  g = prev;
  skies.set(key, c);
  if (skies.size > 16) skies.delete(skies.keys().next().value);
  return c;
}

function paintSky(L, now, ph, view, season) {
  const { x, y } = L.parts.window.inner;
  g.drawImage(viewCanvas(L, now, ph, view, season), x, y);
}

function paintClockHands(L, now) {
  const { cx, cy } = L.parts.clock;
  const m = now.getMinutes();
  const h = (now.getHours() % 12) + m / 60;
  const ma = (m / 60) * Math.PI * 2;
  const ha = (h / 12) * Math.PI * 2;
  line(cx, cy, cx + Math.round(Math.sin(ha) * 2.6), cy - Math.round(Math.cos(ha) * 2.6), INK);
  line(cx, cy, cx + Math.round(Math.sin(ma) * 4.2), cy - Math.round(Math.cos(ma) * 4.2), '#e05c97');
  P(cx, cy, INK);
}

function paintCalendarDate(L, now, dayOffset) {
  const { x, y, w } = L.parts.calendar;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Math.round(dayOffset || 0));
  const mon = MONTHS[d.getMonth()];
  text(mon, x + ((w - textW(mon)) >> 1), y + 2, '#ffffff');
  const day = String(d.getDate());
  text(day, x + ((w - textW(day, 2)) >> 1), y + 10, INK, 2);
  // time machine: a little hourglass sticker on the corner
  if (dayOffset > 0) spr(HOURGLASS, x + w - 4, y - 5, { k: INK, y: MAT.butter.f, g: '#e9f7ff' });
}

function paintBoardBars(L, bars) {
  const c = L.parts.board.chart;
  const cw = c.w + 3;
  const ox = c.x;
  const oy = c.base; // baseline
  const top = c.top;
  const ch = oy - top;
  R(ox, top, 1, ch + 1, SOFT);
  R(ox, oy, cw - 3, 1, SOFT);
  const vals = (Array.isArray(bars) ? bars : []).slice(0, 7);
  const n = vals.length;
  if (!n) {
    for (let xx = ox + 3; xx < ox + cw - 5; xx += 3) P(xx, oy - 3, C.boardLine);
    return;
  }
  const avail = cw - 6;
  const gap = avail / n >= 6 ? 2 : 1;
  const bw = clamp(Math.floor((avail - (n - 1) * gap) / n), 2, 7);
  const cols = [MAT.pink, MAT.sky, MAT.mint, MAT.butter, MAT.lilac, MAT.peach, MAT.rose];
  let bx = ox + 2;
  vals.forEach((v, i) => {
    const val = clamp(Number(v) || 0, 0, 1);
    const bh = val > 0 ? Math.max(2, Math.round(val * (ch - 1))) : 0;
    const M = cols[i % cols.length];
    if (bh) {
      R(bx, oy - bh, bw, bh, M.lo);
      R(bx, oy - bh, bw - 1, bh, M.f);
      R(bx, oy - bh, bw, 1, INK);
    }
    bx += bw + gap;
  });
}

function paintBinPaper(L, count) {
  if (!(count > 0)) return;
  const { x, w, top } = L.parts.bin;
  const balls = [
    [x + 1, top - 3, 5, 5],
    [x + w - 6, top - 4, 6, 5],
    [x + (w >> 1) - 2, top - 5, 5, 4],
  ].slice(0, count >= 3 ? 3 : count >= 2 ? 2 : 1);
  for (const [bx, by, bw, bh] of balls) {
    ell(bx - 1, by - 1, bw + 2, bh + 2, INK);
    ell(bx, by, bw, bh, '#ffffff');
    P(bx + 1, by + 2, '#d6d0f0');
    P(bx + 2, by + 1, '#d6d0f0');
    P(bx + bw - 2, by + bh - 2, '#d6d0f0');
  }
  binRim(L);
}

function paintFrost(L, count) {
  if (!(count > 0)) return;
  const { x, w, top } = L.parts.fridge;
  // frost along the freezer's top and an ice-cube magnet
  for (let i = x + 3; i < x + w - 3; i += 2) P(i, top + 2, '#ffffff');
  P(x + 5, top + 3, '#ffffff');
  P(x + w - 6, top + 3, '#ffffff');
  const ix = x + w - 9;
  const iy = top + 5;
  R(ix, iy, 6, 6, INK);
  R(ix + 1, iy + 1, 4, 4, '#e3f6ff');
  R(ix + 1, iy + 1, 2, 1, '#ffffff');
  P(ix + 1, iy + 2, '#ffffff');
  R(ix + 4, iy + 2, 1, 3, '#a9d4f2');
  R(ix + 2, iy + 4, 3, 1, '#a9d4f2');
  // sparkle
  P(ix - 3, iy + 1, '#ffffff');
  P(ix - 4, iy + 2, '#d8f0ff');
  P(ix - 2, iy + 2, '#d8f0ff');
  P(ix - 3, iy + 3, '#d8f0ff');
}

function paintNestLamp(L, on) {
  const n = L.parts.nest;
  const by = n.ty - 16;
  R(n.cx - 3, by, 6, 2, INK);
  R(n.cx - 2, by, 4, 1, on ? '#fff6c9' : '#d9d4f2');
  if (!on) return;
  P(n.cx - 1, by, '#ffffff');
}

// a stepped cone of light from (cx, y0) down to y1
function cone(cx, y0, y1, w0, spread, c) {
  g.fillStyle = c;
  for (let y = y0; y <= y1; y++) {
    const hw = Math.round(w0 + (y - y0) * spread);
    g.fillRect(cx - hw, y, hw * 2 + 1, 1);
  }
}

// window-shaped sunlight on the floor in front of the window
function sunPatch(L, now, ph) {
  const wn = L.parts.window;
  const { base, rug } = L.parts;
  const hr = now.getHours() + now.getMinutes() / 60;
  const skew = clamp((12.5 - hr) * 0.1, -0.7, 0.7);
  const y0 = base + 2;
  const rows = Math.min(rug.h + 10, L.H - y0 - 4);
  const split = Math.round(rows * 0.42);
  const ix = wn.inner.x;
  const iw = wn.inner.w;
  const mid = wn.mx - ix;
  g.fillStyle = ph === 'day' ? 'rgba(255, 250, 225, 0.075)' : ph === 'golden' ? 'rgba(255, 180, 130, 0.09)' : 'rgba(255, 205, 200, 0.06)';
  for (let i = 0; i < rows; i++) {
    if (i === split) continue;
    const grow = i >> 3;
    const x0 = ix + Math.round(i * skew) - grow;
    g.fillRect(x0, y0 + i, mid + grow, 1);
    g.fillRect(x0 + mid + 2 + grow, y0 + i, iw - mid - 2 + grow, 1);
  }
}

function paintLighting(ctx, L, ph, st, isFront) {
  g = ctx;
  const { W, H, parts } = L;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const tint = {
    night: 'rgba(44, 32, 108, 0.22)',
    dusk: 'rgba(84, 52, 136, 0.14)',
    golden: 'rgba(255, 150, 100, 0.07)',
    dawn: 'rgba(255, 170, 160, 0.06)',
  }[ph];
  if (tint) {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, W, H);
  }
  // light adds up on the opaque back canvas; on the front it can only tint
  // the pixels that are there, so it gets a slightly stronger mix
  ctx.globalCompositeOperation = isFront ? 'source-atop' : 'lighter';
  const k = isFront ? 1.6 : 1;
  const warm = (a) => `rgba(255, 196, 130, ${(a * k).toFixed(3)})`;
  const cool = (a) => `rgba(150, 200, 255, ${(a * k).toFixed(3)})`;
  const dark = ph === 'night' || ph === 'dusk';
  if (!dark && !isFront) sunPatch(L, st.skyNow, ph);
  const y0 = parts.sy - 17;
  if (dark) {
    if (!isFront) for (const b of parts.lights.bulbs) glow(b.x + 1, b.y + 2, 5, warm(0.045));
    const l = parts.lamp;
    if (l) {
      glow(l.x + 5, l.top + 4, 14, warm(0.05));
      cone(l.x + 5, l.top + 9, parts.base + 1, 4, 0.36, warm(0.035));
      cone(l.x + 5, l.top + 9, parts.base + 1, 2, 0.2, warm(0.03));
    }
    if (st.music && !isFront) {
      const p = parts.earned.rec;
      glow(p.x + 6, p.y + 2, 6, warm(0.05));
    }
    parts.desks.forEach((d, i) => {
      if (!st.deskBusy[i]) return;
      glow(d.mon.x + (d.mon.w >> 1), y0 - 9, 12, cool(0.05));
      if (d.acc === 'lamp') {
        const lx = d.x + d.w - 8;
        glow(lx, y0 - 12, 7, warm(0.05));
        cone(lx, y0 - 11, y0 + 2, 2, 0.6, warm(0.04));
      }
    });
  }
  if (st.eggCount > 0) {
    const n = parts.nest;
    glow(n.cx, n.ty - 15, dark ? 9 : 6, warm(0.05));
    cone(n.cx, n.ty - 14, n.ty + 8, 4, 0.8, warm(dark ? 0.05 : 0.035));
  }
  ctx.restore();
}

// ------------------------------------------------------------ the painter

const cache = new Map();

function canvas(W, H) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(W, H);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

// paint rows [oy, oy + H) into a pixel buffer, then hand it to a canvas in
// one go (the scratch buffer is reused between bakes)
let scratch = null;
function bake(W, H, oy, fn) {
  const n = W * H;
  if (!scratch || scratch.length < n) scratch = new Uint32Array(n);
  const px = scratch.subarray(0, n);
  px.fill(0);
  buf = { w: W, h: H, oy, px };
  try {
    fn();
  } finally {
    buf = null;
  }
  const c = canvas(W, H);
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer, 0, n * 4), W, H), 0, 0);
  return c;
}

function buildStatic(L, opts) {
  const { W, H, parts } = L;
  WP = WALLS[opts.wall];
  FP = FLOORS[opts.floor];
  try {
    const back = bake(W, H, 0, () => paintStaticBack(L, opts));
    // the front layer only lives in a thin band around the seats
    const frontY = parts.sy - 30;
    const frontB = Math.max(parts.base + 2, parts.chair.y + 4);
    const front = bake(W, frontB - frontY, frontY, () => {
      paintSofa(L, true);
      paintChair(L, true);
      for (const d of parts.desks) paintDesk(L, d, true);
    });
    return { back, front, frontY };
  } finally {
    WP = WALLS.lilac;
    FP = FLOORS.wood;
  }
}

function paintStaticBack(L, opts) {
  const { parts } = L;
  paintWall(L);
  paintWindow(L, opts);
  paintBoard(L);
  paintCalendarPaper(L);
  paintClockFace(L);
  paintSign(L);
  paintShelfWall(L);
  paintPosters(L);
  paintEarned(L, opts.earned);
  paintDoor(L);
  paintFloor(L);
  paintDoorMatOnly(L);
  paintSeasonStatic(L, opts.season);
  paintRug(L);
  paintLights(L);
  paintCoat(L);
  paintPlants(L);
  paintFridge(L);
  paintBin(L);
  paintChair(L, false);
  paintCabinet(L);
  paintBookshelf(L);
  paintAquarium(L);
  paintFloorLamp(L);
  paintSideTable(L);
  paintNest(L);
  paintSofa(L, false);
  for (const d of parts.desks) paintDesk(L, d, false);
}
// the floor is painted after the wall, so the door's mat is redrawn on it
function paintDoorMatOnly(L) {
  const { x, w } = L.parts.door;
  const fy = L.floorY;
  R(x + 2, fy + 1, w - 4, 4, MAT.lilac.lo);
  R(x + 3, fy + 2, w - 6, 2, MAT.lilac.f);
  for (let i = x + 4; i < x + w - 4; i += 3) P(i, fy + 2, MAT.lilac.hi);
}

function staticFor(L, opts) {
  const e = opts.earned;
  const key = `${L.W}x${L.H}|${opts.wall}|${opts.floor}|${opts.season}|${e ? `${e.trophies},${e.plant},${e.books}` : '-'}`;
  let s = cache.get(key);
  if (!s) {
    s = buildStatic(L, opts);
    cache.set(key, s);
    if (cache.size > 10) cache.delete(cache.keys().next().value);
  }
  return s;
}

const LIGHTS = { day: 'day', golden: 'golden', night: 'night' };
const LIGHT_HOUR = { day: 12, golden: 18, night: 23 };

// the phase the room is lit for: the real time of day, or the one the user
// picked (state.style.light)
export function roomPhase(state = {}) {
  const now = state.now instanceof Date ? state.now : new Date();
  return LIGHTS[state.style && state.style.light] || phaseOf(now);
}

// 'spring' | 'summer' | 'autumn' | 'winter' for the room's date
export function roomSeason(state = {}) {
  const now = state.now instanceof Date ? state.now : new Date();
  return seasonOf(now, Number(state.dayOffset) || 0).season;
}

export function paintRoom(back, front, layout, state = {}) {
  const L = layout;
  const style = state.style || {};
  const st = {
    now: state.now instanceof Date ? state.now : new Date(),
    dayOffset: Number(state.dayOffset) || 0,
    deskBusy: [0, 1, 2].map((i) => !!(state.deskBusy && state.deskBusy[i])),
    binCount: Number(state.binCount) || 0,
    fridgeCount: Number(state.fridgeCount) || 0,
    eggCount: Number(state.eggCount) || 0,
    boardBars: Array.isArray(state.boardBars) ? state.boardBars : [],
    music: !!state.music,
  };
  const forced = LIGHTS[style.light];
  const ph = forced || phaseOf(st.now);
  // a forced light keeps the real minutes (so clouds still drift) at an hour
  // that suits it
  st.skyNow = forced && phaseOf(st.now) !== forced ? new Date(st.now.getFullYear(), st.now.getMonth(), st.now.getDate(), LIGHT_HOUR[forced], st.now.getMinutes()) : st.now;
  const sea = seasonOf(st.now, st.dayOffset);
  const e = state.earned && typeof state.earned === 'object' ? state.earned : null;
  const S = staticFor(L, {
    wall: WALLS[style.wall] ? style.wall : 'lilac',
    floor: FLOORS[style.floor] ? style.floor : 'wood',
    season: sea.key,
    earned: e && {
      trophies: clamp(Math.floor(Number(e.trophies) || 0), 0, 6),
      plant: clamp(Math.floor(Number(e.plant) || 0), 0, 5),
      books: clamp(Math.floor(Number(e.books) || 0), 0, 8),
    },
  });
  const view = VIEWS.has(style.view) ? style.view : 'city';
  const { parts } = L;

  // ---- back
  g = back;
  back.imageSmoothingEnabled = false;
  back.clearRect(0, 0, L.W, L.H);
  paintSky(L, st.skyNow, ph, view, sea.season);
  back.drawImage(S.back, 0, 0);
  paintClockHands(L, st.now);
  paintCalendarDate(L, st.now, st.dayOffset);
  paintBoardBars(L, st.boardBars);
  for (const d of parts.desks) {
    const on = st.deskBusy[d.i];
    paintScreen(L, d, on);
    if (on) paintChairBehind(L, d);
  }
  paintBinPaper(L, st.binCount);
  paintFrost(L, st.fridgeCount);
  paintNestLamp(L, st.eggCount > 0);
  paintRecordLive(L, st.music);
  if (ph === 'night' || ph === 'dusk') {
    for (const b of parts.lights.bulbs) paintBulb(b, true);
    paintFloorLampLit(L);
  }
  paintLighting(back, L, ph, st, false);

  // ---- front
  g = front;
  front.imageSmoothingEnabled = false;
  front.clearRect(0, 0, L.W, L.H);
  front.drawImage(S.front, 0, S.frontY);
  for (const d of parts.desks) if (!st.deskBusy[d.i]) paintChairOut(L, d);
  paintLighting(front, L, ph, st, true);
  g = null;
}

// for the preview page's self-checks: the bare wallpaper, nothing on it
export function paintWallOnly(ctx, layout, wall = 'lilac') {
  const L = layout;
  WP = WALLS[wall] || WALLS.lilac;
  try {
    const c = bake(L.W, L.H, 0, () => paintWall(L));
    ctx.clearRect(0, 0, L.W, L.H);
    ctx.drawImage(c, 0, 0);
  } finally {
    WP = WALLS.lilac;
  }
}
