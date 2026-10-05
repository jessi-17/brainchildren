// Builds each creature from the parts kit in /parts. Every part is a 100×100
// SVG; three key colours get swapped per creature (see parts/README.md).
import { api } from './api.js';
import { rng } from './life.js';

const STD = { face: [50, 58], hat: [50, 24], hand: [80, 66] };
const INK = '#2b2a5e';
const PALETTES = [
  ['#ffb3d1', '#fff3c4'],
  ['#ffe27a', '#fffdf0'],
  ['#c9b6ff', '#fff3c4'],
  ['#c6ef6a', '#fffdf0'],
  ['#a9dcff', '#fff3c4'],
  ['#ffc9a3', '#fffdf0'],
  ['#a8f0d4', '#fff3c4'],
  ['#b4c0ff', '#fffdf0'],
  ['#ff9ec7', '#ffeef6'],
];
const KEYS = [
  [/#ffb3d1\b/gi, 'body'],
  [/#fff3c4\b/gi, 'body2'],
  [/#2b2a5e\b/gi, 'ink'],
];

let manifest = { bodies: [], eyes: [], mouths: [], hats: [], props: [], eggs: [] };
const parts = new Map();
const cache = new Map();
let uid = 0;

export async function loadParts() {
  manifest = await api.get('/api/parts');
  const jobs = [];
  for (const [slot, names] of Object.entries(manifest)) {
    for (const name of names) {
      jobs.push(
        fetch(`/parts/${slot}/${encodeURIComponent(name)}.svg`)
          .then((r) => (r.ok ? r.text() : null))
          .then((text) => {
            const part = text && parse(text);
            if (part) parts.set(`${slot}/${name}`, part);
          })
          .catch(() => {}),
      );
    }
  }
  await Promise.all(jobs);
  cache.clear();
}

function parse(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return null;
  // parts are pictures, not programs
  root.querySelectorAll('script, foreignObject, style').forEach((n) => n.remove());
  for (const el of root.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/href$/i.test(a.name) && !a.value.startsWith('#'))) el.removeAttribute(a.name);
    }
  }
  const anchors = {};
  for (const k of Object.keys(STD)) {
    const [x, y] = (root.getAttribute(`data-${k}`) || '').split(/[\s,]+/).map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) anchors[k] = [x, y];
  }
  const ser = new XMLSerializer();
  let inner = [...root.childNodes].map((n) => ser.serializeToString(n)).join('');
  const vb = (root.getAttribute('viewBox') || '0 0 100 100').split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && (vb[0] || vb[1] || vb[2] !== 100 || vb[3] !== 100)) {
    inner = `<g transform="scale(${100 / vb[2]} ${100 / vb[3]}) translate(${-vb[0]} ${-vb[1]})">${inner}</g>`;
  }
  return { inner, anchors };
}

function paint(inner, colors) {
  let out = inner;
  for (const [re, key] of KEYS) out = out.replace(re, colors[key]);
  // ids inside exported files must stay unique once many creatures share a page
  if (/\bid="/.test(out)) {
    const n = ++uid;
    out = out
      .replace(/\bid="([^"]+)"/g, `id="$1-${n}"`)
      .replace(/url\(#([^)]+)\)/g, `url(#$1-${n})`)
      .replace(/href="#([^"]+)"/g, `href="#$1-${n}"`);
  }
  return out;
}

const pool = (slot) => (manifest[slot] || []).filter((n) => !n.startsWith('_'));
const has = (slot, name) => parts.has(`${slot}/${name}`);

// the stable "look" of a creature: same seed, same creature, every time
export function lookOf(c) {
  const r = rng(c.seed);
  const pick = (slot) => {
    const list = pool(slot);
    return list.length ? list[Math.floor(r() * list.length)] : null;
  };
  const look = {
    body: pick('bodies'),
    palette: PALETTES[Math.floor(r() * PALETTES.length)],
    eyes: pick('eyes'),
    mouth: pick('mouths'),
    hat: r() < 0.72 ? pick('hats') : null,
    egg: pick('eggs'),
    dust: Array.from({ length: 6 }, () => [30 + r() * 40, 42 + r() * 38]),
  };
  return look;
}

