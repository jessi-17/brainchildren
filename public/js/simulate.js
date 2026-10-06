// The guided walkthrough: in the practice studio, a little cursor drives
// the app and a narration card explains what everything does, chapter by
// chapter. Pause, go back, skip or jump to any chapter.
import { closeAll } from './wm.js';
import { openMenu, closeMenu } from './menu.js';
import { openPalette } from './palette.js';
import { undoLast } from './undo.js';
import { resume, finish, focusOn, stop as stopFocus } from './focus.js';
import { clock, esc } from './life.js';

const ABORT = Symbol('abort');
let running = null;

export function startSimulation(app, { chapter = 0 } = {}) {
  running?.exit(true);
  running = new Simulation(app);
  running.start(chapter);
}

class Simulation {
  constructor(app) {
    this.app = app;
    this.i = 0;
    this.runId = 0;
    this.playing = true;
    this.steps = buildSteps(app);
    this.chapters = [...new Set(this.steps.map((s) => s.chapter))];
    this.ui();
  }

  ui() {
    const el = document.createElement('div');
    el.className = 'sim';
    el.innerHTML = `
      <div class="sim-ring" hidden></div>
      <div class="sim-cursor" aria-hidden="true"><svg viewBox="0 0 16 22" width="22" height="30"><path d="M1 1v17l4.5-4.2 3 6.7 3-1.4-3-6.6H15z" fill="#fff" stroke="#2b2a5e" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
      <section class="sim-card win active" role="dialog" aria-label="walkthrough" aria-live="polite">
        <header class="win-title"><span class="win-name">walkthrough · practice studio</span></header>
        <div class="sim-body">
          <div class="sim-top"><select class="select sim-jump" aria-label="jump to a chapter">${this.chapters.map((c, n) => `<option value="${n}">${n + 1}. ${esc(c)}</option>`).join('')}</select><span class="sim-count"></span></div>
          <h3 class="sim-title"></h3>
          <p class="sim-text"></p>
          <div class="meter sim-bar"><i></i></div>
          <div class="row sim-controls">
            <button class="btn small" data-s="back" aria-label="back">◀</button>
            <button class="btn small" data-s="play"></button>
            <button class="btn small primary" data-s="next">next ▶</button>
            <span style="flex:1"></span>
            <button class="btn small" data-s="exit">exit</button>
          </div>
        </div>
      </section>`;
    document.body.append(el);
    this.el = el;
    this.ring = el.querySelector('.sim-ring');
    this.cursor = el.querySelector('.sim-cursor');
    this.cursor.style.transform = `translate(${innerWidth / 2}px, ${innerHeight / 2}px)`;
    el.addEventListener('click', (e) => {
      const s = e.target.closest('[data-s]')?.dataset.s;
      if (s === 'back') this.go(this.i - 1);
      if (s === 'next') this.go(this.i + 1);
      if (s === 'play') this.toggle();
      if (s === 'exit') this.exit();
    });
    el.querySelector('.sim-jump').addEventListener('change', (e) => {
      const ch = this.chapters[Number(e.target.value)];
      this.go(this.steps.findIndex((s) => s.chapter === ch));
    });
    this.onKey = (e) => {
      if (e.target.closest?.('input, textarea, select') && !e.target.closest('.sim')) return;
      if (e.key === 'ArrowRight') this.go(this.i + 1);
      else if (e.key === 'ArrowLeft') this.go(this.i - 1);
      else if (e.key === ' ' && e.target === document.body) this.toggle();
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', this.onKey);
  }

  async start(chapter) {
    this.app.simulating = true;
    if (!this.app.practice) await this.app.enterPractice();
    const at = this.steps.findIndex((s) => s.chapter === this.chapters[chapter]);
    this.go(Math.max(0, at));
  }

  toggle() {
    this.playing = !this.playing;
    this.paint();
    if (this.playing && this.done) this.go(this.i + 1);
  }

  paint() {
    const step = this.steps[this.i];
    this.el.querySelector('.sim-title').textContent = step.title;
    this.el.querySelector('.sim-text').textContent = typeof step.text === 'function' ? step.text() : step.text;
    this.el.querySelector('.sim-count').textContent = `${this.i + 1} / ${this.steps.length}`;
    this.el.querySelector('.sim-jump').value = String(this.chapters.indexOf(step.chapter));
    const play = this.el.querySelector('[data-s=play]');
    if (play) play.textContent = this.playing ? '❚❚ pause' : '▶ play';
    const back = this.el.querySelector('[data-s=back]');
    if (back) back.disabled = this.i === 0;
    this.el.querySelector('.sim-bar i').style.width = `${((this.i + 1) / this.steps.length) * 100}%`;
  }

  async go(n) {
    if (n < 0 || n >= this.steps.length) return n >= this.steps.length && this.exit();
    const prev = this.steps[this.i];
    const id = ++this.runId;
    clearTimeout(this.timer);
    try {
      prev?.cleanup?.(this.helpers(id));
    } catch {}
    this.i = n;
    this.done = false;
    const step = this.steps[n];
    this.paint();
    this.ring.hidden = true;
    const h = this.helpers(id);
    try {
      if (step.fresh) await this.reset(h, step.fresh);
      await step.run?.(h);
    } catch (err) {
      if (err !== ABORT) console.warn('walkthrough step failed', step.title, err);
    }
    if (id !== this.runId) return;
    this.done = true;
    if (step.final) {
      this.playing = false;
      return this.paint();
    }
    const text = typeof step.text === 'function' ? step.text() : step.text;
    const read = Math.max(3800, 1400 + text.length * 45);
    this.timer = setTimeout(() => {
      if (this.playing && id === this.runId) this.go(this.i + 1);
    }, read);
  }

  // put the app in a known state at the start of a chapter
  async reset(h, how) {
    const app = this.app;
    closeMenu();
    document.querySelector('.palette-wrap')?.remove();
    closeAll();
    if (focusOn()) await stopFocus(app, { cancel: true });
    if (clock.offsetDays) {
      clock.offsetDays = 0;
      app.remodel();
    }
    app.showView(how === 'dashboard' ? 'dashboard' : 'studio');
    await h.wait(350);
  }

  helpers(id) {
    const sim = this;
    const check = () => {
      if (id !== sim.runId) throw ABORT;
    };
    const rectOf = (t) => {
      const v = typeof t === 'function' ? t() : t;
      if (!v) return null;
      if (Array.isArray(v)) {
        const rs = v.map(rectOf).filter(Boolean);
        if (!rs.length) return null;
        const l = Math.min(...rs.map((r) => r.left));
        const tp = Math.min(...rs.map((r) => r.top));
        const r = Math.max(...rs.map((x) => x.right));
        const b = Math.max(...rs.map((x) => x.bottom));
        return { left: l, top: tp, right: r, bottom: b, width: r - l, height: b - tp };
      }
      if (typeof Element !== 'undefined' && v instanceof Element) return v.isConnected ? v.getBoundingClientRect() : null;
      return v.left !== undefined ? v : null;
    };
    const h = {
      wait: async (ms) => {
        await new Promise((r) => setTimeout(r, ms));
        check();
      },
      // move the cursor to a target and ring it
      point: async (t, { ring = true, pad = 8 } = {}) => {
        // dashboard parts get scrolled into view first
        const v = typeof t === 'function' ? t() : t;
        const inDash = v instanceof Element && v.closest?.('.dash-scroll');
        if (inDash) {
          v.scrollIntoView({ block: 'center' });
          await h.wait(120);
        }
        const r = rectOf(t);
        check();
        if (!r) return null;
        // keep the narration card out of the way of what it's talking about
        const cardW = sim.el.querySelector('.sim-card').offsetWidth + 24;
        sim.el.classList.toggle('card-right', r.left < cardW && r.bottom > innerHeight - 330);
        const x = r.left + r.width / 2;
        const y = r.top + Math.min(r.height / 2, 40);
        sim.cursor.style.transform = `translate(${x}px, ${y}px)`;
        if (ring) {
          Object.assign(sim.ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
          sim.ring.hidden = false;
        }
        await h.wait(750);
        return r;
      },
      click: async (t, fn, opts) => {
        const r = await h.point(t, opts);
        sim.cursor.classList.remove('tap');
        void sim.cursor.offsetWidth;
        sim.cursor.classList.add('tap');
        await h.wait(220);
        if (fn) await fn(r);
        else {
          const v = typeof t === 'function' ? t() : t;
          if (v instanceof Element) v.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
        await h.wait(450);
        return r;
      },
      type: async (target, text) => {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!el) return;
        await h.point(el, { ring: false });
        el.focus();
        el.value = '';
        for (const ch of text) {
          el.value += ch;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          await h.wait(28);
        }
      },
      ring: (t) => {
        const r = rectOf(t);
        if (!r) return;
        Object.assign(sim.ring.style, { left: `${r.left - 8}px`, top: `${r.top - 8}px`, width: `${r.width + 16}px`, height: `${r.height + 16}px` });
        sim.ring.hidden = false;
      },
      win: () => document.querySelector('#windows .win.active'),
      q: (sel) => document.querySelector(sel),
    };
    return h;
  }

  exit(silent = false) {
    clearTimeout(this.timer);
    this.runId++;
    removeEventListener('keydown', this.onKey);
    this.el.remove();
    closeMenu();
    for (const it of this.app.studio.items.values()) {
      it.hover = false;
      it.el.classList.remove('show-tag');
    }
    this.app.simulating = false;
    if (running === this) running = null;
    if (!silent) this.app.afterWalkthrough?.();
  }
}

// ------------------------------------------------------------ the script

function buildSteps(app) {
  const it = (folder) => [...app.studio.items.values()].find((x) => x.c.p?.folder === folder);
  const card = (key) => app.model.byKey.get(key);
  const byFolder = (folder) => app.model.creatures.find((c) => c.p?.folder === folder);
  const egg = (start) => app.model.creatures.find((c) => c.type === 'egg' && c.name.startsWith(start));
  const hot = (id) => () => app.studio.rectOf(id);
  const hold = (folder) => {
    const x = it(folder);
    if (!x) return null;
    x.hover = true;
    x.el.classList.add('show-tag');
    return x.el;
  };
  const release = () => {
    for (const x of app.studio.items.values()) {
      x.hover = false;
      x.el.classList.remove('show-tag');
    }
  };
  const dash = (sel) => () => document.querySelector(`#dashboard ${sel}`);
  const dashCard = (chart) => () => document.querySelector(`#dashboard [data-chart="${chart}"]`)?.closest('.dash-card');

  return [
    // ---------------------------------------------------------------- 1
    {
      chapter: 'the studio', fresh: true, title: 'welcome to the practice studio ✿',
      text: "this is a pretend studio full of made-up projects, so nothing here touches your real folders. sit back: i'll drive and explain. pause, go back or jump to a chapter any time.",
    },
    {
      chapter: 'the studio', title: 'every folder is a little person',
      text: 'each project folder lives here as a pixel person. their look comes from the project: a music project holds a cassette, and they wear the project’s own brand colour. hover anyone to see their name and how they’re doing.',
      run: (h) => h.point(() => hold('outfit-playlist')),
      cleanup: release,
    },
    {
      chapter: 'the studio', title: 'the 3 desks are your focus',
      text: 'projects you’re focusing on sit at a desk and type. only 3 fit, on purpose. their favicon glows on the monitor, and they also sit on the taskbar at the bottom.',
      run: (h) => h.point(() => [hot('desk0')(), hot('desk1')(), hot('desk2')()]),
    },
    {
      chapter: 'the studio', title: 'naps and ghosts',
      text: 'leave a project alone for 14 days and it naps on the sofa. after 30 days it turns into a see-through ghost that floats around and asks what you’d like to do.',
      run: async (h) => {
        await h.point(hot('sofa'));
        await h.wait(900);
        await h.point(() => it('sticker-shop')?.el);
      },
    },
    {
      chapter: 'the studio', title: 'eggs are ideas you haven’t started',
      text: 'every idea you lay waits as an egg in the nest under the warm lamp. when you make a folder for it, it hatches into a person.',
      run: (h) => h.point(hot('nest')),
    },
    {
      chapter: 'the studio', title: 'the room at a glance',
      text: 'the pill in the corner sums everything up: who’s busy, napping, fading, and how many eggs. hover anything in the room to see what it is: the fridge, the bin, the calendar and the cabinet are all buttons.',
      run: async (h) => {
        await h.point(() => document.getElementById('status'));
        await h.wait(800);
        await h.point(hot('fridge'));
      },
    },
    // ---------------------------------------------------------------- 2
    {
      chapter: 'a project up close', fresh: true, title: 'click anyone',
      text: 'clicking a person opens its properties: what the project is (from its README), where the folder lives, how old it is, git info and checklist progress.',
      run: (h) => h.click(() => it('plant-diary')?.el, () => app.ui.props(byFolder('plant-diary').key, it('plant-diary')?.el)),
    },
    {
      chapter: 'a project up close', title: 'where was I?',
      text: 'this tab gets you back in: your last note, the last commits, the files you changed last, and the open to-dos, with a "maybe start here".',
      run: (h) => h.click(() => h.win()?.querySelector('[data-tab=where]')),
    },
    {
      chapter: 'a project up close', title: 'memories',
      text: 'every project keeps its story: when the egg was laid, when the folder appeared, desk days, focus sessions, and what it’s been saying lately.',
      run: (h) => h.click(() => h.win()?.querySelector('[data-tab=memories]')),
    },
    {
      chapter: 'a project up close', title: 'right-click for quick actions',
      text: 'right-click anyone (a desk, a taskbar slot or a dashboard row works too) for the quick menu: resume, leave a note, desk, open in your editor or folder, dress up, freeze, not a project, let go.',
      run: async (h) => {
        closeAll();
        const r = await h.point(() => it('outfit-playlist')?.el);
        if (r) app.ui.menuFor(byFolder('outfit-playlist'), r.left + r.width / 2, r.top + r.height / 2);
      },
      cleanup: () => closeMenu(),
    },
    // ---------------------------------------------------------------- 3
    {
      chapter: 'getting back to work', fresh: true, title: '▶ resume',
      text: 'resume opens the project in your editor (VS Code, Cursor, Windsurf…), shows the next to-do and your last note, and starts a focus timer. the person types along, and the timer sits in the tray.',
      run: (h) => h.click(() => it('plant-diary')?.el, () => resume(app, byFolder('plant-diary'), { editor: false })),
    },
    {
      chapter: 'getting back to work', title: 'a note for future you',
      text: 'when you finish (or take a project off the desk), you’re asked for one line for future you: where you stopped, what’s tricky, what’s next.',
      run: async (h) => {
        await h.click(() => h.win()?.querySelector('[data-f=done]'), () => finish(app));
        await h.wait(500);
        await h.type(h.win()?.querySelector('textarea'), 'stopped at the reminder email. the timezone math is in watering.js.');
        await h.click(() => h.win()?.querySelector('[data-act=save]'));
      },
    },
    {
      chapter: 'getting back to work', title: 'past you sends a letter',
      text: 'come back 3 or more days later and the person wears a little ✉. click them and they hand you the note as a letter, so you never start from zero.',
      run: async (h) => {
        const el = () => it('moodboard-ai')?.el;
        await h.point(el);
        await h.click(el, () => app.ui.letter(byFolder('moodboard-ai'), el()));
      },
    },
    // ---------------------------------------------------------------- 4
    {
      chapter: 'desks + undo', fresh: true, title: 'pick who sits at a desk',
      text: 'click an empty desk to choose who sits there. when all 3 are taken, someone has to go back to the yard first. that keeps you focused.',
      run: async (h) => {
        await h.click(hot('desk2'), (r) => app.ui.pickDesk());
        await h.wait(400);
        await h.click(() => h.win()?.querySelector('[data-pick]'));
      },
    },
    {
      chapter: 'desks + undo', title: 'everything can be undone',
      text: 'every change shows a little "undo" pop-up at the bottom, and ctrl+Z works too. so it’s safe to click around.',
      run: async (h) => {
        await h.point(() => document.querySelector('.toast'));
        await h.wait(700);
        undoLast();
      },
    },
    // ---------------------------------------------------------------- 5
    {
      chapter: 'when things fade', fresh: true, title: 'the calendar is a time machine',
      text: 'peek ahead to see who’ll fade if nothing changes. it’s only a preview. here we jump 10 days: more people nap, and ghosts appear.',
      run: async (h) => {
        await h.click(hot('calendar'), () => app.ui.timeMachine());
        await h.wait(400);
        const range = h.win()?.querySelector('[name=time]');
        for (let d = 1; d <= 10 && range; d++) {
          range.value = d;
          range.dispatchEvent(new Event('input', { bubbles: true }));
          await h.wait(90);
        }
        await h.wait(500);
        closeAll();
      },
    },
    {
      chapter: 'when things fade', title: 'a ghost asks what to do',
      text: 'ghosts show up as "Not Responding". you choose: revive it (you get "where was I?"), freeze it, or let it go. nothing is ever deleted from your computer.',
      run: (h) => h.click(() => it('sticker-shop')?.el, () => app.ui.visit(byFolder('sticker-shop'))),
    },
    {
      chapter: 'when things fade', title: 'letting go, kindly',
      text: 'letting go asks why (too big, lost interest, someone built it…) and what was worth keeping. over time, the dashboard shows what usually stops your ideas.',
      run: async (h) => {
        await h.click(() => h.win()?.querySelector('[data-act=letgo]'));
        await h.wait(400);
        await h.click(() => h.win()?.querySelector('[name=cause][value="too-big"]'));
        await h.type(h.win()?.querySelector('[name=keep]'), 'the name, and the one-tap checkout idea');
        await h.click(() => h.win()?.querySelector('[data-act=go]'));
      },
    },
    {
      chapter: 'when things fade', title: 'the recycle bin',
      text: 'the bin keeps everything you let go, with the reason and what was worth keeping. restore anything, any time.',
      run: (h) => h.click(hot('bin'), () => app.ui.bin()),
    },
    {
      chapter: 'when things fade', title: 'the fridge (freezer)',
      text: 'freeze ideas you want to keep but not think about right now. frozen ones never get sleepy or turn into ghosts.',
      run: async (h) => {
        closeAll();
        await h.click(hot('fridge'), () => app.ui.freezer());
      },
    },
    // ---------------------------------------------------------------- 6
    {
      chapter: 'eggs (new ideas)', fresh: true, title: 'press N for a new idea',
      text: 'got an idea at 2am? press N, type it (or click 🎤 and say it), and it becomes an egg. with AI on, "tidy my ramble" turns rambling into a neat idea card.',
      run: async (h) => {
        app.ui.run();
        await h.wait(400);
        await h.type(h.win()?.querySelector('[name=title]'), 'a sticker of the day calendar');
        await h.type(h.win()?.querySelector('[name=note]'), 'one tiny doodle sticker every morning');
        await h.click(() => h.win()?.querySelector('[data-act=ok]'));
      },
    },
    {
      chapter: 'eggs (new ideas)', title: 'the nest',
      text: 'click the nest to see all your eggs in one list. you can pin up to 4 to the whiteboard as "this one next".',
      run: (h) => h.click(hot('nest'), () => app.ui.nest()),
    },
    {
      chapter: 'eggs (new ideas)', title: 'sort my eggs',
      text: 'with lots of ideas, sort them one card at a time: K keep, F freeze, L let go, H hatch into a folder, → skip. AI can suggest a choice for each.',
      run: async (h) => {
        closeAll();
        app.ui.sortEggs();
        await h.wait(500);
        await h.click(() => h.win()?.querySelector('[data-act=keep]'));
      },
    },
    {
      chapter: 'eggs (new ideas)', title: 'hatching',
      text: 'made a folder for an idea? open the egg and hatch it: it becomes that folder’s person and keeps the idea as its first memory. brainchildren even suggests which folder it probably is.',
      run: async (h) => {
        closeAll();
        const e = egg('text your plants');
        if (e) app.ui.props(e.key);
        await h.wait(500);
        await h.point(() => h.win()?.querySelector('fieldset.group'));
      },
    },
    // ---------------------------------------------------------------- 7
    {
      chapter: 'the dashboard', fresh: true, title: 'the whiteboard opens the dashboard',
      text: 'click the whiteboard (or "dashboard" on the taskbar, or the pill in the corner) for the full picture.',
      run: (h) => h.click(hot('board'), () => app.showView('dashboard')),
    },
    {
      chapter: 'the dashboard', title: 'numbers at a glance',
      text: 'projects, eggs, desk, need attention, shipped, frozen, let go, and how long you focused this week. click a tile to filter everything below by it.',
      run: (h) => h.point(dash('.kpis')),
    },
    {
      chapter: 'the dashboard', title: 'search + filters',
      text: 'search and the stage chips filter the whole page at once: tiles, charts, lists and the table. "needs attention only" shows just the fading ones. the buttons here jump to pick for me, sorting, the town meeting and ask.',
      run: async (h) => {
        await h.point(dash('.dash-filters'));
        await h.type(dash('.dash-search')(), 'plant');
        await h.wait(900);
        const s = dash('.dash-search')();
        if (s) {
          s.value = '';
          s.dispatchEvent(new Event('input', { bubbles: true }));
        }
      },
    },
    {
      chapter: 'the dashboard', title: 'who’s fading',
      text: 'one bar per project: days since you last touched it. blue bars are napping or worse; the dashed lines mark nap (14 days) and ghost (30 days). hover a bar for details, click it to open the project.',
      run: async (h) => {
        await h.point(dashCard('fading'));
        const bar = document.querySelector('#dashboard [data-chart="fading"] .hit');
        if (bar) {
          const r = bar.getBoundingClientRect();
          bar.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + 160, clientY: r.top + r.height / 2 }));
        }
      },
    },
    {
      chapter: 'the dashboard', title: 'new ideas per week',
      text: 'how many folders you started (blue) and eggs you laid (orange) each week, for the last 12 weeks. hover a column for the numbers.',
      run: (h) => h.point(dashCard('weeks')),
    },
    {
      chapter: 'the dashboard', title: 'how far things got',
      text: 'egg → hatchling → growing → shipped. click a stage to filter everything by it (click again to clear).',
      run: async (h) => {
        await h.point(dashCard('stages'));
        await h.click(() => document.querySelector('#dashboard .hit[data-stage="growing"]'));
        await h.wait(900);
        document.querySelector('#dashboard .chip[data-stage="all"]')?.click();
      },
    },
    {
      chapter: 'the dashboard', title: 'how everyone’s doing + why ideas ended',
      text: 'the stacked bar splits your projects by energy (lively to ghost). "why ideas ended" counts the reasons you gave when letting go, so you can spot your pattern.',
      run: (h) => h.point(() => [dashCard('energy')(), dashCard('causes')()]),
    },
    {
      chapter: 'the dashboard', title: 'on the desk + needs attention',
      text: '"on the desk" shows the next step for each focus project, with a picker for empty desks. "needs attention" lists napping projects, ghosts and cold eggs, with revive / freeze / let go buttons right there.',
      run: (h) => h.point(() => [document.getElementById('dash-desk'), document.getElementById('dash-desk')?.nextElementSibling]),
    },
    {
      chapter: 'the dashboard', title: 'tables for everything',
      text: 'every chart has a "table" button that shows the same numbers as a table. at the bottom, the big table lists everything: sort by any column, click a row to open it, right-click for the quick menu.',
      run: async (h) => {
        await h.click(() => document.querySelector('#dashboard [data-table="fading"]'));
        await h.wait(800);
        document.querySelector('#dashboard [data-table="fading"]')?.click();
        const table = document.querySelector('#dashboard .dash-card.full');
        table?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await h.wait(700);
        await h.point(table);
      },
    },
    // ---------------------------------------------------------------- 8
    {
      chapter: 'finding your way', fresh: true, title: 'ctrl+K finds anything',
      text: 'press ctrl+K and type: projects, eggs and every command ("sort my eggs", "town meeting", "decorate the studio"…). enter opens it.',
      run: async (h) => {
        openPalette(app);
        await h.wait(300);
        await h.type(document.querySelector('.palette input'), 'zine');
        await h.wait(900);
      },
      cleanup: () => document.querySelector('.palette-wrap')?.remove(),
    },
    {
      chapter: 'finding your way', title: 'the start menu',
      text: 'everything also lives in the start menu: new idea, dashboard, pick for me, sorting, the town meeting, the bins, decorating, settings, and this walkthrough.',
      run: async (h) => {
        document.querySelector('.palette-wrap')?.remove();
        await h.click(() => document.getElementById('start'));
      },
      cleanup: () => {
        const m = document.getElementById('startmenu');
        if (m && !m.hidden) document.getElementById('start').click();
      },
    },
    // ---------------------------------------------------------------- 9
    {
      chapter: 'make it yours', fresh: true, title: 'decorate the studio',
      text: 'settings → studio: wallpaper, floor, window view, light, chatter voice (sweet, sassy, quiet), soft sounds and the cat. changes show up straight away.',
      run: async (h) => {
        app.ui.settings(null, { tab: 'studio' });
        await h.wait(700);
        await h.click(() => h.win()?.querySelector('[data-wall="mint"]'));
        const view = h.win()?.querySelector('[name=view]');
        if (view) {
          await h.point(view);
          view.value = 'beach';
          view.dispatchEvent(new Event('change', { bubbles: true }));
        }
        await h.wait(600);
      },
    },
    {
      chapter: 'make it yours', title: 'write on the whiteboard',
      text: 'right-click the whiteboard to write a goal, a quote or the plan on it. pinned eggs show up there as little sticky notes.',
      run: async (h) => {
        closeAll();
        await h.click(hot('board'), () => app.ui.board());
        await h.type(h.win()?.querySelector('[name=text]'), 'finish plant diary reminders ✿');
        await h.click(() => h.win()?.querySelector('[data-act=save]'));
      },
    },
    {
      chapter: 'make it yours', title: 'sticky notes + polaroids',
      text: 'stick notes on the wall, or turn your own photos into tiny pixel polaroids. drag them anywhere; double-click to edit or take them down.',
      run: async (h) => {
        app.ui.wallNote();
        await h.wait(400);
        await h.type(h.win()?.querySelector('textarea'), 'you got this');
        await h.click(() => h.win()?.querySelector('[data-act=save]'));
        await h.wait(600);
        await h.point(() => [...document.querySelectorAll('.wall-note')].pop());
      },
    },
    {
      chapter: 'make it yours', title: 'this is you',
      text: 'you live here too. you walk over to whatever you’re working on, and relax in your armchair otherwise. click yourself to dress up, and right-click anyone to dress them up too.',
      run: async (h) => {
        await h.point(() => document.querySelector('.person.me'));
        await h.click(() => document.querySelector('.person.me'), () => app.ui.dressUp('me'));
        await h.wait(500);
        await h.click(() => h.win()?.querySelector('[data-act=random]'));
        await h.click(() => h.win()?.querySelector('[data-act=save]'));
      },
    },
    {
      chapter: 'make it yours', title: 'decor you earn',
      text: 'the room earns things from what you really do: a trophy for every project you ship, a plant that grows when you revive a ghost, a lessons book for every 5 ideas you let go. it also decorates itself with the seasons.',
      run: (h) => h.point(hot('trophies')),
    },
    // ---------------------------------------------------------------- 10
    {
      chapter: 'AI (optional)', fresh: true, title: 'AI with your own key',
      text: 'settings → AI: paste your Anthropic key (it stays on your computer), pick a model, switch features on or off. nothing is sent until you click something with a ✨, and "what gets sent?" shows you exactly what. here, the answers are examples.',
      run: (h) => {
        app.ui.settings(null, { tab: 'ai' });
        return h.wait(900);
      },
    },
    {
      chapter: 'AI (optional)', title: '✨ where was I?',
      text: 'one click for a 3-line recap, where you probably stopped, and one small step you can finish in 10 minutes.',
      run: async (h) => {
        closeAll();
        app.ui.props(byFolder('moodboard-ai').key, null, 'where');
        await h.wait(600);
        await h.click(() => h.win()?.querySelector('[data-act=ai-where]'));
        await h.wait(700);
        await h.point(() => h.win()?.querySelector('.ai-card'));
      },
    },
    {
      chapter: 'AI (optional)', title: 'pick for me',
      text: 'tell it how much time you have, and it picks the best project for right now with a first step that fits. it works without AI too.',
      run: async (h) => {
        closeAll();
        app.ui.pickForMe();
        await h.wait(500);
        await h.click(() => h.win()?.querySelector('[data-act=pick]'));
      },
    },
    {
      chapter: 'AI (optional)', title: 'the town meeting',
      text: 'once a week everyone gathers at the whiteboard: what moved, what’s fading, and next week’s focus. AI can write it, or you get a simple summary without it.',
      run: async (h) => {
        closeAll();
        app.ui.townMeeting();
        await h.wait(2500);
      },
      cleanup: () => app.studio.meeting?.(false),
    },
    // ---------------------------------------------------------------- 11
    {
      chapter: 'staying present', fresh: true, title: 'so you don’t forget the app itself',
      text: 'settings → stay present: start brainchildren when you log in, a soft weekly desktop nudge, the focus timer length, and the terminal command: brainchildren add "idea" from anywhere.',
      run: (h) => {
        app.ui.settings(null, { tab: 'presence' });
        return h.wait(900);
      },
    },
    {
      chapter: 'staying present', final: true, title: 'that’s everything ✿',
      text: () =>
        app.realSetupDone === false
          ? 'you can keep playing in the practice studio, or set up your real one now. replay this any time from the ? button.'
          : 'keep playing in the practice studio as long as you like (nothing here is real), or exit to go back to your own studio. replay this any time from the ? button.',
      run: (h) => {
        closeAll();
        sim().el.querySelector('.sim-controls').innerHTML = '<button class="btn small" data-x="replay">↺ replay</button><span style="flex:1"></span><button class="btn small" data-x="stay">keep playing here</button><button class="btn small primary" data-x="leave">exit practice</button>';
        sim().el.querySelector('.sim-controls').addEventListener('click', (e) => {
          const x = e.target.closest('[data-x]')?.dataset.x;
          if (x === 'replay') startSimulation(app);
          if (x === 'stay') sim().exit(true);
          if (x === 'leave') {
            sim().exit(true);
            app.exitPractice();
          }
        });
        return h.wait(10);
      },
    },
  ];
}

const sim = () => running;
