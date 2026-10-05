// What the creatures say. Every line is built from real facts about the
// project (dates, commits, files, checklists), so the chatter doubles as
// your status updates.
import { ago, weekday, fmtTime, short, basename, plural, KIND_NOUNS, similarity, projectWords, eggWords, DAY } from './life.js';

const pickWeighted = (pool) => {
  const total = pool.reduce((s, [w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [w, item] of pool) if ((r -= w) <= 0) return item;
  return pool[pool.length - 1]?.[1];
};

const KIND_LINES = {
  music: ['♪ la la la ♪', 'this one goes out to you'],
  camera: ['say cheese!', 'hold still, one more'],
  game: ['wanna play?', 'press start to continue'],
  writing: ['dear diary…', 'i have so many words in me'],
  mail: ['i might have mail for you', 'sealed with a kiss ♡'],
  '3d': ["i'm in 3d btw", 'turn me around, i have a back'],
  social: ['posting this later', 'is this a good angle?'],
  ai: ['beep boop (thinking)', 'i had a thought. it was about you'],
  art: ['i drew you something', 'this color, or that color?'],
  party: ['is it someone’s birthday?', 'party hats on!'],
  web: ['loading… just kidding', 'refresh me, i dare you'],
  code: ['it works on my machine', 'no bugs here (probably)'],
};

export function soloLine(c, ctx) {
  const pool = [];
  const add = (w, ...lines) => lines.forEach((l) => l && pool.push([w, l]));
  const user = ctx.user;

  if (c.type === 'egg') {
    const i = c.idea;
    add(3, '*wobble*');
    add(2, `"${short(i.title, 28)}"… that's me`);
    add(2, `you thought of me on a ${weekday(i.createdAt)}`);
    if (i.source === 'voice') add(2, 'you said me out loud ♡');
    if (c.energy === 'cold') add(5, "it's getting cold in here…", 'will i ever hatch?');
    else add(1, 'is it warm out there?', "i'm not ready yet!");
    return pickWeighted(pool);
  }

  const p = c.p;
  const commit = p.git?.commits?.[0];
  const file = p.recent?.[0];
  const todo = p.todos?.open?.[0];

  if (c.energy === 'asleep') {
    add(5, 'zzz', 'zzz… five more minutes');
    add(2, '*snore*', 'zzz… (dreaming about being finished)');
    return pickWeighted(pool);
  }
  if (c.energy === 'ghost') {
    add(4, `has anyone seen ${user}?`, `it's been ${c.days} days…`);
    add(3, 'am i still a project?', "i'm fading a little");
    if (p.bio) add(2, `i used to be "${short(p.bio, 40)}"`);
    return pickWeighted(pool);
  }

  if (c.energy === 'lively') {
    add(3, `${user} was just here ♡`, 'we’re on a roll!');
    if (commit && ctx.now - commit.t < 3 * DAY) add(5, `new: "${short(commit.msg, 40)}"`);
    if (file) add(3, `someone just changed my ${basename(file.rel)}`);
  } else if (c.energy === 'awake') {
    add(3, `${user} visited ${ago(p.lastTouched, ctx.now)}`, 'doing okay over here!');
    if (file) add(2, `last thing you touched: ${basename(file.rel)}`);
  } else if (c.energy === 'bored') {
    add(4, `it's been ${c.days} days. not that i'm counting`, 'hello? anyone?');
    add(3, "i'm getting a little dusty", `${user}? it's me, ${short(c.name, 20)}`);
  }

  if (todo) add(2, `my list says "${short(todo.text, 36)}"… just saying`);
  const total = (p.todos?.openCount || 0) + (p.todos?.done || 0);
  if (p.todos?.done) add(2, `${p.todos.done} of ${total} things done!`);
  if (p.stack?.length) add(1, `i'm made of ${p.stack.join(' + ')}`);
  if (c.age > 0) add(1, `i'm ${plural(c.age, 'day')} old`);
  add(1, `remember ${weekday(p.born)}? i was just a folder called ${short(p.folder, 22)}`);
  if (c.egg) add(2, `you thought of me at ${fmtTime(c.egg.createdAt)} on a ${weekday(c.egg.createdAt)}`);
  if (c.kind && KIND_LINES[c.kind]) add(2, ...KIND_LINES[c.kind]);
  if (c.stage === 'shipped') add(3, "i'm live!! people can see me", 'being shipped is kinda scary');
  if (c.stage === 'hatchling') add(1, "i'm new here!");
  if (p.files === 0) add(4, 'my folder is empty. it echoes in here', '…hello? (echo)');
  if (c.onDesk) add(3, "i'm on the desk this week ★", 'desk life ★');
  if (p.deploy && c.stage !== 'shipped') add(1, `i have a ${p.deploy} setup. one day i'll be live`);
  return pickWeighted(pool);
}

// two creatures talking: returns [[speaker, line], ...]
export function conversation(a, b, ctx) {
  const pool = [];
  const add = (w, lines) => pool.push([w, lines]);
  const user = ctx.user;
  const name = (c) => short(c.name, 18);

  if (a.type === 'egg' && b.type === 'egg') {
    add(2, [[a, 'are you warm enough?'], [b, '*wobble*']]);
    add(1, [[a, `i'm "${short(a.name, 20)}"`], [b, `i'm "${short(b.name, 20)}"`]]);
    return pickWeighted(pool);
  }
  if (b.type === 'egg') [a, b] = [b, a];
  if (a.type === 'egg') {
    add(3, [[b, 'when are you hatching?'], [a, '*wobble*']]);
    add(2, [[b, 'hi little egg!'], [a, `i'm "${short(a.name, 24)}"!`]]);
    if (similarity(eggWords(a), projectWords(b)) >= 0.5) add(6, [[b, 'wait… are you me?'], [a, "maybe! we're the same idea"]]);
    return pickWeighted(pool);
  }

  if (b.energy === 'asleep') add(5, [[a, `you okay? you haven't moved since ${weekday(b.p.lastTouched)}`], [b, 'zzz… five more minutes']]);
  if (b.energy === 'ghost') add(5, [[a, `${name(b)}, you're kinda see-through`], [b, `tell ${user} i said hi…`]]);
  if (a.energy === 'ghost' && b.energy !== 'ghost') add(3, [[a, "what's it like being worked on?"], [b, 'busy! but fun']]);
  const shared = a.p.stack?.find((s) => b.p.stack?.includes(s));
  if (shared) add(3, [[a, `wait, you're ${shared} too?`], [b, 'twins!!']]);
  if (a.kind && a.kind === b.kind) add(3, [[a, `we're both ${KIND_NOUNS[a.kind]} projects`], [b, 'should we team up?']]);
  if (similarity(projectWords(a), projectWords(b)) >= 0.5) add(6, [[a, 'wait… are we the same idea?'], [b, 'maybe we should merge']]);
  if (a.stage === 'shipped' && b.stage !== 'shipped') add(4, [[b, "what's it like being live?"], [a, 'scary! but nice']]);
  if (a.onDesk && b.onDesk) add(4, [[a, 'desk crew ★'], [b, 'desk crew ★']]);
  if (a.age !== b.age) {
    add(2, [[a, `i'm ${plural(a.age, 'day')} old`], [b, a.age > b.age ? `i'm only ${b.age}!` : `i'm ${b.age}. respect your elders`]]);
  }
  if (a.p.todos?.openCount) add(2, [[b, "how's your to-do list?"], [a, `${a.p.todos.done} done, ${a.p.todos.openCount} to go`]]);
  const commit = a.p.git?.commits?.[0];
  if (commit && ctx.now - commit.t < 4 * DAY) add(4, [[a, `guess what? "${short(commit.msg, 34)}"`], [b, 'ooh!!']]);
  add(1, [[a, `hi ${name(b)}!`], [b, `hi ${name(a)}!`]]);
  add(2, [[a, `seen ${user} today?`], [b, b.days === 0 ? 'yes! they were just here' : `not since ${weekday(b.p.lastTouched)}`]]);
  return pickWeighted(pool);
}
