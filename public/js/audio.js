// Soft sounds, all made in the browser (no audio files): gentle rain on the
// window, the garden radio on the record player, and a quiet chime when a
// focus session ends. Everything is low and warm, and off by default.
let ctx = null;
let rain = null;
let radio = null;
let mode = 'off';
let wanted = 'off';

const audio = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

export async function setAmbience(next) {
  wanted = next;
  if (next === mode) return;
  stopAll();
  mode = next;
  if (next === 'off') return;
  const c = audio();
  if (c.state === 'suspended') {
    try {
      await c.resume();
    } catch {}
  }
  if (c.state !== 'running') {
    // browsers only allow sound after a click: try again on the next one
    mode = 'off';
    addEventListener('pointerdown', () => setAmbience(wanted), { once: true });
    return;
  }
  if (next === 'rain') startRain(c);
  if (next === 'radio') await startRadio(c);
}

export const ambience = () => mode;

function stopAll() {
  if (rain) {
    const { gain, src } = rain;
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    setTimeout(() => src.stop(), 1500);
    rain = null;
  }
  if (radio) radio.pause();
}

function startRain(c) {
  // brown noise, low-passed, with a slow swell, sounds like rain on glass
  const len = c.sampleRate * 4;
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.2;
    }
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1100;
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.gain.setTargetAtTime(0.16, c.currentTime, 1.2);
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.07;
  const depth = c.createGain();
  depth.gain.value = 0.03;
  lfo.connect(depth).connect(gain.gain);
  lfo.start();
  src.connect(lp).connect(gain).connect(c.destination);
  src.start();
  rain = { src, gain };
}

async function startRadio(c) {
  if (!radio) {
    const { createEngine } = await import('./music/engine.js');
    radio = createEngine(c);
  }
  if (mode === 'radio') await radio.play();
}

export function nextSong() {
  if (radio && mode === 'radio') radio.next();
}

// a soft two-note bell
export function chime() {
  try {
    const c = audio();
    if (c.state !== 'running') return;
    const t = c.currentTime;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    lp.connect(c.destination);
    [[660, 0], [880, 0.18]].forEach(([f, at]) => {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(0.07, t + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 1.4);
      o.connect(g).connect(lp);
      o.start(t + at);
      o.stop(t + at + 1.5);
    });
  } catch {}
}
