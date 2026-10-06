// The garden radio synth. Every instrument is made in the browser with Web Audio:
// music box, glockenspiel and kalimba are decaying sine partials, harp / ukulele / bass are
// Karplus-Strong plucked strings, pad and flute are live oscillators. Birds and crickets too.
// A little delay-line wobble, reverb and vinyl crackle make it sound like a record.
import { SONGS } from './songs.js';
import { arrange } from './arrange.js';

const SR = 24000; // instrument samples; plenty for sounds this soft, and half the memory
const LOOKAHEAD = 0.35; // seconds of notes scheduled ahead
const LOOKAHEAD_HIDDEN = 1.8; // background tabs only run timers about once a second
const BASE_DELAY = 0.02;
const MASTER = 0.9;

const hz = (n) => 440 * 2 ** ((n - 69) / 12);

// ---------- Sample makers ----------
// Decaying sine partials: [frequency ratio, level, seconds to fall to 1/e].
function addPartials(d, f, list) {
  const tilt = Math.min(1.6, Math.max(0.45, (440 / f) ** 0.35)); // higher notes ring shorter
  for (const [ratio, amp, decay] of list) {
    const fr = f * ratio;
    if (fr > SR * 0.45) continue;
    const w = (2 * Math.PI * fr) / SR;
    const c = 2 * Math.cos(w);
    const k = Math.exp(-1 / (decay * tilt * SR));
    let s0 = 0;
    let s1 = -Math.sin(w);
    let env = amp;
    for (let i = 0; i < d.length; i++) {
      d[i] += env * s0;
      const next = c * s0 - s1;
      s1 = s0;
      s0 = next;
      env *= k;
    }
  }
}

// Karplus-Strong plucked string. Returns the playback rate that fixes its tuning.
function addPluck(d, f, { bright = 0.6, loss = 0.998, level = 1 }) {
  const S = f > 500 ? 0.25 : 0.5; // less damping per pass for high notes
  const N = Math.max(2, Math.floor(SR / f - S));
  const line = new Float32Array(N);
  let lp = 0;
  let mean = 0;
  for (let i = 0; i < N; i++) {
    lp += bright * (Math.random() * 2 - 1 - lp);
    line[i] = lp;
    mean += lp / N;
  }
  for (let i = 0; i < N; i++) line[i] -= mean;
  let prev = 0;
  let idx = 0;
  for (let i = 0; i < d.length; i++) {
    const x = line[idx];
    line[idx] = loss * ((1 - S) * x + S * prev);
    prev = x;
    d[i] += x * level;
    idx = idx + 1 === N ? 0 : idx + 1;
  }
  return f / (SR / (N + S));
}

function noiseBurst(d, { level = 1, decay = 0.03, hp = 0, attack = 0.002 }) {
  let last = 0;
  const k = Math.exp(-1 / (decay * SR));
  const att = attack * SR;
  let env = level;
  for (let i = 0; i < d.length; i++) {
    const x = Math.random() * 2 - 1;
    const y = hp ? x - last * hp : x; // crude high-pass: difference with the last sample
    last = x;
    d[i] += y * env * Math.min(1, i / att);
    env *= k;
  }
}

function shape(d, attack = 0.002, release = 0.02) {
  const a = Math.max(1, Math.floor(attack * SR));
  const r = Math.max(1, Math.floor(release * SR));
  for (let i = 0; i < a && i < d.length; i++) d[i] *= i / a;
  for (let i = 0; i < r && i < d.length; i++) d[d.length - 1 - i] *= i / r;
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < d.length; i++) d[i] /= peak;
}

// Birdsong, as frequency curves: f(t) in Hz and a loudness envelope.
function addWhistle(d, start, length, freq, amp) {
  let phase = 0;
  const n0 = Math.floor(start * SR);
  const n = Math.floor(length * SR);
  for (let i = 0; i < n && n0 + i < d.length; i++) {
    const t = i / n;
    phase += (2 * Math.PI * freq(t)) / SR;
    d[n0 + i] += Math.sin(phase) * amp(t);
  }
}
const hump = (t) => Math.sin(Math.PI * t) ** 1.5;

