// The studio: a pixel room where every project lives. Projects on the desk
// sit and type, napping ones take the sofa (or the rug), ghosts float,
// eggs wait in the nest, and everyone else wanders and chats.
// The room's objects are buttons: whiteboard, fridge, bin, calendar…
import { SPRITE_W, SPRITE_H, FEET_Y, WAIST_Y } from './pixelfolk.js';
import { layoutRoom, paintRoom } from './room.js';
import { creatureSvg } from './creature.js';
import { personFrames, eggCanvas, lookStyle } from './look.js';
import { soloLine, conversation } from './lines.js';
import { STAGES, ENERGY, DAY, clock, ago, plural, rng } from './life.js';

const SPEED = { lively: 15, awake: 11, bored: 5, ghost: 4 };
const FRAME_MS = { lively: 150, awake: 190, bored: 280 };
const CHATTER = { lots: [3500, 6000], some: [6500, 11000], quiet: [22000, 40000] };
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// desks and the sofa hide everything from 16 scene px above the seat down,
// so seated people are lifted until their waist meets that edge
const SEAT_COVER = 16;

export class Studio {
  constructor(world, { onOpen, onHotspot, hotLabel }) {
    this.world = world;
    this.onOpen = onOpen;
    this.onHotspot = onHotspot;
    this.hotLabel = hotLabel;
    this.items = new Map();
    this.logs = new Map();
    this.model = null;
    this.paused = false;
    this.talking = false;
    this.ready = false;
    world.innerHTML = `
      <div class="studio">
        <canvas class="room room-back" aria-hidden="true"></canvas>
        <div class="layer hotspots"></div>
        <div class="layer seated"></div>
        <canvas class="room room-front" aria-hidden="true"></canvas>
        <div class="layer walkers"></div>
        <div class="nest-badge" hidden></div>
        <div class="hot-label" hidden></div>
      </div>`;
    this.el = world.querySelector('.studio');
    this.back = world.querySelector('.room-back');
    this.front = world.querySelector('.room-front');
    this.seated = world.querySelector('.seated');
    this.walkers = world.querySelector('.walkers');
    this.hotLayer = world.querySelector('.hotspots');
    this.badge = world.querySelector('.nest-badge');
    this.label = world.querySelector('.hot-label');
    this.last = performance.now();
    this.frame = this.frame.bind(this);
    this.measure();
    let t;
    addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => this.measure(), 120);
    });
    setInterval(() => this.paint(true), 60000);
    requestAnimationFrame(this.frame);
    this.hotLayer.addEventListener('click', (e) => {
      const b = e.target.closest('[data-hot]');
      if (b) this.onHotspot(b.dataset.hot, b);
    });
    this.hotLayer.addEventListener('pointerover', (e) => {
      const b = e.target.closest('[data-hot]');
      if (b) this.showLabel(b);
    });
    this.hotLayer.addEventListener('focusin', (e) => {
      const b = e.target.closest('[data-hot]');
      if (b) this.showLabel(b);
    });
    this.hotLayer.addEventListener('pointerout', () => (this.label.hidden = true));
    this.hotLayer.addEventListener('focusout', () => (this.label.hidden = true));
  }

  // ------------------------------------------------------------ size + room

  measure() {
    const w = this.world.clientWidth;
    const h = this.world.clientHeight;
    if (!w || !h) return;
    const S = clamp(Math.round(h / 215), 2, 6);
    const W = Math.max(300, Math.ceil(w / S));
    const H = clamp(Math.floor(h / S), 170, 280);
    const changed = S !== this.S || W !== this.W || H !== this.H;
    if (!changed) return;
    this.S = S;
    this.W = W;
    this.H = H;
    this.layout = layoutRoom(W, H);
    for (const c of [this.back, this.front]) {
      c.width = W;
      c.height = H;
    }
    this.el.style.width = `${W * S}px`;
    this.el.style.height = `${H * S}px`;
    this.el.style.setProperty('--S', S);
    this.backCtx = this.back.getContext('2d');
    this.frontCtx = this.front.getContext('2d');
    this.buildHotspots();
    this.paintKey = null;
    this.paint();
    for (const it of this.items.values()) {
      it.mode = null;
      if (this.model) this.place(it, it.c, this.assign);
    }
  }

  buildHotspots() {
    const S = this.S;
    this.hotLayer.innerHTML = this.layout.hotspots
      .filter((h) => h.id !== 'window')
      .map((h) => `<button class="hot" data-hot="${h.id}" style="left:${h.x * S}px;top:${h.y * S}px;width:${h.w * S}px;height:${h.h * S}px"></button>`)
      .join('');
    this.refreshHotLabels();
  }

  refreshHotLabels() {
    for (const b of this.hotLayer.querySelectorAll('[data-hot]')) {
      const text = this.hotLabel(b.dataset.hot) || b.dataset.hot;
      b.setAttribute('aria-label', text);
      b.dataset.label = text;
    }
  }

  showLabel(b) {
    const text = b.dataset.label;
    if (!text) return;
    this.label.textContent = text;
    this.label.hidden = false;
    const r = b.getBoundingClientRect();
    const host = this.world.getBoundingClientRect();
    const lw = this.label.offsetWidth;
    const x = clamp(r.left - host.left + this.world.scrollLeft + r.width / 2 - lw / 2, 6, this.W * this.S - lw - 6);
    const y = Math.max(6, r.top - host.top - this.label.offsetHeight - 6);
    this.label.style.left = `${x}px`;
    this.label.style.top = `${y}px`;
  }

  paint(force = false) {
    const m = this.model;
    if (!m || !this.backCtx) return;
    const now = new Date();
    const state = {
      now,
      dayOffset: clock.offsetDays,
      deskBusy: [0, 1, 2].map((i) => !!m.desk[i]),
      binCount: m.bin.length,
      fridgeCount: m.freezer.length,
      eggCount: m.live.filter((c) => c.type === 'egg').length,
      boardBars: boardBars(m),
    };
    const key = JSON.stringify({ ...state, now: `${now.getHours()}:${now.getMinutes()}` });
    if (!force && key === this.paintKey) return;
    this.paintKey = key;
    paintRoom(this.backCtx, this.frontCtx, this.layout, state);
    const h = now.getHours() + now.getMinutes() / 60;
    this.el.classList.toggle('night', h < 5.5 || h >= 20.75);
    this.el.classList.toggle('dusk', h >= 19.5 && h < 20.75);
  }

  // ------------------------------------------------------------ syncing

  sync(model) {
    this.model = model;
    this.assign = assignSpots(model, this.layout);
    const keep = new Set();
    for (const c of model.live) {
      keep.add(c.key);
      const it = this.items.get(c.key) || this.add(c);
      this.update(it, c);
      this.place(it, c, this.assign);
    }
    for (const [key, it] of this.items) if (!keep.has(key)) this.remove(it, model.byKey.get(key));
    const hidden = this.assign.hiddenEggs;
    this.badge.hidden = !hidden;
    if (hidden) {
      const slot = this.layout.nest.slots[this.layout.nest.slots.length - 1];
      this.badge.textContent = `+${hidden}`;
      this.badge.style.left = `${(slot.x + 6) * this.S}px`;
      this.badge.style.top = `${(slot.y - 18) * this.S}px`;
    }
    this.paint();
    this.refreshHotLabels();
    this.ready = true;
    if (!this.chatTimer) this.scheduleChat();
  }

  add(c) {
    const el = document.createElement('div');
    el.className = 'person';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.innerHTML = '<div class="art"></div><div class="tag"><b></b><span></span></div>';
    const it = {
      key: c.key,
      c,
      el,
      art: el.querySelector('.art'),
      x: 0,
      y: 0,
      tx: null,
      ty: null,
      pause: 600 + Math.random() * 4000,
      phase: Math.floor(Math.random() * 1000),
      mode: null,
      hover: false,
      busy: false,
      left: false,
    };
    el.addEventListener('click', () => this.onOpen(it.c.key, el));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.onOpen(it.c.key, el);
      }
    });
    el.addEventListener('pointerenter', () => (it.hover = true));
    el.addEventListener('pointerleave', () => (it.hover = false));
    this.items.set(c.key, it);
    if (this.ready) this.flash(it, 'arriving', 600);
    return it;
  }

  update(it, c) {
    it.c = c;
    const doodle = lookStyle() === 'doodle';
    const sig = `${doodle}|${c.seed}|${c.stage}|${c.energy}|${c.kind}`;
    if (sig !== it.sig) {
      it.sig = sig;
      it.doodle = doodle;
      it.frames = c.type === 'egg' ? null : doodle ? null : personFrames(c);
      it.drawn = null;
      if (doodle || c.type === 'egg') {
        it.art.innerHTML = doodle ? creatureSvg(c) : '';
        if (!doodle) it.art.append(cloneCanvas(eggCanvas(c)));
      } else {
        it.canvas = document.createElement('canvas');
        it.art.replaceChildren(it.canvas);
      }
    }
    const cl = it.el.classList;
    cl.toggle('is-egg', c.type === 'egg');
    cl.toggle('cold', c.energy === 'cold');
    cl.toggle('ghost', c.energy === 'ghost');
    cl.toggle('doodle', it.doodle);
    cl.toggle('on-desk', !!c.onDesk);
    it.el.querySelector('.tag b').textContent = `${c.onDesk ? '★ ' : ''}${c.name}`;
    it.el.querySelector('.tag span').textContent = statusLine(c);
    it.el.setAttribute('aria-label', `${c.name}: ${statusLine(c)}. open properties`);
  }

  // decide where this one lives right now (desk, sofa, rug, nest, floor…)
  place(it, c, a) {
    const L = this.layout;
    let mode = 'wander';
    let spot = null;
    if (a.desk.has(c.key)) [mode, spot] = ['desk', L.desks[a.desk.get(c.key)].seat];
    else if (a.sofa.has(c.key)) [mode, spot] = ['sofa', L.sofa.seats[a.sofa.get(c.key)]];
    else if (a.nap.has(c.key)) [mode, spot] = ['nap', L.naps[a.nap.get(c.key)]];
    else if (c.type === 'egg') [mode, spot] = a.egg.has(c.key) ? ['egg', L.nest.slots[a.egg.get(c.key)]] : ['hidden', null];
    else if (c.energy === 'ghost') mode = 'ghost';
    else if (c.energy === 'asleep') mode = 'doze';
    if (mode === it.mode && (!spot || (spot.x === it.x && spot.y === it.y))) return;
    const was = it.mode;
    it.mode = mode;
    it.tx = null;
    it.busy = false;
    if (spot) {
      it.x = spot.x;
      it.y = spot.y;
    } else if (mode === 'ghost') {
      const z = L.ghosts;
      if (was !== 'ghost') [it.x, it.y] = this.freeSpot(this.zone(z), rng(c.seed ^ 77));
    } else if (!was || ['desk', 'sofa', 'nap', 'egg', 'hidden', 'ghost'].includes(was)) {
      [it.x, it.y] = this.freeSpot(this.zone(L.walk), rng(c.seed ^ 0x9e3779b9));
    }
    const layer = ['desk', 'sofa', 'egg'].includes(mode) ? this.seated : this.walkers;
    if (it.el.parentElement !== layer) layer.append(it.el);
    it.el.hidden = mode === 'hidden';
    it.el.dataset.mode = mode;
    it.drawn = null;
    if (was && this.ready && mode !== 'hidden') this.flash(it, 'arriving', 500);
  }

  // keep whole sprites inside the room, not just their feet
  zone(z) {
    const half = Math.ceil(SPRITE_W / 2) + 1;
    return { left: z.left + half, right: Math.max(z.left + half, z.right - half), top: z.top, bottom: z.bottom };
  }

  freeSpot(zone, r) {
    let best = null;
    for (let i = 0; i < 12; i++) {
      const x = zone.left + r() * (zone.right - zone.left);
      const y = zone.top + r() * (zone.bottom - zone.top);
      let room = Infinity;
      for (const it of this.items.values()) if (it.mode && it.mode !== 'hidden') room = Math.min(room, Math.hypot(it.x - x, (it.y - y) * 2));
      if (!best || room > best.room) best = { x, y, room };
    }
    return [best.x, best.y];
  }

  remove(it, c) {
    if (it.removing) return;
    it.removing = true;
    this.items.delete(it.key);
    const hatching = it.el.classList.contains('hatching');
    if (!hatching) it.el.classList.add(c?.frozen ? 'freezing' : 'leaving');
    setTimeout(() => it.el.remove(), hatching ? 950 : 1150);
  }

  // ------------------------------------------------------------ motion + frames

  frame(t) {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    if (document.hidden || this.paused || !this.layout) return;
    for (const it of this.items.values()) {
      if (it.removing && !it.el.isConnected) continue;
      if (it.mode === 'wander' || it.mode === 'ghost') this.step(it, dt);
      this.draw(it, t);
    }
  }

  step(it, dt) {
    const zone = this.zone(it.mode === 'ghost' ? this.layout.ghosts : this.layout.walk);
    const speed = reduced.matches ? 0 : SPEED[it.c.energy] || 0;
    it.walking = false;
    if (!speed || it.hover || it.busy === 'still') return;
    if (it.pause > 0) {
      it.pause -= dt * 1000;
      return;
    }
    if (it.tx === null) [it.tx, it.ty] = this.nextStop(it, zone);
    const dx = it.tx - it.x;
    const dy = it.ty - it.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.6) {
      it.tx = null;
      it.pause = it.c.energy === 'bored' ? 4000 + Math.random() * 9000 : 1500 + Math.random() * 5500;
      const done = it.onArrive;
      it.onArrive = null;
      done?.();
      return;
    }
    const move = Math.min(dist, speed * dt);
    it.x += (dx / dist) * move;
    it.y += (dy / dist) * move;
    if (Math.abs(dx) > 0.5) it.left = dx < 0;
    it.walking = it.mode === 'wander';
  }

  nextStop(it, zone) {
    let best = null;
    for (let i = 0; i < 6; i++) {
      const x = clamp(it.x + (Math.random() - 0.5) * 110, zone.left, zone.right);
      const y = clamp(it.y + (Math.random() - 0.5) * 40, zone.top, zone.bottom);
      let room = Infinity;
      for (const o of this.items.values()) {
        if (o === it || !o.mode || o.mode === 'hidden') continue;
        room = Math.min(room, Math.hypot((o.tx ?? o.x) - x, ((o.ty ?? o.y) - y) * 2));
      }
      if (!best || room > best.room) best = { x, y, room };
    }
    return [best.x, best.y];
  }

  draw(it, t) {
    const S = this.S;
    const c = it.c;
    let frame = null;
    if (it.frames) {
      const f = it.frames;
      const tick = (ms) => Math.floor((t + it.phase) / ms) % 2;
      if (it.mode === 'nap') frame = f.lie;
      else if (it.mode === 'sofa' || it.mode === 'doze') frame = f.sleep;
      else if (it.mode === 'desk') frame = c.energy === 'asleep' ? f.sleep : c.energy === 'lively' || c.energy === 'awake' ? f.type[tick(230)] : f.stand;
      else if (it.walking) frame = f.walk[tick(FRAME_MS[c.energy] || 200)];
      else frame = f.stand;
      if (frame !== it.drawn) {
        const cv = it.canvas;
        if (cv.width !== frame.width || cv.height !== frame.height) {
          cv.width = frame.width;
          cv.height = frame.height;
          cv.style.width = `${frame.width * S}px`;
          cv.style.height = `${frame.height * S}px`;
        }
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(frame, 0, 0);
        it.drawn = frame;
      }
    }
    // feet go on the spot; lying sprites rest on their side
    let w;
    let h;
    let feet;
    if (c.type === 'egg' && !it.doodle) {
      const cv = it.art.firstChild;
      w = cv.width * S;
      h = cv.height * S;
      feet = h;
      if (cv.style.width !== `${w}px`) {
        cv.style.width = `${w}px`;
        cv.style.height = `${h}px`;
      }
    } else if (it.doodle) {
      w = h = Math.round(SPRITE_H * S * (c.type === 'egg' ? 0.6 : 1.1));
      feet = h * 0.93;
      it.art.style.width = `${w}px`;
      it.art.style.height = `${h}px`;
    } else {
      w = (frame?.width || SPRITE_W) * S;
      h = (frame?.height || SPRITE_H) * S;
      feet = it.mode === 'nap' ? h : it.mode === 'desk' || it.mode === 'sofa' ? (WAIST_Y + SEAT_COVER) * S : FEET_Y * S;
    }
    const x = Math.round(it.x) * S - Math.round(w / 2);
    const y = Math.round(it.y) * S - Math.round(feet);
    const flip = it.walking && it.left ? -1 : 1;
    const key = `${x}|${y}|${flip}|${w}`;
    if (key !== it.pos) {
      it.pos = key;
      it.el.style.transform = `translate(${x}px, ${y}px)`;
      it.el.style.width = `${w}px`;
      it.el.style.height = `${h}px`;
      it.art.style.transform = flip < 0 ? 'scaleX(-1)' : '';
      it.el.style.zIndex = it.mode === 'ghost' ? 5000 + Math.round(it.y) : Math.round(it.y);
    }
    it.el.classList.toggle('is-walking', !!it.walking);
  }

  flash(it, cls, ms) {
    it.el.classList.add(cls);
    setTimeout(() => it.el.classList.remove(cls), ms);
  }

  // ------------------------------------------------------------ talking

  scheduleChat() {
    const [lo, hi] = CHATTER[this.model?.settings.chatter] || CHATTER.some;
    this.chatTimer = setTimeout(() => {
      this.chat();
      this.scheduleChat();
    }, lo + Math.random() * (hi - lo));
  }

  chat() {
    if (document.hidden || this.paused || !this.model || this.talking) return;
    const list = [...this.items.values()].filter((it) => !it.removing && it.mode !== 'hidden');
    if (!list.length) return;
    const eggs = list.filter((it) => it.mode === 'egg');
    if (eggs.length && Math.random() < 0.4) this.flash(eggs[Math.floor(Math.random() * eggs.length)], 'wobble', 950);
    if (this.world.querySelectorAll('.bubble.show').length >= 2) return;
    const ctx = { user: this.model.user, now: this.model.now };
    if (Math.random() < 0.32 && this.converse(list, ctx)) return;
    const weights = list.map((it) => (it.c.onDesk ? 3 : 1) * (it.c.energy === 'lively' ? 2 : 1));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    const it = list.find((_, i) => (r -= weights[i]) <= 0) || list[0];
    this.say(it, soloLine(it.c, ctx));
  }

  converse(list, ctx) {
    const walkers = list.filter((it) => it.mode === 'wander' && !it.busy && (SPEED[it.c.energy] || 0) > 0);
    if (!walkers.length || reduced.matches) return false;
    const a = walkers[Math.floor(Math.random() * walkers.length)];
    const near = list
      .filter((it) => it !== a && !it.busy && ['wander', 'doze', 'ghost', 'desk', 'sofa'].includes(it.mode))
      .sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))
      .slice(0, 3);
    const b = near[Math.floor(Math.random() * near.length)];
    if (!b) return false;
    const script = conversation(a.c, b.c, ctx);
    if (!script?.length) return false;
    this.talking = true;
    b.busy = 'still';
    a.busy = 'approach';
    const W = this.zone(this.layout.walk);
    const side = a.x < b.x ? -1 : 1;
    a.tx = clamp(b.x + side * (SPRITE_W + 4), W.left, W.right);
    a.ty = clamp(b.mode === 'wander' || b.mode === 'doze' ? b.y + 1 : W.top + 2, W.top, W.bottom);
    a.pause = 0;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      a.tx = null;
      a.busy = 'still';
      let delay = 0;
      for (const [who, text] of script) {
        const speaker = who.key === a.c.key ? a : b;
        setTimeout(() => this.say(speaker, text), delay);
        delay += 2200 + text.length * 32;
      }
      setTimeout(() => {
        a.busy = false;
        b.busy = false;
        a.pause = 900;
        b.pause = 1800;
        this.talking = false;
      }, delay + 500);
    };
    a.onArrive = start;
    setTimeout(start, 8000);
    return true;
  }

  say(it, text) {
    if (!it || it.removing || !text || it.mode === 'hidden') return;
    let bubble = it.el.querySelector('.bubble');
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.className = 'bubble';
      it.el.append(bubble);
    }
    bubble.textContent = text;
    requestAnimationFrame(() => bubble.classList.add('show'));
    clearTimeout(it.bubbleTimer);
    it.bubbleTimer = setTimeout(() => bubble.classList.remove('show'), Math.min(6500, 2600 + text.length * 40));
    const log = this.logs.get(it.key) || [];
    log.unshift({ t: Date.now(), text });
    this.logs.set(it.key, log.slice(0, 6));
  }

  heard(key) {
    return this.logs.get(key) || [];
  }

  // ------------------------------------------------------------ moments

  hop(key, line) {
    const it = this.items.get(key);
    if (!it) return;
    this.flash(it, 'hop', 520);
    if (line) this.say(it, line);
  }

  hatch(eggKey, projectKey, line) {
    const egg = this.items.get(eggKey);
    if (egg) egg.el.classList.add('hatching');
    setTimeout(() => {
      const pro = this.items.get(projectKey);
      if (pro && egg && pro.mode === 'wander') {
        pro.x = egg.x;
        pro.y = this.layout.walk.top + 2;
        pro.tx = null;
        pro.pause = 2500;
        this.flash(pro, 'arriving', 600);
      }
      if (pro && line) setTimeout(() => this.say(pro, line), 400);
    }, egg ? 850 : 0);
  }

  spotlight(key) {
    const it = this.items.get(key);
    if (!it) return;
    it.el.focus({ preventScroll: true });
    this.hop(key);
  }

  // for the guided tour
  rectOf(id) {
    return this.hotLayer.querySelector(`[data-hot="${id}"]`)?.getBoundingClientRect() || null;
  }
  someone(mode = 'wander') {
    const mid = this.W / 2;
    let best = null;
    for (const it of this.items.values()) {
      if (it.mode !== mode || it.removing) continue;
      if (!best || Math.abs(it.x - mid) < Math.abs(best.x - mid)) best = it;
    }
    return best;
  }
}

