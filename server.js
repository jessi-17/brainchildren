#!/usr/bin/env node
// brainchildren: a tiny local server. It only listens on this computer
// (127.0.0.1), and every API call needs a token that's handed to the page
// when it loads, so other websites can't poke at it.
import http from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore } from './lib/store.js';
import { scanRoots, suggestRoots, isDir } from './lib/scan.js';
import { autostartStatus, setAutostart, notify, findRunning, writeLock } from './lib/presence.js';
import { createAI, AIError, MODELS } from './lib/ai.js';
import { createFeatures } from './lib/ai-features.js';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const DATA_DIR = path.resolve(process.env.BC_DATA_DIR || opt('--data') || path.join(APP_DIR, 'data'));
const FIRST_PORT = Number(process.env.PORT || opt('--port') || 4747);
const OPEN_BROWSER = !(argv.includes('--no-open') || process.env.BC_NO_OPEN === '1');
const TOKEN = crypto.randomBytes(24).toString('hex');
const RESCAN_EVERY = 3 * 60 * 1000;
const DAY = 86400000;
const MAX_DESK = 3;
const CAUSES = ['too-big', 'lost-interest', 'someone-built-it', 'merged', 'did-its-job', 'other'];
const { version: VERSION } = JSON.parse(await fs.readFile(path.join(APP_DIR, 'package.json'), 'utf8'));

// one copy per data folder: if brainchildren is already running, just open it
const running = await findRunning(DATA_DIR);
if (running) {
  const url = `http://127.0.0.1:${running.port}`;
  console.log(`\n  ✿ brainchildren is already running → ${url}\n`);
  if (OPEN_BROWSER) openInBrowser(url);
  process.exit(0);
}

const store = await openStore(DATA_DIR);
const db = store.data;
let port = FIRST_PORT;
let scanning = null;

// optional AI with your own key (see lib/ai.js)
const ai = createAI({ appDir: APP_DIR, dataDir: DATA_DIR, settings: () => db.settings, save: () => store.save() });
const features = createFeatures({ ai, db, save: () => store.save() });
let aiInfo = { hasKey: false, sdk: false };
const refreshAI = async () => {
  const st = await ai.status();
  aiInfo = { hasKey: st.hasKey, sdk: st.sdk, keySource: st.keySource };
  return st;
};
refreshAI();

// ---------------------------------------------------------------- scanning

function rescan() {
  if (scanning) return scanning;
  scanning = (async () => {
    const started = Date.now();
    const projects = await scanRoots(db.settings.roots, { ignore: [DATA_DIR] });
    db.cache = { scannedAt: Date.now(), ms: Date.now() - started, projects };
    await store.save();
  })().finally(() => {
    scanning = null;
  });
  return scanning;
}

const projectById = (id) => db.cache.projects.find((p) => p.id === id);

function snapshot(p) {
  return { title: p.title, folder: p.folder, path: p.path, kind: p.kind, born: p.born, lastTouched: p.lastTouched };
}

function addEvent(target, type, extra = {}) {
  target.events = [...(target.events || []), { t: Date.now(), type, ...extra }].slice(-60);
}

function state() {
  const ids = new Set(db.cache.projects.map((p) => p.id));
  return {
    version: VERSION,
    user: os.userInfo().username,
    platform: process.platform,
    settings: db.settings,
    scannedAt: db.cache.scannedAt,
    scanMs: db.cache.ms,
    scanning: !!scanning,
    projects: db.cache.projects.map((p) => ({ ...p, meta: db.meta[p.id] || {} })),
    // projects you let go whose folder has since been deleted or moved
    gone: Object.entries(db.meta)
      .filter(([id, m]) => !ids.has(id) && m.letGo && m.snapshot)
      .map(([id, m]) => ({ id, ...m.snapshot, meta: m, gone: true })),
    ideas: db.ideas,
    wall: db.wall,
    autostart: autostartOn,
    aiReady: !!(db.settings.ai.on && aiInfo.hasKey && aiInfo.sdk),
    aiInfo,
  };
}

