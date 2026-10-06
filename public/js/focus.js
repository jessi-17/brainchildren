// Resume + focus: one click opens the project in your editor, shows the next
// step and your last note, and starts a timer while its person types along.
import { api } from './api.js';
import { openWindow, balloon, closeWindow } from './wm.js';
import { esc, ago, short } from './life.js';
import { icons } from './icons.js';
import { chime } from './audio.js';

const KEY = 'brainchildren:focus';
let session = null;
let ticker = null;

const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
};
const save = (s) => {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {}
};

export const focusOn = () => session;

export function editorUrl(app, p) {
  const scheme = { vscode: 'vscode', cursor: 'cursor', windsurf: 'windsurf', vscodium: 'vscodium' }[app.model.settings.editor] || 'vscode';
  return `${scheme}://file/${encodeURI(p.replace(/\\/g, '/').replace(/^\/+/, ''))}`;
}

export function openInEditor(app, c) {
  if (app.practice) return balloon({ title: 'in your real studio, this opens the project in your editor', timeout: 3500 });
  const a = document.createElement('a');
  a.href = editorUrl(app, c.p.path);
  a.rel = 'noreferrer';
  document.body.append(a);
  a.click();
  a.remove();
}

export async function resume(app, c, { editor = true } = {}) {
  if (c.type !== 'project' || c.gone) return;
  if (session && session.key !== c.key) await stop(app, { quiet: true });
  if (editor) openInEditor(app, c);
  if (!session) {
    session = { key: c.key, id: c.id, name: c.name, start: Date.now(), minutes: app.model.settings.focusMinutes || 25 };
    save(session);
    await api.patch(`/api/projects/${c.id}`, { focus: 'start' }).then(app.setState, () => {});
  }
  app.studio.hop(c.key, "let's go ✿");
  show(app);
  tick(app);
}

// after a reload, pick the timer up where it was
export function restore(app) {
  const s = load();
  if (!s || !app.model.byKey.get(s.key)) return save(null);
  if (Date.now() - s.start > (s.minutes + 120) * 60000) return save(null);
  session = s;
  tick(app);
}

function remaining() {
  return session ? session.start + session.minutes * 60000 - Date.now() : 0;
}

function tick(app) {
  clearInterval(ticker);
  const pill = document.getElementById('focus-pill');
  const step = () => {
    if (!session) {
      pill.hidden = true;
      return clearInterval(ticker);
    }
    const left = remaining();
    const mm = Math.max(0, Math.floor(left / 60000));
    const ss = Math.max(0, Math.floor((left % 60000) / 1000));
    const text = left > 0 ? `${mm}:${String(ss).padStart(2, '0')}` : 'done!';
    pill.hidden = false;
    pill.textContent = `◷ ${short(session.name, 16)} · ${text}`;
    const win = document.querySelector('.focus-time');
    if (win) win.textContent = text;
    const bar = document.querySelector('.focus-bar i');
    if (bar) bar.style.width = `${Math.min(100, 100 - (left / (session.minutes * 60000)) * 100)}%`;
    if (left <= 0 && !session.rang) {
      session.rang = true;
      save(session);
      chime();
      balloon({ title: `time's up for ${session.name} ✿`, text: 'nice work. leave a note for future you?', timeout: 0, onClick: () => finish(app) });
    }
  };
  step();
  ticker = setInterval(step, 1000);
}

export function show(app) {
  if (!session) return;
  const c = app.model.byKey.get(session.key);
  if (!c) return;
  const next = c.p.todos?.open?.[0]?.text;
  openWindow({
    key: 'focus',
    title: `Focus · ${c.name}`,
    icon: icons.desk,
    width: 400,
    render(w) {
      w.body.innerHTML = `
        <p class="focus-time" aria-live="polite"></p>
        <div class="meter focus-bar"><i></i></div>
        ${c.note ? `<div class="next"><b>your last note</b> <span class="muted">(${ago(c.note.t)})</span><br>${esc(c.note.text)}</div>` : ''}
        <p class="next">${next ? `next: <b>${esc(next)}</b>` : 'no checklist yet. tip: a TODO.md with "- [ ]" lines shows the next step here.'}</p>
        <div class="row end" style="margin-top:12px">
          <button class="btn small" data-f="more">+5 min</button>
          <button class="btn small" data-f="editor">open in editor</button>
          <button class="btn small" data-f="cancel">cancel</button>
          <button class="btn primary" data-f="done">done</button>
        </div>`;
      w.body.addEventListener('click', (e) => {
        const act = e.target.closest('[data-f]')?.dataset.f;
        if (act === 'more' && session) {
          session.minutes += 5;
          session.rang = false;
          save(session);
        }
        if (act === 'editor') openInEditor(app, c);
        if (act === 'cancel') stop(app, { cancel: true });
        if (act === 'done') finish(app);
      });
    },
  });
  tick(app);
}

// finishing asks for a note for future you, then records the session
export async function finish(app) {
  if (!session) return;
  const c = app.model.byKey.get(session.key);
  await stop(app);
  if (c) app.ui.leaveNote(c, null, { after: 'focus' });
}

export async function stop(app, { cancel = false, quiet = false } = {}) {
  if (!session) return;
  const s = session;
  session = null;
  save(null);
  closeWindow('focus');
  clearInterval(ticker);
  document.getElementById('focus-pill').hidden = true;
  try {
    app.setState(await api.patch(`/api/projects/${s.id}`, { focus: cancel ? 'cancel' : 'end' }));
  } catch {}
  if (!quiet && !cancel) balloon({ title: `${Math.max(1, Math.round((Date.now() - s.start) / 60000))} focused minutes on ${s.name}`, timeout: 4000 });
}
