// Boots brainchildren: loads the parts and your projects, builds the studio
// and the dashboard, and keeps everything in sync with the little server.
import { api } from './api.js';
import { loadParts } from './creature.js';
import { buildModel, clock, plural, esc } from './life.js';
import { Studio } from './studio.js';
import { refreshAll, balloon } from './wm.js';
import { icons } from './icons.js';
import { createApps } from './apps.js';
import { createDashboard } from './dashboard.js';
import { thumbHtml, setLookStyle } from './look.js';
import { startTour, tourDone } from './tour.js';
import { extendApps } from './apps-more.js';
import { extendAI } from './apps-ai.js';
import { openPalette } from './palette.js';
import { undoLast } from './undo.js';
import { restore as restoreFocus, show as showFocus } from './focus.js';
import { setAmbience, ambience, nextSong } from './audio.js';
import { api as apiCall, usePractice } from './api.js';
import { demoState, createDemoServer } from './demo.js';
import { startSimulation } from './simulate.js';
import { closeAll } from './wm.js';
import { openMenu } from './menu.js';

const $ = (id) => document.getElementById(id);
const app = { state: null, model: null, view: 'studio' };
const byKey = (key) => app.model?.byKey.get(key);
app.studio = new Studio($('world'), {
  // a person with a note from past you hands you the letter first
  onOpen: (key, el) => (byKey(key)?.letter ? app.ui.letter(byKey(key), el) : app.ui.props(key, el)),
  onHotspot: (id, el) => hotspot(id, el),
  hotLabel: (id) => hotLabel(id),
  onMenu: (key, x, y) => app.ui.menuFor(byKey(key), x, y),
  onMe: (e) => app.ui.dressUp('me', e?.target),
  onPin: (key, el) => app.ui.props(key, el),
  onWall: (action, id, pos, el) => {
    const item = app.state.wall.find((w) => w.id === id);
    if (!item) return;
    if (action === 'move') return apiCall.patch(`/api/wall/${id}`, pos).then(app.setState, app.oops);
    if (item.kind === 'note') return app.ui.wallNote(el, item);
    app.ui.confirm({ title: 'take this photo down?', text: 'it only lives in brainchildren, so it will be gone.', ok: 'take it down' }).then((yes) => yes && apiCall.del(`/api/wall/${id}`).then(app.setState, app.oops));
  },
});
app.habitat = app.studio;
app.ui = createApps(app);
extendApps(app, app.ui);
extendAI(app, app.ui);
app.studio.meSeed = () => app.ui.meSeed();
app.dash = createDashboard(app);
app.tour = () => startTour(app);
app.walkthrough = (chapter = 0) => startSimulation(app, { chapter });

// ------------------------------------------------------------ the practice studio
// made-up projects that live only in this tab; nothing touches your real data
app.enterPractice = async () => {
  if (!app.practice) app.realSetupDone = !!app.state?.settings.setupDone;
  closeAll();
  clock.offsetDays = 0;
  const st = demoState({ name: app.state?.settings.name || app.state?.user || 'you', version: app.state?.version || '' });
  usePractice(createDemoServer(st));
  app.practice = true;
  document.body.classList.add('practice');
  $('practice-banner').hidden = false;
  app.setState(await apiCall.get('/api/state'));
};
app.exitPractice = async () => {
  if (!app.practice) return;
  closeAll();
  clock.offsetDays = 0;
  usePractice(null);
  app.practice = false;
  document.body.classList.remove('practice');
  $('practice-banner').hidden = true;
  await app.refresh();
  if (app.state && !app.state.settings.setupDone) app.ui.settings(null, { welcome: true });
};
app.afterWalkthrough = () => {
  if (app.practice) balloon({ title: "you're still in the practice studio", text: 'play around as much as you like. "exit practice" at the top takes you back.', timeout: 7000 });
};
app.showMeAround = (el) => {
  const r = (el || $('help')).getBoundingClientRect();
  openMenu(r.left, r.top - 150, [
    { label: '▶ full walkthrough (about 4 minutes)', action: () => app.walkthrough() },
    { label: 'quick tour of this room (30 seconds)', action: () => startTour(app) },
    { label: app.practice ? 'leave the practice studio' : 'play in the practice studio', action: () => (app.practice ? app.exitPractice() : app.enterPractice()) },
  ], { title: 'show me around' });
};
$('practice-banner').addEventListener('click', (e) => {
  const act = e.target.closest('[data-p]')?.dataset.p;
  if (act === 'walk') app.walkthrough();
  if (act === 'exit') app.exitPractice();
});

