// Turns a song from songs.js into a list of timed notes for the engine to play.
// The melody is written out; bass, harp, strums, pads, percussion and birdsong are
// generated from the chords, with a little randomness so every play sounds a bit different.
import { RING_OUT } from './songs.js';

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITY = {
  '': [0, 4, 7], m: [0, 3, 7], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11], sus4: [0, 5, 7], '7sus4': [0, 5, 7, 10], dim7: [0, 3, 6, 9],
};

const accidental = (s) => (s === '#' ? 1 : s === 'b' ? -1 : 0);
const pitchClass = (name) => (LETTER[name[0]] + accidental(name[1]) + 12) % 12;

// "F#5" → MIDI note number.
export function noteNumber(name) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!m) throw new Error(`Unknown note "${name}"`);
  return 12 * (Number(m[3]) + 1) + LETTER[m[1]] + accidental(m[2]);
}

// "Bbm6" or "G/B" → pitch classes plus the bass note.
function parseChord(symbol) {
  const [main, slash] = symbol.split('/');
  const m = /^([A-G][#b]?)(.*)$/.exec(main);
  const tones = m && QUALITY[m[2]];
  if (!tones) throw new Error(`Unknown chord "${symbol}"`);
  const root = pitchClass(m[1]);
  return { root, tones: tones.map((t) => (root + t) % 12), bass: slash ? pitchClass(slash) : root };
}

// Up to `max` chord tones between two MIDI notes, lowest first.
function voicing(chord, lo, hi, max = 4) {
  const out = [];
  for (let n = lo; n <= hi && out.length < max; n++) if (chord.tones.includes(n % 12)) out.push(n);
  return out;
}

// The first MIDI note at or above `lo` with this pitch class.
function above(pc, lo) {
  let n = lo;
  while (n % 12 !== pc) n++;
  return n;
}

export function parseSection(section, barLength) {
  const bars = section.chords.split('|').map((bar) => bar.trim().split(/\s+/).map(parseChord));
  const melodyBars = section.melody.split('|');
  if (melodyBars.length !== bars.length) throw new Error(`${melodyBars.length} melody bars but ${bars.length} chord bars`);
  const notes = [];
  const rests = [];
  melodyBars.forEach((bar, i) => {
    let used = 0;
    bar.trim().split(/\s+/).filter(Boolean).forEach((token) => {
      const [name, length] = token.split(':');
      const d = length ? Number(length) : 1;
      const t = i * barLength + used;
      if (name === '~') notes[notes.length - 1].d += d;
      else if (name === 'r') rests.push({ t, d });
      else notes.push({ t, d, n: noteNumber(name) });
      used += d;
    });
    if (Math.abs(used - barLength) > 1e-6) throw new Error(`Melody bar ${i + 1} is ${used} beats, not ${barLength}`);
  });
  return { bars, notes, rests };
}

// Small seeded random generator, so one play is consistent with itself.
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Accompaniment, one chord at a time ----------
// Each writes notes with `add(beat, lengthInBeats, instrument, midi, velocity, extra)`.
const FEELS = {
  // Oom-pah-pah: bass on one, a rolled harp chord on two and three.
  waltz({ add, chord, b, len, bar, last, perc }) {
    const bass = above(bar % 2 && !last ? (chord.root + 7) % 12 : chord.bass, 40);
    const harp = voicing(chord, 55, 70, 3);
    if (last) {
      add(b, len * 2, 'bass', above(chord.bass, 40), 0.8);
      harp.forEach((n, k) => add(b + k * 0.08, len * 2, 'harp', n, 0.5));
      return;
    }
    add(b, 1, 'bass', bass, 0.8);
    for (const beat of [1, 2]) {
      if (beat >= len) continue;
      harp.forEach((n, k) => add(b + beat + k * 0.03, 0.9, 'harp', n, beat === 1 ? 0.44 : 0.36));
    }
    if (perc) {
      add(b, 0.5, 'brush', 0, 0.35);
      add(b + 1, 0.5, 'shaker', 0, 0.55);
      add(b + 2, 0.5, 'shaker', 1, 0.4);
    }
  },

  // Swingy ukulele strums with a walking-ish bass.
  strum({ add, chord, b, len, last, perc }) {
    const uke = voicing(chord, 60, 72, 4);
    if (last) {
      add(b, len, 'bass', above(chord.bass, 40), 0.8);
      uke.forEach((n, k) => add(b, len, 'uke', n, 0.6, { off: k * 0.02 }));
      return;
    }
    add(b, 1.5, 'bass', above(chord.bass, 40), 0.8);
    if (len > 2) add(b + 2, 1.5, 'bass', above((chord.root + 7) % 12, 40), 0.68);
    const pattern = [[0, 0.62, 1], [1, 0.46, 1], [1.5, 0.3, -1], [2.5, 0.36, -1], [3, 0.5, 1], [3.5, 0.3, -1]];
    for (const [t, v, dir] of pattern) {
      if (t >= len) continue;
      const tones = dir > 0 ? uke : [...uke].reverse();
      tones.forEach((n, k) => add(b + t, 0.45, 'uke', n, v, { off: k * 0.012 }));
    }
    if (perc) {
      for (let t = 0; t < len; t += 0.5) add(b + t, 0.25, 'shaker', (t * 2) % 2, t % 1 ? 0.5 : 0.28);
      for (const t of [1, 3]) if (t < len) add(b + t, 0.25, 'block', 0, 0.5);
      for (const t of [0, 2]) if (t < len) add(b + t, 0.5, 'kick', 0, 0.55);
    }
  },

  // 6/8 harp arpeggios that roll up and back down.
  arp68({ add, chord, b, len, last, perc }) {
    const harp = voicing(chord, 55, 76, 4);
    if (last) {
      add(b, len * 2, 'bass', above(chord.bass, 40), 0.7);
      harp.forEach((n, k) => add(b + k * 0.25, len * 2, 'harp', n, 0.45));
      return;
    }
    add(b, 3, 'bass', above(chord.bass, 40), 0.7);
    if (len > 3) add(b + 3, 3, 'bass', above((chord.root + 7) % 12, 40), 0.55);
    [0, 1, 2, 3, 2, 1].forEach((k, i) => {
      if (i < len) add(b + i, 1.6, 'harp', harp[k % harp.length], i % 3 ? 0.3 : 0.42);
    });
    if (perc) {
      add(b, 0.5, 'shaker', 0, 0.25);
      if (len > 3) add(b + 3, 0.5, 'shaker', 1, 0.4);
    }
  },

  // Slow broken chords in eighths, for the evening song.
  lullaby({ add, chord, b, len, last }) {
    const harp = voicing(chord, 57, 74, 4);
    add(b, last ? len * 2 : len, 'bass', above(chord.bass, 40), 0.5);
    if (last) {
      harp.forEach((n, k) => add(b + k * 0.12, len * 2, 'harp', n, 0.36));
      return;
    }
    [0, 1, 2, 3, 2, 1].forEach((k, i) => {
      if (i * 0.5 < len) add(b + i * 0.5, 1.2, 'harp', harp[k % harp.length], i ? 0.26 : 0.34);
    });
  },
};

// Everything the engine needs to play one song: notes in seconds, sorted, plus the length.
export function arrange(song, seed = Date.now()) {
  const rand = random(seed);
  const spb = 60 / song.bpm;
  const scale = [0, 2, 4, 5, 7, 9, 11].map((s) => (pitchClass(song.key) + s) % 12);
  const parsed = Object.fromEntries(Object.entries(song.sections).map(([k, s]) => [k, parseSection(s, song.bar)]));
  const notes = [];
  const add = (beat, d, inst, n, v, extra) => notes.push({ beat, d, inst, n, v, ...extra });

  let barAt = 0;
  for (const [name, opt] of song.form) {
    const sec = parsed[name];
    const b0 = barAt * song.bar;

    sec.bars.forEach((chords, i) => {
      const last = !!opt.end && i === sec.bars.length - 1;
      const len = song.bar / chords.length;
      chords.forEach((chord, c) => {
        const b = b0 + i * song.bar + c * len;
        FEELS[song.feel]({ add, chord, b, len, bar: i, last, perc: opt.perc && !last });
        if (opt.pad) voicing(chord, 52, 67, 4).forEach((n) => add(b, last ? len * 2 : len, 'pad', n, 0.5));
      });
    });

    for (const note of sec.notes) {
      const beat = b0 + note.t;
      const strong = note.t % song.bar === 0;
      add(beat, note.d, opt.lead, note.n, strong ? 0.85 : 0.72);
      if (opt.double) add(beat, note.d, opt.double, note.n + 12, 0.3);
      // A quick grace note from the scale step above, now and then.
      if (note.d >= 1 && rand() < 0.12) {
        let g = note.n + 1;
        while (!scale.includes(g % 12)) g++;
        add(beat, 0.08, opt.lead, g, 0.4, { off: -0.07 });
      }
    }

    // Glockenspiel sparkles fill the longer gaps in the melody.
    if (name !== 'intro') {
      for (const rest of sec.rests) {
        if (rest.d < 2 || rand() < 0.35) continue;
        const bar = Math.floor(rest.t / song.bar);
        const tones = voicing(sec.bars[bar][0], 72, 88, 4);
        tones.forEach((n, k) => add(b0 + rest.t + k * 0.5, 0.5, 'glock', n, 0.28 - k * 0.03));
      }
    }
    barAt += sec.bars.length;
  }

  const duration = barAt * song.bar * spb + RING_OUT;
  const swing = (beat) => {
    const frac = beat % 1;
    return song.swing && Math.abs(frac - 0.5) < 1e-6 ? beat - frac + song.swing : beat;
  };
  const events = notes.map((e) => {
    const loose = !(e.inst === 'bass' && e.beat % song.bar === 0);
    return {
      sec: Math.max(0, swing(e.beat) * spb + (e.off || 0) + (loose ? (rand() - 0.5) * 0.012 : 0)),
      dur: e.d * spb,
      inst: e.inst,
      n: e.n,
      v: e.v * (0.92 + rand() * 0.16),
    };
  });

  // Garden sounds: birds by day, crickets for the dusk song.
  if (song.ambience === 'birds') {
    for (let t = 2 + rand() * 3; t < duration - RING_OUT - 2; t += 4 + rand() * 8) {
      events.push({ sec: t, inst: 'bird', n: Math.floor(rand() * 5), v: 0.5 + rand() * 0.5, pan: rand() * 1.6 - 0.8 });
    }
  } else if (song.ambience === 'crickets') {
    for (let t = 0.5; t < duration - 1; t += 0.9 + rand() * 0.7) {
      if (rand() < 0.75) events.push({ sec: t, inst: 'cricket', n: 0, v: 0.4 + rand() * 0.4, pan: rand() * 1.2 - 0.6, rate: 0.96 + rand() * 0.08 });
    }
  }

  events.sort((a, b) => a.sec - b.sec);
  return { events, duration };
}