export function creatureSvg(c, { mini = false } = {}) {
  const k = `${c.key}|${c.seed}|${c.stage}|${c.energy}|${c.kind}|${mini ? 1 : 0}|${c.type === 'project' ? Math.min(6, Math.floor(c.days / 3)) : 0}`;
  if (cache.has(k)) return cache.get(k);
  const svg = c.type === 'egg' ? eggSvg(c) : projectSvg(c, mini);
  cache.set(k, svg);
  return svg;
}

function projectSvg(c, mini) {
  const look = lookOf(c);
  const colors = { body: look.palette[0], body2: look.palette[1], ink: INK };
  const body = parts.get(`bodies/${look.body}`);
  const anchors = { ...STD, ...(body?.anchors || {}) };

  let eyes = look.eyes;
  let mouth = look.mouth;
  let hat = look.hat;
  if (c.energy === 'lively' && has('mouths', 'open')) mouth = 'open';
  if (c.energy === 'bored') {
    if (has('eyes', 'sleepy')) eyes = 'sleepy';
    if (has('mouths', 'flat')) mouth = 'flat';
  }
  if (c.energy === 'asleep') {
    eyes = has('eyes', '_sleep') ? '_sleep' : eyes;
    mouth = has('mouths', '_sleep') ? '_sleep' : mouth;
  }
  if (c.energy === 'ghost') {
    eyes = has('eyes', '_ghost') ? '_ghost' : eyes;
    mouth = has('mouths', '_sad') ? '_sad' : mouth;
  }
  if (c.stage === 'hatchling' && has('hats', '_shell')) hat = '_shell';
  if (c.stage === 'shipped' && has('hats', '_crown')) hat = '_crown';
  const prop = c.kind && has('props', c.kind) ? c.kind : null;

  const at = (slot, name, anchor) => {
    const part = name && parts.get(`${slot}/${name}`);
    if (!part) return '';
    const dx = anchors[anchor][0] - STD[anchor][0];
    const dy = anchors[anchor][1] - STD[anchor][1];
    const g = paint(part.inner, colors);
    return dx || dy ? `<g transform="translate(${dx} ${dy})">${g}</g>` : g;
  };

  const [fx, fy] = anchors.face;
  const blush = `<ellipse cx="${fx - 16}" cy="${fy + 6}" rx="5" ry="3" fill="#ff8fbf" opacity=".5"/><ellipse cx="${fx + 16}" cy="${fy + 6}" rx="5" ry="3" fill="#ff8fbf" opacity=".5"/>`;
  const bodyMarkup = body
    ? paint(body.inner, colors)
    : `<ellipse cx="50" cy="60" rx="30" ry="28" fill="${colors.body}" stroke="${INK}" stroke-width="3"/>`;
  const dustCount = c.energy === 'bored' || c.energy === 'asleep' ? Math.min(6, Math.floor(c.days / 3)) : 0;
  const dust = look.dust
    .slice(0, dustCount)
    .map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="#9d95bd" opacity=".75"/>`)
    .join('');

  return `<svg viewBox="0 0 100 100" overflow="visible" aria-hidden="true">
<g class="feet"><ellipse class="foot foot-l" cx="40" cy="91" rx="6.5" ry="3.8" fill="${INK}"/><ellipse class="foot foot-r" cx="60" cy="91" rx="6.5" ry="3.8" fill="${INK}"/></g>
<g class="body">${bodyMarkup}${dust}</g>
${mini ? '' : blush}${at('eyes', eyes, 'face')}${at('mouths', mouth, 'face')}${at('hats', hat, 'hat')}${mini ? '' : at('props', prop, 'hand')}
</svg>`;
}

function eggSvg(c) {
  const look = lookOf(c);
  const colors = { body: look.palette[0], body2: look.palette[1], ink: INK };
  const egg = look.egg && parts.get(`eggs/${look.egg}`);
  const shell = egg
    ? paint(egg.inner, colors)
    : `<path d="M50 30c12 0 21 18 21 35 0 15-9 26-21 26S29 80 29 65c0-17 9-35 21-35z" fill="${colors.body}" stroke="${INK}" stroke-width="3"/>`;
  return `<svg viewBox="0 0 100 100" overflow="visible" aria-hidden="true">${shell}</svg>`;
}
