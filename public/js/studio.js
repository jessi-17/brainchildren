// The studio: a pixel room where every project lives. Projects on the desk
// sit and type, napping ones take the sofa (or the rug), ghosts float,
// eggs wait in the nest, and everyone else wanders and chats.
// The room's objects are buttons: whiteboard, fridge, bin, calendar…
import { SPRITE_W, SPRITE_H, FEET_Y, WAIST_Y, person } from './pixelfolk.js';
import { layoutRoom, paintRoom, roomPhase } from './room.js';
import { creatureSvg } from './creature.js';
import { personFrames, eggCanvas, lookStyle } from './look.js';
import { soloLine, conversation } from './lines.js';
import { STAGES, ENERGY, DAY, clock, ago, plural, rng, esc, short } from './life.js';
import { focusOn } from './focus.js';
import { ambience } from './audio.js';

const SPEED = { lively: 15, awake: 11, bored: 5, ghost: 4 };
const FRAME_MS = { lively: 150, awake: 190, bored: 280 };
const CHATTER = { lots: [3500, 6000], some: [6500, 11000], quiet: [22000, 40000] };
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// desks and the sofa hide everything from 16 scene px above the seat down,
// so seated people are lifted until their waist meets that edge
const SEAT_COVER = 16;

export class Studio {
  constructor(world, { onOpen, onHotspot, hotLabel, onMenu, onMe, onWall, onPin }) {
    this.world = world;
    this.onOpen = onOpen;
    this.onMenu = onMenu;
    this.onMe = onMe;
    this.onWall = onWall;
    this.onPin = onPin;
    this.gathering = false;
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
        <div class="layer overlays"></div>
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
    this.overlays = world.querySelector('.overlays');
    // right-click anyone (or a desk) for quick actions
    this.el.addEventListener('contextmenu', (e) => {
      const p = e.target.closest('.person[data-key]');
      const desk = e.target.closest('[data-hot^="desk"]');
      const key = p?.dataset.key || (desk && this.model?.desk[Number(desk.dataset.hot.slice(4))]?.key);
      if (!key) return;
      e.preventDefault();
      if (key === 'me') return this.onMe?.(e);
      this.onMenu?.(key, e.clientX, e.clientY);
    });
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
    this.decoHtml = null;
    if (this.model) this.syncDecor();
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
      style: m.settings.studio?.style,
      earned: m.earned,
      music: ambience() === 'radio',
    };
    const key = JSON.stringify({ ...state, now: `${now.getHours()}:${now.getMinutes()}` });
    if (!force && key === this.paintKey) return;
    this.paintKey = key;
    paintRoom(this.backCtx, this.frontCtx, this.layout, state);
    // people share the room's light (it can be forced in settings)
    const phase = roomPhase(state);
    this.el.classList.toggle('night', phase === 'night');
    this.el.classList.toggle('dusk', phase === 'dusk');
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
    this.syncDecor();
    this.syncMe();
    this.syncCat();
    this.ready = true;
    if (!this.chatTimer) this.scheduleChat();
  }

  add(c) {
    const el = document.createElement('div');
    el.className = 'person';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.dataset.key = c.key;
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
    const sig = `${doodle}|${c.seed}|${c.stage}|${c.energy}|${c.kind}|${JSON.stringify(c.traits || '')}|${c.brand?.color || ''}`;
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
    cl.toggle('has-letter', !!c.letter);
    let env = it.el.querySelector('.letter-badge');
    if (c.letter && !env) {
      env = document.createElement('span');
      env.className = 'letter-badge';
      env.title = 'past you left a note';
      env.textContent = '✉';
      it.el.append(env);
    } else if (!c.letter && env) env.remove();
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
    if (this.me) this.tickMe(dt, t);
    if (this.cat) this.tickCat(dt, t);
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
    if (it.tx === null) {
      if (this.gathering && it.mode === 'wander' && it.meetSpot) {
        if (Math.hypot(it.x - it.meetSpot.x, it.y - it.meetSpot.y) < 1) return;
        [it.tx, it.ty] = [it.meetSpot.x, it.meetSpot.y];
      } else [it.tx, it.ty] = this.nextStop(it, zone);
    }
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
    const ctx = { user: this.model.user, now: this.model.now, voice: this.model.settings.voice };
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
    bubble.style.marginLeft = '0px';
    requestAnimationFrame(() => {
      // keep bubbles inside the room near the edges
      const r = bubble.getBoundingClientRect();
      const host = this.world.getBoundingClientRect();
      const dx = r.right > host.right - 6 ? host.right - 6 - r.right : r.left < host.left + 6 ? host.left + 6 - r.left : 0;
      bubble.style.marginLeft = `${dx}px`;
      bubble.classList.add('show');
    });
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

  // ------------------------------------------------------------ the walls: sign, board, pins, notes, polaroids, desk screens

  syncDecor() {
    const m = this.model;
    const L = this.layout;
    const S = this.S;
    if (!m || !L) return;
    const st = m.settings.studio || {};
    const box = (r) => `left:${r.x * S}px;top:${r.y * S}px;width:${r.w * S}px;height:${r.h * S}px`;
    const parts = [];

    const sign = L.sign;
    if (sign) parts.push(`<div class="deco sign-text" style="${box(sign)};font-size:${Math.max(9, Math.min(sign.h * S * 0.62, (sign.w * S) / Math.max(6, (st.name || `${m.user}'s studio`).length) * 1.7))}px">${esc(st.name || `${m.user}'s studio`)}</div>`);

    const board = L.boardText || this.fallbackBoard();
    if (board && st.boardText) parts.push(`<div class="deco board-text" style="${box(board)};font-size:${Math.max(10, Math.min(board.h * S * 0.3, 22))}px">${esc(st.boardText)}</div>`);

    const pins = L.boardPins || [];
    m.pinned.slice(0, pins.length || 4).forEach((c, i) => {
      const p = pins[i] || (board ? { x: board.x + i * 16, y: board.y + board.h + 2 } : null);
      if (!p) return;
      parts.push(`<button class="deco pin-note" data-pin="${c.key}" style="left:${p.x * S}px;top:${p.y * S}px;width:${14 * S}px;height:${12 * S}px" title="${esc(c.name)}">${esc(short(c.name, 22))}</button>`);
    });

    for (const w of m.state.wall || []) {
      const style = `left:${(w.x ?? 20) * S}px;top:${(w.y ?? 20) * S}px;--tilt:${w.tilt || 0}deg`;
      if (w.kind === 'photo') parts.push(`<div class="deco wall-photo" data-wall="${w.id}" style="${style};width:${18 * S}px"><img src="${w.src}" alt=""></div>`);
      else parts.push(`<div class="deco wall-note" data-wall="${w.id}" style="${style};width:${16 * S}px;min-height:${14 * S}px;background:${w.color || '#fff3a8'};font-size:${Math.max(9, S * 2.4)}px">${esc(w.text)}</div>`);
    }

    // a project's favicon glows on the monitor while it sits at that desk
    (L.desks || []).forEach((d, i) => {
      const c = m.desk[i];
      if (!d.screen || !c?.brand?.favicon) return;
      parts.push(`<img class="deco desk-icon" src="${c.brand.favicon}" alt="" style="${box(d.screen)}">`);
    });

    const rec = this.layout.hotspots.find((h) => h.id === 'record');
    if (rec && ambience() === 'radio') parts.push(`<div class="deco music-notes" style="left:${(rec.x + rec.w / 2) * S}px;top:${rec.y * S}px"><i>♪</i><i>♫</i></div>`);

    const html = parts.join('');
    if (html !== this.decoHtml) {
      this.decoHtml = html;
      this.overlays.innerHTML = html;
    }
    if (!this.decoWired) this.wireDecor();
  }

  fallbackBoard() {
    const b = this.layout.hotspots.find((h) => h.id === 'board');
    return b ? { x: b.x + 4, y: b.y + 4, w: Math.round(b.w * 0.5), h: Math.round(b.h * 0.4) } : null;
  }

  // a free spot on the wall for a new sticky note or polaroid (scene px)
  freeWallSpot() {
    const spots = this.layout.wallSpots || [];
    const taken = (this.model?.state.wall || []).map((w) => ({ x: w.x, y: w.y }));
    for (const s of spots) if (!taken.some((t) => Math.abs(t.x - s.x) < 10 && Math.abs(t.y - s.y) < 10)) return { x: s.x, y: s.y };
    const n = taken.length;
    return { x: 30 + (n % 6) * 22, y: 18 + Math.floor(n / 6) * 20 };
  }

  wireDecor() {
    this.decoWired = true;
    let drag = null;
    this.overlays.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-wall]');
      if (!el || e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      drag = { el, id: el.dataset.wall, sx: e.clientX, sy: e.clientY, x0: el.offsetLeft, y0: el.offsetTop, moved: false };
    });
    this.overlays.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      drag.el.style.left = `${drag.x0 + dx}px`;
      drag.el.style.top = `${drag.y0 + dy}px`;
    });
    const end = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.moved) return;
      const x = Math.max(0, Math.round(d.el.offsetLeft / this.S));
      const y = Math.max(0, Math.min(this.layout.floorY - 8, Math.round(d.el.offsetTop / this.S)));
      this.onWall?.('move', d.id, { x, y });
    };
    this.overlays.addEventListener('pointerup', end);
    this.overlays.addEventListener('pointercancel', end);
    this.overlays.addEventListener('dblclick', (e) => {
      const el = e.target.closest('[data-wall]');
      if (el) this.onWall?.('edit', el.dataset.wall, null, el);
    });
    this.overlays.addEventListener('click', (e) => {
      const pin = e.target.closest('[data-pin]');
      if (pin) this.onPin?.(pin.dataset.pin, pin);
    });
  }

  // ------------------------------------------------------------ you

  syncMe() {
    const m = this.model;
    const traits = m.settings.studio?.me || null;
    const seed = this.meSeed?.() ?? 1;
    const sig = `${seed}|${JSON.stringify(traits)}`;
    if (!this.me) {
      const el = document.createElement('div');
      el.className = 'person me';
      el.dataset.key = 'me';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.innerHTML = '<div class="art"><canvas></canvas></div><div class="tag"><b></b><span>that’s you</span></div>';
      el.addEventListener('click', (e) => this.onMe?.(e));
      const L = this.layout;
      this.me = { el, canvas: el.querySelector('canvas'), x: (L.chair?.x ?? L.walk.left + 30), y: (L.chair?.y ?? L.walk.top + 6), tx: null, ty: null, mode: null, pause: 0, left: false };
      this.walkers.append(el);
    }
    if (sig !== this.me.sig) {
      this.me.sig = sig;
      this.me.frames = person(seed, { mood: 'lively', stage: 'growing', traits });
      this.me.drawn = null;
    }
    this.me.el.querySelector('.tag b').textContent = m.user;
  }

  // where you are: next to what you're focusing on or just edited, else in your chair
  meTarget() {
    const focus = focusOn();
    const now = Date.now();
    let target = focus && this.items.get(focus.key);
    if (!target) {
      let best = null;
      for (const it of this.items.values()) {
        if (it.c.type !== 'project' || it.mode === 'hidden') continue;
        if (now - it.c.p.lastTouched < 15 * 60000 && (!best || it.c.p.lastTouched > best.c.p.lastTouched)) best = it;
      }
      target = best;
    }
    return target;
  }

  tickMe(dt, t) {
    const me = this.me;
    const L = this.layout;
    const W = this.zone(L.walk);
    const target = this.meTarget();
    let mode;
    let gx;
    let gy;
    if (target) {
      mode = 'visit';
      const side = target.x < (W.left + W.right) / 2 ? 1 : -1;
      gx = clamp(target.x + side * (SPRITE_W - 4), W.left, W.right);
      gy = clamp(['desk', 'sofa', 'egg'].includes(target.mode) ? W.top + 2 : target.y + 1, W.top, W.bottom);
    } else if (L.chair) {
      mode = 'chair';
      [gx, gy] = [L.chair.x, L.chair.y];
    } else {
      mode = 'idle';
      [gx, gy] = [W.left + 30, W.top + 8];
    }
    const dist = Math.hypot(gx - me.x, gy - me.y);
    me.walking = false;
    if (dist > 0.8 && !reduced.matches) {
      const move = Math.min(dist, 16 * dt);
      me.x += ((gx - me.x) / dist) * move;
      me.y += ((gy - me.y) / dist) * move;
      me.left = gx < me.x;
      me.walking = true;
    } else if (dist > 0.8) {
      me.x = gx;
      me.y = gy;
    }
    const seated = mode === 'chair' && !me.walking;
    const layer = seated ? this.seated : this.walkers;
    if (me.el.parentElement !== layer) layer.append(me.el);
    const f = me.frames;
    const frame = me.walking ? f.walk[Math.floor(t / 170) % 2] : seated ? f.stand : f.stand;
    const S = this.S;
    if (frame !== me.drawn) {
      me.canvas.width = frame.width;
      me.canvas.height = frame.height;
      me.canvas.style.width = `${frame.width * S}px`;
      me.canvas.style.height = `${frame.height * S}px`;
      me.canvas.getContext('2d').drawImage(frame, 0, 0);
      me.drawn = frame;
    }
    const w = frame.width * S;
    const h = frame.height * S;
    const feet = seated ? (WAIST_Y + SEAT_COVER) * S : FEET_Y * S;
    const x = Math.round(me.x) * S - Math.round(w / 2);
    const y = Math.round(me.y) * S - Math.round(feet);
    me.el.style.transform = `translate(${x}px, ${y}px)`;
    me.el.style.width = `${w}px`;
    me.el.style.height = `${h}px`;
    me.el.style.zIndex = Math.round(me.y) + 1;
    me.el.querySelector('.art').style.transform = me.walking && me.left ? 'scaleX(-1)' : '';
    me.el.dataset.mode = seated ? 'sofa' : 'wander';
  }

  // ------------------------------------------------------------ the studio cat

  async syncCat() {
    const want = this.model.settings.studio?.cat !== false;
    if (!want) {
      this.cat?.el.remove();
      this.cat = null;
      return;
    }
    if (this.cat || this.catLoading) return;
    this.catLoading = true;
    let mod;
    try {
      mod = await import('./cat.js');
    } catch {
      return; // the cat sprites aren't there (yet)
    }
    const frames = mod.cat(this.meSeed?.() ?? 7);
    const el = document.createElement('div');
    el.className = 'person cat';
    el.dataset.key = 'cat';
    el.innerHTML = '<div class="art"><canvas></canvas></div>';
    el.addEventListener('click', () => {
      this.flash(this.cat, 'hop', 520);
      this.say(this.cat, ['mrrp', 'prrr…', '*slow blink*', 'mew'][Math.floor(Math.random() * 4)]);
    });
    this.cat = { el, canvas: el.querySelector('canvas'), frames, x: this.layout.walk.left + 40, y: this.layout.walk.bottom - 4, mode: 'nap', until: 0, key: 'cat', removing: false };
    this.walkers.append(el);
  }

  // naps on the busiest desk; now and then strolls around the floor
  tickCat(dt, t) {
    const cat = this.cat;
    const L = this.layout;
    const now = performance.now();
    const busiest = this.model.desk
      .map((c, i) => ({ c, i }))
      .filter(({ i }) => L.desks[i]?.cat)
      .sort((a, b) => b.c.lastActive - a.c.lastActive)[0];
    const napSpot = busiest ? L.desks[busiest.i].cat : L.naps?.[L.naps.length - 1];
    if (now > cat.until) {
      cat.mode = cat.mode === 'nap' ? 'stroll' : 'nap';
      cat.until = now + (cat.mode === 'nap' ? 40000 + Math.random() * 50000 : 9000 + Math.random() * 8000);
      const W = this.zone(L.walk);
      cat.tx = cat.mode === 'nap' && napSpot ? napSpot.x : W.left + Math.random() * (W.right - W.left);
      cat.ty = cat.mode === 'nap' && napSpot ? napSpot.y : W.top + Math.random() * (W.bottom - W.top);
    }
    const dist = Math.hypot(cat.tx - cat.x, cat.ty - cat.y);
    const walking = dist > 0.8 && !reduced.matches;
    if (walking) {
      const move = Math.min(dist, 12 * dt);
      cat.x += ((cat.tx - cat.x) / dist) * move;
      cat.y += ((cat.ty - cat.y) / dist) * move;
      cat.left = cat.tx < cat.x;
    } else if (dist > 0.8) {
      cat.x = cat.tx;
      cat.y = cat.ty;
    }
    const onDesk = !walking && cat.mode === 'nap' && busiest;
    const f = cat.frames;
    const frame = walking ? f.walk[Math.floor(t / 160) % 2] : cat.mode === 'nap' ? f.sleep : f.sit;
    const S = this.S;
    if (frame !== cat.drawn) {
      cat.canvas.width = frame.width;
      cat.canvas.height = frame.height;
      cat.canvas.style.width = `${frame.width * S}px`;
      cat.canvas.style.height = `${frame.height * S}px`;
      cat.canvas.getContext('2d').drawImage(frame, 0, 0);
      cat.drawn = frame;
    }
    const w = frame.width * S;
    const h = frame.height * S;
    cat.el.style.transform = `translate(${Math.round(cat.x) * S - Math.round(w / 2)}px, ${Math.round(cat.y) * S - h}px)`;
    cat.el.style.width = `${w}px`;
    cat.el.style.height = `${h}px`;
    // on a desk it sits on the desk top, so it belongs above the front layer
    cat.el.style.zIndex = onDesk ? 9000 : Math.round(cat.y);
    cat.el.querySelector('.art').style.transform = cat.left ? 'scaleX(-1)' : '';
  }

  // ------------------------------------------------------------ town meeting: everyone gathers at the whiteboard

  meeting(on) {
    this.gathering = !!on;
    const L = this.layout;
    const board = L.hotspots.find((h) => h.id === 'board');
    const W = this.zone(L.walk);
    const spots = L.meeting?.length
      ? L.meeting
      : Array.from({ length: 12 }, (_, i) => ({ x: clamp((board ? board.x + board.w / 2 : (W.left + W.right) / 2) + ((i % 6) - 2.5) * (SPRITE_W - 2), W.left, W.right), y: W.top + 3 + Math.floor(i / 6) * 9 }));
    let n = 0;
    for (const it of this.items.values()) {
      if (it.mode !== 'wander') continue;
      it.meetSpot = on ? spots[n++ % spots.length] : null;
      it.tx = null;
      it.pause = on ? Math.random() * 600 : 800;
    }
    if (on) {
      const speaker = [...this.items.values()].find((it) => it.c.onDesk) || [...this.items.values()].find((it) => it.mode === 'wander');
      if (speaker) setTimeout(() => this.say(speaker, 'order, order! town meeting ✿'), 900);
    }
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
