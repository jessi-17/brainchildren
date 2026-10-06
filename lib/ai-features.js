// What AI can do in brainchildren. Each feature builds a small, readable
// context from your own data (never your source code), asks for a JSON
// answer of a fixed shape, and saves the useful bits so it doesn't re-ask.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { obj, arr, S } from './ai.js';

const DAY = 86400000;
const CAUSES = ['too-big', 'lost-interest', 'someone-built-it', 'merged', 'did-its-job', 'other'];
const SYSTEM = `You help a creative person look after their own side projects inside brainchildren, a cosy local app where every project folder is a little pixel person in a studio and every unstarted idea is an egg.
Write warmly and plainly, in lowercase, with short sentences. Be concrete and kind, never preachy or guilt-tripping.
Only use facts that are in the data you are given. If something isn't known, say so briefly instead of guessing.`;

export function createFeatures({ ai, db, save }) {
  const now = () => Date.now();
  const meta = (id) => (db.meta[id] ||= {});
  const projectById = (id) => db.cache.projects.find((p) => p.id === id);
  const nameOf = (p) => db.meta[p.id]?.nickname || p.title || p.folder;
  const lastActive = (p) => Math.max(p.lastTouched, db.meta[p.id]?.lastFocus || 0, db.meta[p.id]?.lastNote || 0);
  const days = (t) => Math.max(0, Math.floor((now() - t) / DAY));
  const energy = (d) => {
    const s = db.settings;
    return d <= 2 ? 'lively' : d <= 6 ? 'awake' : d < s.sleepDays ? 'bored' : d < s.ghostDays ? 'asleep' : 'ghost';
  };
  const live = () =>
    db.cache.projects.filter((p) => {
      const m = db.meta[p.id] || {};
      return !m.letGo && !m.ignored;
    });
  const eggs = () => db.ideas.filter((i) => !i.projectId && !i.letGo);

  function facts(p, { full = false } = {}) {
    const m = db.meta[p.id] || {};
    const d = days(lastActive(p));
    const todos = p.todos || { open: [], openCount: 0, done: 0 };
    const f = {
      id: p.id,
      name: nameOf(p),
      folder: p.folder,
      what: p.bio || null,
      kind: p.kind || null,
      stack: p.stack || [],
      daysSinceTouched: d,
      energy: energy(d),
      ageDays: days(p.born),
      onDesk: !!m.onDesk,
      frozen: !!m.frozen,
      shipped: !!m.shipped,
      nextTodo: todos.open[0]?.text || null,
      checklist: `${todos.done} done, ${todos.openCount} open`,
      lastNote: m.notes?.length ? m.notes[m.notes.length - 1].text : null,
      focusMinutesThisWeek: (m.sessions || []).reduce((n, s) => n + (now() - s.t < 7 * DAY ? s.minutes : 0), 0),
    };
    if (full) {
      f.recentCommits = (p.git?.commits || []).slice(0, 8).map((c) => ({ message: c.msg, daysAgo: days(c.t) }));
      f.recentFiles = (p.recent || []).map((r) => ({ file: r.rel, daysAgo: days(r.t) }));
      f.openTodos = todos.open.map((t) => t.text);
      f.notes = (m.notes || []).slice(-3).map((n) => ({ text: n.text, daysAgo: days(n.t) }));
    }
    return f;
  }

  async function readme(p) {
    try {
      const names = await fs.readdir(p.path);
      const hit = names.find((n) => /^readme\.(md|markdown|txt)$/i.test(n));
      if (!hit) return null;
      return (await fs.readFile(path.join(p.path, hit), 'utf8')).slice(0, 4000);
    } catch {
      return null;
    }
  }

  const eggFacts = (i) => ({ id: i.id, idea: i.title, notes: i.note || null, daysOld: days(i.createdAt), frozen: !!i.frozen });
  const json = (label, data) => `${label}:\n${JSON.stringify(data, null, 1)}`;

  // each feature: build(args) → { user, schema, effort }, then apply(result, args) → what the page gets
  const features = {
    where: {
      async build({ projectId }) {
        const p = need(projectById(projectId));
        const text = await readme(p);
        return {
          effort: 'medium',
          schema: obj({ recap: S, stoppedAt: S, nextStep: S, why: S }),
          user: `${json('the project', facts(p, { full: true }))}\n\nits README (first part):\n${text || '(no README)'}\n\nI'm coming back to this project. In 2-3 sentences, recap what it is and how far it got (recap). Say where I most likely stopped (stoppedAt). Suggest one small next step I can finish in about 10 minutes (nextStep) and why that one (why).`,
        };
      },
      apply(out, { projectId }) {
        meta(projectId).ai = { ...meta(projectId).ai, where: { t: now(), ...out } };
        return out;
      },
    },

    card: {
      build({ text }) {
        const known = [...live().slice(0, 60).map((p) => ({ id: p.id, kind: 'project', name: nameOf(p), what: p.bio?.slice(0, 120) || null })), ...eggs().slice(0, 40).map((i) => ({ id: i.id, kind: 'egg', name: i.title }))];
        return {
          effort: 'low',
          schema: obj({ title: S, oneLiner: S, forWho: S, magic: S, firstStep: S, tags: arr(S), similarIds: arr(S) }),
          user: `my rambling idea (maybe voice-typed, so forgive the ums):\n"""${String(text).slice(0, 4000)}"""\n\n${json('ideas and projects I already have', known)}\n\nTurn the ramble into a tidy idea card: a short title (under 60 characters), a one-line pitch, who it's for, the magic bit that makes it special, a first tiny step, and up to 4 short lowercase tags. In similarIds, list ids of existing ideas or projects that sound like the same idea (or none).`,
        };
      },
      apply: (out) => out,
    },

    match: {
      build({ eggId }) {
        const egg = need(db.ideas.find((i) => i.id === eggId));
        const linked = new Set(db.ideas.filter((i) => i.projectId).map((i) => i.projectId));
        const cands = live().filter((p) => !linked.has(p.id)).slice(0, 60).map((p) => ({ id: p.id, name: nameOf(p), folder: p.folder, what: p.bio?.slice(0, 160) || null, ageDays: days(p.born) }));
        return {
          effort: 'low',
          schema: obj({ projectId: S, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, reason: S }),
          user: `${json('the idea (egg)', eggFacts(egg))}\n\n${json('project folders it might have become', cands)}\n\nWhich folder (if any) is this idea? Give its id in projectId, or "none". Explain briefly.`,
        };
      },
      apply: (out) => out,
    },

    sort: {
      build() {
        const list = eggs().filter((i) => !i.frozen).slice(0, 40).map(eggFacts);
        if (!list.length) throw new Error('there are no eggs to sort');
        return {
          effort: 'low',
          schema: obj({ items: arr(obj({ id: S, suggestion: { type: 'string', enum: ['keep', 'hatch', 'freeze', 'letgo'] }, reason: S, mergeWith: S })) }),
          user: `${json('my eggs (ideas not started yet)', list)}\n\n${json('my existing projects', live().slice(0, 40).map((p) => ({ id: p.id, name: nameOf(p) })))}\n\nFor each egg suggest: keep (worth keeping as an idea), hatch (it already has a matching project folder), freeze (good but not now), or letgo (probably not worth it). One short reason each. If two eggs are really the same idea, put the other egg's id in mergeWith, otherwise "".`,
        };
      },
      apply: (out) => out,
    },

    pick: {
      build({ minutes = 30 }) {
        const list = live().filter((p) => !db.meta[p.id]?.frozen).map((p) => facts(p));
        if (!list.length) throw new Error('there are no projects to pick from');
        return {
          effort: 'low',
          schema: obj({ projectId: S, why: S, firstStep: S, alternatives: arr(obj({ projectId: S, why: S })) }),
          user: `${json('my projects', list)}\n\nI have about ${Number(minutes) || 30} minutes right now. Pick the one project I should spend them on (favour desk projects and ones with momentum or a clear next step; a quick win on a fading one is fine too). Say why, give a first step that fits the time, and up to 2 alternatives.`,
        };
      },
      apply: (out) => out,
    },

    chatter: {
      build() {
        const list = live().slice(0, 40).map((p) => ({ ...facts(p), recentCommit: p.git?.commits?.[0]?.msg || null }));
        const voice = db.settings.voice || 'sweet';
        return {
          effort: 'low',
          schema: obj({ people: arr(obj({ id: S, personality: S, lines: arr(S) })) }),
          user: `${json('the projects living in my studio', list)}\n\nGive each project a little personality (under 10 words) based on what it is, and 6 short things it might say out loud in the studio (each under 60 characters, lowercase, ${voice === 'sassy' ? 'cheeky and a bit sassy' : voice === 'quiet' ? 'very short and shy' : 'sweet and warm'}). Base the lines on the real facts: its energy, what it's about, its next to-do, recent commit, how long since it was touched. The person is called ${JSON.stringify(db.settings.name || 'you')}.`,
        };
      },
      apply(out) {
        for (const x of out.people || []) {
          if (!projectById(x.id)) continue;
          meta(x.id).ai = { ...meta(x.id).ai, voice: { t: now(), personality: String(x.personality).slice(0, 80), lines: (x.lines || []).slice(0, 8).map((l) => String(l).slice(0, 80)) } };
        }
        return { count: (out.people || []).length };
      },
    },

    meeting: {
      build() {
        const list = live().map((p) => facts(p));
        const week = {
          newEggs: db.ideas.filter((i) => now() - i.createdAt < 7 * DAY).map((i) => i.title),
          letGo: Object.values(db.meta).filter((m) => m.letGo && now() - m.letGo.at < 7 * DAY).map((m) => m.snapshot?.title || m.snapshot?.folder || 'a project'),
        };
        return {
          effort: 'medium',
          schema: obj({ headline: S, moved: arr(S), fading: arr(S), focusId: S, focusWhy: S, encouragement: S }),
          user: `${json('every project in my studio', list)}\n\n${json('this week', week)}\n\nRun a cosy weekly town meeting: a one-line headline, what moved this week (short items), what's fading (short items), the one project to focus on next week (focusId + why), and a short encouraging closing line.`,
        };
      },
      apply(out) {
        db.settings.ai.lastMeeting = { t: now(), ...out };
        return out;
      },
    },

    letgo: {
      async build({ projectId, eggId }) {
        if (eggId) {
          const egg = need(db.ideas.find((i) => i.id === eggId));
          return {
            effort: 'low',
            schema: obj({ keep: S, cause: { type: 'string', enum: CAUSES }, note: S }),
            user: `${json("the idea I'm letting go of", eggFacts(egg))}\n\nWrite one or two lines on what's worth keeping from it (keep), the most likely reason it's ending (cause), and a kind one-line send-off (note).`,
          };
        }
        const p = need(projectById(projectId));
        return {
          effort: 'low',
          schema: obj({ keep: S, cause: { type: 'string', enum: CAUSES }, note: S }),
          user: `${json("the project I'm letting go of", facts(p, { full: true }))}\n\nREADME start:\n${(await readme(p))?.slice(0, 1500) || '(none)'}\n\nWrite one or two lines on what's worth keeping from it (a name, a feature, a lesson) (keep), the most likely reason it's ending (cause), and a kind one-line send-off (note).`,
        };
      },
      apply: (out) => out,
    },

    steps: {
      async build({ projectId }) {
        const p = need(projectById(projectId));
        return {
          effort: 'medium',
          schema: obj({ steps: arr(S) }),
          user: `${json('the project', facts(p, { full: true }))}\n\nREADME start:\n${(await readme(p)) || '(none)'}\n\nBreak what's left into 3 to 7 small, concrete next steps in order, each doable in an hour or less. Skip anything already done.`,
        };
      },
      apply(out, { projectId }) {
        meta(projectId).ai = { ...meta(projectId).ai, steps: { t: now(), items: (out.steps || []).slice(0, 7).map((text) => ({ text: String(text).slice(0, 160), done: false })) } };
        return out;
      },
    },

    readme: {
      async build({ projectId, eggId }) {
        if (eggId) {
          const egg = need(db.ideas.find((i) => i.id === eggId));
          return {
            effort: 'low',
            schema: obj({ names: arr(S), readme: S }),
            user: `${json('my idea', eggFacts(egg))}\n\nSuggest 3 short, charming names for it, and a starter README in markdown (title, one-line pitch, who it's for, what it does, first steps as - [ ] checkboxes).`,
          };
        }
        const p = need(projectById(projectId));
        return {
          effort: 'low',
          schema: obj({ names: arr(S), readme: S }),
          user: `${json('my project', facts(p, { full: true }))}\n\nIt has ${p.hasReadme ? 'a README already' : 'no README yet'}. Suggest 3 short, charming names for it, and a starter README in markdown (title, one-line pitch, what it does, how to run it if you can tell from the stack, next steps as - [ ] checkboxes). Only say what the data supports.`,
        };
      },
      apply: (out) => out,
    },

    ask: {
      build({ question }) {
        const q = String(question || '').trim().slice(0, 500);
        if (!q) throw new Error('ask a question first');
        return {
          effort: 'medium',
          schema: obj({ answer: S, mentions: arr(S) }),
          user: `${json('every project in my studio', live().map((p) => ({ ...facts(p), born: new Date(p.born).toISOString().slice(0, 10) })))}\n\n${json('my eggs', eggs().slice(0, 60).map(eggFacts))}\n\nquestion: ${q}\n\nAnswer from the data only. In mentions, list the ids of projects or eggs you talk about.`,
        };
      },
      apply: (out) => out,
    },

    reflect: {
      build() {
        const bin = Object.values(db.meta).filter((m) => m.letGo).map((m) => ({ cause: m.letGo.cause, keep: m.letGo.keep || null, daysAgo: days(m.letGo.at) }));
        return {
          effort: 'medium',
          schema: obj({ highlight: S, patterns: arr(S), advice: S }),
          user: `${json('my projects', live().map((p) => facts(p)))}\n\n${json('ideas I let go (and why)', bin)}\n\n${json('eggs', eggs().map(eggFacts))}\n\nLook at how my ideas start, stall and end. Give one highlight worth celebrating, 2 to 4 honest patterns you notice, and one piece of gentle, practical advice.`,
        };
      },
      apply(out) {
        db.settings.ai.lastReflection = { t: now(), ...out };
        return out;
      },
    },
  };

  async function run(name, args = {}, { preview = false } = {}) {
    const f = features[name];
    if (!f) throw new Error('no such AI feature');
    if (db.settings.ai.features[name] === false) throw new Error('that AI feature is switched off in settings');
    const req = await f.build(args);
    if (preview) return { preview: true, system: SYSTEM, user: req.user };
    const out = await ai.call({ system: SYSTEM, user: req.user, schema: req.schema, effort: req.effort });
    const result = f.apply(out, args);
    await save();
    return { result };
  }

  return { run, names: Object.keys(features) };
}

function need(x) {
  if (!x) throw new Error("couldn't find that one");
  return x;
}
