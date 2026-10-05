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

const store = await openStore(DATA_DIR);
const db = store.data;
let port = FIRST_PORT;
let scanning = null;

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
