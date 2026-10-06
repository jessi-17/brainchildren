// A tiny window manager: pop-up windows you can drag, plus tray balloons.
import { esc } from './life.js';

const layer = document.getElementById('windows');
const balloons = document.getElementById('balloons');
const open = new Map();
let z = 10;
let cascade = 0;

export function openWindow({ key, title, icon = '', width = 420, className = '', from, render, onClose }) {
  if (key && open.has(key)) {
    const existing = open.get(key);
    existing.focus();
    return existing;
  }
  const el = document.createElement('section');
  el.className = `win ${className}`;
  el.setAttribute('role', 'dialog');
  el.innerHTML = `<header class="win-title"><span class="win-icon">${icon}</span><span class="win-name"></span><button class="win-close" aria-label="close">×</button></header><div class="win-body"></div>`;
  el.style.width = `${Math.min(width, innerWidth - 16)}px`;
  layer.append(el);

  const w = {
    key,
    el,
    body: el.querySelector('.win-body'),
    refresh: null,
    setTitle(t) {
      el.querySelector('.win-name').textContent = t;
      el.setAttribute('aria-label', t);
    },
    focus() {
      for (const other of open.values()) other.el.classList.remove('active');
      el.classList.add('active');
      el.style.zIndex = ++z;
    },
    close() {
      if (w.closed) return;
      w.closed = true;
      open.delete(key);
      w.cleanup?.();
      onClose?.();
      el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 140, easing: 'ease-in' }).onfinish = () => el.remove();
      const next = [...open.values()].pop();
      next?.focus();
    },
  };
  w.setTitle(title);
  open.set(key, w);
  render(w);

  // place it: a gentle cascade around the middle of the screen
  const rect = el.getBoundingClientRect();
  const maxTop = innerHeight - 52 - rect.height;
  const left = Math.max(8, (innerWidth - rect.width) / 2 + (cascade % 5) * 26 - 52);
  const top = Math.max(8, Math.min(maxTop, (innerHeight - 44 - rect.height) / 2 + (cascade % 5) * 22 - 44));
  cascade++;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  // grow out of whatever was clicked
  const origin = from?.getBoundingClientRect?.();
  if (origin) el.style.transformOrigin = `${origin.left + origin.width / 2 - left}px ${origin.top + origin.height / 2 - top}px`;
  el.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });

  el.addEventListener('pointerdown', () => w.focus());
  el.querySelector('.win-close').addEventListener('click', () => w.close());
  drag(el, el.querySelector('.win-title'));
  w.focus();
  return w;
}

function drag(el, handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || e.button !== 0) return;
    const startX = e.clientX - el.offsetLeft;
    const startY = e.clientY - el.offsetTop;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    const move = (ev) => {
      const x = Math.min(innerWidth - 60, Math.max(60 - el.offsetWidth, ev.clientX - startX));
      const y = Math.min(innerHeight - 80, Math.max(0, ev.clientY - startY));
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };
    const up = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

export function refreshAll() {
  for (const w of open.values()) w.refresh?.();
}

export const getWindow = (key) => open.get(key);
export const closeAll = () => [...open.values()].forEach((w) => w.close());
export const closeWindow = (key) => open.get(key)?.close();

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const top = [...open.values()].find((w) => w.el.classList.contains('active'));
  if (top && !e.target.closest?.('input, textarea, select')) top.close();
});

export function balloon({ title, text = '', onClick, timeout = 9000 }) {
  const el = document.createElement('div');
  el.className = 'balloon';
  el.setAttribute('role', 'status');
  el.innerHTML = `<b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}<button class="x" aria-label="dismiss">×</button>`;
  balloons.append(el);
  while (balloons.children.length > 3) balloons.firstElementChild.remove();
  requestAnimationFrame(() => el.classList.add('show'));
  const dismiss = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 260);
  };
  el.querySelector('.x').addEventListener('click', (e) => {
    e.stopPropagation();
    dismiss();
  });
  el.addEventListener('click', () => {
    dismiss();
    onClick?.();
  });
  if (timeout) setTimeout(dismiss, timeout);
  return dismiss;
}