// ------------------------------------------------------------ helpers

function assignSpots(model, L) {
  const desk = new Map(model.desk.slice(0, L.desks.length).map((c, i) => [c.key, i]));
  const sleepers = model.live
    .filter((c) => c.type === 'project' && !desk.has(c.key) && c.energy === 'asleep')
    .sort((a, b) => b.days - a.days);
  const sofa = new Map();
  const nap = new Map();
  sleepers.forEach((c, i) => {
    if (i < L.sofa.seats.length) sofa.set(c.key, i);
    else if (i - L.sofa.seats.length < L.naps.length) nap.set(c.key, i - L.sofa.seats.length);
  });
  const eggs = model.live.filter((c) => c.type === 'egg').sort((a, b) => b.idea.createdAt - a.idea.createdAt);
  const egg = new Map(eggs.slice(0, L.nest.slots.length).map((c, i) => [c.key, i]));
  return { desk, sofa, nap, egg, hiddenEggs: Math.max(0, eggs.length - L.nest.slots.length) };
}

function boardBars(m) {
  const weeks = 7;
  const now = clock.now();
  const counts = new Array(weeks).fill(0);
  for (const c of m.creatures) {
    const t = c.type === 'egg' ? c.idea.createdAt : c.p?.born;
    if (!t) continue;
    const i = weeks - 1 - Math.floor((now - t) / (7 * DAY));
    if (i >= 0 && i < weeks) counts[i]++;
  }
  const max = Math.max(1, ...counts);
  return counts.map((n) => n / max);
}

export function statusLine(c) {
  if (c.type === 'egg') return c.energy === 'cold' ? `egg · getting cold, laid ${ago(c.idea.createdAt)}` : `egg · laid ${ago(c.idea.createdAt)}`;
  if (c.frozen) return 'frozen';
  const when = c.days === 0 ? 'touched today' : `touched ${ago(c.p.lastTouched)}`;
  return `${STAGES[c.stage].label} · ${ENERGY[c.energy].label} · ${when}`;
}

function cloneCanvas(src) {
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  cv.getContext('2d').drawImage(src, 0, 0);
  return cv;
}

export { plural };
