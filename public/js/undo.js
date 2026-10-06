// "let go · undo": every change you might regret gets a little toast with
// an undo button, and Ctrl+Z undoes the most recent one for 30 seconds.
import { esc } from './life.js';

const stack = [];
const host = () => document.getElementById('toasts');

export function undoable(text, undo) {
  const entry = { text, undo, t: Date.now(), done: false };
  stack.push(entry);
  if (stack.length > 20) stack.shift();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(text)}</span><button class="link" data-undo>undo</button>`;
  host().append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const remove = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  };
  el.querySelector('[data-undo]').addEventListener('click', () => {
    run(entry);
    remove();
  });
  entry.remove = remove;
  setTimeout(remove, 8000);
  while (host().children.length > 3) host().firstElementChild.remove();
}

async function run(entry) {
  if (entry.done) return;
  entry.done = true;
  try {
    await entry.undo();
  } catch (err) {
    console.warn('undo failed', err);
  }
}

export function undoLast() {
  for (let i = stack.length - 1; i >= 0; i--) {
    const e = stack[i];
    if (e.done) continue;
    if (Date.now() - e.t > 30000) return false;
    e.remove?.();
    run(e);
    return true;
  }
  return false;
}
