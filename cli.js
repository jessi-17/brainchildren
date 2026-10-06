#!/usr/bin/env node
// brainchildren from the terminal:
//   brainchildren add "a playlist that matches the weather" [--note "rainy = lofi"]
//   brainchildren status
//   brainchildren open
// "add" works even when the app isn't running: the idea waits in a small
// inbox file and hatches into an egg the next time brainchildren starts.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const DATA_DIR = path.resolve(process.env.BC_DATA_DIR || flag('--data') || path.join(APP_DIR, 'data'));
const DAY = 86400000;
const say = (s = '') => console.log(s);

const commands = { add, status, open, start, help };
const [cmd = 'help', ...rest] = args;
(commands[cmd] || unknown)(rest).catch((err) => {
  console.error(`  hmm: ${err.message}`);
  process.exit(1);
});

async function add(rest) {
  const words = [...rest];
  let note = '';
  const at = words.findIndex((w) => w === '--note' || w === '-n');
  if (at >= 0) note = words.splice(at, 2)[1] || '';
  const title = words.join(' ').trim();
  if (!title) return say('  usage: brainchildren add "your idea" [--note "more words"]');
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.appendFile(path.join(DATA_DIR, 'inbox.jsonl'), `${JSON.stringify({ title: title.slice(0, 80), note: note.slice(0, 4000), t: Date.now() })}\n`);
  const up = await running();
  say(`  🥚 laid an egg: "${title}"`);
  say(up ? '  it’s already in your studio.' : '  it will appear in your studio the next time brainchildren starts.');
}

async function status() {
  let db;
  try {
    db = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'brainchildren.json'), 'utf8'));
  } catch {
    return say('  no studio yet. run "npm start" in the brainchildren folder first.');
  }
  const now = Date.now();
  const s = db.settings || {};
  const meta = db.meta || {};
  const live = (db.cache?.projects || []).filter((p) => !meta[p.id]?.letGo && !meta[p.id]?.frozen && !meta[p.id]?.ignored);
  const days = (p) => Math.floor((now - Math.max(p.lastTouched, meta[p.id]?.lastFocus || 0)) / DAY);
  const name = (p) => meta[p.id]?.nickname || p.title || p.folder;
  const desk = live.filter((p) => meta[p.id]?.onDesk);
  const ghosts = live.filter((p) => days(p) >= (s.ghostDays || 30));
  const napping = live.filter((p) => days(p) >= (s.sleepDays || 14) && days(p) < (s.ghostDays || 30));
  const eggs = (db.ideas || []).filter((i) => !i.projectId && !i.letGo && !i.frozen);
  say(`\n  ✿ ${s.studio?.name || 'your studio'}${(await running()) ? '' : ' (not running)'}\n`);
  say('  on the desk');
  if (!desk.length) say('    (empty)');
  for (const p of desk) say(`    ★ ${name(p)}${p.todos?.open?.[0] ? `  → ${p.todos.open[0].text}` : ''}`);
  say(`\n  ${live.length} projects · ${napping.length} napping · ${ghosts.length} ghost${ghosts.length === 1 ? '' : 's'} · ${eggs.length} egg${eggs.length === 1 ? '' : 's'}`);
  for (const p of ghosts.slice(0, 5)) say(`    ◌ ${name(p)} (${days(p)} days)`);
  say('');
}

async function open() {
  const up = await running();
  if (up) return openUrl(`http://127.0.0.1:${up.port}`);
  return start([], true);
}

async function start(rest, quietOpen = false) {
  const child = spawn(process.execPath, [path.join(APP_DIR, 'server.js'), ...(DATA_DIR !== path.join(APP_DIR, 'data') ? ['--data', DATA_DIR] : [])], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  say(quietOpen ? '  starting brainchildren… your browser will open in a moment.' : '  brainchildren is starting in the background.');
}

async function help() {
  say(`
  brainchildren · your project ideas, living in a tiny pixel studio

    brainchildren add "idea" [--note "…"]   lay an egg (works even when the app is closed)
    brainchildren status                    what's on the desk, napping and fading
    brainchildren open                      open the studio (starts it if needed)
    brainchildren start                     start it in the background

  install the command once with "npm link" in the brainchildren folder,
  or run it as "node cli.js add …".
`);
}

async function unknown() {
  say(`  i don't know "${cmd}".`);
  await help();
}

async function running() {
  try {
    const lock = JSON.parse(await fs.readFile(path.join(DATA_DIR, '.lock'), 'utf8'));
    const res = await fetch(`http://127.0.0.1:${lock.port}/__brainchildren`, { signal: AbortSignal.timeout(1200) });
    return (await res.json()).app === 'brainchildren' ? lock : null;
  } catch {
    return null;
  }
}

function openUrl(url) {
  const [c, a] = process.platform === 'win32' ? ['explorer.exe', [url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(c, a, { windowsHide: true }, () => {});
  say(`  ✿ opening ${url}`);
}
