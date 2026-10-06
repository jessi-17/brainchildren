// The practice studio: made-up projects and ideas that live only in this
// browser tab. It answers the same API calls as the real server, so every
// window and button works, but nothing touches your real folders or data.
const DAY = 86400000;
const MIN = 60000;

const icon = (body, bg) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="${bg}"/>${body}</svg>`)}`;
const ICONS = {
  leaf: icon('<path d="M4 12c0-5 3-8 8-8 0 5-3 8-8 8z" fill="#fff"/>', '#5cbf7a'),
  note: icon('<path d="M6 4v6.5a2 2 0 1 0 1.4 1.9V6.5l4-1V9a2 2 0 1 0 1.4 1.9V3z" fill="#fff"/>', '#ff6fae'),
  star: icon('<path d="M8 3l1.5 3.2 3.5.4-2.6 2.3.8 3.4L8 10.6 4.8 12.3l.8-3.4L3 6.6l3.5-.4z" fill="#fff"/>', '#7b6cff'),
  cake: icon('<rect x="3.5" y="7" width="9" height="5" rx="1" fill="#fff"/><path d="M8 3.5v2.5" stroke="#fff" stroke-width="1.4"/>', '#ffb347'),
};

export function demoState({ name = 'you', version = '' } = {}) {
  const now = Date.now();
  const ago = (d) => now - d * DAY;
  const id = (n) => `d${String(n).padStart(11, '0')}`;
  const project = (n, o) => ({
    id: id(n),
    path: `practice/${o.folder}`,
    root: 'practice',
    folder: o.folder,
    title: o.title || null,
    bio: o.bio || null,
    kind: o.kind || null,
    stack: o.stack || [],
    deploy: o.deploy || null,
    url: null,
    born: ago(o.born),
    lastTouched: o.touched,
    files: o.files ?? 60,
    truncated: false,
    hasReadme: true,
    hasPackage: (o.files ?? 60) > 0,
    git: o.commits
      ? { branch: 'main', remote: null, commits: o.commits.map(([msg, d]) => ({ msg, t: ago(d) })), count: o.commits.length + 6, partial: false, first: ago(o.born) }
      : null,
    todos: o.todos || { open: [], openCount: 0, done: 0 },
    recent: (o.recent || []).map(([rel, d]) => ({ rel, t: ago(d) })),
    brand: o.brand || null,
    meta: o.meta || {},
  });
  const todo = (done, open, file = 'TODO.md') => ({ open: open.map((text) => ({ text, file })), openCount: open.length, done });

  const projects = [
    project(1, {
      folder: 'plant-diary', title: 'plant diary', kind: 'writing', stack: ['Astro'], deploy: 'Cloudflare', born: 21, touched: now - 6 * MIN,
      bio: 'A tiny journal for houseplants: snap a photo, log the watering, watch them grow.',
      commits: [['watering log saves offline', 0.01], ['photo grid on the plant page', 1], ['first sketch of the journal', 6]],
      recent: [['src/pages/plant.astro', 0.004], ['src/lib/watering.js', 0.02], ['TODO.md', 1]],
      todos: todo(3, ['reminders when the soil is dry', 'share a plant card', 'dark mode']),
      brand: { color: '#5cbf7a', favicon: ICONS.leaf },
      meta: { onDesk: true, events: [{ t: ago(9), type: 'desk' }], sessions: [{ t: ago(1), minutes: 25 }, { t: ago(2), minutes: 40 }], lastFocus: ago(1) },
    }),
    project(2, {
      folder: 'moodboard-ai', title: 'moodboard ai', kind: 'ai', stack: ['React', 'Vite'], born: 30, touched: ago(5),
      bio: 'Describe a vibe, get a moodboard.',
      commits: [['drag to rearrange images', 5], ['grid layout for the board', 9]],
      recent: [['src/Board.jsx', 5], ['src/prompt.js', 6]],
      brand: { color: '#7b6cff', favicon: ICONS.star },
      meta: { onDesk: true, events: [{ t: ago(8), type: 'desk' }], notes: [{ t: ago(5), text: 'stopped at the drag handles. images jump when you drop them on the last row.' }], lastNote: ago(5) },
    }),
    project(3, { folder: 'outfit-playlist', title: 'outfit playlist', kind: 'music', stack: ['React'], born: 25, touched: ago(3), bio: 'Spotify playlists that match what you are wearing today.', recent: [['src/match.js', 3]], brand: { color: '#ff6fae', favicon: ICONS.note } }),
    project(4, { folder: 'pixel-pet-game', title: 'pixel pet game', kind: 'game', stack: ['Phaser'], born: 40, touched: ago(9), bio: 'A tiny browser game where you raise a pixel pet.', recent: [['src/pet.js', 9]], todos: todo(1, ['feeding animation', 'save the pet between visits']) }),
    project(5, { folder: 'weather-widget', title: 'weather widget', kind: null, stack: ['HTML'], born: 33, touched: ago(11), bio: 'A desktop widget that only says "bring a coat" or "don\'t".' }),
    project(6, { folder: 'zine-maker', title: 'zine maker', kind: 'writing', stack: ['Svelte'], born: 50, touched: ago(18), bio: 'Fold-and-print zines from your notes app.', recent: [['src/fold.js', 18]] }),
    project(7, { folder: '3d-room', title: '3d room', kind: '3d', stack: ['three.js'], born: 44, touched: ago(16), bio: 'A tiny 3D bedroom you can walk around in.' }),
    project(8, { folder: 'sticker-shop', title: 'sticker shop', kind: 'art', stack: ['Next.js'], born: 70, touched: ago(41), bio: 'A little shop for die-cut doodle stickers.', todos: todo(4, ['checkout page', 'shipping rates']) }),
    project(9, { folder: 'recipe-camera', title: 'recipe camera', kind: 'camera', stack: ['React'], born: 60, touched: ago(36), bio: 'Point your camera at the fridge, get a recipe.' }),
    project(10, {
      folder: 'birthday-countdown', title: 'birthday countdown', kind: 'party', stack: ['HTML'], born: 28, touched: ago(1), bio: 'A countdown page for your best friend\'s birthday, with tasteful confetti.',
      brand: { color: '#ffb347', favicon: ICONS.cake }, meta: { shipped: true, events: [{ t: ago(2), type: 'shipped' }] },
    }),
    project(11, { folder: 'letters-app', title: 'letters app', kind: 'mail', stack: ['Cloudflare'], born: 15, touched: ago(4), bio: 'Write a letter to future you; it arrives on a random morning.' }),
    project(12, { folder: 'untitled-folder', title: null, kind: null, stack: [], born: 6, touched: ago(6), files: 0, bio: null }),
  ];
  // a revived ghost earns the plant its first leaves
  projects[5].meta.events = [{ t: ago(20), type: 'revived' }];

  const idea = (n, o) => ({
    id: `demo-idea-${n}`, title: o.title, note: o.note || '', source: o.source || 'typed', createdAt: ago(o.d), projectId: null, frozen: !!o.frozen,
    letGo: o.letGo || null, lookSeed: 0, pinned: o.pinned || undefined,
  });
  const ideas = [
    idea(1, { title: 'a playlist that matches the weather', note: 'rainy = lofi, sunny = pop', d: 1, pinned: true }),
    idea(2, { title: 'text your plants and they text back', source: 'voice', d: 3 }),
    idea(3, { title: 'tiny tarot for coders', note: 'draw a card before you start a bug hunt', d: 34 }),
    idea(4, { title: 'a calm pomodoro radio', d: 6 }),
    idea(5, { title: 'vr museum of my old projects', d: 80, frozen: true }),
    idea(6, { title: 'yet another to-do app', d: 45, letGo: { cause: 'someone-built-it', keep: 'the "one thing today" view was the nice part', at: ago(3) } }),
  ];

  return {
    version,
    user: name,
    platform: 'practice',
    demo: true,
    settings: {
      name,
      roots: ['(practice studio)'],
      sleepDays: 14,
      ghostDays: 30,
      editor: 'vscode',
      chatter: 'some',
      look: 'pixel',
      voice: 'sweet',
      ambience: 'off',
      focusMinutes: 25,
      nudge: { on: false, day: 1, hour: 10, lastSent: 0 },
      studio: { name: 'practice studio', boardText: 'ship one tiny thing this week', me: null, cat: true, style: { wall: 'lilac', floor: 'wood', view: 'city', light: 'real' } },
      ai: {
        on: true,
        model: 'claude-opus-5-5',
        features: { where: true, card: true, match: true, sort: true, pick: true, chatter: true, meeting: true, letgo: true, steps: true, readme: true, ask: true, reflect: true },
        usage: { month: new Date().toISOString().slice(0, 7), calls: 4, input: 9000, output: 1200, cost: 0.06 },
        lastMeeting: null,
        lastReflection: null,
      },
      setupDone: true,
    },
    scannedAt: now,
    scanMs: 42,
    scanning: false,
    projects,
    gone: [],
    ideas,
    wall: [{ id: 'demo-wall-1', kind: 'note', text: 'drink water ✿', color: '#fff3a8', x: 48, y: 22, tilt: -2 }],
    autostart: false,
    aiReady: true,
    aiInfo: { hasKey: true, sdk: true, keySource: 'practice' },
  };
}