const BIRDS = [
  // tweet tweet
  (d) => [0, 0.16, 0.32].forEach((s) => addWhistle(d, s, 0.075, (t) => 2800 * 1.65 ** t, hump)),
  // trill
  (d) => addWhistle(d, 0, 0.45, (t) => 4200 + 650 * Math.sin(2 * Math.PI * 28 * t * 0.45), (t) => hump(t) * (0.6 + 0.4 * Math.sin(40 * t))),
  // fee-bee
  (d) => {
    addWhistle(d, 0, 0.16, (t) => 3150 - 80 * t, hump);
    addWhistle(d, 0.2, 0.24, (t) => 2650 - 120 * t, hump);
  },
  // chip chatter
  (d) => [0, 0.08, 0.16, 0.24, 0.32].forEach((s, i) => addWhistle(d, s, 0.035, (t) => (5000 - i * 180) * (1 - 0.25 * t), hump)),
  // warble
  (d) => addWhistle(d, 0, 0.6, (t) => 3600 + 700 * Math.sin(2 * Math.PI * 7 * t) + 300 * Math.sin(2 * Math.PI * 17 * t), hump),
];

function cricket(d) {
  [0, 0.04, 0.08].forEach((s) => addWhistle(d, s, 0.022, () => 4600, hump));
}

// Pitched instruments: how long the sample is and how it's built.
const VOICES = {
  musicbox: { len: 2.2, make: (d, f) => { addPartials(d, f, [[1, 1, 1.3], [2, 0.2, 0.6], [3, 0.07, 0.3], [5.95, 0.14, 0.1], [8.1, 0.05, 0.05]]); noiseBurst(d, { level: 0.08, decay: 0.002 }); } },
  glock: { len: 1.6, make: (d, f) => addPartials(d, f, [[1, 1, 1.0], [2.76, 0.36, 0.3], [5.4, 0.16, 0.1], [8.93, 0.06, 0.05]]) },
  kalimba: { len: 1.5, make: (d, f) => { addPartials(d, f, [[1, 1, 0.8], [2, 0.08, 0.25], [5.2, 0.22, 0.07], [8.4, 0.05, 0.03]]); noiseBurst(d, { level: 0.1, decay: 0.004 }); }, attack: 0.003 },
  harp: { len: 1.9, make: (d, f) => { const r = addPluck(d, f, { bright: 0.5, loss: 0.9985 }); addPartials(d, f / r, [[1, 0.25, 0.9]]); return r; } },
  uke: { len: 1.0, make: (d, f) => addPluck(d, f, { bright: 0.75, loss: 0.996 }) },
  bass: { len: 1.5, make: (d, f) => { const r = addPluck(d, f, { bright: 0.3, loss: 0.997 }); addPartials(d, f / r, [[1, 0.8, 0.45], [2, 0.15, 0.2]]); return r; } },
};

// Unpitched sounds: one sample each (a couple of variants for the shaker).
const HITS = {
  shaker: { len: 0.14, make: (d) => noiseBurst(d, { decay: 0.035, hp: 0.95, attack: 0.006 }), variants: 2 },
  brush: { len: 0.3, make: (d) => noiseBurst(d, { decay: 0.08, hp: 0.6, attack: 0.01 }) },
  block: { len: 0.12, make: (d) => { addPartials(d, 1050, [[1, 1, 0.025], [1.6, 0.5, 0.015]]); noiseBurst(d, { level: 0.3, decay: 0.003, hp: 0.9 }); } },
  kick: {
    len: 0.35,
    make: (d) => {
      let phase = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / SR;
        phase += (2 * Math.PI * (50 + 70 * Math.exp(-t / 0.03))) / SR;
        d[i] += Math.sin(phase) * Math.exp(-t / 0.12);
      }
    },
  },
  bird: { len: 0.7, make: (d, n) => BIRDS[n](d), variants: BIRDS.length },
  cricket: { len: 0.14, make: cricket },
};

