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

const $ = (id) => document.getElementById(id);
const app = { state: null, model: null, view: 'studio' };
app.studio = new Studio($('world'), {
  onOpen: (key, el) => app.ui.props(key, el),
  onHotspot: (id, el) => hotspot(id, el),
  hotLabel: (id) => hotLabel(id),
});
app.habitat = app.studio;
app.ui = createApps(app);
app.dash = createDashboard(app);

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
    board: 'whiteboard · your dashboard: charts, lists, what needs attention',
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
$('help').addEventListener('click', () => startTour(app));
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
  ['dashboard', 'taskmgr', () => app.showView('dashboard')],
  ['task manager', 'taskmgr', (el) => app.ui.taskmgr(el)],
  ['egg nest', 'egg', (el) => app.ui.nest(el)],
  ['recycle bin', 'bin', (el) => app.ui.bin(el)],
  ['freezer', 'freezer', (el) => app.ui.freezer(el)],
  null,
  ['show me around', 'about', () => startTour(app)],
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
  if (!fresh.length || !app.state.settings.setupDone || document.querySelector('.tour')) return;
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
  if (!app.state.settings.setupDone) app.ui.settings(null, { welcome: true });
  else if (!tourDone()) setTimeout(() => startTour(app), 1200);
  if (app.state.scanning) setTimeout(app.refresh, 1500);
  setInterval(app.refresh, 20000);
  addEventListener('focus', app.refresh);
}

boot();

// handy when poking around in the console
window.brainchildren = app;
