// Garden radio: four original tunes written for tiny tools club, played by music/engine.js.
// Nothing here is a recording, so there is nothing to license. Anyone can listen for free.
//
// A song is a few sections (chords + melody) and a `form` that strings them together.
//   chords: one chord per bar, split by "|". Two chords in one bar share it evenly ("Am7 D7").
//   melody: notes per bar, split by "|". "A5" is one beat, "A5:2" two beats, "r" is a rest,
//           "~:2" holds the previous note two beats longer (for ties across a bar line).
//   form:   [section, options]. `lead` is the melody instrument, `double` plays it an octave up,
//           `perc` adds shakers and snaps, `pad` adds a soft chord pad, `end` rings out the last chord.
// `beat` is what one melody unit means: quarter notes, except in 6/8 where it's an eighth.

// Seconds the last chord rings after the final bar, before the next song starts.
export const RING_OUT = 3;

// Song length in seconds, from the bars in its form.
export function songSeconds(song) {
  const bars = song.form.reduce((sum, [name]) => sum + song.sections[name].chords.split('|').length, 0);
  return (bars * song.bar * 60) / song.bpm + RING_OUT;
}

export const SONGS = [
  {
    id: 'tea-for-two-bees',
    title: 'tea for two bees',
    key: 'F',
    bpm: 132,
    bar: 3,
    feel: 'waltz',
    ambience: 'birds',
    sections: {
      intro: {
        chords: 'F | Bb | F | C7',
        melody: 'r:3 | r:3 | r:3 | C6 A5 G5',
      },
      A: {
        chords: 'F | Dm7 | Gm7 | C7 | F | Am7 | Bb | C7 | F | Dm7 | Gm7 | C7 | D7 | Gm7 | C7 | F',
        melody: 'C5 F5 A5 | G5:2 F5 | D5 E5 F5 | E5:2 C5 | C5 F5 A5 | C6:2 A5 | Bb5 A5 G5 | G5:3 |'
          + ' C5 F5 A5 | G5:2 F5 | D5 E5 F5 | E5 G5 Bb5 | C6:2 A5 | Bb5 A5 G5 | E5:2 G5 | F5:3',
      },
      B: {
        chords: 'Bb | Bbm6 | Am7 | D7 | Gm7 | C7 | F | C7',
        melody: 'D5 F5 Bb5 | Db6:2 Bb5 | C6 A5 E5 | F#5:2 A5 | Bb5 A5 G5 | E5 G5 Bb5 | A5:2 F5 | E5 D5 C5',
      },
      outro: {
        chords: 'F | Bb | F | F',
        melody: 'C6 A5 F5 | D6:2 Bb5 | A5:3 | F5:3',
      },
    },
    form: [
      ['intro', { lead: 'musicbox' }],
      ['A', { lead: 'musicbox' }],
      ['B', { lead: 'flute', perc: true }],
      ['A', { lead: 'flute', double: 'glock', perc: true, pad: true }],
      ['B', { lead: 'musicbox', perc: true, pad: true }],
      ['A', { lead: 'musicbox', double: 'glock', pad: true }],
      ['outro', { lead: 'musicbox', end: true }],
    ],
  },
  {
    id: 'picnic-in-the-clover',
    title: 'picnic in the clover',
    key: 'C',
    bpm: 108,
    bar: 4,
    swing: 0.6,
    feel: 'strum',
    ambience: 'birds',
    sections: {
      intro: {
        chords: 'C | Am7 | Dm7 | G7',
        melody: 'r:4 | r:4 | r:4 | G5 A5 B5 D6',
      },
      A: {
        chords: 'C | Am7 | Dm7 | G7 | C | Am7 | Dm7 | G7 | C | Am7 | Dm7 | G7 | F | G7 | C | C',
        melody: 'E5 G5 A5:.5 G5:.5 E5 | C5:1.5 D5:.5 E5:2 | F5 A5 G5:.5 F5:.5 D5 | B4:1.5 C5:.5 D5:2 |'
          + ' E5 G5 C6 B5:.5 A5:.5 | A5:1.5 G5:.5 E5:2 | F5:.5 E5:.5 D5 A5 F5 | G5:2 r:2 |'
          + ' E5 G5 A5:.5 G5:.5 E5 | C5:1.5 D5:.5 E5:2 | F5 A5 C6 A5 | G5:3 r |'
          + ' A5:1.5 G5:.5 F5 A5 | G5:1.5 F5:.5 D5 B4 | C5:4 | r:4',
      },
      B: {
        chords: 'F | Fm6 | Em7 | A7 | Dm7 | G7 | C | G7',
        melody: 'A5 C6 A5 F5 | Ab5:2 F5 D5 | G5 B5 G5 E5 | C#5:2 E5 G5 | F5:1.5 E5:.5 D5 F5 | B5:1.5 A5:.5 G5 F5 | E5 D5 C5 G4 | D5:2 r:2',
      },
      outro: {
        chords: 'C | F | C | C',
        melody: 'E5 G5 C6 G5 | A5 C6 A5 F5 | E5:2 G5:2 | C6:4',
      },
    },
    form: [
      ['intro', { lead: 'glock' }],
      ['A', { lead: 'flute', perc: true }],
      ['B', { lead: 'glock', perc: true, pad: true }],
      ['A', { lead: 'flute', double: 'glock', perc: true, pad: true }],
      ['outro', { lead: 'glock', perc: true, end: true }],
    ],
  },
  {
    id: 'strawberry-lemonade',
    title: 'strawberry lemonade',
    key: 'G',
    bpm: 190, // eighth notes: this one is in 6/8
    bar: 6,
    feel: 'arp68',
    ambience: 'birds',
    sections: {
      intro: {
        chords: 'Gmaj7 | Cmaj7',
        melody: 'r:6 | r:3 D6 C6 A5',
      },
      A: {
        chords: 'Gmaj7 | Em7 | Cmaj7 | D7 | Gmaj7 | Bm7 | Cmaj7 | Am7 D7 | Gmaj7 | Em7 | Cmaj7 | D7 | Bm7 | E7 | Am7 D7 | G',
        melody: 'B5:3 A5 G5 F#5 | G5:3 E5:3 | E5:2 G5 B5:3 | A5:4 F#5:2 | B5:3 D6 C6 B5 | A5:3 F#5:3 | G5:2 E5 C5:3 | D5:3 F#5:3 |'
          + ' B5:3 A5 G5 F#5 | G5:3 B5:3 | C6:2 B5 A5:3 | F#5:3 A5:3 | B5:3 A5 F#5 D5 | G#5:3 B5:3 | C6:2 B5 A5:2 F#5 | G5:6',
      },
      B: {
        chords: 'Cmaj7 | Cm6 | G/B | E7 | Am7 | D7 | G | D7',
        melody: 'E5:2 G5 B5:2 C6 | Eb6:3 C6:3 | D6:2 B5 G5:3 | G#5:3 B5:3 | C6:2 B5 A5 G5 E5 | F#5:3 A5:3 | B5:3 G5:3 | A5:3 r:3',
      },
      outro: {
        chords: 'Cmaj7 | Gmaj7',
        melody: 'E5:3 D5:3 | D5:6',
      },
    },
    form: [
      ['intro', { lead: 'kalimba' }],
      ['A', { lead: 'kalimba', pad: true }],
      ['B', { lead: 'flute', pad: true, perc: true }],
      ['A', { lead: 'musicbox', double: 'glock', pad: true, perc: true }],
      ['B', { lead: 'kalimba', pad: true }],
      ['outro', { lead: 'kalimba', end: true }],
    ],
  },
  {
    id: 'fairy-lights-at-dusk',
    title: 'fairy lights at dusk',
    key: 'D',
    bpm: 84,
    bar: 3,
    feel: 'lullaby',
    ambience: 'crickets',
    sections: {
      intro: {
        chords: 'D | G | D | A7',
        melody: 'r:3 | r:3 | r:3 | r:3',
      },
      A: {
        chords: 'D | Bm7 | Gmaj7 | A7 | D | F#m7 | Gmaj7 | A7 | D | Bm7 | Gmaj7 | A7 | Bm7 | Em7 | A7 | D',
        melody: 'F#5:2 A5 | D6:2 C#6 | B5:3 | A5:2 G5 | F#5:2 A5 | C#6:2 A5 | B5:2 G5 | A5:3 |'
          + ' F#5:2 A5 | D6:2 C#6 | B5:2 D6 | E6:2 C#6 | D6:2 B5 | G5:2 B5 | G5:2 E5 | D5:3',
      },
      B: {
        chords: 'G | Gm6 | F#m7 | B7 | Em7 | A7 | D | A7',
        melody: 'B5:2 D6 | Bb5:2 G5 | A5:2 F#5 | D#5:2 F#5 | G5 B5 D6 | C#6:2 A5 | A5:2 F#5 | E5:3',
      },
      outro: {
        chords: 'D | G | D | D',
        melody: 'A5:2 F#5 | B5:2 G5 | F#5:3 | D5:3',
      },
    },
    form: [
      ['intro', { lead: 'musicbox' }],
      ['A', { lead: 'musicbox', pad: true }],
      ['B', { lead: 'glock', pad: true }],
      ['A', { lead: 'musicbox', double: 'glock', pad: true }],
      ['outro', { lead: 'musicbox', pad: true, end: true }],
    ],
  },
];