app.setState = (s) => {
  app.state = s;
  app.remodel();
};
app.remodel = () => {
  if (!app.state) return;
  setLookStyle(app.state.settings.look);
  app.model = buildModel(app.state);
  app.studio.sync(app.model);
  drawTaskbar();
  drawStatus();
  drawHint();
  app.dash.render();
  refreshAll();
  greetGhosts();
};
app.oops = (err) => {
  if (err?.message === 'reloading') return;
  balloon({ title: "hmm, that didn't work", text: err?.message || String(err) });
};
app.run = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    app.oops(err);
  }
};
app.showView = (view) => {
  app.view = view;
  const dash = view === 'dashboard';
  $('dashboard').hidden = !dash;
  $('status').hidden = dash || !app.model?.live.length;
  app.studio.paused = dash;
  $('view-studio').setAttribute('aria-pressed', String(!dash));
  $('view-dash').setAttribute('aria-pressed', String(dash));
  if (dash) {
    app.dash.render();
    $('dashboard').querySelector('.dash-search')?.focus({ preventScroll: true });
  }
};
app.afterSetup = () => setTimeout(() => startTour(app), 900);

let offline = false;
app.refresh = async () => {
  try {
    const s = await api.get('/api/state');
    if (offline) balloon({ title: 'brainchildren is back', timeout: 3000 });
    offline = false;
    app.setState(s);
  } catch (err) {
    if (err instanceof TypeError && !offline) {
      offline = true;
      balloon({ title: 'brainchildren stopped', text: 'start it again with "npm start" in its folder, and this page will catch up.', timeout: 0 });
    }
  }
};
app.rescan = async () => {
  $('tray-scan').hidden = false;
  try {
    const s = await api.post('/api/scan');
    app.setState(s);
    balloon({ title: 'all caught up', text: `looked at ${plural(s.projects.length, 'folder')} in ${s.scanMs} ms.`, timeout: 4000 });
  } catch (err) {
    app.oops(err);
  } finally {
    $('tray-scan').hidden = !app.state?.scanning;
  }
};

// ------------------------------------------------------------ room objects

function hotspot(id, el) {
  const m = app.model;
  if (!m) return;
  if (id.startsWith('desk')) {
    const c = m.desk[Number(id.slice(4))];
    return c ? app.ui.props(c.key, el) : app.ui.pickDesk(el);
  }
  const actions = {
    board: () => app.showView('dashboard'),
    fridge: () => app.ui.freezer(el),
    bin: () => app.ui.bin(el),
    calendar: () => app.ui.timeMachine(el),
    cabinet: () => app.ui.taskmgr(el),
    door: () => app.ui.settings(el),
    nest: () => app.ui.nest(el),
    sofa: () => app.ui.taskmgr(el, 'attention'),
    shelf: () => app.ui.about(el),
    record: () => {
      const next = ambience() === 'radio' ? 'off' : 'radio';
      setAmbience(next);
      apiCall.post('/api/prefs', { ambience: next }).then(app.setState, () => {});
    },
    chair: () => app.ui.dressUp('me', el),
    sign: () => app.ui.settings(el, { tab: 'studio' }),
    trophies: () => {
      const e = app.model.earned;
      balloon({ title: 'things you earned ✿', text: `${plural(e.trophies, 'trophy', 'trophies')} for shipped projects · a plant at stage ${e.plant}/5 (it grows when you revive ghosts) · ${plural(e.books, 'lessons book')} (one per 5 ideas let go)`, timeout: 9000 });
    },
  };
  actions[id]?.();
}

function hotLabel(id) {
  const m = app.model;
  if (!m) return id;
  if (id.startsWith('desk')) {
    const c = m.desk[Number(id.slice(4))];
    return c ? `${c.name} works here · click to open` : 'empty desk · click to pick a project to focus on';
  }
  const eggs = m.live.filter((c) => c.type === 'egg').length;
  const napping = m.live.filter((c) => c.energy === 'asleep').length;
  return {
    board: 'whiteboard · click for your dashboard, right-click to write on it',
    record: ambience() === 'radio' ? 'record player · playing the garden radio (click to stop)' : 'record player · click for soft music',
    chair: 'your chair · where you relax (click to change how you look)',
    sign: `${m.settings.studio?.name || `${m.user}'s studio`} · click to rename or redecorate`,
    trophies: `trophy shelf · ${plural(m.earned.trophies, 'shipped project')}`,
    fridge: `freezer · ${plural(m.freezer.length, 'idea')} kept for later`,
    bin: `recycle bin · ${plural(m.bin.length, 'idea')} let go`,
    calendar: clock.offsetDays ? `time machine · showing ${plural(clock.offsetDays, 'day')} ahead` : 'time machine · peek into the future',
    cabinet: 'task manager · every project in one list',
    door: 'settings · your projects folder and preferences',
    nest: eggs ? `egg nest · ${plural(eggs, 'egg')} waiting · click to see them or lay one` : 'egg nest · click to lay your first egg (or press N)',
    sofa: `nap corner · ${napping} napping (untouched ${m.settings.sleepDays}+ days)`,
    shelf: 'bookshelf · about brainchildren',
    clock: new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase(),
  }[id];
}