// ------------------------------------------------------------ a pretend server

const fail = (status, message, data = {}) => {
  throw Object.assign(new Error(message), { status, data: { error: message, ...data } });
};

export function createDemoServer(state) {
  const s = state;
  const P = (pid) => s.projects.find((p) => p.id === pid) || fail(404, 'no such project');
  const I = (iid) => s.ideas.find((i) => i.id === iid) || fail(404, 'no such idea');
  const event = (m, type, extra = {}) => (m.events = [...(m.events || []), { t: Date.now(), type, ...extra }]);
  const out = () => structuredClone(s);
  const routes = [
    ['GET', /^\/api\/state$/, () => out()],
    ['GET', /^\/api\/suggest-roots$/, () => []],
    ['POST', /^\/api\/scan$/, () => out()],
    ['POST', /^\/api\/settings$/, (b) => {
      if (b.sleepDays) s.settings.sleepDays = Number(b.sleepDays);
      if (b.ghostDays) s.settings.ghostDays = Math.max(s.settings.sleepDays + 1, Number(b.ghostDays));
      return out();
    }],
    ['POST', /^\/api\/prefs$/, (b) => {
      const st = s.settings;
      for (const k of ['name', 'editor', 'chatter', 'voice', 'look', 'ambience', 'focusMinutes']) if (k in b) st[k] = b[k];
      if (b.nudge) Object.assign(st.nudge, b.nudge);
      if (b.studio) {
        const { style, ...rest } = b.studio;
        Object.assign(st.studio, rest);
        if (style) Object.assign(st.studio.style, style);
      }
      return out();
    }],
    ['POST', /^\/api\/ideas$/, (b) => {
      if (!String(b.title || '').trim()) fail(400, 'an idea needs at least a name');
      const idea = { id: `demo-idea-${Date.now()}`, title: String(b.title).slice(0, 80), note: b.note || '', source: b.source || 'typed', createdAt: Date.now(), projectId: null, frozen: false, letGo: null, lookSeed: 0 };
      s.ideas.push(idea);
      return { idea: structuredClone(idea), state: out() };
    }],
    ['PATCH', /^\/api\/ideas\/([\w-]+)$/, (b, [, iid]) => {
      const i = I(iid);
      for (const k of ['title', 'note', 'lookSeed', 'snoozeUntil']) if (k in b) i[k] = b[k];
      if ('pinned' in b) {
        if (b.pinned && s.ideas.filter((x) => x.pinned && x.id !== i.id).length >= 4) fail(409, 'the board fits 4 pinned eggs. unpin one first');
        i.pinned = !!b.pinned || undefined;
      }
      if ('projectId' in b) {
        i.projectId = b.projectId;
        i.hatchedAt = b.projectId ? Date.now() : null;
      }
      if ('frozen' in b) i.frozen = !!b.frozen;
      if ('letGo' in b) i.letGo = b.letGo ? { cause: b.letGo.cause || 'other', keep: b.letGo.keep || '', at: Date.now() } : null;
      return out();
    }],
    ['DELETE', /^\/api\/ideas\/([\w-]+)$/, (b, [, iid]) => {
      s.ideas = s.ideas.filter((i) => i.id !== iid);
      return out();
    }],
    ['PATCH', /^\/api\/projects\/(\w+)$/, (b, [, pid]) => {
      const p = P(pid);
      const m = p.meta;
      for (const k of ['nickname', 'lookSeed', 'snoozeUntil', 'traits']) if (k in b) m[k] = b[k] || undefined;
      if ('shipped' in b) {
        m.shipped = !!b.shipped;
        if (m.shipped) event(m, 'shipped');
      }
      if (b.revive) {
        m.snoozeUntil = Number(b.until) || Date.now() + 14 * DAY;
        event(m, 'revived');
      }
      if ('frozen' in b) {
        m.frozen = !!b.frozen;
        if (m.frozen) m.onDesk = false;
        event(m, m.frozen ? 'frozen' : 'thawed');
      }
      if ('letGo' in b) {
        m.letGo = b.letGo ? { cause: b.letGo.cause || 'other', keep: b.letGo.keep || '', at: Date.now() } : null;
        if (m.letGo) m.onDesk = false;
        event(m, m.letGo ? 'let-go' : 'restored', m.letGo ? { cause: m.letGo.cause } : {});
      }
      if ('ignored' in b) {
        m.ignored = !!b.ignored || undefined;
        if (m.ignored) m.onDesk = false;
      }
      if (b.addNote) {
        m.notes = [...(m.notes || []), { t: Date.now(), text: b.addNote }];
        m.lastNote = Date.now();
      }
      if ('readNote' in b) m.noteReadAt = Date.now();
      if (b.focus === 'start') {
        m.focusStart = Date.now();
        m.lastFocus = Date.now();
      }
      if (b.focus === 'end' && m.focusStart) {
        m.sessions = [...(m.sessions || []), { t: m.focusStart, minutes: Math.max(1, Math.round((Date.now() - m.focusStart) / MIN)) }];
        m.lastFocus = Date.now();
        m.focusStart = undefined;
      }
      if (b.focus === 'cancel') m.focusStart = undefined;
      if ('stepDone' in b && m.ai?.steps?.items?.[b.stepDone]) m.ai.steps.items[b.stepDone].done = !!b.done;
      if ('onDesk' in b) {
        if (b.onDesk) {
          const desk = s.projects.filter((x) => x.id !== p.id && x.meta.onDesk && !x.meta.letGo);
          if (desk.length >= 3) fail(409, 'desk-full', { desk: desk.map((x) => x.id) });
          if (!m.onDesk) event(m, 'desk');
          m.onDesk = true;
        } else m.onDesk = false;
      }
      return out();
    }],
    ['POST', /^\/api\/projects\/\w+\/reveal$/, () => ({ ok: true })],
    ['POST', /^\/api\/wall$/, (b) => {
      s.wall.push({ id: `demo-wall-${Date.now()}`, kind: b.kind === 'photo' ? 'photo' : 'note', text: b.text || '', color: b.color, src: b.src, x: b.x ?? 30, y: b.y ?? 20, tilt: b.tilt || 0 });
      return out();
    }],
    ['PATCH', /^\/api\/wall\/([\w-]+)$/, (b, [, wid]) => {
      const w = s.wall.find((x) => x.id === wid);
      if (w) Object.assign(w, b);
      return out();
    }],
    ['DELETE', /^\/api\/wall\/([\w-]+)$/, (b, [, wid]) => {
      s.wall = s.wall.filter((x) => x.id !== wid);
      return out();
    }],
    ['POST', /^\/api\/autostart$/, (b) => {
      s.autostart = !!b.on;
      return out();
    }],
    ['POST', /^\/api\/nudge\/test$/, () => ({ ok: true, practice: true })],
    ['GET', /^\/api\/ai$/, () => ({
      on: s.settings.ai.on, sdk: true, hasKey: true, keySource: 'the practice studio', keyHint: '…demo', model: s.settings.ai.model,
      models: { 'claude-opus-5-5': { label: 'Claude Opus 5.5 (best)', input: 4, output: 20 }, 'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5 (balanced)', input: 2, output: 10 }, 'claude-haiku-4-5': { label: 'Claude Haiku 4.5 (cheapest)', input: 1, output: 5 } },
      features: s.settings.ai.features, usage: s.settings.ai.usage,
    })],
    ['POST', /^\/api\/ai\/settings$/, (b) => {
      if ('on' in b) s.settings.ai.on = !!b.on;
      if ('model' in b) s.settings.ai.model = b.model;
      if (b.features) Object.assign(s.settings.ai.features, b.features);
      s.aiReady = s.settings.ai.on;
      return out();
    }],
    ['POST', /^\/api\/ai\/key$/, () => out()],
    ['POST', /^\/api\/ai\/test$/, () => ({ ok: true, greeting: 'hi from the practice studio ✿' })],
    ['POST', /^\/api\/ai\/run\/(\w+)$/, (b, [, name]) => {
      if (b.preview) return { preview: true, user: `(practice example)\nthe project: {"name":"plant diary","daysSinceTouched":0,"nextTodo":"reminders when the soil is dry","recentFiles":["src/pages/plant.astro"], …}\n\nonly names, dates, file names, checklists, notes and README text are sent. never your code.` };
      const result = cannedAI(name, b.args || {}, s);
      return { result, state: out() };
    }],
  ];

  return async function demoCall(method, url, body) {
    await new Promise((r) => setTimeout(r, 60));
    const path = url.split('?')[0];
    for (const [m, re, fn] of routes) {
      const match = re.exec(path);
      if (match && m === method) return fn(body || {}, match);
    }
    fail(404, 'that isn’t available in the practice studio');
  };
}

