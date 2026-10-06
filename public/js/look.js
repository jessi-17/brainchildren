// One place that knows how a project looks: pixel person (default) or the
// older doodle creature. Everything else asks here for frames or thumbnails.
import * as folk from './pixelfolk.js';
import { creatureSvg } from './creature.js';
import { esc } from './life.js';

let style = 'pixel';
const urls = new Map();

export function setLookStyle(next) {
  const s = next === 'doodle' ? 'doodle' : 'pixel';
  if (s !== style) urls.clear();
  style = s;
}
export const lookStyle = () => style;

const moodOf = (c) => (c.energy === 'egg' || c.energy === 'cold' ? 'awake' : c.energy);
const stageOf = (c) => (c.stage === 'egg' ? 'growing' : c.stage);

export const personFrames = (c) =>
  folk.person(c.seed >>> 0, { mood: moodOf(c), stage: stageOf(c), kind: c.kind || null, traits: c.traits || null, outfitColor: c.brand?.color || null });
export const eggCanvas = (c) => folk.egg(c.seed >>> 0, { cold: c.energy === 'cold' });

// a small picture as an HTML string, for lists, portraits and the taskbar
export function thumbHtml(c, size = 26) {
  if (style === 'doodle') return `<span class="thumb doodle" style="width:${size}px;height:${size}px">${creatureSvg(c, { mini: size < 40 })}</span>`;
  const key = `${c.key}|${c.seed}|${c.stage}|${c.energy}|${c.kind}|${JSON.stringify(c.traits || '')}|${c.brand?.color || ''}`;
  let entry = urls.get(key);
  if (!entry) {
    const src = c.type === 'egg' ? eggCanvas(c) : personFrames(c).stand;
    entry = { url: src.toDataURL(), w: src.width, h: src.height };
    urls.set(key, entry);
  }
  const k = size / Math.max(entry.w, entry.h);
  return `<span class="thumb" style="width:${size}px;height:${size}px"><img src="${entry.url}" width="${Math.round(entry.w * k)}" height="${Math.round(entry.h * k)}" alt="${esc(c.name)}"></span>`;
}
