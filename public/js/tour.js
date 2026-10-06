// A short guided tour: dims the room, spotlights one thing at a time and
// explains it in a speech balloon. Runs once after setup; replay from "?".
import { esc } from './life.js';

const DONE_KEY = 'brainchildren:tour-done';

export const tourDone = () => {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
};

export function startTour(app) {
  if (document.querySelector('.tour')) return;
  app.showView('studio');
  const s = app.model.settings;
  const studio = app.studio;
  const walker = () => studio.someone('wander') || studio.someone('desk') || studio.someone('doze');
  const union = (...rects) => {
    const list = rects.filter(Boolean);
    if (!list.length) return null;
    const l = Math.min(...list.map((r) => r.left));
    const t = Math.min(...list.map((r) => r.top));
    const r = Math.max(...list.map((x) => x.right));
    const b = Math.max(...list.map((x) => x.bottom));
    return { left: l, top: t, width: r - l, height: b - t, right: r, bottom: b };
  };
  const hot = (...ids) => () => union(...ids.map((id) => studio.rectOf(id)));

  const steps = [
    {
      target: () => null,
      title: 'hi! welcome to your studio ✿',
      text: 'every folder in your projects folder lives here as a little person. this tour takes about 30 seconds.',
    },
    {
      target: () => {
        const it = walker();
        if (it) it.hover = true;
        return it?.el.getBoundingClientRect() || null;
      },
      title: 'this is one of your projects',
      text: () => {
        const it = walker();
        return `${it ? `meet ${it.c.name}. ` : ''}click anyone to see what the project is and where you left off. right-click for quick actions: ▶ resume opens it in your editor with a focus timer, and you can leave a note for future you.`;
      },
    },
    {
      target: hot('desk0', 'desk1', 'desk2'),
      title: 'your 3 desks',
      text: 'these are your focus. put up to 3 projects at a desk and they sit and type. click an empty desk to pick someone.',
    },
    {
      target: hot('sofa'),
      title: 'the nap corner',
      text: `projects you haven't touched for ${s.sleepDays} days come here to nap. after ${s.ghostDays} days they turn into ghosts and ask what you'd like to do: revive, freeze or let go.`,
    },
    {
      target: hot('nest'),
      title: 'the egg nest',
      text: "eggs are ideas you haven't started yet. press N any time to lay one: type it or say it. when you make a folder for it, it hatches into a person.",
    },
    {
      target: hot('board'),
      title: 'the whiteboard is your dashboard',
      text: "click it for charts, lists and everything that needs attention. right-click it to write your own goal on it, and pin eggs to it.",
    },
    {
      target: () => document.querySelector('.person.me')?.getBoundingClientRect() || null,
      title: "and this is you",
      text: 'you walk over to whatever you’re working on, and relax in your chair the rest of the time. click yourself to change how you look.',
    },
    {
      target: hot('fridge', 'bin'),
      title: 'fridge and bin',
      text: 'the fridge keeps ideas you want to save for later. the bin holds ideas you let go. neither ever deletes anything from your computer.',
    },
    {
      target: hot('calendar'),
      title: 'the calendar is a time machine',
      text: "peek ahead to see who'll fade if nothing changes. it's only a preview.",
    },
    {
      target: () => document.getElementById('help')?.getBoundingClientRect() || null,
      title: "that's it!",
      text: 'hover over anything in the room to see what it is. press ctrl+K to find anything, ctrl+Z to undo. decorate the studio and dress up from the start menu. replay this tour with the ? button.',
      last: true,
    },
  ];

  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = '<div class="tour-hole"></div><div class="tour-card" role="dialog" aria-live="polite"></div>';
  document.body.append(root);
  const hole = root.querySelector('.tour-hole');
  const card = root.querySelector('.tour-card');
  let i = 0;

  function show() {
    const step = steps[i];
    const r = step.target();
    const pad = 10;
    if (r) {
      Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
      hole.classList.remove('none');
    } else {
      Object.assign(hole.style, { left: '50%', top: '42%', width: '0px', height: '0px' });
      hole.classList.add('none');
    }
    const text = typeof step.text === 'function' ? step.text() : step.text;
    card.innerHTML = `
      <p class="tour-step">${i + 1} of ${steps.length}</p>
      <h3>${esc(step.title)}</h3>
      <p>${esc(text)}</p>
      <div class="row">
        ${step.last ? '' : '<button class="btn small" data-t="skip">skip tour</button>'}
        <span style="flex:1"></span>
        ${i ? '<button class="btn small" data-t="back">back</button>' : ''}
        <button class="btn small primary" data-t="next">${step.last ? 'start exploring' : i ? 'next' : "let's go"}</button>
      </div>`;
    // put the card next to the spotlight, inside the screen
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    let x;
    let y;
    if (r) {
      x = Math.min(innerWidth - cw - 12, Math.max(12, r.left + r.width / 2 - cw / 2));
      y = r.top - ch - pad - 14 > 12 ? r.top - ch - pad - 14 : Math.min(innerHeight - ch - 12, r.bottom + pad + 14);
    } else {
      x = (innerWidth - cw) / 2;
      y = innerHeight * 0.36 - ch / 2;
    }
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
    card.querySelector('[data-t=next]').focus();
  }

  function finish() {
    try {
      localStorage.setItem(DONE_KEY, '1');
    } catch {}
    for (const it of studio.items.values()) it.hover = false;
    root.remove();
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', show);
  }
  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      finish();
    }
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft' && i) go(-1);
  }
  function go(d) {
    for (const it of studio.items.values()) it.hover = false;
    i += d;
    if (i >= steps.length) return finish();
    show();
  }
  card.addEventListener('click', (e) => {
    const t = e.target.closest('[data-t]')?.dataset.t;
    if (t === 'skip') finish();
    if (t === 'back') go(-1);
    if (t === 'next') go(1);
  });
  addEventListener('keydown', onKey, true);
  addEventListener('resize', show);
  show();
}