// example AI answers, so the practice studio can show what AI does without a key
function cannedAI(name, args, s) {
  const now = Date.now();
  const byId = (pid) => s.projects.find((p) => p.id === pid);
  switch (name) {
    case 'where': {
      const p = byId(args.projectId);
      const out = {
        recap: `${p?.title || 'this project'} is ${p?.bio ? p.bio.charAt(0).toLowerCase() + p.bio.slice(1) : 'a little project'} the basics work and you were polishing the details.`,
        stoppedAt: p?.meta.notes?.length ? p.meta.notes[p.meta.notes.length - 1].text : `the last file you touched was ${p?.recent?.[0]?.rel || 'the readme'}.`,
        nextStep: p?.todos?.open?.[0]?.text ? `start on "${p.todos.open[0].text}": just sketch the first function.` : 'open the README and write one line about what "done" looks like.',
        why: 'it’s small enough to finish in one sitting, and it gets you moving again.',
      };
      if (p) p.meta.ai = { ...p.meta.ai, where: { t: now, ...out } };
      return out;
    }
    case 'card': {
      const words = String(args.text || '').trim().split(/\s+/).slice(0, 7).join(' ');
      return { title: words || 'a new idea', oneLiner: 'a small, cosy tool that does one thing well.', forWho: 'people like you who get too many ideas', magic: 'it feels like a little toy, not a chore', firstStep: 'sketch the one screen it needs', tags: ['tiny', 'cosy'], similarIds: [] };
    }
    case 'match':
      return { projectId: 'none', confidence: 'low', reason: 'none of the practice folders sound like this idea yet.' };
    case 'sort':
      return {
        items: s.ideas.filter((i) => !i.projectId && !i.letGo && !i.frozen).map((i) => ({
          id: i.id,
          suggestion: now - i.createdAt > 30 * DAY ? 'freeze' : i.title.includes('plant') ? 'keep' : 'keep',
          reason: now - i.createdAt > 30 * DAY ? 'nice idea, but it has waited a month. save it for later.' : 'small and fun. worth keeping around.',
          mergeWith: '',
        })),
      };
    case 'pick': {
      const p = s.projects.find((x) => x.folder === 'moodboard-ai');
      return { projectId: p.id, why: 'it’s on your desk and you left yourself a clear note about the drag handles.', firstStep: 'reproduce the jump when you drop on the last row, then fix the index math.', alternatives: [] };
    }
    case 'chatter':
      for (const p of s.projects) p.meta.ai = { ...p.meta.ai, voice: { t: now, personality: 'a cheerful little helper', lines: [`i'm ${p.title || p.folder}!`, 'one more feature, i promise', 'have you seen my README?'] } };
      return { count: s.projects.length };
    case 'meeting': {
      const out = {
        headline: 'a busy week: plant diary moved the most',
        moved: ['plant diary: watering log saves offline', 'birthday countdown shipped ✨', 'outfit playlist got a new matcher'],
        fading: ['sticker shop (41 days)', 'recipe camera (36 days)'],
        focusId: s.projects.find((x) => x.folder === 'plant-diary').id,
        focusWhy: 'two small to-dos away from something you can share.',
        encouragement: 'you shipped something this week. that counts ✿',
      };
      s.settings.ai.lastMeeting = { t: now, ...out };
      return out;
    }
    case 'letgo':
      return { keep: 'the name was great, and the idea of one-tap checkout.', cause: 'too-big', note: 'thanks for the practice, little shop.' };
    case 'steps': {
      const p = byId(args.projectId);
      const items = ['write down what "done" means in one line', 'finish the smallest open to-do', 'make it shareable (one link)', 'show one friend'];
      if (p) p.meta.ai = { ...p.meta.ai, steps: { t: now, items: items.map((text) => ({ text, done: false })) } };
      return { steps: items };
    }
    case 'readme':
      return { names: ['little thing', 'tiny helper', 'pocket idea'], readme: '# little thing\n\nA tiny tool that does one thing well.\n\n## next\n- [ ] sketch the main screen\n- [ ] make it work once\n- [ ] share it' };
    case 'ask':
      return { answer: 'in the practice studio, plant diary and moodboard ai are on your desk, and sticker shop has gone the longest without a visit (41 days).', mentions: [] };
    case 'reflect': {
      const out = { highlight: 'you shipped birthday countdown, start to finish in under a month.', patterns: ['big shop-style ideas stall after the first week', 'small single-page ideas get finished', 'you start most projects late at night'], advice: 'before starting a big one, write the smallest version that could ship this weekend.' };
      s.settings.ai.lastReflection = { t: now, ...out };
      return out;
    }
    default:
      return {};
  }
}
