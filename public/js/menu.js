// Win95-style right-click menus. Items: { label, icon?, action, disabled?, danger?, hint? } or null for a divider.
import { esc } from './life.js';

let current = null;

export function openMenu(x, y, items, { title } = {}) {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'ctx';
  el.setAttribute('role', 'menu');
  el.innerHTML = `${title ? `<div class="ctx-title">${esc(title)}</div>` : ''}${items
    .map((it, i) =>
      it
        ? `<button role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}><span class="ctx-icon">${it.icon || ''}</span><span class="ctx-label">${esc(it.label)}</span>${it.hint ? `<span class="ctx-hint">${esc(it.hint)}</span>` : ''}</button>`
        : '<hr>',
    )
    .join('')}`;
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  el.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  const buttons = [...el.querySelectorAll('button:not([disabled])')];
  buttons[0]?.focus();

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    closeMenu();
    it?.action?.(b);
  });
  el.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') buttons[(i + 1) % buttons.length]?.focus();
    else if (e.key === 'ArrowUp') buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    else if (e.key === 'Escape' || e.key === 'Tab') closeMenu();
    else return;
    e.preventDefault();
  });
  current = el;
}

export function closeMenu() {
  current?.remove();
  current = null;
}

addEventListener('pointerdown', (e) => {
  if (current && !current.contains(e.target)) closeMenu();
});
addEventListener('resize', closeMenu);
addEventListener('blur', closeMenu);
