// Turns raw scan data into creatures: what stage each one is at (how far
// it got) and its energy (how recently you touched it).
export const DAY = 86400000;

let offsetDays = 0;
export const clock = {
  get offsetDays() {
    return offsetDays;
  },
  set offsetDays(v) {
    offsetDays = Math.max(0, Math.round(Number(v) || 0));
  },
  now: () => Date.now() + offsetDays * DAY,
};

export const daysSince = (t, now) => Math.max(0, Math.floor((now - t) / DAY));

export function energyOf(days, settings) {
  if (days <= 2) return 'lively';
  if (days <= 6) return 'awake';
  if (days < settings.sleepDays) return 'bored';
  if (days < settings.ghostDays) return 'asleep';
  return 'ghost';
}

export function stageOf(p) {
  if (p.meta?.shipped) return 'shipped';
  if ((p.git?.count || 0) >= 5 || p.files >= 40 || (p.hasPackage && p.files >= 15)) return 'growing';
  return 'hatchling';
}

export const STAGES = {
  egg: { emoji: '🥚', label: 'egg' },
  hatchling: { emoji: '🐣', label: 'hatchling' },
  growing: { emoji: '🐥', label: 'growing' },
  shipped: { emoji: '✨', label: 'shipped' },
};
export const ENERGY = {
  lively: { label: 'lively', status: 'Running' },
  awake: { label: 'awake', status: 'Running' },
  bored: { label: 'bored', status: 'Idle' },
  asleep: { label: 'asleep', status: 'Sleeping' },
  ghost: { label: 'ghost', status: 'Not Responding' },
  egg: { label: 'waiting', status: 'Waiting to hatch' },
  cold: { label: 'getting cold', status: 'Getting cold' },
};
export const CAUSES = {
  'too-big': 'too big',
  'lost-interest': 'lost interest',
  'someone-built-it': 'someone else built it',
  merged: 'merged into another idea',
  'did-its-job': 'it did its job',
  other: 'something else',
};
export const KIND_NOUNS = {
  music: 'music', camera: 'camera', game: 'game', writing: 'writing', mail: 'mail', '3d': '3d',
  social: 'social', ai: 'ai', art: 'art', party: 'party', web: 'web', code: 'code',
};

const WEB_STACK = ['Astro', 'Next.js', 'Nuxt', 'SvelteKit', 'Svelte', 'Vue', 'React', 'Solid', 'Vite', 'HTML', 'Cloudflare', 'Tailwind', 'GSAP'];