// ------------------------------------------------------------ taskbar + status

$('view-studio').innerHTML = `${icons.home}<span>studio</span>`;
$('view-dash').innerHTML = `${icons.taskmgr}<span>dashboard</span>`;
$('view-studio').addEventListener('click', () => app.showView('studio'));
$('view-dash').addEventListener('click', () => app.showView(app.view === 'dashboard' ? 'studio' : 'dashboard'));
$('help').addEventListener('click', (e) => app.showMeAround(e.currentTarget));
$('world').addEventListener('contextmenu', (e) => {
  if (e.target.closest('[data-hot="board"]')) {
    e.preventDefault();
    app.ui.board(e.target);
  }
});
$('focus-pill').addEventListener('click', () => showFocus(app));
$('status').addEventListener('click', () => app.showView('dashboard'));

function drawTaskbar() {
  const m = app.model;
  const slots = [];
  for (let i = 0; i < 3; i++) {
    const c = m.desk[i];
    slots.push(
      c
        ? `<button class="slot" data-key="${c.key}" title="${esc(c.name)}">${thumbHtml(c, 26)}<span>${esc(c.name)}</span></button>`
        : '<button class="slot empty" data-empty="1" title="put a project on the desk to focus on it">+ empty desk</button>',
    );
  }
  const desk = $('desk');
  const html = slots.join('');
  if (desk.dataset.html !== html) {
    desk.innerHTML = html;
    desk.dataset.html = html;
  }
  const ghosts = $('tray-ghosts');
  ghosts.hidden = !m.visits.length;
  ghosts.innerHTML = `${icons.ghost}<span>${m.visits.length}</span>`;
  ghosts.title = `${plural(m.visits.length, 'creature')} want a word`;
  $('tray-scan').hidden = !app.state.scanning;
  $('tray-time').hidden = !clock.offsetDays;
  $('tray-time').textContent = `⌛ +${clock.offsetDays}d`;
  drawClock();
}

$('desk').addEventListener('click', (e) => {
  const slot = e.target.closest('.slot');
  if (!slot) return;
  if (slot.dataset.empty) return app.ui.pickDesk(slot);
  app.studio.spotlight(slot.dataset.key);
  app.ui.props(slot.dataset.key, slot);
});
$('desk').addEventListener('contextmenu', (e) => {
  const slot = e.target.closest('.slot[data-key]');
  if (!slot) return;
  e.preventDefault();
  app.ui.menuFor(byKey(slot.dataset.key), e.clientX, e.clientY);
});
$('tray-ghosts').addEventListener('click', (e) => {
  const c = app.model.visits[0];
  if (c) app.ui.visit(c, e.currentTarget);
});
$('tray-time').addEventListener('click', (e) => app.ui.timeMachine(e.currentTarget));

function drawStatus() {
  const m = app.model;
  const el = $('status');
  const count = (e) => m.live.filter((c) => c.energy === e).length;
  const parts = [
    `${count('lively') + count('awake')} busy`,
    count('bored') && `${count('bored')} bored`,
    count('asleep') && `${count('asleep')} napping`,
    count('ghost') && plural(count('ghost'), 'ghost'),
    plural(m.live.filter((c) => c.type === 'egg').length, 'egg'),
    m.live.some((c) => c.letter) && `✉ ${plural(m.live.filter((c) => c.letter).length, 'note')} from past you`,
  ].filter(Boolean);
  el.innerHTML = `<span>${esc(parts.join(' · '))}</span><b>dashboard →</b>`;
  el.hidden = app.view === 'dashboard' || !m.live.length;
}

function drawClock() {
  const now = new Date(clock.now());
  $('clock').textContent = clock.offsetDays
    ? now.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}
setInterval(drawClock, 15000);

// ------------------------------------------------------------ start menu

