// A small studio cat: 16x12 pixel frames, facing right, feet on the bottom
// edge, outlined in the room's ink. cat(seed) picks a coat and hands back
// canvases at 1x for the app to draw (scaled up) wherever the cat goes.

export const CAT_W = 16;
export const CAT_H = 12;

const INK = '#2b2a5e';

// '.' clear  k ink  b coat  h coat light  s coat shade  w white
// t stripe/patch spot (tabby stripes, calico patches)  n nose  i inner ear
// e eye
const HEAD = [
  '...........k..k.',
  '.k........kikkik',
  'kbk......kbbbbbk',
  'kbk......kbhbebk',
  '.kbk.....kbbbwwn',
  '..kbkkkkkkbbwwk.',
];
const BODY = [
  '...kbhhhbbbbwwk.',
  '...kbtbbtbbtbwk.',
  '...ksbbbbbbbwwk.',
  '....kssssssswk..',
];
const LEGS = {
  stand: ['....kbk....kwk..', '....kkk....kkk..'],
  a: ['...kbk......kwk.', '...kkk......kkk.'],
  b: ['.....kbk..kwk...', '.....kkk..kkk...'],
};

const SIT = [
  '........k..k....',
  '.......kikkik...',
  '.......kbbbbbk..',
  '.......kbhbebk..',
  '.......kbbbwwn..',
  '........kbwwk...',
  '.......kbbwwwk..',
  '......kbtbwwwk..',
  '.....kbbtbbwwk..',
  '....kbtbbbkwwk..',
  '.kkkkbbbbbkwwk..',
  'kbbbkkkkkkkkkk..',
];
const SLEEP = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '..........k..k..',
  '.....kkkkkikkik.',
  '...kkbhhbbbbbbbk',
  '..kbtbbtbbbkkbbk',
  '..kbbbbsssssbbwn',
  '.kbbbkbbbbbbkwwk',
  '..kkkkkkkkkkkkk.',
];

const COATS = [
  { name: 'cream', b: '#fff1d6', h: '#fffaf0', s: '#ecd3aa', w: '#ffffff', t: '#f6dfb8' },
  { name: 'ginger', b: '#ffb877', h: '#ffd3a3', s: '#e8935a', w: '#fff4e4', t: '#e8935a' },
  { name: 'tabby', b: '#cdbcaa', h: '#e2d6c8', s: '#a9977f', w: '#f6efe6', t: '#8f7b68' },
  { name: 'tuxedo', b: '#6b689c', h: '#8885b8', s: '#575489', w: '#ffffff', t: '#6b689c' },
  { name: 'grey', b: '#b9bad8', h: '#d5d6ec', s: '#9798bd', w: '#eef0fa', t: '#a3a5c9' },
  { name: 'calico', b: '#fff6ea', h: '#ffffff', s: '#ecdcc8', w: '#ffffff', t: '#ffad66', u: '#5e5a8a' },
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

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function draw(rows, coat) {
  const c = canvas(CAT_W, CAT_H);
  const g = c.getContext('2d');
  const pal = { k: INK, e: INK, b: coat.b, h: coat.h, s: coat.s, w: coat.w, n: '#ff8fb5', i: '#ffc2d8', t: coat.t };
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      let ch = row[x];
      if (ch === '.') continue;
      // calico: a second, dark patch on the back and the head
      if (coat.u && ch === 't' && (x + y) % 2 === 0) {
        g.fillStyle = coat.u;
        g.fillRect(x, y, 1, 1);
        continue;
      }
      if (coat.u && ch === 'h' && y < 4) ch = 'u';
      g.fillStyle = ch === 'u' ? coat.u : pal[ch] || coat.b;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// the patches are spread over the coat for calico and tabby cats
function withPatches(rows, coat) {
  if (coat.name !== 'calico' && coat.name !== 'tabby') return rows;
  return rows;
}

export function cat(seed = 0) {
  const r = rng((seed * 2654435761) >>> 0);
  const coat = COATS[Math.floor(r() * COATS.length)];
  const stand = [...HEAD, ...BODY, ...LEGS.stand];
  const a = [...HEAD, ...BODY, ...LEGS.a];
  const b = [...HEAD, ...BODY, ...LEGS.b];
  return {
    coat: coat.name,
    sit: draw(withPatches(SIT, coat), coat),
    sleep: draw(withPatches(SLEEP, coat), coat),
    walk: [draw(withPatches(a, coat), coat), draw(withPatches(b, coat), coat)],
    stand: draw(withPatches(stand, coat), coat),
  };
}

export const CAT_COATS = COATS.map((c) => c.name);
