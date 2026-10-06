// AI, with your own key: the settings tab and every AI helper window.
// Nothing is sent until you click; every feature can show what it would send.
import { api } from './api.js';
import { openWindow, balloon } from './wm.js';
import { icons } from './icons.js';
import { thumbHtml } from './look.js';
import { CAUSES, esc, ago, short, plural } from './life.js';

const FEATURES = [
  ['where', '"where was I?" recaps'],
  ['card', 'tidy a rambly idea into a card'],
  ['match', 'match eggs to folders'],
  ['sort', 'egg-sorting suggestions'],
  ['pick', '"pick for me"'],
  ['chatter', 'personalities + fresh chatter'],
  ['meeting', 'weekly town meeting'],
  ['letgo', 'let-go helper'],
  ['steps', 'next-steps checklists'],
  ['readme', 'names + README drafts'],
  ['ask', 'ask your studio'],
  ['reflect', 'monthly reflection'],
];

export function extendAI(app, ui) {
  const get = (key) => app.model.byKey.get(key);

  // run a feature; errors become friendly balloons (and point to settings when needed)
  ui.ai = async (name, args, { from } = {}) => {
    try {
      const res = await api.post(`/api/ai/run/${name}`, { args });
      if (res.state) app.setState(res.state);
      return res.result;
    } catch (err) {
      const code = err.data?.code;
      balloon({
        title: code === 'off' || code === 'bad-key' || code === 'needs-sdk' ? 'AI needs a quick setup' : "AI couldn't do that",
        text: err.message,
        timeout: 9000,
        onClick: code ? () => ui.settings(from, { tab: 'ai' }) : undefined,
      });
      return null;
    }
  };

  ui.aiPreview = (name, args, from) =>
    openWindow({
      key: `preview:${name}`,
      title: 'what would be sent',
      icon: icons.about,
      width: 560,
      from,
      async render(w) {
        w.body.innerHTML = '<p class="muted">building the preview…</p>';
        try {
          const p = await api.post(`/api/ai/run/${name}`, { args, preview: true });
          w.body.innerHTML = `<p style="margin-top:0">this is exactly what goes to Anthropic for this feature. no source code, only names, dates, file names, checklists, notes and README text.</p><pre class="mono code-box tall">${esc(p.user)}</pre>`;
        } catch (err) {
          w.body.innerHTML = `<p class="err">${esc(err.message)}</p>`;
        }
      },
    });

  // ------------------------------------------------------------ settings tab

  ui.aiTab = async (panel) => {
    panel.innerHTML = '<p class="muted">checking…</p>';
    let st;
    try {
      st = await api.get('/api/ai');
    } catch (err) {
      panel.innerHTML = `<p class="err">${esc(err.message)}</p>`;
      return;
    }
    const usage = st.usage?.month === new Date().toISOString().slice(0, 7) ? st.usage : null;
    panel.innerHTML = `
      <p style="margin-top:0">brainchildren can use Claude with <b>your own Anthropic API key</b>. it runs from this computer: the key stays here and never reaches the browser, and nothing is sent until you click something with a ✨.</p>
      ${st.sdk ? '' : '<p class="next">one-time step: AI needs the Anthropic SDK. run <code>npm install</code> in the brainchildren folder, then restart it.</p>'}
      <label class="check"><input type="checkbox" name="on" ${st.on ? 'checked' : ''}> turn AI on</label>
      <fieldset class="group"><legend>API key</legend>
        ${st.hasKey ? `<p style="margin:0 0 8px">using a key from <b>${esc(st.keySource)}</b> (${esc(st.keyHint)}).</p>` : '<p style="margin:0 0 8px">no key yet. get one at console.anthropic.com → API keys.</p>'}
        <div class="row"><input class="input" type="password" name="key" placeholder="sk-ant-…" autocomplete="off" style="flex:1"><button class="btn" data-x="savekey">save key</button>${st.keySource === 'saved' ? '<button class="btn small" data-x="clearkey">remove</button>' : ''}</div>
        <p class="small-print">saved keys live in <code>data/secrets.json</code>. you can also put <code>ANTHROPIC_API_KEY=…</code> in a <code>.env</code> file in the brainchildren folder, or set it as an environment variable. none of these are ever committed to git.</p>
      </fieldset>
      <fieldset class="group"><legend>model</legend>
        <select class="select" name="model">${Object.entries(st.models).map(([id, m]) => `<option value="${id}" ${st.model === id ? 'selected' : ''}>${esc(m.label)} · $${m.input} in / $${m.output} out per million tokens</option>`).join('')}</select>
        <p class="small-print">${usage ? `this month: ${plural(usage.calls, 'request')}, about $${usage.cost.toFixed(2)}.` : 'nothing used this month yet.'} most features cost well under a cent each.</p>
      </fieldset>
      <fieldset class="group"><legend>features</legend>
        <div class="radios">${FEATURES.map(([k, label]) => `<label><input type="checkbox" name="f-${k}" ${st.features[k] !== false ? 'checked' : ''}> ${label}</label>`).join('')}</div>
      </fieldset>
      <div class="row" style="margin-top:12px"><button class="btn" data-x="test">test the connection</button><button class="btn small" data-x="preview">show me what gets sent</button><span class="test-out muted"></span></div>`;

    const saveAI = (body) => api.post('/api/ai/settings', body).then(app.setState, app.oops);
    panel.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'on') saveAI({ on: t.checked });
      if (t.name === 'model') saveAI({ model: t.value });
      if (t.name?.startsWith('f-')) saveAI({ features: { [t.name.slice(2)]: t.checked } });
    });
    panel.addEventListener('click', async (e) => {
      const x = e.target.closest('[data-x]')?.dataset.x;
      if (!x) return;
      if (x === 'savekey' || x === 'clearkey') {
        try {
          app.setState(await api.post('/api/ai/key', { key: x === 'savekey' ? panel.querySelector('[name=key]').value : null }));
          ui.aiTab(panel);
        } catch (err) {
          app.oops(err);
        }
      }
      if (x === 'test') {
        const out = panel.querySelector('.test-out');
        out.textContent = 'talking to Claude…';
        try {
          const r = await api.post('/api/ai/test');
          out.textContent = `✓ ${r.greeting}`;
        } catch (err) {
          out.textContent = err.message;
        }
      }
      if (x === 'preview') {
        const any = app.model.live.find((c) => c.type === 'project');
        if (any) ui.aiPreview('where', { projectId: any.id }, e.target);
      }
    });
  };

  // ------------------------------------------------------------ helpers used around the app

  ui.aiTidyRamble = (text, from) => ui.ai('card', { text }, { from });

  ui.aiTidyEgg = async (c, from) => {
    const card = await ui.ai('card', { text: `${c.idea.title}\n${c.idea.note || ''}` }, { from });
    if (!card) return;
    const note = cardNote(card);
    try {
      app.setState(await api.patch(`/api/ideas/${c.id}`, { title: card.title, note }));
      balloon({ title: `tidied "${short(card.title, 30)}" ✿`, text: card.similarIds?.length ? 'it sounds like something you already have. open it to see.' : card.oneLiner, timeout: 6000, onClick: () => ui.props(c.key) });
    } catch (err) {
      app.oops(err);
    }
  };

  ui.cardNote = cardNote;

  ui.aiReadme = (c, from) =>
    openWindow({
      key: `readme:${c.key}`,
      title: c.type === 'egg' ? 'names + README' : `README for ${short(c.name, 24)}`,
      icon: icons.about,
      width: 560,
      from,
      async render(w) {
        w.body.innerHTML = '<p class="muted">✨ writing…</p>';
        const out = await ui.ai('readme', c.type === 'egg' ? { eggId: c.id } : { projectId: c.id }, { from });
        if (!out) return w.close();
        w.body.innerHTML = `
          <h4>name ideas</h4><div class="chips">${out.names.map((n) => `<span class="chip">${esc(n)}</span>`).join('')}</div>
          <h4 style="margin-top:12px">README draft</h4><pre class="mono code-box tall">${esc(out.readme)}</pre>
          <p class="small-print">brainchildren never writes into your folders. copy this and save it as README.md yourself if you like it.</p>
          <div class="row end"><button class="btn primary" data-copy>copy README</button></div>`;
        w.body.querySelector('[data-copy]').addEventListener('click', async () => {
          await navigator.clipboard.writeText(out.readme).catch(() => {});
          balloon({ title: 'copied ✿', timeout: 2000 });
        });
      },
    });

  ui.aiLetGo = async (c, form, btn) => {
    const out = await ui.ai('letgo', c.type === 'egg' ? { eggId: c.id } : { projectId: c.id }, { from: btn });
    if (!out) return;
    const radio = form.querySelector(`[name=cause][value="${out.cause}"]`);
    if (radio) radio.checked = true;
    form.querySelector('[name=keep]').value = `${out.keep}${out.note ? `\n${out.note}` : ''}`;
  };

  ui.aiMatch = async (c, btn) => {
    const out = await ui.ai('match', { eggId: c.id }, { from: btn });
    if (!out) return null;
    if (out.projectId === 'none' || !get(`p:${out.projectId}`)) {
      balloon({ title: 'no folder looks like this idea yet', text: out.reason, timeout: 6000 });
      return null;
    }
    return out;
  };

  ui.aiSteps = (c, btn) => ui.ai('steps', { projectId: c.id }, { from: btn });
  ui.aiWhere = (c, btn) => ui.ai('where', { projectId: c.id }, { from: btn });

  ui.refreshChatter = async (from) => {
    const out = await ui.ai('chatter', {}, { from });
    if (out) balloon({ title: `${plural(out.count, 'person')} got new things to say ✿`, timeout: 4000 });
  };

  ui.ask = (from) =>
    openWindow({
      key: 'ask',
      title: 'ask your studio',
      icon: icons.about,
      width: 520,
      from,
      render(w) {
        const history = [];
        const draw = () => {
          w.body.innerHTML = `
            ${app.state.aiReady ? '' : '<p class="next">this one needs AI. switch it on in settings → AI.</p>'}
            <div class="ask-log">${history.map((h) => `<p class="ask-q">${esc(h.q)}</p><p class="ask-a">${esc(h.a)}${h.mentions?.length ? `<br>${h.mentions.map((k) => (get(k) ? `<button class="chip" data-open="${k}">${esc(get(k).name)}</button>` : '')).join('')}` : ''}</p>`).join('') || '<p class="muted">try: "which projects use Astro?", "what did I work on last week?", "which egg is closest to something I already have?"</p>'}</div>
            <div class="row"><input class="input" name="q" placeholder="ask anything about your projects…" style="flex:1" autocomplete="off"><button class="btn primary" data-act="ask">ask</button><button class="btn small" data-act="preview">what's sent?</button></div>`;
          w.body.querySelector('[name=q]').focus();
        };
        const ask = async (btn) => {
          const q = w.body.querySelector('[name=q]').value.trim();
          if (!q) return;
          btn.disabled = true;
          btn.textContent = '…';
          const out = await ui.ai('ask', { question: q }, { from: btn });
          if (out) history.push({ q, a: out.answer, mentions: (out.mentions || []).map((id) => (get(`p:${id}`) ? `p:${id}` : `e:${id}`)) });
          draw();
        };
        w.body.addEventListener('click', (e) => {
          const o = e.target.closest('[data-open]');
          if (o) return ui.props(o.dataset.open, o);
          const act = e.target.closest('[data-act]')?.dataset.act;
          if (act === 'ask') ask(e.target.closest('button'));
          if (act === 'preview') ui.aiPreview('ask', { question: w.body.querySelector('[name=q]').value || 'example question' }, e.target);
        });
        w.body.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && e.target.name === 'q') ask(w.body.querySelector('[data-act=ask]'));
        });
        draw();
      },
    });

  ui.reflect = (from) =>
    openWindow({
      key: 'reflect',
      title: 'monthly reflection',
      icon: icons.about,
      width: 500,
      from,
      render(w) {
        const draw = (r) => {
          w.body.innerHTML = r
            ? `<p class="lead">✿ ${esc(r.highlight)}</p><h4>patterns</h4><ul class="todo">${r.patterns.map((p) => `<li>${esc(p)}</li>`).join('')}</ul><p class="next">${esc(r.advice)}</p><p class="small-print">written ${ago(r.t || Date.now(), Date.now())}</p><div class="row end"><button class="btn small" data-act="again">✨ write a fresh one</button></div>`
            : `<p style="margin-top:0">a look at how your ideas start, stall and end: what you let go and why, what keeps moving, and one gentle piece of advice.</p><div class="row end"><button class="btn small" data-act="preview">what's sent?</button><button class="btn primary" data-act="again">✨ reflect (AI)</button></div>`;
        };
        draw(app.model.settings.ai?.lastReflection);
        w.body.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-act]');
          if (!b) return;
          if (b.dataset.act === 'preview') return ui.aiPreview('reflect', {}, b);
          b.disabled = true;
          b.textContent = 'thinking…';
          const out = await ui.ai('reflect', {}, { from: b });
          draw(out ? { ...out, t: Date.now() } : app.model.settings.ai?.lastReflection);
        });
      },
    });

  return ui;
}

export function cardNote(card) {
  return [card.oneLiner, card.forWho && `for: ${card.forWho}`, card.magic && `the magic bit: ${card.magic}`, card.firstStep && `first step: ${card.firstStep}`, card.tags?.length && `#${card.tags.join(' #')}`].filter(Boolean).join('\n');
}

export { CAUSES, thumbHtml };