const START = [
  ['new idea…', 'egg', (el) => app.ui.run(el)],
  ['find anything…  ctrl+K', 'scan', () => openPalette(app)],
  ['dashboard', 'taskmgr', () => app.showView('dashboard')],
  ['pick for me', 'desk', (el) => app.ui.pickForMe(el)],
  ['sort my eggs', 'egg', (el) => app.ui.sortEggs(el)],
  ['town meeting', 'home', (el) => app.ui.townMeeting(el)],
  ['ask your studio ✨', 'about', (el) => app.ui.ask(el)],
  ['monthly reflection ✨', 'about', (el) => app.ui.reflect(el)],
  null,
  ['task manager', 'taskmgr', (el) => app.ui.taskmgr(el)],
  ['egg nest', 'egg', (el) => app.ui.nest(el)],
  ['recycle bin', 'bin', (el) => app.ui.bin(el)],
  ['freezer', 'freezer', (el) => app.ui.freezer(el)],
  null,
  ['write on the whiteboard', 'taskmgr', (el) => app.ui.board(el)],
  ['decorate the studio', 'home', (el) => app.ui.settings(el, { tab: 'studio' })],
  ['how you look', 'desk', (el) => app.ui.dressUp('me', el)],
  ['show me around…', 'about', (el) => app.showMeAround(el)],
  ['rescan folders', 'scan', () => app.rescan()],
  ['settings', 'settings', (el) => app.ui.settings(el)],
  ['about', 'about', (el) => app.ui.about(el)],
];
const menu = $('startmenu');
const startBtn = $('start');
menu.innerHTML = `<div class="startmenu-band">brainchildren</div><ul>${START.map((item, n) => (item ? `<li><button role="menuitem" data-n="${n}">${icons[item[1]]}${item[0]}</button></li>` : '<li><hr></li>')).join('')}</ul>`;
const setMenu = (open) => {
  menu.hidden = !open;
  startBtn.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('button')?.focus();
};
startBtn.addEventListener('click', () => setMenu(menu.hidden));
menu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-n]');
  if (!b) return;
  setMenu(false);
  START[b.dataset.n][2](startBtn);
});
document.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !menu.contains(e.target) && !startBtn.contains(e.target)) setMenu(false);
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menu.hidden) {
    setMenu(false);
    startBtn.focus();
  }
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    return openPalette(app);
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
    if (undoLast()) e.preventDefault();
    return;
  }
  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'n' || e.key === 'N') && !document.querySelector('.tour')) {
    e.preventDefault();
    app.ui.run();
  }
});

// ------------------------------------------------------------ hints + ghosts

function drawHint() {
  const hint = $('empty-hint');
  const s = app.state;
  const show = s.settings.setupDone && !app.model.live.length;
  hint.hidden = !show;
  if (show) {
    hint.textContent = s.settings.roots.length
      ? s.projects.length
        ? 'everyone is in the freezer or the recycle bin. press N to lay a new egg.'
        : 'no folders found yet. press N to lay your first egg, or check the folder in settings (the door).'
      : 'no projects folder yet. click the door to add one, or press N to lay your first egg.';
  }
}

const greeted = new Set();
function greetGhosts() {
  const fresh = app.model.visits.filter((c) => !greeted.has(c.key));
  if (!fresh.length || !app.state.settings.setupDone || document.querySelector('.tour') || app.simulating) return;
  fresh.forEach((c) => greeted.add(c.key));
  const first = fresh[0];
  balloon({
    title: fresh.length === 1 ? `${first.name} wants a word` : `${fresh.length} projects want a word`,
    text: fresh.length === 1 ? (first.type === 'egg' ? 'this egg is getting cold.' : `nobody has touched it in ${first.days} days.`) : 'some of your projects have been quiet for a long time.',
    timeout: 15000,
    onClick: () => app.ui.visit(first),
  });
}

// ------------------------------------------------------------ boot

async function boot() {
  try {
    await Promise.all([loadParts(), document.fonts?.ready]);
    app.setState(await api.get('/api/state'));
  } catch (err) {
    document.body.insertAdjacentHTML('beforeend', `<p class="noscript">couldn't load brainchildren: ${esc(err.message)}</p>`);
    return;
  }
  restoreFocus(app);
  if (app.state.settings.ambience !== 'off') setAmbience(app.state.settings.ambience);
  if (!app.state.settings.setupDone) app.ui.settings(null, { welcome: true });
  else {
    weeklyMeetingNudge();
    if (!tourDone()) setTimeout(() => startTour(app), 1200);
  }
  if (app.state.scanning) setTimeout(app.refresh, 1500);
  setInterval(app.refresh, 20000);
  addEventListener('focus', app.refresh);
}

// once a week, a gentle "town meeting" invitation inside the app
function weeklyMeetingNudge() {
  let last = 0;
  try {
    last = Number(localStorage.getItem('brainchildren:meeting-nudge')) || 0;
  } catch {}
  if (Date.now() - last < 7 * 86400000 || !app.model.live.length) return;
  try {
    localStorage.setItem('brainchildren:meeting-nudge', String(Date.now()));
  } catch {}
  setTimeout(() => balloon({ title: "it's town meeting time ✿", text: 'everyone gathers at the whiteboard for a quick look at your week.', timeout: 20000, onClick: () => app.ui.townMeeting() }), 4000);
}

boot();

// handy when poking around in the console
window.brainchildren = app;
