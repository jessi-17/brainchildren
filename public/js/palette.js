// Ctrl+K: find anyone (they get spotlighted in the room) or run any command.
import { esc, STAGES, ENERGY } from './life.js';
import { thumbHtml } from './look.js';

let root = null;

export function openPalette(app) {
  if (root) return root.querySelector('input').focus();
  root = document.createElement('div');
  root.className = 'palette-wrap';
  root.innerHTML = `
    <div class="palette win active" role="dialog" aria-label="find anything">
      <input class="input" placeholder="find a project or idea, or type a command…" aria-label="search" autocomplete="off">
      <ul class="palette-list" role="listbox"></ul>
      <p class="palette-foot">↑↓ to move · enter to open · esc to close</p>
    </div>`;
  document.body.append(root);
  const input = root.querySelector('input');
  const list = root.querySelector('.palette-list');
  let sel = 0;
  let results = [];

  const commands = () => [
    { label: 'new idea', hint: 'N', run: () => app.ui.run() },
    { label: 'sort my eggs', run: () => app.ui.sortEggs() },
    { label: 'open the dashboard', run: () => app.showView('dashboard') },
    { label: 'back to the studio', run: () => app.showView('studio') },
    { label: 'task manager', run: () => app.ui.taskmgr() },
    { label: 'egg nest', run: () => app.ui.nest() },
    { label: 'recycle bin', run: () => app.ui.bin() },
    { label: 'freezer', run: () => app.ui.freezer() },
    { label: 'time machine', run: () => app.ui.timeMachine() },
    { label: 'write on the whiteboard', run: () => app.ui.board() },
    { label: 'add a sticky note to the wall', run: () => app.ui.wallNote() },
    { label: 'pin a photo to the wall', run: () => app.ui.wallPhoto() },
    { label: 'decorate the studio', run: () => app.ui.settings(null, { tab: 'studio' }) },
    { label: 'change how you look', run: () => app.ui.dressUp('me') },
    { label: 'pick for me', run: () => app.ui.pickForMe() },
    { label: 'town meeting', run: () => app.ui.townMeeting() },
    { label: 'ask your studio', run: () => app.ui.ask() },
    { label: 'refresh chatter (AI)', run: () => app.ui.refreshChatter() },
    { label: 'monthly reflection (AI)', run: () => app.ui.reflect() },
    { label: 'show me around', run: () => app.tour() },
    { label: 'rescan folders', run: () => app.rescan() },
    { label: 'settings', run: () => app.ui.settings() },
  ];

  function search() {
    const q = input.value.trim().toLowerCase();
    const people = app.model.creatures
      .filter((c) => !c.gone)
      .map((c) => ({ c, hay: `${c.name} ${c.p?.folder || ''} ${c.p?.stack?.join(' ') || ''} ${c.idea?.note || ''}`.toLowerCase() }))
      .filter((x) => !q || x.hay.includes(q))
      .sort((a, b) => (a.hay.startsWith(q) ? 0 : 1) - (b.hay.startsWith(q) ? 0 : 1) || b.c.lastActive - a.c.lastActive)
      .slice(0, q ? 8 : 6)
      .map(({ c }) => ({ kind: 'person', c }));
    const cmds = commands()
      .filter((x) => !q || x.label.includes(q))
      .slice(0, q ? 6 : 4)
      .map((x) => ({ kind: 'cmd', ...x }));
    results = [...people, ...cmds];
    sel = Math.min(sel, Math.max(0, results.length - 1));
    list.innerHTML = results
      .map((r, i) =>
        r.kind === 'person'
          ? `<li role="option" data-i="${i}" aria-selected="${i === sel}">${thumbHtml(r.c, 24)}<span class="grow">${esc(r.c.name)}</span><span class="muted">${r.c.ignored ? 'hidden' : r.c.letGo ? 'in the bin' : r.c.frozen ? 'frozen' : `${STAGES[r.c.stage].label} · ${ENERGY[r.c.energy].label}`}</span></li>`
          : `<li role="option" data-i="${i}" aria-selected="${i === sel}"><span class="palette-cmd">›</span><span class="grow">${esc(r.label)}</span>${r.hint ? `<kbd>${r.hint}</kbd>` : ''}</li>`,
      )
      .join('') || '<li class="muted">nothing found</li>';
  }

  function pick(i) {
    const r = results[i];
    if (!r) return;
    close();
    if (r.kind === 'cmd') return r.run();
    app.showView('studio');
    app.studio.spotlight(r.c.key);
    app.ui.props(r.c.key);
  }
  function close() {
    root?.remove();
    root = null;
  }

  input.addEventListener('input', () => {
    sel = 0;
    search();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') sel = Math.min(results.length - 1, sel + 1);
    else if (e.key === 'ArrowUp') sel = Math.max(0, sel - 1);
    else if (e.key === 'Enter') return pick(sel);
    else if (e.key === 'Escape') return close();
    else return;
    e.preventDefault();
    search();
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) pick(Number(li.dataset.i));
  });
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) close();
  });
  search();
  input.focus();
}
