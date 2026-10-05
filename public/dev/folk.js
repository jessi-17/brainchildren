// preview + QA sheet for /js/pixelfolk.js — open /dev/folk.html
import { person, egg, SPRITE_W, SPRITE_H, FEET_Y, WAIST_Y, EGG_W, EGG_H } from '/js/pixelfolk.js';

const $ = (id) => document.getElementById(id);
const urls = new WeakMap();
const urlOf = (canvas) => {
  let u = urls.get(canvas);
  if (!u) urls.set(canvas, (u = canvas.toDataURL()));
  return u;
};

function pic(canvas, scale) {
  const el = document.createElement('img');
  el.className = 'px';
  el.src = urlOf(canvas);
  el.width = canvas.width * scale;
  el.height = canvas.height * scale;
  el.alt = '';
  return el;
}

function fig(content, label) {
  const f = document.createElement('figure');
  f.append(content);
  if (label) {
    const c = document.createElement('figcaption');
    c.textContent = label;
    f.append(c);
  }
  return f;
}

function anim(frames, scale, ms) {
  const el = pic(frames[0], scale);
  let i = 0;
  setInterval(() => {
    i = (i + 1) % frames.length;
    el.src = urlOf(frames[i]);
  }, ms);
  return el;
}

function boxed(el, scale, cover) {
  const box = document.createElement('div');
  box.className = 'stage-box';
  box.append(el);
  if (cover) {
    const d = document.createElement('div');
    d.className = cover;
    d.style.height = `${(SPRITE_H - WAIST_Y) * scale}px`;
    box.append(d);
  }
  const line = document.createElement('div');
  line.className = 'waist';
  line.style.top = `${WAIST_Y * scale}px`;
  box.append(line);
  return box;
}

$('consts').innerHTML =
  `SPRITE_W <code>${SPRITE_W}</code> · SPRITE_H <code>${SPRITE_H}</code> · FEET_Y <code>${FEET_Y}</code> · ` +
  `WAIST_Y <code>${WAIST_Y}</code> · EGG <code>${EGG_W}×${EGG_H}</code>`;

// 1. the crowd
for (let s = 1; s <= 49; s++) {
  const p = person(s, { mood: 'awake', stage: 'growing', kind: null });
  const f = fig(pic(p.stand, 4), `#${s}`);
  f.classList.add('floor');
  $('crowd').append(f);
}

// 2. moods
for (const seed of [24, 27]) {
  for (const mood of ['lively', 'awake', 'bored', 'asleep', 'ghost']) {
    const p = person(seed, { mood, stage: 'growing' });
    const el = pic(p.stand, 5);
    if (mood === 'ghost') el.style.opacity = '0.75';
    $('moods').append(fig(el, `${mood} #${seed}`));
  }
}

// 3. stages
for (const seed of [5, 33, 41]) {
  for (const stage of ['hatchling', 'growing', 'shipped']) {
    $('stages').append(fig(pic(person(seed, { stage }).stand, 5), `${stage} #${seed}`));
  }
}

// 4. kinds
const KINDS = ['music', 'camera', 'game', 'writing', 'mail', '3d', 'social', 'ai', 'art', 'party', 'web', 'code'];
KINDS.forEach((kind, i) => {
  $('kinds').append(fig(pic(person(60 + i, { kind }).stand, 5), kind));
});

// 5. motion
for (const [seed, kind] of [[3, 'music'], [8, 'party'], [17, null], [22, 'code'], [36, 'art'], [44, null]]) {
  const p = person(seed, { mood: 'lively', kind });
  $('motion').append(fig(anim(p.walk, 4, 280), `walk #${seed}`));
  $('motion').append(fig(boxed(anim(p.type, 4, 200), 4, 'desk'), `type #${seed}`));
  $('motion').append(fig(boxed(pic(p.sleep, 4), 4, 'sofa'), `sleep #${seed}`));
}
for (const seed of [3, 17, 36]) {
  const p = person(seed, {});
  const rug = document.createElement('div');
  rug.className = 'rug';
  rug.append(pic(p.lie, 4));
  $('motion').append(fig(rug, `lie #${seed}`));
}
for (const seed of [9, 14, 26, 31]) {
  $('motion').append(fig(boxed(pic(person(seed).stand, 4), 4), `waist #${seed}`));
}

// 6. eggs
for (let s = 1; s <= 12; s++) $('eggs').append(fig(pic(egg(s), 6), `#${s}`));
$('eggs').append(fig(pic(egg(4, { cold: true }), 6), 'cold #4'));
$('eggs').append(fig(pic(egg(9, { cold: true }), 6), 'cold #9'));

// 7. on dark
for (let s = 50; s <= 61; s++) $('dark').append(pic(person(s, { mood: s % 5 === 0 ? 'ghost' : 'awake' }).stand, 3));

// determinism check: a second, cache-free copy of the module must draw the
// exact same pixels for the same seed + opts
import('/js/pixelfolk.js?fresh').then((fresh) => {
  let bad = 0;
  for (const [seed, opts] of [[7, { mood: 'bored', stage: 'shipped', kind: 'web' }], [4242, { mood: 'ghost' }], [3, {}]]) {
    const a = person(seed, opts);
    const b = fresh.person(seed, opts);
    for (const k of ['stand', 'sleep', 'lie']) if (a[k].toDataURL() !== b[k].toDataURL()) bad++;
    if (a.walk[1].toDataURL() !== b.walk[1].toDataURL() || a.color !== b.color) bad++;
  }
  for (const s of [5, 11]) if (egg(s, { cold: s === 11 }).toDataURL() !== fresh.egg(s, { cold: s === 11 }).toDataURL()) bad++;
  console.log(bad ? `pixelfolk: ${bad} determinism mismatches` : 'pixelfolk: deterministic ✓');
});
