// Reads your project folders and works out what each one is and when it was
// last touched. It only reads: folder listings, file dates, README/TODO-style
// markdown, package.json and the .git folder's own text files. It never runs
// git, never changes anything, and never sends anything anywhere.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const SKIP_DIRS = new Set([
  'node_modules', 'bower_components', 'jspm_packages', 'vendor', 'dist', 'build', 'out',
  'target', 'coverage', '__pycache__', 'venv', 'site-packages', 'pods', 'deriveddata',
]);
const NOISE_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const LOCK_FILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock',
  'cargo.lock', 'poetry.lock', 'composer.lock', 'gemfile.lock',
]);
// pictures, video and fonts still count as activity, but 'where was I?' lists your real work files
const MEDIA = /^\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|mp4|mov|webm|mp3|wav|ogg|woff2?|ttf|otf|zip|pdf)$/;
const MAX_FILES = 30000;
const MAX_DEPTH = 14;
const DAY = 86400000;

export const norm = (p) => {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};
export const idFor = (p) => crypto.createHash('sha1').update(norm(p)).digest('hex').slice(0, 12);

// ---------------------------------------------------------------- roots

export async function scanRoots(roots, { ignore = [] } = {}) {
  const ignoreSet = new Set(ignore.map(norm));
  const seen = new Set();
  const dirs = [];
  for (const root of roots) {
    if (!(await isDir(root))) continue;
    if (await looksLikeProject(root)) {
      dirs.push({ dir: root, root });
      continue;
    }
    let entries = [];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const lower = e.name.toLowerCase();
      if (!e.isDirectory() || lower.startsWith('.') || SKIP_DIRS.has(lower)) continue;
      dirs.push({ dir: path.join(root, e.name), root });
    }
  }
  const unique = dirs.filter(({ dir }) => {
    const key = norm(dir);
    if (seen.has(key) || ignoreSet.has(key)) return false;
    seen.add(key);
    return true;
  });
  const results = await mapLimit(unique, 4, ({ dir, root }) =>
    scanProject(dir, root, ignoreSet).catch((err) => {
      console.warn(`  skipped ${dir}: ${err.message}`);
      return null;
    }),
  );
  return results.filter(Boolean).sort((a, b) => b.lastTouched - a.lastTouched);
}

async function looksLikeProject(dir) {
  for (const marker of ['.git', 'package.json']) {
    try {
      await fs.stat(path.join(dir, marker));
      return true;
    } catch {}
  }
  return false;
}

// ---------------------------------------------------------------- one project

async function scanProject(dir, root, ignoreSet) {
  const st = await fs.stat(dir);
  const now = Date.now();
  let top = [];
  try {
    top = await fs.readdir(dir, { withFileTypes: true });
  } catch {}
  const topFiles = top.filter((e) => e.isFile()).map((e) => e.name);
  const topLower = new Set(top.map((e) => e.name.toLowerCase()));

  const [tree, git, pkg, brand] = await Promise.all([
    walk(dir, ignoreSet, now),
    readGit(dir),
    readJson(path.join(dir, 'package.json')),
    readBrand(dir),
  ]);

  // markdown worth reading: README first, then todo/notes/plan files
  const docs = topFiles
    .filter((n) => /\.(md|markdown|txt)$/i.test(n))
    .sort((a, b) => docRank(a) - docRank(b))
    .slice(0, 6);
  const texts = await Promise.all(docs.map(async (name) => ({ name, text: await readSmall(path.join(dir, name)) })));
  const readmeText = texts.find((t) => /^readme\./i.test(t.name))?.text;
  const readme = parseReadme(readmeText);
  const todos = parseTodos(texts.filter((t) => t.text));

  const folder = path.basename(dir);
  const stack = detectStack(pkg, topLower, tree.exts);
  const deploy = detectDeploy(topLower);
  const bio = readme.bio || (pkg?.description ? clean(pkg.description) : null);
  const title = readme.title || null;
  const url = typeof pkg?.homepage === 'string' && /^https?:\/\//.test(pkg.homepage) ? pkg.homepage : null;

  // copying or cloning a folder resets its creation date but not the file
  // dates, so "last touched" comes from files and commits only, and a
  // folder can't be born after it was last touched
  const birth = st.birthtimeMs > 0 && st.birthtimeMs <= now ? st.birthtimeMs : null;
  const lastCommit = git?.commits[0]?.t || 0;
  const lastTouched = tree.files ? Math.max(tree.latest, lastCommit) : Math.max(lastCommit, Math.min(st.mtimeMs, now));
  const born = Math.min(
    birth ?? (Number.isFinite(tree.earliest) ? tree.earliest : st.mtimeMs),
    git?.first || Infinity,
    lastTouched,
  );

  return {
    id: idFor(dir),
    path: dir,
    root,
    folder,
    title,
    bio,
    kind: detectKind(`${folder} ${title || ''}`, `${bio || ''} ${pkg?.name || ''} ${Object.keys(pkg?.deps || {}).join(' ')}`),
    stack,
    deploy,
    url,
    born: Math.round(born),
    lastTouched: Math.round(lastTouched),
    files: tree.files,
    truncated: tree.truncated,
    hasReadme: !!readmeText,
    hasPackage: !!pkg,
    git,
    todos,
    recent: tree.recent.slice(0, 6),
    brand,
  };
}