// ---------------------------------------------------------------- api

const routes = [
  ['GET', /^\/api\/state$/, async () => state()],
  ['GET', /^\/api\/parts$/, partsManifest],
  ['GET', /^\/api\/suggest-roots$/, () => suggestRoots(APP_DIR)],
  ['POST', /^\/api\/scan$/, async () => (await rescan(), state())],
  ['POST', /^\/api\/settings$/, saveSettings],
  ['POST', /^\/api\/ideas$/, createIdea],
  ['PATCH', /^\/api\/ideas\/([\w-]{8,40})$/, patchIdea],
  ['DELETE', /^\/api\/ideas\/([\w-]{8,40})$/, deleteIdea],
  ['PATCH', /^\/api\/projects\/([0-9a-f]{12})$/, patchProject],
  ['POST', /^\/api\/projects\/([0-9a-f]{12})\/reveal$/, revealProject],
  ['POST', /^\/api\/prefs$/, savePrefs],
  ['POST', /^\/api\/autostart$/, toggleAutostart],
  ['POST', /^\/api\/nudge\/test$/, testNudge],
  ['POST', /^\/api\/wall$/, addWall],
  ['PATCH', /^\/api\/wall\/([\w-]{8,40})$/, patchWall],
  ['DELETE', /^\/api\/wall\/([\w-]{8,40})$/, deleteWall],
  ['GET', /^\/api\/ai$/, () => refreshAI()],
  ['POST', /^\/api\/ai\/settings$/, aiSettings],
  ['POST', /^\/api\/ai\/key$/, aiKey],
  ['POST', /^\/api\/ai\/test$/, aiTest],
  ['POST', /^\/api\/ai\/run\/([a-z]{2,12})$/, aiRun],
];

async function partsManifest() {
  const out = {};
  for (const slot of ['bodies', 'eyes', 'mouths', 'hats', 'props', 'eggs']) {
    try {
      out[slot] = (await fs.readdir(path.join(PUBLIC_DIR, 'parts', slot)))
        .filter((f) => f.toLowerCase().endsWith('.svg'))
        .map((f) => f.slice(0, -4))
        .sort();
    } catch {
      out[slot] = [];
    }
  }
  return out;
}