export function buildModel(s) {
  const now = clock.now();
  const settings = s.settings;
  const user = settings.name || s.user || 'you';
  const eggOf = new Map(s.ideas.filter((i) => i.projectId).map((i) => [i.projectId, i]));
  const creatures = [];

  for (const p of s.projects) {
    const m = p.meta || {};
    // working on it in brainchildren (a focus session, a note) counts as touching it
    const lastActive = Math.max(p.lastTouched, m.lastFocus || 0, m.lastNote || 0);
    const days = daysSince(lastActive, now);
    const note = m.notes?.length ? m.notes[m.notes.length - 1] : null;
    const c = {
      key: `p:${p.id}`,
      id: p.id,
      type: 'project',
      p,
      meta: m,
      name: m.nickname || p.title || prettify(p.folder),
      stage: stageOf(p),
      days,
      age: daysSince(p.born, now),
      energy: energyOf(days, settings),
      kind: p.kind || fallbackKind(p),
      seed: hash(p.path.toLowerCase()) + (m.lookSeed || 0) * 7919,
      egg: eggOf.get(p.id) || null,
      letGo: m.letGo || null,
      frozen: !!m.frozen && !m.letGo,
      ignored: !!m.ignored,
      lastActive,
      note,
      // past you left a note at least 3 days ago that you haven't read since
      letter: note && now - note.t >= 3 * DAY && (m.noteReadAt || 0) < note.t ? note : null,
      brand: p.brand || null,
      traits: m.traits || null,
      focusMinutes: (m.sessions || []).reduce((sum, x) => sum + (now - x.t < 7 * DAY ? x.minutes : 0), 0),
    };
    c.onDesk = !!m.onDesk && !c.letGo && !c.frozen && !c.ignored;
    c.needsVisit = c.energy === 'ghost' && !c.frozen && !c.letGo && !(m.snoozeUntil > now);
    creatures.push(c);
  }

  for (const g of s.gone || []) {
    creatures.push({
      key: `p:${g.id}`,
      id: g.id,
      type: 'project',
      gone: true,
      p: { ...g, files: 0, recent: [], todos: { open: [], openCount: 0, done: 0 }, git: null, stack: [] },
      meta: g.meta,
      name: g.meta.nickname || g.title || prettify(g.folder),
      stage: 'hatchling',
      days: daysSince(g.lastTouched, now),
      age: daysSince(g.born, now),
      energy: 'ghost',
      kind: g.kind,
      seed: hash(String(g.path).toLowerCase()) + (g.meta.lookSeed || 0) * 7919,
      letGo: g.meta.letGo,
      frozen: false,
      onDesk: false,
    });
  }

  for (const i of s.ideas) {
    if (i.projectId) continue;
    const days = daysSince(i.createdAt, now);
    const cold = days >= settings.ghostDays;
    creatures.push({
      key: `e:${i.id}`,
      id: i.id,
      type: 'egg',
      idea: i,
      name: i.title,
      stage: 'egg',
      days,
      age: days,
      energy: cold ? 'cold' : 'egg',
      seed: hash(i.id) + (i.lookSeed || 0) * 7919,
      letGo: i.letGo || null,
      frozen: !!i.frozen && !i.letGo,
      onDesk: false,
      needsVisit: cold && !i.frozen && !i.letGo && !(i.snoozeUntil > now),
    });
  }

  const live = creatures.filter((c) => !c.frozen && !c.letGo && !c.gone && !c.ignored);
  const bin = creatures.filter((c) => c.letGo).sort((a, b) => b.letGo.at - a.letGo.at);
  const projects = creatures.filter((c) => c.type === 'project' && !c.gone);
  const revived = projects.reduce((n, c) => n + (c.meta.events || []).filter((e) => e.type === 'revived').length, 0);
  return {
    now,
    settings,
    user,
    state: s,
    creatures,
    live,
    // desks keep the order people sat down in, so nobody swaps seats
    desk: live.filter((c) => c.onDesk).sort((a, b) => deskSince(a) - deskSince(b)),
    bin,
    freezer: creatures.filter((c) => c.frozen && !c.ignored),
    hidden: creatures.filter((c) => c.ignored),
    visits: live.filter((c) => c.needsVisit),
    pinned: live.filter((c) => c.type === 'egg' && c.idea.pinned),
    // decor you earn: a trophy per shipped project, a plant that grows with
    // every revived ghost, a lessons book per 5 ideas let go
    earned: {
      trophies: projects.filter((c) => c.meta.shipped && !c.letGo).length,
      plant: Math.min(5, revived),
      books: Math.floor(bin.length / 5),
    },
    focusWeek: projects.reduce((n, c) => n + c.focusMinutes, 0),
    byKey: new Map(creatures.map((c) => [c.key, c])),
  };
}

function deskSince(c) {
  const events = c.meta?.events || [];
  for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'desk') return events[i].t;
  return 0;
}

function fallbackKind(p) {
  if (!p.files) return null;
  if (p.stack?.some((s) => WEB_STACK.includes(s))) return 'web';
  return 'code';
}

export const prettify = (folder) => String(folder).replace(/[-_]+/g, ' ').trim();

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- words

export function ago(t, now = clock.now()) {
  const d = daysSince(t, now);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  if (d < 730) return `${Math.round(d / 30)} months ago`;
  return `${Math.round(d / 365)} years ago`;
}
export const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
export const fmtTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase();
export const weekday = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'long' }).toLowerCase();
export const plural = (n, word, many) => `${n} ${n === 1 ? word : many || `${word}s`}`;
export const short = (s, n = 36) => {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : str;
};
export const basename = (rel) => String(rel).split('/').pop();

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// how much an egg and a folder seem to be about the same thing
const STOP = new Set('a an and the of for to in on my your app idea project with that this it is be maybe like thing site web website tool'.split(' '));
export function words(text) {
  const out = new Set();
  for (const w of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.add(w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
  }
  return out;
}
export function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / Math.min(a.size, b.size);
}
export const projectWords = (c) => words(`${c.p.folder} ${c.p.title || ''} ${c.p.bio || ''} ${c.meta?.nickname || ''}`);
export const eggWords = (c) => words(`${c.idea.title} ${c.idea.note || ''}`);