// ---------------------------------------------------------------- brand colour + favicon
// A project's own colour (theme-color, web manifest, a --brand/--primary CSS
// variable…) and its favicon, so its person can wear its colours.

const BRAND_DIRS = ['', 'public', 'public/css', 'static', 'src', 'src/styles', 'src/css', 'styles', 'css', 'assets', 'app', 'src/app'];
const ICON_NAMES = ['favicon.svg', 'favicon.png', 'favicon.ico', 'icon.svg', 'icon.png', 'apple-touch-icon.png', 'logo.svg', 'logo.png'];
const ICON_TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const COLOR_PATTERNS = [
  /<meta[^>]+name=["']theme-color["'][^>]*content=["'](#[0-9a-f]{3,8})["']/i,
  /"theme_color"\s*:\s*"(#[0-9a-f]{3,8})"/i,
  /themeColor\s*:\s*['"](#[0-9a-f]{3,8})['"]/i,
  /--(?:brand|primary|accent|main|theme|pink)[\w-]*\s*:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/i,
];

async function readBrand(dir) {
  let color = null;
  let favicon = null;
  for (const sub of BRAND_DIRS) {
    const base = path.join(dir, sub);
    let names;
    try {
      names = await fs.readdir(base);
    } catch {
      continue;
    }
    if (!favicon) {
      for (const n of ICON_NAMES) {
        const hit = names.find((x) => x.toLowerCase() === n);
        if (!hit) continue;
        try {
          const buf = await fs.readFile(path.join(base, hit));
          if (buf.length && buf.length <= 48 * 1024) {
            favicon = `data:${ICON_TYPES[path.extname(hit).toLowerCase()]};base64,${buf.toString('base64')}`;
            break;
          }
        } catch {}
      }
    }
    if (!color) {
      const files = names.filter((n) => /\.(html|webmanifest|json|css|astro|tsx|jsx)$/i.test(n) && !/lock|package/i.test(n)).slice(0, 12);
      for (const n of files) {
        const text = await readSmall(path.join(base, n), 120 * 1024);
        if (!text) continue;
        for (const re of COLOR_PATTERNS) {
          const m = text.match(re);
          if (m && usableColor(m[1])) {
            color = normHex(m[1]);
            break;
          }
        }
        if (color) break;
      }
    }
    if (color && favicon) break;
  }
  return color || favicon ? { color, favicon } : null;
}

function normHex(h) {
  let s = h.slice(1).toLowerCase();
  if (s.length === 3 || s.length === 4) s = [...s.slice(0, 3)].map((c) => c + c).join('');
  return `#${s.slice(0, 6)}`;
}

// near-white and near-black colours make poor outfits
function usableColor(h) {
  const s = normHex(h);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l > 0.08 && l < 0.93;
}

function docRank(name) {
  const n = name.toLowerCase();
  if (n.startsWith('readme')) return 0;
  if (/^(todo|tasks|checklist)/.test(n)) return 1;
  if (/^(plan|roadmap|notes|ideas|research)/.test(n)) return 2;
  return 3;
}

async function walk(dir, ignoreSet, now) {
  const out = { files: 0, latest: 0, earliest: Infinity, recent: [], exts: new Map(), truncated: false };
  const stack = [[dir, 0]];
  while (stack.length) {
    const [cur, depth] = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    const names = [];
    for (const e of entries) {
      const lower = e.name.toLowerCase();
      if (e.isDirectory()) {
        if (lower.startsWith('.') || SKIP_DIRS.has(lower) || depth >= MAX_DEPTH) continue;
        const full = path.join(cur, e.name);
        if (!ignoreSet.has(norm(full))) stack.push([full, depth + 1]);
      } else if (e.isFile() && !NOISE_FILES.has(lower)) {
        names.push(e.name);
      }
    }
    const stats = await Promise.all(
      names.map((n) => fs.stat(path.join(cur, n)).then((s) => [n, s], () => null)),
    );
    for (const item of stats) {
      if (!item) continue;
      const [name, s] = item;
      const t = Math.min(s.mtimeMs, now); // ignore clock-skewed future dates
      out.files++;
      if (t > out.latest) out.latest = t;
      if (t < out.earliest) out.earliest = t;
      const ext = path.extname(name).toLowerCase();
      out.exts.set(ext, (out.exts.get(ext) || 0) + 1);
      if (!name.startsWith('.') && !LOCK_FILES.has(name.toLowerCase()) && !MEDIA.test(ext)) {
        const rel = path.relative(dir, path.join(cur, name)).split(path.sep).join('/');
        pushRecent(out.recent, { rel, t: Math.round(t) });
      }
      if (out.files >= MAX_FILES) {
        out.truncated = true;
        return out;
      }
    }
  }
  return out;
}

function pushRecent(list, item, max = 8) {
  if (list.length >= max && item.t <= list[list.length - 1].t) return;
  list.push(item);
  list.sort((a, b) => b.t - a.t);
  if (list.length > max) list.pop();
}

// ---------------------------------------------------------------- git (files only)

async function readGit(dir) {
  let gitDir = path.join(dir, '.git');
  let st;
  try {
    st = await fs.stat(gitDir);
  } catch {
    return null;
  }
  if (st.isFile()) {
    // worktrees and submodules point at the real git dir
    const m = (await readSmall(gitDir, 4096))?.match(/gitdir:\s*(.+)/);
    if (!m) return null;
    gitDir = path.resolve(dir, m[1].trim());
  }
  const head = ((await readSmall(path.join(gitDir, 'HEAD'), 4096)) || '').trim();
  const branch = head.startsWith('ref:') ? head.replace(/^ref:\s*refs\/heads\//, '') : head.slice(0, 7) || null;
  const remote = webUrl(parseOrigin((await readSmall(path.join(gitDir, 'config'), 64 * 1024)) || ''));

  // the reflog has every commit made in this copy, with its time and message
  const log = await readTail(path.join(gitDir, 'logs', 'HEAD'), 256 * 1024);
  const commits = [];
  let count = 0;
  let first = null;
  for (const line of (log?.text || '').split('\n')) {
    const m = line.match(/^[0-9a-f]{40,64} [0-9a-f]{40,64} .*? (\d{9,11}) [+-]\d{4}\t(.*)$/);
    if (!m) continue;
    const t = Number(m[1]) * 1000;
    const c = m[2].match(/^commit(?: \((?:initial|amend|merge)\))?: (.*)/);
    if (!c) continue;
    count++;
    if (first === null || t < first) first = t;
    commits.push({ t, msg: c[1].trim().slice(0, 120) });
  }
  commits.sort((a, b) => b.t - a.t);
  return {
    branch,
    remote,
    commits: commits.slice(0, 8),
    count,
    partial: !!log?.truncated,
    first: log && !log.truncated ? first : null,
  };
}

function parseOrigin(config) {
  const section = config.split(/^\[/m).find((s) => /^remote\s+"origin"\]/.test(s));
  return section?.match(/^\s*url\s*=\s*(.+)$/m)?.[1].trim() || null;
}

function webUrl(remote) {
  if (!remote) return null;
  let m = remote.match(/^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/?$/); // git@github.com:me/repo.git
  if (m) return `https://${m[1]}/${m[2]}`;
  m = remote.match(/^(?:ssh|git):\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/);
  if (m) return `https://${m[1]}/${m[2]}`;
  m = remote.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/); // drops any saved credentials
  if (m) return `https://${m[1]}/${m[2]}`;
  return null;
}

// ---------------------------------------------------------------- markdown

function parseReadme(md) {
  if (!md) return {};
  const lines = md.replace(/^﻿/, '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  let title = null;
  const para = [];
  let inCode = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inCode = !inCode;
      if (para.length) break;
      continue;
    }
    if (inCode) continue;
    if (!title && !para.length) {
      const h = line.match(/^#\s+(.+)/);
      if (h) {
        title = clean(h[1]).slice(0, 60) || null;
        continue;
      }
    }
    const quote = line.match(/^>\s?(.*)/);
    const text = quote ? quote[1].trim() : line;
    const skip =
      !text ||
      /^#{1,6}\s/.test(text) ||
      /^(!\[|\[!\[|<|---|===|\|)/.test(text) ||
      /^([-*+]|\d+\.)\s/.test(text);
    if (skip) {
      if (para.length) break;
      continue;
    }
    para.push(text);
  }
  let bio = clean(para.join(' ')) || null;
  if (bio && bio.length > 240) bio = `${bio.slice(0, 237).replace(/\s+\S*$/, '')}…`;
  return { title, bio };
}

function parseTodos(texts) {
  const open = [];
  let openCount = 0;
  let done = 0;
  for (const { name, text } of texts) {
    let inCode = false;
    for (const raw of text.split(/\r?\n/)) {
      if (raw.trim().startsWith('```')) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      const m = raw.match(/^\s*(?:[-*+]|\d+\.)\s+\[( |x|X)\]\s+(.+)/);
      if (!m) continue;
      if (m[1] === ' ') {
        openCount++;
        if (open.length < 10) open.push({ text: clean(m[2]).slice(0, 140), file: name });
      } else {
        done++;
      }
    }
  }
  return { open, openCount, done };
}

function clean(s) {
  return String(s)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_](\S.*?\S|\S)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- guessing

const STACK_DEPS = [
  ['astro', 'Astro'], ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['@sveltejs/kit', 'SvelteKit'],
  ['svelte', 'Svelte'], ['vue', 'Vue'], ['solid-js', 'Solid'], ['react', 'React'],
  ['@react-three/fiber', 'R3F'], ['three', 'three.js'], ['electron', 'Electron'],
  ['@tauri-apps/api', 'Tauri'], ['express', 'Express'], ['hono', 'Hono'], ['wrangler', 'Cloudflare'],
  ['phaser', 'Phaser'], ['p5', 'p5.js'], ['gsap', 'GSAP'], ['tailwindcss', 'Tailwind'], ['vite', 'Vite'],
];
const STACK_FILES = [
  ['cargo.toml', 'Rust'], ['go.mod', 'Go'], ['pyproject.toml', 'Python'], ['requirements.txt', 'Python'],
  ['pubspec.yaml', 'Flutter'], ['package.swift', 'Swift'], ['gemfile', 'Ruby'], ['composer.json', 'PHP'],
];
const STACK_EXTS = [
  ['.py', 'Python'], ['.rs', 'Rust'], ['.go', 'Go'], ['.swift', 'Swift'], ['.kt', 'Kotlin'],
  ['.ts', 'TypeScript'], ['.js', 'JavaScript'], ['.html', 'HTML'],
];

function detectStack(pkg, topLower, exts) {
  const out = [];
  const add = (name) => !out.includes(name) && out.length < 3 && out.push(name);
  if (pkg?.deps) for (const [dep, name] of STACK_DEPS) if (pkg.deps[dep]) add(name);
  for (const [file, name] of STACK_FILES) if (topLower.has(file)) add(name);
  if (!out.length) {
    let best = null;
    for (const [ext, name] of STACK_EXTS) {
      const n = exts.get(ext) || 0;
      if (n && (!best || n > best.n)) best = { n, name };
    }
    if (best) add(best.name);
    else if (pkg) add('Node');
  }
  return out;
}

function detectDeploy(topLower) {
  if (topLower.has('wrangler.toml') || topLower.has('wrangler.json') || topLower.has('wrangler.jsonc')) return 'Cloudflare';
  if (topLower.has('vercel.json') || topLower.has('.vercel')) return 'Vercel';
  if (topLower.has('netlify.toml')) return 'Netlify';
  if (topLower.has('firebase.json')) return 'Firebase';
  if (topLower.has('fly.toml')) return 'Fly.io';
  if (topLower.has('render.yaml')) return 'Render';
  if (topLower.has('cname')) return 'GitHub Pages';
  return null;
}

// first match wins, so the more specific kinds come first
const KINDS = [
  ['party', 'bday birthday party cake celebrate celebration wedding invite invitation'],
  ['mail', 'mail email letter newsletter postcard inbox envelope'],
  ['camera', 'camera photo photobooth booth mirror selfie lens webcam polaroid snapshot'],
  ['music', 'music song audio sound record vinyl playlist spotify beat synth radio cassette mixtape dj'],
  ['game', 'game games arcade level quest puzzle rpg quiz platformer phaser'],
  ['3d', '3d three r3f webgl blender room'],
  ['social', 'instagram insta carousel reel reels tiktok social profile youtube twitter content creator'],
  ['writing', 'journal diary blog write writing notes poem story essay book zine'],
  ['ai', 'ai gpt claude llm agent agents bot chatbot openai anthropic'],
  ['art', 'draw drawing doodle doodles sticker stickers paint art design pixel icon icons illustration collage scrapbook tin'],
];
const KIND_WORDS = KINDS.map(([kind, words]) => [kind, new Set(words.split(' '))]);

// the folder name and title count three times as much as the README text
function detectKind(strong, weak) {
  const scores = new Map();
  const score = (text, weight) => {
    for (const raw of String(text).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)) {
      if (!raw) continue;
      const forms = raw.length > 3 && raw.endsWith('s') ? [raw, raw.slice(0, -1)] : [raw];
      for (const [kind, words] of KIND_WORDS) {
        if (forms.some((f) => words.has(f))) scores.set(kind, (scores.get(kind) || 0) + weight);
      }
    }
  };
  score(strong, 3);
  score(weak, 1);
  let best = null;
  for (const [kind] of KIND_WORDS) if ((scores.get(kind) || 0) > (scores.get(best) || 0)) best = kind;
  return best;
}

// ---------------------------------------------------------------- folder suggestions

export async function suggestRoots(appDir) {
  const home = os.homedir();
  const cands = [path.dirname(appDir)];
  for (const rel of [
    'projects', 'Projects', 'code', 'Code', 'dev', 'Developer', 'repos', 'src', 'Sites', 'GitHub',
    'Documents/GitHub', 'Documents/Projects', 'Documents/code', 'source/repos', 'Desktop/projects',
  ]) cands.push(path.join(home, rel));
  if (process.platform === 'win32') {
    for (const drive of ['C', 'D', 'E']) for (const n of ['projects', 'code', 'dev', 'repos', 'GitHub']) cands.push(`${drive}:\\${n}`);
  }
  const seen = new Set();
  const out = [];
  for (const dir of cands) {
    const key = norm(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!(await isDir(dir))) continue;
    let count = 0;
    try {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name.toLowerCase())) count++;
      }
    } catch {
      continue;
    }
    if (count) out.push({ path: path.resolve(dir), count });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 6);
}

// ---------------------------------------------------------------- helpers

export async function isDir(p) {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function readSmall(file, max = 256 * 1024) {
  try {
    const s = await fs.stat(file);
    if (!s.isFile() || s.size > max) return null;
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function readTail(file, max) {
  let fh;
  try {
    const s = await fs.stat(file);
    if (s.size <= max) return { text: await fs.readFile(file, 'utf8'), truncated: false };
    fh = await fs.open(file, 'r');
    const buf = Buffer.alloc(max);
    await fh.read(buf, 0, max, s.size - max);
    const text = buf.toString('utf8');
    return { text: text.slice(text.indexOf('\n') + 1), truncated: true };
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

async function readJson(file) {
  const text = await readSmall(file, 512 * 1024);
  if (!text) return null;
  try {
    const j = JSON.parse(text);
    return {
      name: typeof j.name === 'string' ? j.name : null,
      description: typeof j.description === 'string' ? j.description : null,
      homepage: j.homepage,
      deps: { ...(j.dependencies || {}), ...(j.devDependencies || {}) },
    };
  } catch {
    return null;
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const n = i++;
      out[n] = await fn(items[n]);
    }
  });
  await Promise.all(workers);
  return out;
}

export { DAY };