async function saveSettings(req) {
  const body = await readBody(req);
  const s = db.settings;
  if ('name' in body) s.name = str(body.name, 40);
  if ('editor' in body && ['vscode', 'cursor', 'windsurf', 'vscodium'].includes(body.editor)) s.editor = body.editor;
  if ('chatter' in body && ['lots', 'some', 'quiet'].includes(body.chatter)) s.chatter = body.chatter;
  if ('look' in body && ['pixel', 'doodle'].includes(body.look)) s.look = body.look;
  if ('sleepDays' in body) s.sleepDays = clampInt(body.sleepDays, 3, 120, 14);
  if ('ghostDays' in body) s.ghostDays = clampInt(body.ghostDays, s.sleepDays + 1, 365, 30);
  if (s.ghostDays <= s.sleepDays) s.ghostDays = s.sleepDays + 1;
  if (Array.isArray(body.roots)) {
    const roots = [];
    const bad = [];
    for (const raw of body.roots.slice(0, 20)) {
      const p = typeof raw === 'string' ? raw.trim().replace(/^["']|["']$/g, '') : '';
      if (!p) continue;
      const abs = path.resolve(p.replace(/^~(?=$|[\\/])/, os.homedir()));
      if (await isDir(abs)) {
        if (!roots.some((r) => r.toLowerCase() === abs.toLowerCase())) roots.push(abs);
      } else bad.push(p);
    }
    if (bad.length) throw httpError(400, `couldn't find ${bad.map((b) => `"${b}"`).join(', ')}`);
    s.roots = roots;
  }
  s.setupDone = true;
  await store.save();
  await rescan();
  return state();
}

async function createIdea(req) {
  const body = await readBody(req);
  const title = str(body.title, 80);
  if (!title) throw httpError(400, 'an idea needs at least a name');
  const idea = {
    id: crypto.randomUUID(),
    title,
    note: str(body.note, 4000),
    source: body.source === 'voice' ? 'voice' : 'typed',
    createdAt: Date.now(),
    projectId: null,
    frozen: false,
    letGo: null,
    lookSeed: 0,
  };
  db.ideas.push(idea);
  await store.save();
  return { idea, state: state() };
}

async function patchIdea(req, [, id]) {
  const idea = db.ideas.find((i) => i.id === id);
  if (!idea) throw httpError(404, 'no such idea');
  const body = await readBody(req);
  if ('title' in body) idea.title = str(body.title, 80) || idea.title;
  if ('note' in body) idea.note = str(body.note, 4000);
  if ('lookSeed' in body) idea.lookSeed = clampInt(body.lookSeed, 0, 1e6, 0);
  if ('snoozeUntil' in body) idea.snoozeUntil = Number(body.snoozeUntil) || undefined;
  if ('pinned' in body) {
    const pinned = db.ideas.filter((i) => i.pinned && i.id !== idea.id);
    if (body.pinned && pinned.length >= 4) throw httpError(409, 'the board fits 4 pinned eggs. unpin one first');
    idea.pinned = !!body.pinned || undefined;
  }
  if ('projectId' in body) {
    if (body.projectId === null) {
      idea.projectId = null;
      idea.hatchedAt = null;
    } else {
      if (!projectById(body.projectId)) throw httpError(400, "that folder isn't in your projects");
      const taken = db.ideas.find((i) => i.projectId === body.projectId && i.id !== idea.id);
      if (taken) throw httpError(409, `that folder already hatched from "${taken.title}"`);
      idea.projectId = body.projectId;
      idea.hatchedAt = Date.now();
      idea.frozen = false;
      idea.letGo = null;
    }
  }
  if ('frozen' in body) {
    idea.frozen = !!body.frozen;
    if (idea.frozen) idea.letGo = null;
  }
  if ('letGo' in body) idea.letGo = letGoValue(body.letGo);
  await store.save();
  return state();
}

async function deleteIdea(req, [, id]) {
  const i = db.ideas.findIndex((x) => x.id === id);
  if (i < 0) throw httpError(404, 'no such idea');
  if (!db.ideas[i].letGo) throw httpError(409, 'only eggs in the recycle bin can be deleted');
  db.ideas.splice(i, 1);
  await store.save();
  return state();
}

async function patchProject(req, [, id]) {
  const p = projectById(id);
  const m = db.meta[id] || {};
  if (!p && !m.letGo) throw httpError(404, 'no such project');
  const body = await readBody(req);
  if (p) m.path = p.path;

  if ('nickname' in body) m.nickname = str(body.nickname, 40) || undefined;
  if ('lookSeed' in body) m.lookSeed = clampInt(body.lookSeed, 0, 1e6, 0);
  if ('url' in body) m.url = /^https?:\/\/\S+$/.test(String(body.url || '')) ? String(body.url).slice(0, 300) : undefined;
  if ('snoozeUntil' in body) m.snoozeUntil = Number(body.snoozeUntil) || undefined;
  if ('shipped' in body) {
    m.shipped = !!body.shipped;
    if (m.shipped) addEvent(m, 'shipped');
  }
  if ('revive' in body && body.revive) {
    m.snoozeUntil = Number(body.until) || Date.now() + 14 * DAY;
    addEvent(m, 'revived');
  }
  if ('frozen' in body) {
    m.frozen = !!body.frozen;
    if (m.frozen) {
      m.onDesk = false;
      addEvent(m, 'frozen');
    } else addEvent(m, 'thawed');
  }
  if ('letGo' in body) {
    m.letGo = letGoValue(body.letGo);
    if (m.letGo) {
      m.onDesk = false;
      m.frozen = false;
      if (p) m.snapshot = snapshot(p);
      addEvent(m, 'let-go', { cause: m.letGo.cause });
    } else addEvent(m, 'restored');
  }
  if ('ignored' in body) {
    m.ignored = !!body.ignored || undefined;
    if (m.ignored) m.onDesk = false;
  }
  if ('addNote' in body) {
    const text = str(body.addNote, 600);
    if (text) {
      m.notes = [...(m.notes || []), { t: Date.now(), text }].slice(-30);
      m.lastNote = Date.now();
    }
  }
  if ('deleteNote' in body) m.notes = (m.notes || []).filter((n) => n.t !== Number(body.deleteNote));
  if ('readNote' in body) m.noteReadAt = Date.now();
  if ('focus' in body) {
    if (body.focus === 'start') {
      m.focusStart = Date.now();
      m.lastFocus = Date.now();
    } else if (body.focus === 'end' && m.focusStart) {
      const minutes = Math.max(1, Math.round((Date.now() - m.focusStart) / 60000));
      m.sessions = [...(m.sessions || []), { t: m.focusStart, minutes: Math.min(minutes, 600) }].slice(-200);
      m.lastFocus = Date.now();
      m.focusStart = undefined;
    } else if (body.focus === 'cancel') m.focusStart = undefined;
  }
  if ('traits' in body) m.traits = cleanTraits(body.traits);
  if ('stepDone' in body && m.ai?.steps?.items) {
    const step = m.ai.steps.items[clampInt(body.stepDone, 0, 20, 0)];
    if (step) step.done = !!body.done;
  }
  if ('onDesk' in body) {
    if (body.onDesk) {
      if (m.letGo || m.frozen) throw httpError(409, 'bring it back first');
      const desk = db.cache.projects.filter((x) => x.id !== id && db.meta[x.id]?.onDesk && !db.meta[x.id]?.letGo);
      if (desk.length >= MAX_DESK) throw httpError(409, 'desk-full', { desk: desk.map((x) => x.id) });
      if (!m.onDesk) addEvent(m, 'desk');
      m.onDesk = true;
    } else {
      m.onDesk = false;
    }
  }
  db.meta[id] = m;
  await store.save();
  return state();
}

async function revealProject(req, [, id]) {
  const p = projectById(id);
  if (!p) throw httpError(404, 'no such project');
  const [cmd, args] =
    process.platform === 'win32' ? ['explorer.exe', [p.path]]
    : process.platform === 'darwin' ? ['open', [p.path]]
    : ['xdg-open', [p.path]];
  execFile(cmd, args, { windowsHide: true }, () => {});
  return { ok: true };
}

// ---------------------------------------------------------------- preferences (no rescan)

const WALLS = ['lilac', 'mint', 'peach', 'sky', 'butter', 'cocoa'];
const FLOORS = ['wood', 'checker', 'carpet', 'tatami'];
const VIEWS = ['city', 'beach', 'mountains', 'rain', 'stars', 'space', 'garden'];
const LIGHTS = ['real', 'day', 'golden', 'night'];

async function savePrefs(req) {
  const body = await readBody(req);
  const s = db.settings;
  if ('name' in body) s.name = str(body.name, 40);
  if ('editor' in body && ['vscode', 'cursor', 'windsurf', 'vscodium'].includes(body.editor)) s.editor = body.editor;
  if ('chatter' in body && ['lots', 'some', 'quiet'].includes(body.chatter)) s.chatter = body.chatter;
  if ('voice' in body && ['sweet', 'sassy', 'quiet'].includes(body.voice)) s.voice = body.voice;
  if ('look' in body && ['pixel', 'doodle'].includes(body.look)) s.look = body.look;
  if ('ambience' in body && ['off', 'rain', 'radio'].includes(body.ambience)) s.ambience = body.ambience;
  if ('focusMinutes' in body) s.focusMinutes = clampInt(body.focusMinutes, 5, 120, 25);
  if (body.nudge && typeof body.nudge === 'object') {
    const n = s.nudge;
    if ('on' in body.nudge) n.on = !!body.nudge.on;
    if ('day' in body.nudge) n.day = clampInt(body.nudge.day, 0, 6, 1);
    if ('hour' in body.nudge) n.hour = clampInt(body.nudge.hour, 0, 23, 10);
  }
  if (body.studio && typeof body.studio === 'object') {
    const st = s.studio;
    const b = body.studio;
    if ('name' in b) st.name = str(b.name, 32);
    if ('boardText' in b) st.boardText = str(b.boardText, 140);
    if ('me' in b) st.me = b.me === null ? null : cleanTraits(b.me);
    if (b.style && typeof b.style === 'object') {
      if (WALLS.includes(b.style.wall)) st.style.wall = b.style.wall;
      if (FLOORS.includes(b.style.floor)) st.style.floor = b.style.floor;
      if (VIEWS.includes(b.style.view)) st.style.view = b.style.view;
      if (LIGHTS.includes(b.style.light)) st.style.light = b.style.light;
    }
    if ('cat' in b) st.cat = !!b.cat;
  }
  await store.save();
  return state();
}

const TRAIT_KEYS = ['skin', 'style', 'variant', 'hat', 'hatColor', 'hairColor', 'outfit', 'top', 'accent', 'bottomKind', 'bottom', 'shoe', 'socks', 'sleeves', 'print', 'tie', 'glasses', 'glassesColor', 'phones', 'phonesColor', 'bow', 'bowColor', 'beard', 'freckles', 'blush', 'pom'];
function cleanTraits(t) {
  if (!t || typeof t !== 'object') return undefined;
  const out = {};
  for (const k of TRAIT_KEYS) {
    if (!(k in t)) continue;
    const v = t[k];
    if (v === null || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v);
    else if (typeof v === 'string' && /^[#\w-]{1,24}$/.test(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------- the wall: sticky notes + polaroids

async function addWall(req) {
  const body = await readBody(req);
  if (db.wall.length >= 16) throw httpError(409, 'the wall is full (16 things). take something down first');
  const item = wallItem({ id: crypto.randomUUID() }, body);
  if (item.kind === 'note' && !item.text) throw httpError(400, 'a sticky note needs some words');
  if (item.kind === 'photo' && !item.src) throw httpError(400, "that picture didn't come through");
  db.wall.push(item);
  await store.save();
  return state();
}

async function patchWall(req, [, id]) {
  const item = db.wall.find((w) => w.id === id);
  if (!item) throw httpError(404, 'no such thing on the wall');
  wallItem(item, await readBody(req));
  await store.save();
  return state();
}

async function deleteWall(req, [, id]) {
  db.wall = db.wall.filter((w) => w.id !== id);
  await store.save();
  return state();
}

function wallItem(item, b) {
  if (!item.kind) item.kind = b.kind === 'photo' ? 'photo' : 'note';
  if ('text' in b) item.text = str(b.text, 120);
  if ('color' in b && /^#[0-9a-f]{6}$/i.test(b.color)) item.color = b.color;
  if ('x' in b) item.x = clampInt(b.x, 0, 2000, 0);
  if ('y' in b) item.y = clampInt(b.y, 0, 1000, 0);
  if ('tilt' in b) item.tilt = clampInt(b.tilt, -8, 8, 0);
  if (item.kind === 'photo' && typeof b.src === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.src) && b.src.length < 90000) item.src = b.src;
  return item;
}

// ---------------------------------------------------------------- staying present

let autostartOn = await autostartStatus();

async function toggleAutostart(req) {
  const body = await readBody(req);
  autostartOn = await setAutostart(!!body.on, { serverPath: fileURLToPath(import.meta.url), dataDir: DATA_DIR, defaultDataDir: path.join(APP_DIR, 'data') });
  return state();
}

function nudgeText() {
  const now = Date.now();
  const s = db.settings;
  const live = db.cache.projects.filter((p) => {
    const m = db.meta[p.id] || {};
    return !m.letGo && !m.frozen && !m.ignored;
  });
  const days = (p) => Math.floor((now - Math.max(p.lastTouched, db.meta[p.id]?.lastFocus || 0)) / DAY);
  const ghosts = live.filter((p) => days(p) >= s.ghostDays && !(db.meta[p.id]?.snoozeUntil > now));
  const napping = live.filter((p) => days(p) >= s.sleepDays && days(p) < s.ghostDays);
  const eggs = db.ideas.filter((i) => !i.projectId && !i.letGo && !i.frozen);
  const cold = eggs.filter((i) => (now - i.createdAt) / DAY >= s.ghostDays);
  const desk = live.filter((p) => db.meta[p.id]?.onDesk);
  const bits = [];
  if (ghosts.length) bits.push(`${ghosts.length} ghost${ghosts.length === 1 ? '' : 's'}`);
  if (napping.length) bits.push(`${napping.length} napping`);
  if (cold.length) bits.push(`${cold.length} cold egg${cold.length === 1 ? '' : 's'}`);
  else if (eggs.length) bits.push(`${eggs.length} egg${eggs.length === 1 ? '' : 's'} waiting`);
  const first = desk[0];
  const next = first?.todos?.open?.[0]?.text;
  const deskLine = first ? `desk: ${(db.meta[first.id]?.nickname || first.title || first.folder)}${next ? ` (next: ${next})` : ''}` : 'your desk is empty. pick something to focus on';
  return { title: bits.length ? `your studio: ${bits.join(', ')}` : 'your studio is doing fine ✿', body: deskLine.slice(0, 180) };
}

async function testNudge() {
  const { title, body } = nudgeText();
  const ok = await notify(title, body, `http://127.0.0.1:${port}`);
  return { ok };
}

// the weekly nudge: checked every 10 minutes, sent once on the chosen day after the chosen hour
setInterval(async () => {
  const n = db.settings.nudge;
  if (!n.on) return;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (now.getDay() !== n.day || now.getHours() < n.hour || (n.lastSent || 0) >= today) return;
  n.lastSent = Date.now();
  await store.save();
  const { title, body } = nudgeText();
  notify(title, body, `http://127.0.0.1:${port}`);
}, 10 * 60 * 1000).unref();

// ideas added from the terminal ("brainchildren add …") land in data/inbox.jsonl
const INBOX = path.join(DATA_DIR, 'inbox.jsonl');
async function importInbox() {
  const claimed = `${INBOX}.${process.pid}.processing`;
  try {
    await fs.rename(INBOX, claimed);
  } catch {
    return;
  }
  const text = await fs.readFile(claimed, 'utf8').catch(() => '');
  let added = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      const title = str(j.title, 80);
      if (!title) continue;
      db.ideas.push({ id: crypto.randomUUID(), title, note: str(j.note, 4000), source: 'terminal', createdAt: Number(j.t) || Date.now(), projectId: null, frozen: false, letGo: null, lookSeed: 0 });
      added++;
    } catch {}
  }
  await fs.rm(claimed, { force: true });
  if (added) await store.save();
}
importInbox();
setInterval(importInbox, 3000).unref();

// ---------------------------------------------------------------- AI routes

async function aiSettings(req) {
  const body = await readBody(req);
  const a = db.settings.ai;
  if ('on' in body) a.on = !!body.on;
  if ('model' in body && MODELS[body.model]) a.model = body.model;
  if (body.features && typeof body.features === 'object') {
    for (const [k, v] of Object.entries(body.features)) if (k in a.features) a.features[k] = !!v;
  }
  await store.save();
  await refreshAI();
  return state();
}

async function aiKey(req) {
  const body = await readBody(req);
  try {
    await ai.setKey(typeof body.key === 'string' ? body.key.trim() : null);
  } catch (err) {
    throw aiHttp(err);
  }
  await refreshAI();
  return state();
}

async function aiTest() {
  try {
    return await ai.test();
  } catch (err) {
    throw aiHttp(err);
  }
}

async function aiRun(req, [, name]) {
  const body = await readBody(req);
  try {
    const out = await features.run(name, body.args || {}, { preview: !!body.preview });
    return { ...out, state: out.preview ? undefined : state() };
  } catch (err) {
    throw aiHttp(err);
  }
}

function aiHttp(err) {
  if (err instanceof AIError) return httpError(err.code === 'off' || err.code === 'needs-sdk' ? 409 : 400, err.message, { code: err.code });
  if (err.status) return err;
  return httpError(400, err.message || 'something went wrong');
}

function letGoValue(v) {
  if (!v) return null;
  return {
    cause: CAUSES.includes(v.cause) ? v.cause : 'other',
    keep: str(v.keep, 500),
    at: Date.now(),
  };
}

// ---------------------------------------------------------------- http plumbing

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

function httpError(status, message, extra) {
  return Object.assign(new Error(message), { status, extra });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw httpError(413, 'too much text');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return body && typeof body === 'object' ? body : {};
  } catch {
    throw httpError(400, "that wasn't valid JSON");
  }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

async function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch {
    return send(res, 400, { error: 'bad path' });
  }
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'nope' });
  let st;
  try {
    st = await fs.stat(file);
  } catch {
    return send(res, 404, { error: 'not found' });
  }
  if (!st.isFile()) return send(res, 404, { error: 'not found' });
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  if (file === path.join(PUBLIC_DIR, 'index.html')) {
    const html = (await fs.readFile(file, 'utf8')).replace('%%BC_TOKEN%%', TOKEN);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    return res.end(html);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(req.headers.host)) return send(res, 403, { error: 'wrong host' });
  const origin = req.headers.origin;
  if (origin && !hosts.some((h) => origin === `http://${h}`)) return send(res, 403, { error: 'wrong origin' });

  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (pathname === '/__brainchildren') return send(res, 200, { app: 'brainchildren', version: VERSION });
  try {
    if (pathname.startsWith('/api/')) {
      if (req.headers['x-bc-token'] !== TOKEN) return send(res, 401, { error: 'stale-token' });
      for (const [method, pattern, handler] of routes) {
        const match = pattern.exec(pathname);
        if (match && method === req.method) return send(res, 200, await handler(req, match));
      }
      return send(res, 404, { error: 'no such api' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'nope' });
    return await serveStatic(req, res, pathname);
  } catch (err) {
    if (!err.status) console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'something broke', ...err.extra });
  }
});

function listen(p, tries = 0) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && tries < 20) return listen(p + 1, tries + 1);
    console.error(`  couldn't start: ${err.message}`);
    process.exit(1);
  });
  server.listen(p, '127.0.0.1', () => {
    port = p;
    writeLock(DATA_DIR, port).then((clear) => {
      process.on('exit', clear);
      for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
    });
    const url = `http://127.0.0.1:${port}`;
    console.log(`\n  ✿ brainchildren ${VERSION} is running\n  → ${url}\n\n  only this computer can see it. press Ctrl+C to stop.\n`);
    if (OPEN_BROWSER) openInBrowser(url);
  });
}

function openInBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['explorer.exe', [url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  execFile(cmd, args, { windowsHide: true }, () => {});
}

listen(FIRST_PORT);
if (db.settings.roots.length) rescan().catch((err) => console.error('  scan failed:', err.message));
setInterval(() => {
  if (db.settings.roots.length) rescan().catch((err) => console.error('  scan failed:', err.message));
}, RESCAN_EVERY).unref();
