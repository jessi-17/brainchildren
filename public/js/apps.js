// Every window on the desktop: Properties, Task Manager, Recycle Bin,
// Freezer, Run (new idea), Settings, About and the "Not Responding" visits.
import { api } from './api.js';
import { openWindow, balloon, closeWindow } from './wm.js';
import { icons } from './icons.js';
import { thumbHtml } from './look.js';
import { resume } from './focus.js';
import { undoable } from './undo.js';
import {
  STAGES, ENERGY, CAUSES, KIND_NOUNS, DAY, clock, esc, ago, fmtDate, fmtTime, plural, short,
  similarity, projectWords, eggWords,
} from './life.js';

const EDITORS = {
  vscode: ['VS Code', 'vscode'],
  cursor: ['Cursor', 'cursor'],
  windsurf: ['Windsurf', 'windsurf'],
  vscodium: ['VSCodium', 'vscodium'],
};
const MAX_DESK = 3;

export function createApps(app) {
  const ui = {};
  const model = () => app.model;
  const get = (key) => app.model.byKey.get(key);

  const portrait = (c) =>
    `<div class="portrait ${c.energy === 'ghost' ? 'ghost' : ''} ${c.energy === 'cold' ? 'cold' : ''}">${thumbHtml(c, 78)}</div>`;
  const pills = (c) => {
    const out = [`<span class="pill stage-${c.stage}">${STAGES[c.stage].emoji} ${STAGES[c.stage].label}</span>`];
    if (c.letGo) out.push('<span class="pill">🗑 in the recycle bin</span>');
    else if (c.frozen) out.push('<span class="pill energy-asleep">🧊 frozen</span>');
    else out.push(`<span class="pill energy-${c.energy}">${ENERGY[c.energy].label}</span>`);
    if (c.onDesk) out.push('<span class="pill desk">★ on desk</span>');
    return `<div class="pills">${out.join('')}</div>`;
  };
  const patchProject = (c, body) => api.patch(`/api/projects/${c.id}`, body);
  const patchIdea = (c, body) => api.patch(`/api/ideas/${c.id}`, body);
  const patch = (c, body) => (c.type === 'egg' ? patchIdea(c, body) : patchProject(c, body));
  const editorUrl = (p) => `${EDITORS[model().settings.editor]?.[1] || 'vscode'}://file/${encodeURI(p.replace(/\\/g, '/').replace(/^\/+/, ''))}`;

  // ------------------------------------------------------------ shared actions

  ui.newLook = (c) =>
    app.run(async () => {
      const seed = ((c.type === 'egg' ? c.idea.lookSeed : c.meta.lookSeed) || 0) + 1;
      app.setState(await patch(c, { lookSeed: seed }));
      app.habitat.hop(c.key);
    });

  ui.revive = (c, from) =>
    app.run(async () => {
      closeWindow(`visit:${c.key}`);
      if (c.type === 'egg') {
        app.setState(await patchIdea(c, { snoozeUntil: clock.now() + 30 * DAY }));
        return ui.props(c.key, from);
      }
      app.setState(await patchProject(c, { revive: true, until: clock.now() + 14 * DAY }));
      app.habitat.hop(c.key, 'you remembered me!!');
      ui.props(c.key, from, 'where');
    });

  ui.snooze = (c, days = 7) =>
    app.run(async () => {
      closeWindow(`visit:${c.key}`);
      app.setState(await patch(c, { snoozeUntil: clock.now() + days * DAY }));
    });

  ui.copyPath = async (c) => {
    try {
      await navigator.clipboard.writeText(c.p.path);
      balloon({ title: 'copied the folder path', timeout: 2500 });
    } catch {
      balloon({ title: "couldn't copy", text: c.p.path });
    }
  };

  ui.reveal = (c) => (app.practice ? balloon({ title: 'in your real studio, this opens the folder', timeout: 3500 }) : app.run(() => api.post(`/api/projects/${c.id}/reveal`)));

  ui.confirm = ({ title, text, ok = 'ok' }) =>
    new Promise((resolve) => {
      openWindow({
        key: 'confirm',
        title,
        icon: icons.about,
        width: 380,
        onClose: () => resolve(false),
        render(w) {
          w.body.innerHTML = `<p style="margin:0 0 14px">${esc(text)}</p><div class="row end"><button class="btn" data-v="0">cancel</button><button class="btn primary" data-v="1">${esc(ok)}</button></div>`;
          w.body.addEventListener('click', (e) => {
            const b = e.target.closest('[data-v]');
            if (!b) return;
            resolve(b.dataset.v === '1');
            w.close();
          });
          w.body.querySelector('[data-v="1"]').focus();
        },
      });
    });

  // ------------------------------------------------------------ properties

  ui.props = (key, from, tab) => {
    const c0 = get(key);
    if (!c0) return null;
    if (c0.type === 'egg') return ui.eggProps(key, from);
    const w = openWindow({
      key: `props:${key}`,
      title: `${c0.name} Properties`,
      icon: icons.desk,
      width: 580,
      from,
      render(w) {
        w.tab = tab || 'general';
        w.refresh = () => drawProject(w, key);
        w.refresh();
        w.body.addEventListener('click', (e) => onProjectClick(e, w, key));
        w.body.addEventListener('keydown', (e) => {
          if (e.target.name !== 'nickname') return;
          if (e.key === 'Enter') saveNickname(w, key);
          if (e.key === 'Escape') {
            e.stopPropagation();
            w.renaming = false;
            w.refresh();
          }
        });
      },
    });
    if (tab && w.tab !== tab) {
      w.tab = tab;
      w.refresh();
    }
    return w;
  };

  function drawProject(w, key) {
    const c = get(key);
    if (!c) return w.close();
    if (w.renaming && w.body.contains(document.activeElement)) return;
    const p = c.p;
    w.setTitle(`${c.name} Properties`);
    const tabs = [['general', 'General'], ['where', 'Where was I?'], ['memories', 'Memories']];
    const kind = c.kind ? `${KIND_NOUNS[c.kind] || c.kind} project` : 'project';
    w.body.innerHTML = `
      <div class="props-head">
        ${portrait(c)}
        <div>
          ${w.renaming
            ? `<input class="input" name="nickname" maxlength="40" value="${esc(c.name)}" aria-label="name">`
            : `<p class="props-name">${esc(c.name)} ${c.gone ? '' : '<button class="link" data-act="rename" aria-label="rename">✎</button>'}</p>`}
          ${pills(c)}
          <div class="muted">${esc(kind)}${p.stack?.length ? ` · ${esc(p.stack.join(' + '))}` : ''}</div>
        </div>
      </div>
      <div class="tabs" role="tablist">${tabs.map(([id, label]) => `<button class="tab" role="tab" data-tab="${id}" aria-selected="${w.tab === id}">${label}</button>`).join('')}</div>
      <div class="tab-panel" role="tabpanel">${w.tab === 'where' ? whereWasI(c) : w.tab === 'memories' ? memories(c) : general(c)}</div>
      <div class="actions">${projectActions(c)}</div>`;
    if (w.renaming) {
      const input = w.body.querySelector('[name=nickname]');
      input.focus();
      input.select();
    }
  }

  function general(c) {
    const p = c.p;
    if (c.gone) return `<p class="bio">this folder isn't there anymore. it used to live at <code>${esc(p.path)}</code>.</p>`;
    const total = (p.todos?.openCount || 0) + (p.todos?.done || 0);
    const remote = p.git?.remote;
    const git = p.git
      ? `${esc(p.git.branch || 'detached')} · ${plural(p.git.count, 'commit')} made here${remote ? ` · <a href="${esc(remote)}" target="_blank" rel="noopener noreferrer">${esc(remote.replace(/^https:\/\//, ''))}</a>` : ''}`
      : '<span class="muted">not a git repo yet</span>';
    const editor = EDITORS[model().settings.editor]?.[0] || 'VS Code';
    return `
      <p class="bio">${p.bio ? esc(p.bio) : '<span class="muted">no README yet, so i don\'t know what i am. add one and tell me!</span>'}</p>
      <dl class="facts">
        <dt>folder</dt><dd><code>${esc(p.path)}</code></dd>
        <dt>born</dt><dd>${fmtDate(p.born)} <span class="muted">(${plural(c.age, 'day')} old)</span></dd>
        <dt>last touched</dt><dd>${fmtDate(p.lastTouched)} <span class="muted">(${ago(p.lastTouched)})</span></dd>
        <dt>files</dt><dd>${p.files}${p.truncated ? '+' : ''}</dd>
        <dt>git</dt><dd>${git}</dd>
        ${p.deploy ? `<dt>deploys to</dt><dd>${esc(p.deploy)} <span class="muted">(config found)</span></dd>` : ''}
        ${p.url || c.meta.url ? `<dt>live at</dt><dd><a href="${esc(c.meta.url || p.url)}" target="_blank" rel="noopener noreferrer">${esc(c.meta.url || p.url)}</a></dd>` : ''}
        ${total ? `<dt>checklist</dt><dd><span class="meter"><i style="width:${Math.round((p.todos.done / total) * 100)}%"></i></span>${p.todos.done} of ${total} done</dd>` : ''}
      </dl>
      <div class="row" style="margin-top:14px">
        <button class="btn small" data-act="reveal">open folder</button>
        <a class="btn small" href="${esc(editorUrl(p.path))}">open in ${esc(editor)}</a>
        <button class="btn small" data-act="copy">copy path</button>
      </div>`;
  }

  function whereWasI(c) {
    const p = c.p;
    if (c.gone) return '<p class="muted">the folder is gone, so there are no breadcrumbs left.</p>';
    const commits = p.git?.commits || [];
    const recent = p.recent || [];
    const todos = p.todos?.open || [];
    const aiOn = app.state.aiReady;
    const recap = c.meta.ai?.where;
    const steps = c.meta.ai?.steps?.items || [];
    return `
      <p class="lead">you were last here <b>${ago(c.lastActive)}</b> <span class="muted">(${fmtDate(c.lastActive)})</span></p>
      ${c.note ? `<div class="note-card"><b>✉ your last note</b> <span class="muted">· ${ago(c.note.t)}</span><p>${esc(c.note.text)}</p></div>` : ''}
      ${recap ? `<div class="ai-card"><b>✨ recap</b> <span class="muted">· ${ago(recap.t)}</span><p>${esc(recap.recap)}</p><p><b>you probably stopped at:</b> ${esc(recap.stoppedAt)}</p><p class="next">10-minute step → <b>${esc(recap.nextStep)}</b><br><span class="muted">${esc(recap.why)}</span></p></div>` : ''}
      ${aiOn ? `<div class="row" style="margin:6px 0 4px"><button class="btn small" data-act="ai-where">✨ ${recap ? 'fresh recap' : 'recap this for me'}</button><button class="btn small" data-act="ai-steps">✨ ${steps.length ? 'new steps' : 'break it into steps'}</button><button class="link" data-act="ai-preview">what gets sent?</button></div>` : ''}
      ${steps.length ? `<h4>next steps</h4><ul class="steps">${steps.map((st, i) => `<li><label class="check"><input type="checkbox" data-step="${i}" ${st.done ? 'checked' : ''}> <span>${esc(st.text)}</span></label></li>`).join('')}</ul>` : ''}
      ${commits.length ? `<h4>your last commits</h4><ul class="crumbs">${commits.slice(0, 5).map((x) => `<li><span>${esc(x.msg)}</span><time>${ago(x.t)}</time></li>`).join('')}</ul>` : ''}
      ${recent.length ? `<h4>files you changed last</h4><ul class="crumbs">${recent.map((f) => `<li><span class="mono">${esc(f.rel)}</span><time>${ago(f.t)}</time></li>`).join('')}</ul>` : '<p class="muted">this folder is empty. maybe it was waiting for a first file?</p>'}
      ${todos.length
        ? `<h4>still on your list${p.todos.openCount > todos.length ? ` (${p.todos.openCount})` : ''}</h4><ul class="todo">${todos.slice(0, 6).map((t) => `<li>${esc(t.text)} <span class="muted">· ${esc(t.file)}</span></li>`).join('')}</ul>
           <p class="next">maybe start here → <b>${esc(todos[0].text)}</b></p>`
        : '<p class="small-print">tip: add a TODO.md with lines like "- [ ] the next thing" and they\'ll show up here.</p>'}`;
  }

  function memories(c) {
    const p = c.p;
    const items = [];
    if (c.egg) {
      items.push([c.egg.createdAt, `🥚 you thought of me${c.egg.source === 'voice' ? ' out loud' : ''}: <q>${esc(short(c.egg.note || c.egg.title, 160))}</q> <span class="muted">${fmtTime(c.egg.createdAt)}</span>`]);
      if (c.egg.hatchedAt) items.push([c.egg.hatchedAt, '🐣 hatched from my egg']);
    }
    items.push([p.born, `📁 my folder appeared${p.folder ? `: ${esc(p.folder)}` : ''}`]);
    if (p.git?.first) items.push([p.git.first, '🌱 first commit']);
    const words = {
      desk: '★ put on the desk', shipped: '✨ shipped!', frozen: '🧊 went in the freezer', thawed: '☀ thawed out',
      'let-go': '🗑 let go', restored: '♻ came back from the recycle bin', revived: '💌 you came back for me',
    };
    for (const e of c.meta.events || []) items.push([e.t, `${words[e.type] || e.type}${e.cause ? ` (${esc(CAUSES[e.cause] || e.cause)})` : ''}`]);
    for (const n of c.meta.notes || []) items.push([n.t, `✉ you left a note: <q>${esc(short(n.text, 140))}</q>`]);
    const sessions = c.meta.sessions || [];
    if (sessions.length) items.push([sessions[sessions.length - 1].t, `◷ ${plural(sessions.length, 'focus session')}, ${Math.round(sessions.reduce((n, x) => n + x.minutes, 0) / 6) / 10} hours in all`]);
    items.sort((a, b) => a[0] - b[0]);
    const heard = app.habitat.heard(c.key);
    return `
      <ul class="memories">${items.map(([t, html]) => `<li><span>${html}</span><time>${fmtDate(t)}</time></li>`).join('')}</ul>
      <h4>overheard lately</h4>
      ${heard.length ? `<ul class="overheard">${heard.map((l) => `<li><span>“${esc(l.text)}”</span><time>${fmtTime(l.t)}</time></li>`).join('')}</ul>` : '<p class="muted">nothing yet. give it a minute, they\'re chatty.</p>'}`;
  }

  function projectActions(c) {
    if (c.gone) return '<span class="muted">this one is just a memory now.</span>';
    if (c.letGo) return `<button class="btn primary" data-act="restore">♻ restore</button><span class="spacer"></span><span class="muted">let go ${ago(c.letGo.at)} · ${esc(CAUSES[c.letGo.cause])}</span>`;
    if (c.frozen) return '<button class="btn primary" data-act="thaw">☀ thaw</button>';
    return `
      <button class="btn primary" data-act="resume">▶ resume</button>
      <button class="btn" data-act="desk">${c.onDesk ? 'take off desk' : '★ put on desk'}</button>
      <button class="btn" data-act="note">✉ note</button>
      <button class="btn" data-act="ship">${c.stage === 'shipped' ? 'not shipped' : '✨ shipped it'}</button>
      <span class="spacer"></span>
      <button class="btn" data-act="more">more ▾</button>`;
  }

  async function onProjectClick(e, w, key) {
    const c = get(key);
    if (!c) return;
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      w.tab = tabBtn.dataset.tab;
      return w.refresh();
    }
    const step = e.target.closest('[data-step]');
    if (step) return app.run(async () => app.setState(await patchProject(c, { stepDone: Number(step.dataset.step), done: step.checked })));
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'resume':
        return resume(app, c);
      case 'note':
        return ui.leaveNote(c, btn);
      case 'more': {
        const r = btn.getBoundingClientRect();
        return ui.menuFor(c, r.left, r.bottom + 4);
      }
      case 'ai-where':
        btn.disabled = true;
        btn.textContent = '✨ thinking…';
        await ui.aiWhere(c, btn);
        return w.refresh();
      case 'ai-steps':
        btn.disabled = true;
        btn.textContent = '✨ thinking…';
        await ui.aiSteps(c, btn);
        return w.refresh();
      case 'ai-preview':
        return ui.aiPreview('where', { projectId: c.id }, btn);
      case 'rename':
        w.renaming = true;
        return w.refresh();
      case 'reveal': return ui.reveal(c);
      case 'copy': return ui.copyPath(c);
      case 'desk': return ui.desk(c, !c.onDesk, btn);
      case 'ship':
        return app.run(async () => {
          const shipped = c.stage !== 'shipped';
          app.setState(await patchProject(c, { shipped }));
          if (shipped) app.habitat.hop(c.key, "i'm live!! ✨");
          undoable(shipped ? `${c.name} shipped ✨` : 'marked as not shipped', async () => app.setState(await patchProject(c, { shipped: !shipped })));
        });
      case 'look': return ui.newLook(c);
      case 'freeze': return ui.freeze(c);
      case 'thaw': return ui.thaw(c);
      case 'letgo': return ui.letGo(c, btn);
      case 'restore': return ui.restore(c);
    }
  }

  async function saveNickname(w, key) {
    const c = get(key);
    const value = w.body.querySelector('[name=nickname]')?.value.trim();
    w.renaming = false;
    await app.run(async () => {
      const name = c.p.title || c.p.folder;
      app.setState(await patchProject(c, { nickname: value && value !== name ? value : '' }));
    });
    w.refresh();
  }

  // ------------------------------------------------------------ eggs

  ui.eggProps = (key, from) =>
    openWindow({
      key: `props:${key}`,
      title: 'Egg Properties',
      icon: icons.egg,
      width: 480,
      from,
      render(w) {
        w.refresh = () => {
          const c = get(key);
          if (!c) return w.close();
          if (w.dirty || w.body.contains(document.activeElement)) return;
          drawEgg(w, c);
        };
        drawEgg(w, get(key));
        w.body.addEventListener('input', () => {
          w.dirty = true;
          w.body.querySelector('[data-act=save]').disabled = false;
        });
        w.body.addEventListener('click', (e) => onEggClick(e, w, key));
      },
    });

  function hatchCandidates(c) {
    const linked = new Set(app.state.ideas.filter((i) => i.projectId).map((i) => i.projectId));
    const ew = eggWords(c);
    return model()
      .creatures.filter((x) => x.type === 'project' && !x.gone && !linked.has(x.id))
      .map((x) => ({ x, score: similarity(ew, projectWords(x)) }))
      .sort((a, b) => b.score - a.score || b.x.p.born - a.x.p.born);
  }

  function drawEgg(w, c) {
    const i = c.idea;
    const cands = hatchCandidates(c);
    const best = cands[0]?.score >= 0.34 ? cands[0].x : null;
    w.dirty = false;
    w.setTitle(`${short(c.name, 30)} Properties`);
    w.body.innerHTML = `
      <div class="props-head">
        ${portrait(c)}
        <div>
          <p class="props-name">${esc(c.name)}</p>
          ${pills(c)}
          <div class="muted">laid ${ago(i.createdAt)} · ${fmtDate(i.createdAt)}, ${fmtTime(i.createdAt)}${i.source === 'voice' ? ' · said out loud' : ''}</div>
        </div>
      </div>
      <div style="margin-top:14px">
        <label class="field"><span>idea</span><input class="input" name="title" maxlength="80" value="${esc(i.title)}"></label>
        <label class="field"><span>notes</span><textarea class="textarea" name="note" rows="4" maxlength="4000" placeholder="what is it? who is it for? what's the magic bit?">${esc(i.note || '')}</textarea></label>
        <div class="row end"><button class="btn" data-act="save" disabled>save</button></div>
      </div>
      ${c.letGo || c.frozen ? '' : `
      <fieldset class="group">
        <legend>🐣 hatch it</legend>
        <p style="margin:0 0 8px">made a folder for this idea? link them and the egg hatches into that folder's creature.</p>
        ${best ? `<p class="next" style="margin:0 0 10px">this looks like it: <b>${esc(best.name)}</b> <button class="btn small primary" data-act="hatch" data-id="${best.id}">yes, hatch!</button></p>` : ''}
        ${cands.length
          ? `<div class="row"><select class="select" name="project" style="flex:1">${cands.map(({ x }) => `<option value="${x.id}">${esc(x.name)} (${esc(x.p.folder)})</option>`).join('')}</select><button class="btn" data-act="hatch-pick">hatch</button>${app.state.aiReady ? '<button class="btn small" data-act="ai-match">✨ find its folder</button>' : ''}</div>`
          : '<p class="muted" style="margin:0">no unlinked folders yet. when you make one, it shows up here.</p>'}
      </fieldset>`}
      <div class="actions">${c.letGo
        ? '<button class="btn primary" data-act="restore">♻ restore</button>'
        : c.frozen
          ? '<button class="btn primary" data-act="thaw">☀ thaw</button>'
          : `<button class="btn" data-act="pin">${i.pinned ? 'unpin from board' : '📌 pin to board'}</button>${app.state.aiReady ? '<button class="btn" data-act="ai-tidy">✨ tidy</button><button class="btn" data-act="ai-readme">✨ names + README</button>' : ''}<span class="spacer"></span><button class="btn" data-act="freeze">🧊 freeze</button><button class="btn danger" data-act="letgo">let go…</button>`}</div>`;
  }

  async function onEggClick(e, w, key) {
    const c = get(key);
    const btn = e.target.closest('[data-act]');
    if (!c || !btn) return;
    switch (btn.dataset.act) {
      case 'save':
        return app.run(async () => {
          const title = w.body.querySelector('[name=title]').value.trim();
          const note = w.body.querySelector('[name=note]').value;
          if (!title) throw new Error('an idea needs a name');
          app.setState(await patchIdea(c, { title, note }));
          w.dirty = false;
          document.activeElement?.blur();
          drawEgg(w, get(key));
        });
      case 'pin': return ui.pin(c, !c.idea.pinned);
      case 'ai-tidy':
        btn.disabled = true;
        btn.textContent = '✨ thinking…';
        await ui.aiTidyEgg(c, btn);
        w.dirty = false;
        return w.refresh();
      case 'ai-readme': return ui.aiReadme(c, btn);
      case 'ai-match': {
        btn.disabled = true;
        btn.textContent = '✨ looking…';
        const m = await ui.aiMatch(c, btn);
        btn.disabled = false;
        btn.textContent = '✨ find its folder';
        if (m) {
          const sel = w.body.querySelector('[name=project]');
          if (sel) sel.value = m.projectId;
          balloon({ title: `looks like ${get(`p:${m.projectId}`).name} (${m.confidence})`, text: m.reason, timeout: 8000 });
        }
        return;
      }
      case 'hatch': return ui.hatch(c, btn.dataset.id);
      case 'hatch-pick': return ui.hatch(c, w.body.querySelector('[name=project]').value);
      case 'look': return ui.newLook(c);
      case 'freeze': return ui.freeze(c);
      case 'thaw': return ui.thaw(c);
      case 'letgo': return ui.letGo(c, btn);
      case 'restore': return ui.restore(c);
    }
  }

  ui.hatch = (egg, projectId) =>
    app.run(async () => {
      const res = await patchIdea(egg, { projectId });
      closeWindow(`props:${egg.key}`);
      app.habitat.hatch(egg.key, `p:${projectId}`, `it's me! i was "${short(egg.name, 26)}"`);
      app.setState(res);
      undoable(`"${short(egg.name, 24)}" hatched`, async () => app.setState(await patchIdea(egg, { projectId: null })));
    });

  // ------------------------------------------------------------ desk full

  ui.deskFull = (c, from) =>
    openWindow({
      key: 'deskfull',
      title: 'the desk is full',
      icon: icons.desk,
      width: 440,
      from,
      render(w) {
        const draw = () => {
          const desk = model().desk;
          if (desk.length < MAX_DESK) {
            w.close();
            return ui.desk(get(c.key) || c, true);
          }
          w.body.innerHTML = `
            <p style="margin-top:0">only ${MAX_DESK} creatures fit on the desk, so you stay focused. who goes back to the yard to make room for <b>${esc(c.name)}</b>?</p>
            <ul class="binlist">${desk.map((d) => `<li>${portrait(d)}<div class="grow"><b>${esc(d.name)}</b><div class="muted">${ENERGY[d.energy].label} · touched ${ago(d.p.lastTouched)}</div></div><button class="btn small" data-off="${d.id}">back to the yard</button></li>`).join('')}</ul>`;
        };
        w.refresh = draw;
        draw();
        w.body.addEventListener('click', (e) => {
          const b = e.target.closest('[data-off]');
          if (!b) return;
          app.run(async () => app.setState(await api.patch(`/api/projects/${b.dataset.off}`, { onDesk: false })));
        });
      },
    });

  // ------------------------------------------------------------ let go

  ui.letGo = (c, from) =>
    openWindow({
      key: `letgo:${c.key}`,
      title: 'let go?',
      icon: icons.bin,
      width: 460,
      from,
      render(w) {
        w.body.innerHTML = `
          <div class="nr">${portrait(c)}<div>
            <p>letting go of <b>${esc(c.name)}</b>.</p>
            <p class="muted" style="margin:0">${c.type === 'egg' ? "it's only an idea, so nothing on your computer changes." : 'your files stay exactly where they are.'} you can restore it from the recycle bin any time.</p>
          </div></div>
          <fieldset class="group"><legend>why?</legend><div class="radios">
            ${Object.entries(CAUSES).map(([v, label], n) => `<label><input type="radio" name="cause" value="${v}" ${n === 0 ? 'checked' : ''}> ${label}</label>`).join('')}
          </div></fieldset>
          <label class="field" style="margin-top:12px"><span>what's worth keeping? (a name, a feature, a lesson)</span><textarea class="textarea" name="keep" rows="3" maxlength="500"></textarea></label>
          <div class="row end">${app.state.aiReady ? '<button class="btn small" data-act="ai">✨ suggest (AI)</button><span style="flex:1"></span>' : ''}<button class="btn" data-act="cancel">cancel</button><button class="btn primary" data-act="go">let go</button></div>`;
        w.body.addEventListener('click', async (e) => {
          const act = e.target.closest('[data-act]')?.dataset.act;
          if (act === 'cancel') return w.close();
          if (act === 'ai') {
            const b = e.target.closest('button');
            b.disabled = true;
            b.textContent = '✨ thinking…';
            await ui.aiLetGo(c, w.body, b);
            b.disabled = false;
            b.textContent = '✨ suggest (AI)';
            return;
          }
          if (act !== 'go') return;
          const cause = w.body.querySelector('[name=cause]:checked').value;
          const keep = w.body.querySelector('[name=keep]').value;
          w.close();
          ui.confirmLetGo(c, cause, keep);
        });
      },
    });

  // ------------------------------------------------------------ not responding

  ui.visit = (c, from) =>
    openWindow({
      key: `visit:${c.key}`,
      title: c.type === 'egg' ? `${short(c.name, 28)} (Getting Cold)` : `${short(c.name, 28)} (Not Responding)`,
      icon: icons.ghost,
      width: 460,
      from,
      render(w) {
        const egg = c.type === 'egg';
        w.body.innerHTML = `
          <div class="nr">${portrait(c)}<div>
            ${egg
              ? `<p><b>"${esc(c.name)}"</b> has been waiting <b>${plural(c.days, 'day')}</b> to hatch and is getting cold.</p>`
              : `<p><b>${esc(c.name)}</b> hasn't been touched in <b>${plural(c.days, 'day')}</b> and is starting to fade.</p>`}
            <p style="margin:0">what would you like to do?</p>
          </div></div>
          <div class="row" style="margin-top:16px">
            <button class="btn primary" data-act="revive">${egg ? '♡ keep it warm' : '💌 revive'}</button>
            <button class="btn" data-act="freeze">🧊 freeze</button>
            <button class="btn danger" data-act="letgo">let go…</button>
            <span style="flex:1"></span>
            <button class="btn" data-act="later">not now</button>
          </div>
          <p class="small-print">${egg ? 'keeping it warm gives it another month.' : 'revive opens "where was i?" so you can pick up where you left off.'} freezing keeps it safe but out of the way.</p>`;
        w.body.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-act]');
          if (!btn) return;
          const act = btn.dataset.act;
          if (act === 'revive') ui.revive(c, btn);
          if (act === 'freeze') ui.freeze(c);
          if (act === 'letgo') ui.letGo(c, btn);
          if (act === 'later') ui.snooze(c, 7);
        });
      },
    });

  // ------------------------------------------------------------ task manager

  const COLS = [
    ['name', 'Name', (c) => c.name.toLowerCase()],
    ['stage', 'Stage', (c) => ['egg', 'hatchling', 'growing', 'shipped'].indexOf(c.stage)],
    ['status', 'Status', (c) => ['lively', 'awake', 'egg', 'bored', 'asleep', 'cold', 'ghost'].indexOf(c.energy)],
    ['touched', 'Last touched', (c) => (c.type === 'egg' ? c.idea.createdAt : c.p.lastTouched)],
    ['age', 'Age', (c) => c.age],
    ['files', 'Files', (c) => (c.type === 'egg' ? -1 : c.p.files)],
  ];
  const FILTERS = {
    all: ['everything', () => true],
    creatures: ['creatures', (c) => c.type === 'project'],
    eggs: ['eggs', (c) => c.type === 'egg'],
    attention: ['needs attention', (c) => ['asleep', 'ghost', 'cold'].includes(c.energy)],
    desk: ['on the desk', (c) => c.onDesk],
  };

  ui.taskmgr = (from, filter) =>
    openWindow({
      key: 'taskmgr',
      title: 'Task Manager',
      icon: icons.taskmgr,
      width: 760,
      from,
      render(w) {
        w.sort = { col: 'touched', dir: -1 };
        w.filter = filter || 'all';
        w.sel = null;
        w.refresh = () => drawTasks(w);
        drawTasks(w);
        w.body.addEventListener('click', (e) => onTaskClick(e, w));
        w.body.addEventListener('contextmenu', (e) => {
          const row = e.target.closest('tr[data-key]');
          if (!row) return;
          e.preventDefault();
          ui.menuFor(get(row.dataset.key), e.clientX, e.clientY);
        });
        w.body.addEventListener('dblclick', (e) => {
          const row = e.target.closest('tr[data-key]');
          if (row) ui.props(row.dataset.key, row);
        });
        w.body.addEventListener('change', (e) => {
          if (e.target.name === 'filter') {
            w.filter = e.target.value;
            drawTasks(w);
          }
        });
      },
    });

  function drawTasks(w) {
    const m = model();
    const sortKey = COLS.find((x) => x[0] === w.sort.col)[2];
    const rows = m.live
      .filter(FILTERS[w.filter][1])
      .sort((a, b) => {
        const va = sortKey(a);
        const vb = sortKey(b);
        return (va < vb ? -1 : va > vb ? 1 : 0) * w.sort.dir;
      });
    if (w.sel && !m.byKey.get(w.sel)) w.sel = null;
    const projects = m.live.filter((c) => c.type === 'project');
    const ghosts = m.live.filter((c) => c.energy === 'ghost');
    const scanned = m.state.scannedAt ? `scanned ${ago(m.state.scannedAt, Date.now())} in ${m.state.scanMs} ms` : 'not scanned yet';
    w.body.innerHTML = `
      <div class="toolbar">
        <label class="row" style="gap:6px"><span style="font-family:var(--font-ui)">show</span>
          <select class="select" name="filter">${Object.entries(FILTERS).map(([k, [label]]) => `<option value="${k}" ${w.filter === k ? 'selected' : ''}>${label}</option>`).join('')}</select>
        </label>
        <span style="flex:1"></span>
        <button class="btn small" data-act="rescan">↻ rescan folders</button>
      </div>
      <div class="list">
        <table class="table">
          <thead><tr>${COLS.map(([k, label]) => `<th><button data-sort="${k}">${label}${w.sort.col === k ? (w.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`).join('')}</tr></thead>
          <tbody>${rows.map((c) => `
            <tr data-key="${c.key}" class="${w.sel === c.key ? 'selected' : ''}">
              <td class="name"><span>${thumbHtml(c, 22)}${esc(c.name)}${c.onDesk ? ' ★' : ''}</span></td>
              <td>${STAGES[c.stage].emoji} ${STAGES[c.stage].label}</td>
              <td class="status ${c.energy}">${ENERGY[c.energy].status}</td>
              <td>${ago(c.type === 'egg' ? c.idea.createdAt : c.p.lastTouched)}</td>
              <td>${plural(c.age, 'day')}</td>
              <td>${c.type === 'egg' ? '—' : c.p.files}</td>
            </tr>`).join('') || `<tr><td colspan="6" class="empty">nothing here.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn" data-act="props">Properties</button>
        <button class="btn" data-act="desk">★ Desk</button>
        <button class="btn" data-act="freeze">Freeze</button>
        <span style="flex:1"></span>
        <button class="btn danger" data-act="end">End Task</button>
      </div>
      <div class="statusbar">
        <span>creatures: ${projects.length}</span>
        <span>eggs: ${m.live.length - projects.length}</span>
        <span>on desk: ${m.desk.length}/${MAX_DESK}</span>
        <span>not responding: ${ghosts.length}</span>
        <span>${scanned}</span>
      </div>`;
    updateTaskButtons(w);
  }

  function updateTaskButtons(w) {
    const c = w.sel && get(w.sel);
    const set = (act, on, label) => {
      const b = w.body.querySelector(`[data-act=${act}]`);
      if (!b) return;
      b.disabled = !on;
      if (label) b.textContent = label;
    };
    set('props', !!c);
    set('desk', c?.type === 'project', c?.onDesk ? 'Take off desk' : '★ Desk');
    set('freeze', !!c);
    set('end', !!c);
  }

  function onTaskClick(e, w) {
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      const col = sortBtn.dataset.sort;
      w.sort = { col, dir: w.sort.col === col ? -w.sort.dir : col === 'name' ? 1 : -1 };
      return drawTasks(w);
    }
    const row = e.target.closest('tr[data-key]');
    if (row) {
      w.sel = row.dataset.key;
      w.body.querySelectorAll('tr.selected').forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
      return updateTaskButtons(w);
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'rescan') return app.rescan();
    const c = w.sel && get(w.sel);
    if (!c) return;
    if (btn.dataset.act === 'props') ui.props(c.key, btn);
    if (btn.dataset.act === 'desk') ui.desk(c, !c.onDesk, btn);
    if (btn.dataset.act === 'freeze') ui.freeze(c);
    if (btn.dataset.act === 'end') ui.letGo(c, btn);
  }

  // ------------------------------------------------------------ recycle bin

  ui.bin = (from) =>
    openWindow({
      key: 'bin',
      title: 'Recycle Bin',
      icon: icons.bin,
      width: 540,
      from,
      render(w) {
        w.refresh = () => {
          const bin = model().bin;
          const counts = {};
          for (const c of bin) counts[c.letGo.cause] = (counts[c.letGo.cause] || 0) + 1;
          const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
          w.body.innerHTML = bin.length
            ? `<p class="muted" style="margin-top:0">where ideas come back from the trash. nothing here was deleted from your computer.</p>
               <div class="list"><ul class="binlist">${bin.map((c) => `
                <li>${portrait(c)}<div class="grow">
                  <b>${esc(c.name)}</b>
                  <div class="muted">${c.type === 'egg' ? 'idea' : c.gone ? 'folder (now deleted)' : 'folder'} · let go ${ago(c.letGo.at, Date.now())} · ${esc(CAUSES[c.letGo.cause])}</div>
                  ${c.letGo.keep ? `<q>${esc(c.letGo.keep)}</q>` : ''}
                </div>
                <div class="row" style="flex-direction:column;align-items:stretch;gap:4px">
                  ${c.gone ? '' : `<button class="btn small" data-act="restore" data-key="${c.key}">restore</button>`}
                  ${c.type === 'egg' ? `<button class="btn small" data-act="delete" data-key="${c.key}">delete</button>` : c.gone ? '' : `<button class="btn small" data-act="reveal" data-key="${c.key}">show folder</button>`}
                </div></li>`).join('')}</ul></div>
               <div class="statusbar"><span>${plural(bin.length, 'item')}</span>${top ? `<span>most common reason: ${esc(CAUSES[top[0]])} (${top[1]})</span>` : ''}</div>`
            : '<p class="empty">the recycle bin is empty.<br>every idea is still here ♡</p>';
        };
        w.refresh();
        w.body.addEventListener('click', async (e) => {
          const btn = e.target.closest('[data-act]');
          const c = btn && get(btn.dataset.key);
          if (!c) return;
          if (btn.dataset.act === 'restore') ui.restore(c);
          if (btn.dataset.act === 'reveal') ui.reveal(c);
          if (btn.dataset.act === 'delete' && (await ui.confirm({ title: 'delete forever?', text: `"${c.name}" will be gone for good. this can't be undone.`, ok: 'delete' }))) {
            app.run(async () => app.setState(await api.del(`/api/ideas/${c.id}`)));
          }
        });
      },
    });

  // ------------------------------------------------------------ freezer

  ui.freezer = (from) =>
    openWindow({
      key: 'freezer',
      title: 'Freezer',
      icon: icons.freezer,
      width: 540,
      from,
      render(w) {
        w.refresh = () => {
          const items = model().freezer;
          w.body.innerHTML = items.length
            ? `<p class="muted" style="margin-top:0">kept safe, out of the way. frozen creatures don't get sleepy or turn into ghosts.</p>
               <div class="cards">${items.map((c) => `
                 <div class="card"><div class="ice">${portrait(c)}</div><b>${esc(c.name)}</b><span class="muted">${c.type === 'egg' ? 'idea' : 'folder'}</span>
                 <div class="row"><button class="btn small" data-act="thaw" data-key="${c.key}">thaw</button><button class="btn small" data-act="props" data-key="${c.key}">info</button></div></div>`).join('')}</div>`
            : '<p class="empty">nothing in the freezer.<br>freeze ideas you want to keep but not think about right now.</p>';
        };
        w.refresh();
        w.body.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-act]');
          const c = btn && get(btn.dataset.key);
          if (!c) return;
          if (btn.dataset.act === 'thaw') ui.thaw(c);
          if (btn.dataset.act === 'props') ui.props(c.key, btn);
        });
      },
    });

  // ------------------------------------------------------------ run (new idea)

  ui.run = (from) =>
    openWindow({
      key: 'run',
      title: 'Run',
      icon: icons.egg,
      width: 460,
      from,
      render(w) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        w.body.innerHTML = `
          <div class="run-head">${icons.egg}<p>type an idea and brainchildren will keep it safe as an egg. hatch it later, when you make a folder for it.</p></div>
          <label class="field"><span>Open:</span><input class="input" name="title" maxlength="80" placeholder="e.g. a playlist that matches your outfit" autocomplete="off"></label>
          <label class="field"><span>notes (optional)</span><textarea class="textarea" name="note" rows="4" maxlength="4000" placeholder="ramble here. who is it for? what's the magic bit?"></textarea></label>
          <div class="row">${SR ? '<button class="btn small mic" data-act="mic">🎤 talk</button>' : ''}${app.state.aiReady ? '<button class="btn small" data-act="tidy">✨ tidy my ramble</button>' : ''}<span class="mic-status"></span></div>
          <p class="err" hidden></p>
          <div class="row end" style="margin-top:12px"><button class="btn" data-act="cancel">cancel</button><button class="btn primary" data-act="ok">OK</button></div>
          ${SR ? '<p class="small-print">talking uses your browser\'s speech-to-text, which may send audio to its maker (Google, in Chrome). typing never leaves your computer.</p>' : ''}`;
        const title = w.body.querySelector('[name=title]');
        const note = w.body.querySelector('[name=note]');
        const err = w.body.querySelector('.err');
        let rec = null;
        let spoken = false;
        setTimeout(() => title.focus(), 60);

        const firstWords = (text) => short(text.trim().replace(/\s+/g, ' ').split(' ').slice(0, 8).join(' '), 60);
        const stopMic = () => rec?.stop();
        const submit = () =>
          app.run(async () => {
            stopMic();
            const t = title.value.trim() || (note.value.trim() ? firstWords(note.value) : '');
            if (!t) {
              err.hidden = false;
              err.textContent = 'give your idea a name first (or say it out loud).';
              return title.focus();
            }
            const res = await api.post('/api/ideas', { title: t, note: note.value, source: spoken ? 'voice' : 'typed' });
            w.close();
            app.setState(res.state);
            app.habitat.hop(`e:${res.idea.id}`);
            balloon({ title: '🥚 new egg', text: res.idea.title, timeout: 5000, onClick: () => ui.props(`e:${res.idea.id}`) });
          });

        w.body.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && e.target === title) submit();
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
        });
        w.body.addEventListener('click', (e) => {
          const act = e.target.closest('[data-act]')?.dataset.act;
          if (act === 'cancel') return w.close();
          if (act === 'ok') return submit();
          if (act === 'tidy') {
            const text = `${title.value}\n${note.value}`.trim();
            if (!text) return title.focus();
            const b = e.target.closest('button');
            b.disabled = true;
            b.textContent = '✨ tidying…';
            ui.aiTidyRamble(text, b).then((card) => {
              b.disabled = false;
              b.textContent = '✨ tidy my ramble';
              if (!card) return;
              title.value = card.title;
              note.value = ui.cardNote(card);
              const similar = (card.similarIds || []).map((id) => get(`e:${id}`) || get(`p:${id}`)).filter(Boolean);
              if (similar.length) balloon({ title: 'this sounds like something you already have', text: similar.map((x) => x.name).join(', '), timeout: 8000 });
            });
            return;
          }
          if (act !== 'mic') return;
          const mic = w.body.querySelector('.mic');
          const status = w.body.querySelector('.mic-status');
          if (rec) return stopMic();
          rec = new SR();
          rec.lang = navigator.language || 'en-US';
          rec.continuous = true;
          rec.interimResults = true;
          const before = note.value.trim() ? `${note.value.trim()} ` : '';
          rec.onresult = (ev) => {
            let text = '';
            for (const r of ev.results) text += r[0].transcript;
            note.value = before + text.trim();
            spoken = true;
          };
          rec.onerror = (ev) => {
            status.textContent = ev.error === 'not-allowed' ? 'the microphone is blocked for this page' : `voice stopped (${ev.error})`;
          };
          rec.onend = () => {
            rec = null;
            mic.classList.remove('listening');
            mic.textContent = '🎤 talk';
            if (!status.textContent.startsWith('voice') && !status.textContent.startsWith('the mic')) status.textContent = '';
            if (!title.value.trim() && note.value.trim()) title.value = firstWords(note.value);
          };
          rec.start();
          mic.classList.add('listening');
          mic.textContent = '■ stop';
          status.textContent = 'listening… ramble away';
        });
        w.cleanup = () => rec?.abort();
      },
    });

  // ------------------------------------------------------------ settings

  // ------------------------------------------------------------ about

  ui.about = (from) =>
    openWindow({
      key: 'about',
      title: 'About brainchildren',
      icon: icons.about,
      width: 440,
      from,
      render(w) {
        w.body.innerHTML = `
          <div class="run-head">${icons.egg}<div><p><b>brainchildren</b> ${esc(app.state.version)}</p><p class="muted">your project ideas, living on a tiny desktop.</p></div></div>
          <p>every project folder becomes a little person in your studio, and every idea you haven't started yet is an egg in the nest. the ones you focus on sit at the desks. the ones you don't touch get bored, nap on the sofa, and after a while turn into ghosts that ask what you'd like to do. nothing gets forgotten by accident.</p>
          <p class="small-print">brainchildren only reads folder names, file dates, READMEs, checklists, package.json files and the text files inside .git. it never changes your files and never sends anything anywhere.</p>
          <p class="small-print">made with ♡ by @doodlesby.jessi</p>`;
      },
    });

  // ------------------------------------------------------------ egg nest

  ui.nest = (from) =>
    openWindow({
      key: 'nest',
      title: 'Egg Nest',
      icon: icons.egg,
      width: 520,
      from,
      render(w) {
        w.refresh = () => {
          const eggs = model()
            .live.filter((c) => c.type === 'egg')
            .sort((a, b) => b.idea.createdAt - a.idea.createdAt);
          w.body.innerHTML = `
            <div class="run-head">${icons.egg}<p>eggs are ideas you haven't started yet. when you make a folder for one, open it and hatch it.</p></div>
            ${eggs.length
              ? `<div class="list"><ul class="binlist">${eggs.map((c) => `
                  <li>${portrait(c)}<div class="grow"><b>${esc(c.name)}</b>
                    <div class="muted">laid ${ago(c.idea.createdAt)}${c.energy === 'cold' ? ' · getting cold' : ''}</div>
                    ${c.idea.note ? `<q>${esc(short(c.idea.note, 120))}</q>` : ''}</div>
                    <button class="btn small" data-egg="${c.key}">open</button></li>`).join('')}</ul></div>`
              : '<p class="empty">no eggs yet.<br>lay one for every idea you get, even the silly ones.</p>'}
            <div class="row end" style="margin-top:12px"><button class="btn primary" data-act="new">🥚 lay a new egg</button></div>`;
        };
        w.refresh();
        w.body.addEventListener('click', (e) => {
          const egg = e.target.closest('[data-egg]');
          if (egg) return ui.props(egg.dataset.egg, egg);
          if (e.target.closest('[data-act=new]')) {
            w.close();
            ui.run(from);
          }
        });
      },
    });

  // ------------------------------------------------------------ pick for desk

  ui.pickDesk = (from) =>
    openWindow({
      key: 'pickdesk',
      title: 'Who sits here?',
      icon: icons.desk,
      width: 460,
      from,
      render(w) {
        w.refresh = () => {
          const m = model();
          if (m.desk.length >= MAX_DESK) return w.close();
          const list = m.live.filter((c) => c.type === 'project' && !c.onDesk).sort((a, b) => a.days - b.days);
          w.body.innerHTML = `
            <p style="margin-top:0">pick a project to focus on. it sits at a desk and shows up on the taskbar. you can have ${MAX_DESK} at a time.</p>
            ${list.length
              ? `<div class="list"><ul class="binlist">${list.map((c) => `
                  <li>${portrait(c)}<div class="grow"><b>${esc(c.name)}</b><div class="muted">${ENERGY[c.energy].label} · touched ${ago(c.p.lastTouched)}</div></div>
                  <button class="btn small primary" data-pick="${c.key}">★ sit here</button></li>`).join('')}</ul></div>`
              : '<p class="empty">no projects to pick yet.</p>'}`;
        };
        w.refresh();
        w.body.addEventListener('click', (e) => {
          const b = e.target.closest('[data-pick]');
          if (!b) return;
          w.close();
          ui.desk(get(b.dataset.pick), true, b);
        });
      },
    });

  // ------------------------------------------------------------ time machine

  ui.timeMachine = (from) =>
    openWindow({
      key: 'timemachine',
      title: 'Time Machine',
      icon: icons.about,
      width: 420,
      from,
      render(w) {
        w.body.innerHTML = `
          <p style="margin-top:0">peek at your studio in the future to see who'll be napping or a ghost if nothing changes. it's only a preview and resets when you reload.</p>
          <div class="range-row"><input type="range" name="time" min="0" max="90" value="${clock.offsetDays}" aria-label="days ahead"><b class="time-label"></b></div>
          <div class="row end" style="margin-top:12px"><button class="btn" data-act="today">back to today</button><button class="btn primary" data-act="close">done</button></div>`;
        const label = w.body.querySelector('.time-label');
        const range = w.body.querySelector('[name=time]');
        const show = () => (label.textContent = clock.offsetDays ? `+${plural(clock.offsetDays, 'day')} (${fmtDate(clock.now())})` : 'today');
        show();
        range.addEventListener('input', () => {
          clock.offsetDays = range.value;
          show();
          app.remodel();
        });
        w.body.addEventListener('click', (e) => {
          const act = e.target.closest('[data-act]')?.dataset.act;
          if (act === 'today') {
            clock.offsetDays = 0;
            range.value = 0;
            show();
            app.remodel();
          }
          if (act === 'close') w.close();
        });
      },
    });

  return ui;
}