// Channel strips: level, stereo position, reverb send, optional low-pass.
const CHANNELS = {
  musicbox: { level: 0.42, pan: 0.12, rev: 0.4 },
  glock: { level: 0.22, pan: -0.18, rev: 0.45 },
  kalimba: { level: 0.5, pan: 0.05, rev: 0.32 },
  harp: { level: 0.3, pan: -0.25, rev: 0.32 },
  uke: { level: 0.2, pan: 0.28, rev: 0.18, lp: 3800 },
  bass: { level: 0.5, pan: 0, rev: 0.06, lp: 900 },
  pad: { level: 0.06, pan: 0, rev: 0.6, lp: 1400 },
  flute: { level: 0.2, pan: 0.05, rev: 0.4 },
  shaker: { level: 0.07, pan: 0.35, rev: 0.12 },
  brush: { level: 0.06, pan: -0.1, rev: 0.2 },
  block: { level: 0.1, pan: -0.3, rev: 0.25 },
  kick: { level: 0.28, pan: 0, rev: 0.02 },
  bird: { level: 0.07, pan: 0, rev: 0.7, lp: 7000 },
  cricket: { level: 0.035, pan: 0, rev: 0.5 },
};

export function createEngine(ctx) {
  const listeners = new Set();
  const emit = (type, detail) => listeners.forEach((fn) => fn(type, detail));

  // ---------- Graph ----------
  // channels → bus → wobble delay → warm low-pass → fade (pause) → compressor → volume → speakers
  const volume = ctx.createGain();
  volume.gain.value = 0;
  volume.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.25;
  comp.connect(volume);
  const fade = ctx.createGain();
  fade.gain.value = 0;
  fade.connect(comp);
  const warmth = ctx.createBiquadFilter();
  warmth.type = 'lowpass';
  warmth.frequency.value = 6500;
  warmth.Q.value = 0.5;
  warmth.connect(fade);
  // A slowly wobbling delay gives the gentle pitch "wow" of a record, and bends the pitch
  // down when the platter stops.
  const wow = ctx.createDelay(1);
  wow.delayTime.value = BASE_DELAY;
  wow.connect(warmth);
  const wowLfo = ctx.createOscillator();
  wowLfo.frequency.value = 0.55;
  const wowDepth = ctx.createGain();
  wowDepth.gain.value = 0.0006;
  wowLfo.connect(wowDepth).connect(wow.delayTime);
  wowLfo.start();
  const bus = ctx.createGain();
  bus.connect(wow);
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 2.6);
  reverb.connect(wow);

  const channels = {};
  for (const [name, c] of Object.entries(CHANNELS)) {
    const input = ctx.createGain();
    input.gain.value = c.level;
    let node = input;
    if (c.lp) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = c.lp;
      node = node.connect(lp);
    }
    const pan = ctx.createStereoPanner();
    pan.pan.value = c.pan;
    node.connect(pan);
    pan.connect(bus);
    const send = ctx.createGain();
    send.gain.value = c.rev;
    pan.connect(send).connect(reverb);
    channels[name] = input;
  }

  // Vinyl crackle loops under everything.
  const crackleGain = ctx.createGain();
  crackleGain.gain.value = 0.5;
  crackleGain.connect(fade);
  const crackle = ctx.createBufferSource();
  crackle.buffer = crackleBuffer(ctx);
  crackle.loop = true;
  crackle.connect(crackleGain);
  crackle.start();

  const noise = ctx.createBuffer(1, SR, SR);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }

  // ---------- Samples ----------
  const cache = new Map();
  function sample(inst, n) {
    const key = `${inst}:${n}`;
    let s = cache.get(key);
    if (s) return s;
    const def = VOICES[inst] || HITS[inst];
    const buf = ctx.createBuffer(1, Math.ceil(def.len * SR), SR);
    const d = buf.getChannelData(0);
    let rate = 1;
    if (VOICES[inst]) rate = def.make(d, hz(n)) || 1;
    else def.make(d, def.variants ? n % def.variants : 0);
    shape(d, def.attack || 0.0015, 0.03);
    s = { buf, rate };
    cache.set(key, s);
    return s;
  }
  // Pitched samples are specific to a song; drop them when the song changes.
  function forgetPitched() {
    for (const key of cache.keys()) if (VOICES[key.split(':')[0]]) cache.delete(key);
  }

  // Everything currently sounding, so skipping a song can silence it.
  let live = [];
  const track = (node, end) => live.push({ node, end });

  function out(inst, v, pan) {
    const g = ctx.createGain();
    g.gain.value = v;
    if (pan === undefined) g.connect(channels[inst]);
    else {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(channels[inst]);
    }
    return g;
  }

  function playSample(e, at) {
    const { buf, rate } = sample(e.inst, e.n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (e.rate || 1);
    const g = out(e.inst, e.v, e.pan);
    src.connect(g);
    let end = at + buf.duration / src.playbackRate.value;
    // Bass and ukulele strings are damped when the note ends; the rest ring out.
    if ((e.inst === 'bass' || e.inst === 'uke') && e.dur) {
      const stop = at + e.dur;
      g.gain.setValueAtTime(e.v, stop);
      g.gain.setTargetAtTime(0, stop, 0.06);
      end = Math.min(end, stop + 0.5);
    }
    src.start(at);
    src.stop(end);
    track(src, end);
  }

  function playPad(e, at) {
    const g = out('pad', 0);
    const attack = Math.min(0.6, e.dur * 0.6);
    const end = at + e.dur + 1.1;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(e.v, at + attack);
    g.gain.setValueAtTime(e.v, at + e.dur);
    g.gain.linearRampToValueAtTime(0, end - 0.05);
    for (const [type, cents, level] of [['triangle', -6, 1], ['sawtooth', 7, 0.25]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz(e.n);
      o.detune.value = cents;
      if (level === 1) o.connect(g);
      else {
        const l = ctx.createGain();
        l.gain.value = level;
        o.connect(l).connect(g);
      }
      o.start(at);
      o.stop(end);
      track(o, end);
    }
  }

  function playFlute(e, at) {
    const f = hz(e.n);
    const dur = Math.max(0.12, e.dur * 0.95);
    const end = at + dur + 0.3;
    const g = out('flute', 0);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(e.v, at + 0.05);
    g.gain.linearRampToValueAtTime(e.v * 0.78, at + 0.2);
    g.gain.setValueAtTime(e.v * 0.78, at + dur);
    g.gain.setTargetAtTime(0, at + dur, 0.05);
    const tone = ctx.createOscillator();
    tone.frequency.value = f;
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = f;
    const bodyLevel = ctx.createGain();
    bodyLevel.gain.value = 0.22;
    tone.connect(g);
    body.connect(bodyLevel).connect(g);
    // Vibrato fades in on longer notes.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, at);
    if (dur > 0.35) depth.gain.linearRampToValueAtTime(f * 0.005, at + 0.35);
    lfo.connect(depth);
    depth.connect(tone.frequency);
    depth.connect(body.frequency);
    // Breath: a puff of band-passed noise at the start of the note.
    const breath = ctx.createBufferSource();
    breath.buffer = noise;
    breath.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = Math.min(9000, f * 2);
    band.Q.value = 1.2;
    const puff = ctx.createGain();
    puff.gain.setValueAtTime(0, at);
    puff.gain.linearRampToValueAtTime(0.35, at + 0.03);
    puff.gain.linearRampToValueAtTime(0.06, at + 0.16);
    puff.gain.setTargetAtTime(0, at + dur, 0.04);
    breath.connect(band).connect(puff).connect(g);
    for (const node of [tone, body, lfo, breath]) {
      node.start(at);
      node.stop(end);
    }
    track(tone, end);
    track(body, end);
    track(lfo, end);
    track(breath, end);
  }

  function fire(e, at) {
    if (e.inst === 'pad') playPad(e, at);
    else if (e.inst === 'flute') playFlute(e, at);
    else playSample(e, at);
  }

  // ---------- Transport ----------
  let index = 0;
  let plan = null;
  let start = 0;
  let ptr = 0;
  let scheduled = 0; // song time up to which notes have been handed to the audio clock
  let paused = true;
  let muted = false;
  let level = 0.6;

  function load(i, offset = 0, lead = 0.12) {
    index = (i + SONGS.length) % SONGS.length;
    forgetPitched();
    plan = arrange(SONGS[index]);
    offset = Math.min(Math.max(0, offset), plan.duration - 1);
    start = ctx.currentTime + lead - offset;
    scheduled = offset;
    ptr = plan.events.findIndex((e) => e.sec >= offset);
    if (ptr < 0) ptr = plan.events.length;
    emit('song', index);
  }

  function tick() {
    if (!plan || ctx.state !== 'running' || paused) return;
    const horizon = ctx.currentTime + (document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD);
    while (ptr < plan.events.length && start + plan.events[ptr].sec < horizon) {
      const e = plan.events[ptr++];
      try { fire(e, Math.max(ctx.currentTime, start + e.sec)); } catch (err) { /* one odd note is never worth stopping the music */ }
    }
    scheduled = horizon - start;
    if (live.length > 200) live = live.filter((l) => l.end > ctx.currentTime);
    if (ctx.currentTime > start + plan.duration) load(index + 1, 0, 1.2); // a breath between songs
  }
  setInterval(tick, 40);

  // AudioParam helpers. Firefox has no cancelAndHoldAtTime, so hold by hand.
  function hold(param, at) {
    const v = param.value;
    param.cancelScheduledValues(0);
    param.setValueAtTime(v, at);
    return v;
  }

  // The needle speeds up to 33⅓: pitch slides up from low into tune.
  function spinUp(time = 0.55) {
    const now = ctx.currentTime;
    const d0 = hold(wow.delayTime, now);
    const a = 0.55; // starts at 45% speed
    const curve = new Float32Array(32).map((_, i) => {
      const t = (i / 31) * time;
      return d0 + a * t - (a / (2 * time)) * t * t;
    });
    try { wow.delayTime.setValueCurveAtTime(curve, now + 0.005, time); } catch (err) { /* pitch bend is decoration */ }
    hold(fade.gain, now);
    fade.gain.linearRampToValueAtTime(1, now + time * 0.8);
  }

  // The platter slows to a stop: pitch sags and the sound fades.
  function brake(time = 0.8) {
    const now = ctx.currentTime;
    const d0 = hold(wow.delayTime, now);
    const k = 0.75 / (2 * time); // ends at 25% speed
    const curve = new Float32Array(32).map((_, i) => {
      const t = (i / 31) * time;
      return d0 + k * t * t;
    });
    try { wow.delayTime.setValueCurveAtTime(curve, now + 0.005, time); } catch (err) { /* pitch bend is decoration */ }
    hold(fade.gain, now);
    fade.gain.linearRampToValueAtTime(0, now + time);
    return time;
  }

  function applyVolume(ramp = 0.15) {
    const now = ctx.currentTime;
    hold(volume.gain, now);
    volume.gain.linearRampToValueAtTime(muted ? 0 : MASTER * level * level, now + ramp);
  }

  // Suspend the audio when nothing can be heard, so it costs no battery.
  let sleepTimer;
  function settle(delay) {
    clearTimeout(sleepTimer);
    if (!paused && !muted) return;
    sleepTimer = setTimeout(async () => {
      if (!paused && !muted) return;
      try { await ctx.suspend(); } catch (err) { /* already closed */ }
      if (paused) {
        wow.delayTime.cancelScheduledValues(0);
        wow.delayTime.setValueAtTime(BASE_DELAY, ctx.currentTime);
      }
    }, delay);
  }

  // After a pause, carry on from the last scheduled note instead of catching up in a rush.
  function rebase() {
    if (plan) start = ctx.currentTime + 0.1 - scheduled;
  }

  async function wake() {
    clearTimeout(sleepTimer);
    if (ctx.state !== 'running') await ctx.resume();
  }

  function silenceLive(at) {
    live.forEach((l) => { try { l.node.stop(at); } catch (err) { /* already stopped */ } });
    live = [];
  }

  // Skip to another song: dip the sound, cut what's ringing, start fresh.
  function skip(i) {
    const now = ctx.currentTime;
    hold(fade.gain, now);
    fade.gain.linearRampToValueAtTime(0, now + 0.08);
    silenceLive(now + 0.1);
    load(i, 0, 0.5);
    if (!paused) fade.gain.linearRampToValueAtTime(1, now + 0.45);
  }

  return {
    songs: SONGS,
    get index() { return index; },
    get playing() { return !paused; },
    get position() { return plan ? Math.min(plan.duration, Math.max(0, ctx.currentTime - start)) : 0; },
    get duration() { return plan ? plan.duration : 0; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async play(i = index, offset = 0) {
      paused = false;
      await wake();
      if (paused) return; // paused again while the audio woke up
      if (!plan || i !== index || offset) {
        silenceLive(ctx.currentTime);
        load(i, offset, 0.2);
      } else rebase();
      spinUp();
      applyVolume(0.3);
    },
    pause() {
      if (paused) return 0;
      paused = true;
      const t = brake();
      settle(t * 1000 + 80);
      return t;
    },
    async resume() {
      if (!paused) return;
      paused = false;
      await wake();
      if (paused) return;
      if (!plan) load(index);
      else rebase();
      spinUp();
      applyVolume(0.3);
    },
    next() { skip(index + 1); },
    prev() {
      // Like a CD player: back to the start of this song first, then the one before.
      skip(this.position > 4 ? index : index - 1);
    },
    async setMuted(value) {
      muted = !!value;
      if (!muted && !paused) await wake();
      applyVolume(0.2);
      settle(260);
    },
    setVolume(value) {
      level = Math.min(1, Math.max(0, value));
      applyVolume(0.1);
    },
    setCrackle(on) {
      const now = ctx.currentTime;
      hold(crackleGain.gain, now);
      crackleGain.gain.linearRampToValueAtTime(on ? 0.5 : 0, now + 0.2);
    },
  };
}

// Stereo room reverb: decaying noise that gets darker as it fades.
function impulse(ctx, seconds) {
  const rate = ctx.sampleRate;
  const len = Math.floor(seconds * rate);
  const buf = ctx.createBuffer(2, len, rate);
  const pre = Math.floor(0.012 * rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / rate;
      const cutoff = 0.55 * Math.exp(-t / 0.9) + 0.06;
      lp += cutoff * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-t / 0.42) * 0.9;
    }
  }
  return buf;
}

// Six seconds of record noise: soft hiss, small ticks and the odd pop.
function crackleBuffer(ctx) {
  const len = 6 * SR;
  const buf = ctx.createBuffer(1, len, SR);
  const d = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    lp += 0.2 * (Math.random() * 2 - 1 - lp);
    d[i] = lp * 0.02;
  }
  for (let i = 0; i < len; i++) {
    if (Math.random() > 7 / SR) continue;
    const amp = (Math.random() ** 3) * 0.5 + 0.03;
    const decay = (0.0002 + Math.random() * 0.0008) * SR;
    const sign = Math.random() < 0.5 ? -1 : 1;
    for (let j = 0; j < decay * 5 && i + j < len; j++) d[i + j] += sign * amp * Math.exp(-j / decay) * (j % 2 ? -0.6 : 1);
  }
  return buf;
}
