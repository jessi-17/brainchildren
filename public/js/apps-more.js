// The second batch of windows: right-click menus, notes for future you,
// egg sorting, dress-up, the whiteboard and wall, settings with tabs,
// the town meeting and "pick for me".
import { api } from './api.js';
import { openWindow, balloon, closeWindow } from './wm.js';
import { icons } from './icons.js';
import { openMenu } from './menu.js';
import { undoable } from './undo.js';
import { thumbHtml, lookStyle } from './look.js';
import { resume, openInEditor, focusOn } from './focus.js';
import { setAmbience } from './audio.js';
import * as folk from './pixelfolk.js';
import { STAGES, ENERGY, CAUSES, DAY, clock, esc, ago, fmtDate, plural, short, hash } from './life.js';

const EDITOR_NAMES = { vscode: 'VS Code', cursor: 'Cursor', windsurf: 'Windsurf', vscodium: 'VSCodium' };

export function extendApps(app, ui) {
  const model = () => app.model;
  const get = (key) => app.model.byKey.get(key);
  const patchP = (c, body) => api.patch(`/api/projects/${c.id}`, body);
  const patchI = (c, body) => api.patch(`/api/ideas/${c.id}`, body);
  const patch = (c, body) => (c.type === 'egg' ? patchI(c, body) : patchP(c, body));
  const prefs = (body) => api.post('/api/prefs', body).then(app.setState);
  const aiOn = () => !!app.state.aiReady;

  // ------------------------------------------------------------ right-click menus

  ui.menuFor = (c, x, y) => {
    if (!c) return;
    const items = [];
    const it = (label, action, extra = {}) => items.push({ label, action, ...extra });
    if (c.letGo) {
      it('restore', () => ui.restore(c));
      return openMenu(x, y, items, { title: c.name });
    }
    if (c.ignored) {
      it('this is a project after all', () => ui.notAProject(c, false));
      return openMenu(x, y, items, { title: c.name });
    }
    it('open', () => ui.props(c.key));
    if (c.type === 'egg') {
      it(c.idea.pinned ? 'unpin from the board' : 'pin to the board ("this one next")', () => ui.pin(c, !c.idea.pinned));
      it('sort my eggs…', () => ui.sortEggs());
      if (aiOn()) it('✨ tidy this idea (AI)', () => ui.aiTidyEgg(c));
      if (aiOn()) it('✨ names + README (AI)', () => ui.aiReadme(c));
      items.push(null);
      if (c.frozen) it('thaw', () => ui.thaw(c));
      else it('freeze', () => ui.freeze(c));
      it('let go…', () => ui.letGo(c), { danger: true });
      return openMenu(x, y, items, { title: c.name });
    }
    if (c.frozen) {
      it('thaw', () => ui.thaw(c));
      return openMenu(x, y, items, { title: c.name });
    }
    it(focusOn()?.key === c.key ? '◷ show the timer' : '▶ resume (editor + focus timer)', () => resume(app, c));
    it('✉ leave a note for future me…', () => ui.leaveNote(c));
    it(c.onDesk ? 'take off the desk' : '★ put on the desk', () => ui.desk(c, !c.onDesk));
    items.push(null);
    it(`open in ${EDITOR_NAMES[model().settings.editor] || 'VS Code'}`, () => openInEditor(app, c));
    it('open folder', () => ui.reveal(c));
    if (aiOn()) it('✨ where was i? (AI)', () => ui.props(c.key, null, 'where'));
    items.push(null);
    it('dress up…', () => ui.dressUp(c));
    it('new look', () => ui.newLook(c));
    items.push(null);
    it('freeze', () => ui.freeze(c));
    it('not a project (hide it)', () => ui.notAProject(c, true));
    it('let go…', () => ui.letGo(c), { danger: true });
    openMenu(x, y, items, { title: c.name });
  };

  // ------------------------------------------------------------ undo-able actions

  const keep = (c) => c.name;
  ui.desk = async (c, on, from) => {
    try {
      app.setState(await patchP(c, { onDesk: on }));
      if (on) app.studio.hop(c.key, "i'm on the desk ★");
      undoable(on ? `${keep(c)} is on the desk` : `${keep(c)} went back to the yard`, async () => app.setState(await patchP(c, { onDesk: !on })));
      if (!on && c.p?.files) ui.leaveNote(get(c.key) || c, from, { after: 'desk' });
    } catch (err) {
      if (err.data?.error === 'desk-full') ui.deskFull(c, from);
      else app.oops(err);
    }
  };

  ui.freeze = (c) =>
    app.run(async () => {
      closeWindow(`props:${c.key}`);
      closeWindow(`visit:${c.key}`);
      app.setState(await patch(c, { frozen: true }));
      undoable(`${keep(c)} is in the freezer`, async () => app.setState(await patch(c, { frozen: false })));
    });

  ui.thaw = (c) =>
    app.run(async () => {
      app.setState(await patch(c, { frozen: false }));
      app.studio.hop(c.key, 'brrr! hi again');
      undoable(`${keep(c)} thawed out`, async () => app.setState(await patch(c, { frozen: true })));
    });

  ui.restore = (c) =>
    app.run(async () => {
      const was = c.letGo;
      app.setState(await patch(c, { letGo: null }));
      app.studio.hop(c.key, "i'm back!");
      undoable(`${keep(c)} came back`, async () => app.setState(await patch(c, { letGo: { cause: was.cause, keep: was.keep } })));
    });

  ui.confirmLetGo = (c, cause, keepText) =>
    app.run(async () => {
      closeWindow(`props:${c.key}`);
      closeWindow(`visit:${c.key}`);
      app.setState(await patch(c, { letGo: { cause, keep: keepText } }));
      undoable(`${keep(c)} is in the recycle bin`, async () => app.setState(await patch(c, { letGo: null })));
    });

  ui.notAProject = (c, hide) =>
    app.run(async () => {
      closeWindow(`props:${c.key}`);
      app.setState(await patchP(c, { ignored: hide }));
      if (hide) undoable(`hid ${keep(c)} (not a project)`, async () => app.setState(await patchP(c, { ignored: false })));
    });

  ui.pin = (c, on) =>
    app.run(async () => {
      app.setState(await patchI(c, { pinned: on }));
      undoable(on ? `pinned "${short(c.name, 24)}" to the board` : 'unpinned it', async () => app.setState(await patchI(c, { pinned: !on })));
    });

  // ------------------------------------------------------------ notes for future you

  const PROMPTS = ['stopped at: ', 'next time, start with: ', "don't forget: ", 'the tricky bit is: '];
  ui.leaveNote = (c, from, { after } = {}) =>
    openWindow({
      key: `note:${c.key}`,
      title: 'a note for future you',
      icon: icons.about,
      width: 440,
      from,
      render(w) {
        const old = (c.meta?.notes || []).slice(-2).reverse();
        w.body.innerHTML = `
          <div class="run-head">${thumbHtml(c, 44)}<p>${after === 'focus' ? `nice session on <b>${esc(c.name)}</b>. ` : after === 'desk' ? `<b>${esc(c.name)}</b> is going back to the yard. ` : ''}leave a line for whoever opens <b>${esc(c.name)}</b> next. probably you, in a few weeks.</p></div>
          <textarea class="textarea" name="note" rows="4" maxlength="600" placeholder="stopped at the login page. the bug is in the form validation…"></textarea>
          <div class="chips">${PROMPTS.map((p) => `<button class="chip" data-p="${esc(p)}">${esc(p.replace(/: $/, '…'))}</button>`).join('')}</div>
          ${old.length ? `<h4 style="margin-top:12px">earlier notes</h4><ul class="memories">${old.map((n) => `<li><span>${esc(n.text)}</span><time>${ago(n.t, Date.now())}</time></li>`).join('')}</ul>` : ''}
          <div class="row end" style="margin-top:12px"><button class="btn" data-act="skip">${after ? 'skip' : 'cancel'}</button><button class="btn primary" data-act="save">✉ seal the note</button></div>`;
        const ta = w.body.querySelector('textarea');
        setTimeout(() => ta.focus(), 60);
        w.body.addEventListener('click', (e) => {
          const p = e.target.closest('[data-p]');
          if (p) {
            ta.value = `${ta.value ? `${ta.value.trimEnd()}\n` : ''}${p.dataset.p}`;
            return ta.focus();
          }
          const act = e.target.closest('[data-act]')?.dataset.act;
          if (act === 'skip') return w.close();
          if (act !== 'save') return;
          const text = ta.value.trim();
          if (!text) return ta.focus();
          app.run(async () => {
            app.setState(await patchP(c, { addNote: text }));
            w.close();
            app.studio.hop(c.key, 'i’ll keep it safe ✉');
          });
        });
      },
    });

  ui.letter = (c, from) =>
    openWindow({
      key: `letter:${c.key}`,
      title: `a note from past you`,
      icon: icons.about,
      width: 420,
      from,
      className: 'letter-win',
      render(w) {
        const n = c.letter || c.note;
        w.body.innerHTML = `
          <div class="letter">
            <div class="envelope" aria-hidden="true"><i></i></div>
            <p class="letter-meta">${esc(c.name)} kept this for you · written ${fmtDate(n.t)} (${ago(n.t, Date.now())})</p>
            <p class="letter-text">${esc(n.text)}</p>
            <p class="letter-sign">love, past you ♡</p>
          </div>
          <div class="row end"><button class="btn" data-act="later">later</button><button class="btn primary" data-act="resume">▶ pick it back up</button></div>`;
        const read = () => patchP(c, { readNote: true }).then(app.setState, () => {});
        w.body.addEventListener('click', (e) => {
          const act = e.target.closest('[data-act]')?.dataset.act;
          if (!act) return;
          read();
          w.close();
          if (act === 'resume') resume(app, c);
        });
      },
    });

  // ------------------------------------------------------------ egg sorting

  ui.sortEggs = (from) =>
    openWindow({
      key: 'sorteggs',
      title: 'Sort my eggs',
      icon: icons.egg,
      width: 480,
      from,
      render(w) {
        const queue = model()
          .live.filter((c) => c.type === 'egg')
          .sort((a, b) => a.idea.createdAt - b.idea.createdAt)
          .map((c) => c.key);
        let i = 0;
        let hints = {};
        const done = { keep: 0, hatch: 0, freeze: 0, letgo: 0 };
        const draw = () => {
          const c = get(queue[i]);
          if (!c || i >= queue.length) {
            w.body.innerHTML = `<p class="empty">all sorted ✿<br>${done.keep} kept · ${done.hatch} hatched · ${done.freeze} frozen · ${done.letgo} let go</p><div class="row end"><button class="btn primary" data-act="close">done</button></div>`;
            return;
          }
          const hint = hints[c.id];
          const linked = new Set(app.state.ideas.filter((x) => x.projectId).map((x) => x.projectId));
          const folders = model().live.filter((x) => x.type === 'project' && !linked.has(x.id));
          w.body.innerHTML = `
            <div class="row" style="justify-content:space-between"><span class="muted">${i + 1} of ${queue.length}</span>${aiOn() ? `<button class="btn small" data-act="ai">✨ suggest (AI)</button>` : ''}</div>
            <div class="sort-card">
              ${thumbHtml(c, 54)}
              <div class="grow">
                <b>${esc(c.name)}</b>
                <div class="muted">laid ${ago(c.idea.createdAt)}${c.energy === 'cold' ? ' · getting cold' : ''}</div>
                ${c.idea.note ? `<p>${esc(short(c.idea.note, 220))}</p>` : ''}
                ${hint ? `<p class="next">✨ ${esc(hint.suggestion === 'letgo' ? 'let go' : hint.suggestion)}: ${esc(hint.reason)}${hint.mergeWith ? ' (sounds like another egg)' : ''}</p>` : ''}
              </div>
            </div>
            <div class="sort-actions">
              <button class="btn" data-act="keep"><kbd>K</kbd> keep</button>
              <button class="btn" data-act="freeze"><kbd>F</kbd> freeze</button>
              <button class="btn danger" data-act="letgo"><kbd>L</kbd> let go</button>
              <button class="btn" data-act="skip"><kbd>→</kbd> skip</button>
            </div>
            ${folders.length ? `<div class="row" style="margin-top:8px"><select class="select" name="folder" style="flex:1">${folders.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><button class="btn" data-act="hatch"><kbd>H</kbd> hatch into</button></div>` : ''}`;
        };
        const act = async (what) => {
          const c = get(queue[i]);
          if (!c) return;
          try {
            if (what === 'keep') {
              app.setState(await patchI(c, { snoozeUntil: clock.now() + 30 * DAY }));
            } else if (what === 'freeze') {
              app.setState(await patchI(c, { frozen: true }));
              undoable(`froze "${short(c.name, 24)}"`, async () => app.setState(await patchI(c, { frozen: false })));
            } else if (what === 'letgo') {
              app.setState(await patchI(c, { letGo: { cause: 'lost-interest', keep: '' } }));
              undoable(`let go of "${short(c.name, 24)}"`, async () => app.setState(await patchI(c, { letGo: null })));
            } else if (what === 'hatch') {
              const id = w.body.querySelector('[name=folder]')?.value;
              if (!id) return;
              app.setState(await patchI(c, { projectId: id }));
              undoable(`hatched "${short(c.name, 24)}"`, async () => app.setState(await patchI(c, { projectId: null })));
            }
            if (what !== 'skip') done[what]++;
            i++;
            draw();
          } catch (err) {
            app.oops(err);
          }
        };
        w.body.addEventListener('click', async (e) => {
          const a = e.target.closest('[data-act]')?.dataset.act;
          if (!a) return;
          if (a === 'close') return w.close();
          if (a === 'ai') {
            const btn = e.target.closest('button');
            btn.disabled = true;
            btn.textContent = 'thinking…';
            const out = await ui.ai('sort', {}, { from: btn });
            if (out) hints = Object.fromEntries(out.items.map((x) => [x.id, x]));
            return draw();
          }
          act(a);
        });
        w.el.addEventListener('keydown', (e) => {
          if (e.target.closest('select, input, textarea')) return;
          const k = e.key.toLowerCase();
          const map = { k: 'keep', f: 'freeze', l: 'letgo', h: 'hatch', arrowright: 'skip', s: 'skip' };
          if (k === 'arrowleft' && i > 0) {
            i--;
            return draw();
          }
          if (map[k]) {
            e.preventDefault();
            act(map[k]);
          }
        });
        w.el.tabIndex = -1;
        draw();
        setTimeout(() => w.el.focus(), 50);
      },
    });

  // ------------------------------------------------------------ dress up

  const meSeed = () => hash(`me:${model().settings.name || app.state.user || 'you'}`);
  ui.meTraits = () => model().settings.studio.me || null;
  ui.meSeed = meSeed;

  ui.dressUp = (target, from) =>
    openWindow({
      key: `dress:${target === 'me' ? 'me' : target.key}`,
      title: target === 'me' ? 'how you look' : `dress up ${short(target.name, 24)}`,
      icon: icons.settings,
      width: 520,
      from,
      render(w) {
        const isMe = target === 'me';
        const seed = isMe ? meSeed() : target.seed >>> 0;
        const brand = isMe ? null : target.brand?.color || null;
        let traits = { ...(isMe ? ui.meTraits() : target.traits) };
        const C = folk.TRAIT_CHOICES;
        const base = () => ({ ...folk.traitsOf(seed), ...traits });
        const swatches = (key, list) =>
          `<div class="swatches">${list.map((c) => `<button class="sw ${base()[key] === c ? 'on' : ''}" data-k="${key}" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>`;
        const select = (key, list, label = (v) => v ?? 'none') =>
          `<select class="select" data-k="${key}">${list.map((v) => `<option value="${v ?? ''}" ${String(base()[key] ?? '') === String(v ?? '') ? 'selected' : ''}>${label(v)}</option>`).join('')}</select>`;
        const draw = () => {
          w.body.innerHTML = `
            <div class="dress">
              <div class="dress-preview"><canvas width="${folk.SPRITE_W}" height="${folk.SPRITE_H}"></canvas>${brand && !('top' in traits) ? `<p class="small-print">wearing its brand colour</p>` : ''}</div>
              <div class="dress-fields">
                <label>skin</label>${swatches('skin', C.skin)}
                <label>hair</label>${select('style', C.style)}
                <label>hair colour</label>${swatches('hairColor', C.hairColor)}
                <label>hat</label>${select('hat', C.hat)}
                <label>outfit</label>${select('outfit', C.outfit)}
                <label>top colour</label>${swatches('top', C.top)}
                <label>bottoms</label>${select('bottomKind', C.bottomKind)}
                <label>bottom colour</label>${swatches('bottom', C.bottom)}
                <label>shoes</label>${swatches('shoe', C.shoe)}
                <label>glasses</label>${select('glasses', C.glasses)}
                <label>beard</label>${select('beard', C.beard)}
                <label>extras</label><div class="row">${C.extras.map((k) => `<label class="check"><input type="checkbox" data-k="${k}" ${base()[k] ? 'checked' : ''}> ${k === 'phones' ? 'headphones' : k}</label>`).join('')}</div>
              </div>
            </div>
            <div class="row" style="margin-top:12px"><button class="btn small" data-act="random">🎲 surprise me</button><button class="btn small" data-act="reset">reset</button><span style="flex:1"></span><button class="btn" data-act="cancel">cancel</button><button class="btn primary" data-act="save">save</button></div>`;
          const cv = w.body.querySelector('canvas');
          const frame = folk.person(seed, { mood: 'lively', stage: isMe ? 'growing' : target.stage === 'egg' ? 'growing' : target.stage, kind: isMe ? null : target.kind, traits, outfitColor: brand }).stand;
          cv.getContext('2d').drawImage(frame, 0, 0);
        };
        w.body.addEventListener('click', (e) => {
          const sw = e.target.closest('.sw');
          if (sw) {
            traits[sw.dataset.k] = sw.dataset.v;
            return draw();
          }
          const act = e.target.closest('[data-act]')?.dataset.act;
          if (act === 'random') {
            const r = folk.traitsOf(Math.floor(Math.random() * 1e9));
            traits = { skin: r.skin, style: r.style, hairColor: r.hairColor, outfit: r.outfit, top: r.top, bottomKind: r.bottomKind, bottom: r.bottom, shoe: r.shoe, glasses: r.glasses, hat: r.hat, beard: r.beard };
            return draw();
          }
          if (act === 'reset') {
            traits = {};
            return draw();
          }
          if (act === 'cancel') return w.close();
          if (act === 'save')
            app.run(async () => {
              if (isMe) await prefs({ studio: { me: Object.keys(traits).length ? traits : null } });
              else app.setState(await patchP(target, { traits: Object.keys(traits).length ? traits : null }));
              w.close();
              if (!isMe) app.studio.hop(target.key, 'new outfit ✿');
            });
        });
        w.body.addEventListener('change', (e) => {
          const k = e.target.dataset.k;
          if (!k) return;
          if (e.target.type === 'checkbox') traits[k] = e.target.checked;
          else traits[k] = e.target.value === '' ? null : e.target.value;
          draw();
        });
        draw();
      },
    });

  // ------------------------------------------------------------ whiteboard + wall

  ui.board = (from) =>
    openWindow({
      key: 'board',
      title: 'the whiteboard',
      icon: icons.taskmgr,
      width: 440,
      from,
      render(w) {
        const draw = () => {
          const pinned = model().pinned;
          w.body.innerHTML = `
            <label class="field"><span>write on the board (a goal, a quote, the plan)</span><textarea class="textarea" name="text" rows="3" maxlength="140" placeholder="ship one tiny thing this week ✿">${esc(model().settings.studio.boardText || '')}</textarea></label>
            <h4>pinned eggs (${pinned.length}/4) · "this one next"</h4>
            ${pinned.length ? `<ul class="binlist">${pinned.map((c) => `<li>${thumbHtml(c, 30)}<div class="grow">${esc(c.name)}</div><button class="btn small" data-unpin="${c.key}">unpin</button></li>`).join('')}</ul>` : '<p class="muted">right-click any egg and pick "pin to the board".</p>'}
            <div class="row" style="margin-top:12px"><button class="btn small" data-act="dash">open the dashboard</button><button class="btn small" data-act="note">+ sticky note on the wall</button><span style="flex:1"></span><button class="btn primary" data-act="save">save</button></div>`;
        };
        w.refresh = () => {
          if (!w.body.contains(document.activeElement)) draw();
        };
        draw();
        w.body.addEventListener('click', (e) => {
          const un = e.target.closest('[data-unpin]');
          if (un) return ui.pin(get(un.dataset.unpin), false);
          const act = e.target.closest('[data-act]')?.dataset.act;
          if (act === 'dash') {
            w.close();
            return app.showView('dashboard');
          }
          if (act === 'note') return ui.wallNote(e.target);
          if (act === 'save')
            app.run(async () => {
              await prefs({ studio: { boardText: w.body.querySelector('[name=text]').value } });
              w.close();
            });
        });
      },
    });

  const NOTE_COLORS = ['#fff3a8', '#ffd6e8', '#d6f5e3', '#dbe9ff', '#ece0ff', '#ffe2c4'];
  ui.wallNote = (from, item) =>
    openWindow({
      key: `wallnote:${item?.id || 'new'}`,
      title: item ? 'sticky note' : 'new sticky note',
      icon: icons.about,
      width: 380,
      from,
      render(w) {
        let color = item?.color || NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
        const draw = () => {
          w.body.innerHTML = `
            <textarea class="textarea" name="text" rows="3" maxlength="120" style="background:${color}" placeholder="a reminder, a lyric, a tiny goal…">${esc(item?.text || '')}</textarea>
            <div class="swatches" style="margin-top:8px">${NOTE_COLORS.map((c) => `<button class="sw ${c === color ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
            <p class="small-print">tip: drag notes around on the wall to move them.</p>
            <div class="row end" style="margin-top:10px">${item ? '<button class="btn danger" data-act="del">take it down</button><span style="flex:1"></span>' : ''}<button class="btn" data-act="cancel">cancel</button><button class="btn primary" data-act="save">${item ? 'save' : 'stick it up'}</button></div>`;
        };
        draw();
        w.body.addEventListener('click', (e) => {
          const sw = e.target.closest('[data-c]');
          if (sw) {
            const text = w.body.querySelector('textarea').value;
            color = sw.dataset.c;
            draw();
            w.body.querySelector('textarea').value = text;
            return;
          }
          const act = e.target.closest('[data-act]')?.dataset.act;
          if (act === 'cancel') return w.close();
          if (act === 'del')
            return app.run(async () => {
              app.setState(await api.del(`/api/wall/${item.id}`));
              w.close();
              undoable('took a note down', async () => app.setState(await api.post('/api/wall', item)));
            });
          if (act === 'save')
            app.run(async () => {
              const text = w.body.querySelector('textarea').value.trim();
              if (!text) return;
              const spot = item ? {} : app.studio.freeWallSpot?.() || {};
              app.setState(item ? await api.patch(`/api/wall/${item.id}`, { text, color }) : await api.post('/api/wall', { kind: 'note', text, color, ...spot }));
              w.close();
            });
        });
      },
    });

  ui.wallPhoto = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const src = await pixelPhoto(file);
        const spot = app.studio.freeWallSpot?.() || {};
        app.setState(await api.post('/api/wall', { kind: 'photo', src, tilt: Math.round(Math.random() * 8 - 4), ...spot }));
        balloon({ title: 'pinned a polaroid to the wall ✿', text: 'drag it to move it, double-click to take it down.', timeout: 5000 });
      } catch (err) {
        app.oops(err);
      }
    });
    input.click();
  };

  // ------------------------------------------------------------ town meeting + pick for me

  ui.townMeeting = (from) =>
    openWindow({
      key: 'meeting',
      title: 'town meeting',
      icon: icons.taskmgr,
      width: 480,
      from,
      onClose: () => app.studio.meeting?.(false),
      render(w) {
        app.showView('studio');
        app.studio.meeting?.(true);
        const local = localMeeting();
        const draw = (m, isAI) => {
          const focus = m.focusId && get(`p:${m.focusId}`);
          w.body.innerHTML = `
            <p class="lead"><b>${esc(m.headline)}</b></p>
            ${m.moved.length ? `<h4>what moved</h4><ul class="plain">${m.moved.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
            ${m.fading.length ? `<h4>what's fading</h4><ul class="plain">${m.fading.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
            ${focus ? `<p class="next">next week's focus: <b>${esc(focus.name)}</b>${m.focusWhy ? ` · ${esc(m.focusWhy)}` : ''}</p>` : ''}
            <p class="muted">${esc(m.encouragement)}</p>
            <div class="row end" style="margin-top:12px">${aiOn() && !isAI ? '<button class="btn small" data-act="ai">✨ let AI run the meeting</button>' : ''}${focus && !focus.onDesk ? `<button class="btn small" data-act="desk" data-key="${focus.key}">★ put ${esc(short(focus.name, 16))} on the desk</button>` : ''}<button class="btn primary" data-act="close">end meeting</button></div>`;
        };
        const last = model().settings.ai?.lastMeeting;
        if (last && Date.now() - last.t < 6 * DAY) draw(last, true);
        else draw(local, false);
        w.body.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-act]');
          if (!b) return;
          if (b.dataset.act === 'close') return w.close();
          if (b.dataset.act === 'desk') return ui.desk(get(b.dataset.key), true, b);
          if (b.dataset.act === 'ai') {
            b.disabled = true;
            b.textContent = 'thinking…';
            const out = await ui.ai('meeting', {}, { from: b });
            if (out) draw(out, true);
          }
        });
      },
    });

  function localMeeting() {
    const m = model();
    const projects = m.live.filter((c) => c.type === 'project');
    const moved = projects.filter((c) => c.days < 7).sort((a, b) => b.lastActive - a.lastActive).map((c) => `${c.name} (touched ${ago(c.lastActive)})`);
    const fading = projects.filter((c) => c.energy === 'asleep' || c.energy === 'ghost').sort((a, b) => b.days - a.days).map((c) => `${c.name} (${plural(c.days, 'day')})`);
    const focus = m.desk[0] || projects.sort((a, b) => b.lastActive - a.lastActive)[0];
    const lines = ['small steps still count ✿', 'one thing at a time. you’ve got this.', 'nobody here is in a hurry. pick one and enjoy it.'];
    return {
      headline: `${plural(moved.length, 'project')} moved this week, ${fading.length} fading`,
      moved: moved.slice(0, 6),
      fading: fading.slice(0, 6),
      focusId: focus?.id,
      focusWhy: focus ? (focus.p.todos?.open?.[0] ? `next up: ${focus.p.todos.open[0].text}` : 'it has the most momentum') : '',
      encouragement: lines[new Date().getDate() % lines.length],
    };
  }

  ui.pickForMe = (from) =>
    openWindow({
      key: 'pick',
      title: 'pick for me',
      icon: icons.desk,
      width: 440,
      from,
      render(w) {
        let minutes = 30;
        const draw = (res) => {
          const c = res && get(`p:${res.projectId}`);
          w.body.innerHTML = `
            <p style="margin-top:0">how much time do you have?</p>
            <div class="chips">${[15, 30, 60, 120].map((m) => `<button class="chip" data-m="${m}" aria-pressed="${m === minutes}">${m < 60 ? `${m} min` : `${m / 60} hr${m > 60 ? 's' : ''}`}</button>`).join('')}</div>
            ${c ? `<div class="sort-card" style="margin-top:12px">${thumbHtml(c, 48)}<div class="grow"><b>${esc(c.name)}</b><p>${esc(res.why)}</p><p class="next">first: ${esc(res.firstStep)}</p></div></div>` : ''}
            <div class="row end" style="margin-top:12px">${c ? `<button class="btn primary" data-act="go" data-key="${c.key}">▶ resume it</button>` : ''}<button class="btn ${c ? '' : 'primary'}" data-act="pick">${aiOn() ? '✨ pick (AI)' : 'pick'}</button></div>`;
        };
        draw();
        w.body.addEventListener('click', async (e) => {
          const chip = e.target.closest('[data-m]');
          if (chip) {
            minutes = Number(chip.dataset.m);
            return draw();
          }
          const b = e.target.closest('[data-act]');
          if (!b) return;
          if (b.dataset.act === 'go') {
            w.close();
            return resume(app, get(b.dataset.key));
          }
          if (aiOn()) {
            b.disabled = true;
            b.textContent = 'thinking…';
            const out = await ui.ai('pick', { minutes }, { from: b });
            return draw(out || localPick(minutes));
          }
          draw(localPick(minutes));
        });
      },
    });

  function localPick(minutes) {
    const projects = model().live.filter((c) => c.type === 'project');
    const score = (c) => (c.onDesk ? 3 : 0) + ({ lively: 2, awake: 1.6, bored: 1, asleep: 0.6, ghost: 0.3 }[c.energy] || 0) + (c.p.todos?.open?.[0] ? 1.5 : 0) + (c.note ? 0.5 : 0) + Math.random() * 0.8;
    const best = projects.sort((a, b) => score(b) - score(a))[0];
    if (!best) return null;
    const next = best.p.todos?.open?.[0]?.text;
    return {
      projectId: best.id,
      why: best.onDesk ? "it's on your desk, so it's what you said matters right now." : best.days < 3 ? 'it has momentum.' : `it hasn't had attention in ${plural(best.days, 'day')}.`,
      firstStep: next ? (minutes <= 15 ? `just look at: ${next}` : next) : best.note ? `read your note: "${short(best.note.text, 60)}"` : 'open it and read the README for 5 minutes',
    };
  }

  // ------------------------------------------------------------ settings (tabs)

  const TABS = [
    ['general', 'general'],
    ['studio', 'studio'],
    ['you', 'you'],
    ['presence', 'stay present'],
    ['life', 'life cycle'],
    ['hidden', 'hidden'],
    ['ai', 'AI'],
  ];
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const WALLS = { lilac: '#e7dcff', mint: '#d6f5e3', peach: '#ffe2cf', sky: '#d8ecff', butter: '#fff3c4', cocoa: '#e6d3c6' };

  ui.settings = (from, { welcome = false, tab } = {}) => {
    const w = openWindow({
      key: 'settings',
      title: welcome ? 'welcome to brainchildren' : 'Settings',
      icon: icons.settings,
      width: 600,
      from,
      render(w) {
        w.tab = tab || 'general';
        w.refresh = () => {
          if (w.body.contains(document.activeElement) && document.activeElement.matches('input[type=text], input:not([type]), textarea')) return;
          draw();
        };
        const draw = () => {
          const s = model().settings;
          w.body.innerHTML = `
            ${welcome ? '' : `<div class="tabs" role="tablist">${TABS.map(([id, label]) => `<button class="tab" role="tab" data-tab="${id}" aria-selected="${w.tab === id}">${label}</button>`).join('')}</div>`}
            <div class="${welcome ? '' : 'tab-panel'}" data-panel></div>`;
          const panel = w.body.querySelector('[data-panel]');
          const render = { general: tabGeneral, studio: tabStudio, you: tabYou, presence: tabPresence, life: tabLife, hidden: tabHidden, ai: (p) => ui.aiTab(p) }[welcome ? 'general' : w.tab];
          render(panel, s, w, welcome);
        };
        draw();
        w.body.addEventListener('click', (e) => {
          const t = e.target.closest('[data-tab]');
          if (!t) return;
          w.tab = t.dataset.tab;
          draw();
        });
      },
    });
    if (tab && w.tab !== tab) {
      w.tab = tab;
      w.refresh();
    }
    return w;
  };

  function tabGeneral(panel, s, w, welcome) {
    const roots = [...s.roots];
    panel.innerHTML = `
      ${welcome ? '<p class="welcome">every folder in your projects folder becomes a little person who lives in your studio. the ones you forget about get sleepy, nap on the sofa, then turn into ghosts, so no idea gets lost. <b>nothing leaves your computer.</b></p>' : ''}
      <label class="field"><span>what should your projects call you?</span><input class="input" name="name" maxlength="40" value="${esc(s.name)}" placeholder="${esc(app.state.user || 'you')}"></label>
      <div class="field"><span>where do your projects live?</span>
        <ul class="roots"></ul>
        <div class="row"><input class="input" name="root" placeholder="paste a folder path, like D:\\projects or ~/code" style="flex:1" autocomplete="off"><button class="btn" data-g="add">add</button></div>
        <div class="chips suggest"></div>
        <p class="small-print">each folder inside becomes a person. a folder that is a project itself (it has .git or package.json) becomes one person.</p>
      </div>
      <div class="row" style="gap:16px">
        <label class="row" style="gap:6px">open projects in <select class="select" name="editor" style="width:auto">${Object.entries(EDITOR_NAMES).map(([k, l]) => `<option value="${k}" ${s.editor === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="row" style="gap:6px">characters <select class="select" name="look" style="width:auto"><option value="pixel" ${s.look !== 'doodle' ? 'selected' : ''}>pixel people</option><option value="doodle" ${s.look === 'doodle' ? 'selected' : ''}>doodle creatures</option></select></label>
      </div>
      <p class="err" hidden></p>
      <div class="row end" style="margin-top:14px">${welcome ? '<button class="btn" data-g="practice">▶ first, show me how it works</button><span style="flex:1"></span>' : '<button class="btn" data-g="cancel">close</button>'}<button class="btn primary" data-g="save">${welcome ? 'meet my projects' : 'save'}</button></div>`;
    const list = panel.querySelector('.roots');
    const input = panel.querySelector('[name=root]');
    const chips = panel.querySelector('.suggest');
    let suggestions = [];
    const drawRoots = () => {
      list.innerHTML = roots.length ? roots.map((r, n) => `<li><code>${esc(r)}</code><button class="btn small" data-rm="${n}">remove</button></li>`).join('') : '<li class="muted">no folders yet. add one below.</li>';
      const left = suggestions.filter((x) => !roots.some((r) => r.toLowerCase() === x.path.toLowerCase()));
      chips.innerHTML = left.length ? `<span class="small-print" style="margin:0">found:</span>${left.map((x) => `<button class="btn small" data-sug="${esc(x.path)}">+ ${esc(x.path)} · ${plural(x.count, 'folder')}</button>`).join('')}` : '';
    };
    const add = (p) => {
      const v = String(p || '').trim();
      if (v && !roots.some((r) => r.toLowerCase() === v.toLowerCase())) roots.push(v);
      input.value = '';
      drawRoots();
    };
    drawRoots();
    api.get('/api/suggest-roots').then((x) => {
      suggestions = x;
      drawRoots();
    }, () => {});
    input.addEventListener('keydown', (e) => e.key === 'Enter' && add(input.value));
    panel.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.sug) return add(b.dataset.sug);
      if (b.dataset.rm) {
        roots.splice(Number(b.dataset.rm), 1);
        return drawRoots();
      }
      if (b.dataset.g === 'add') return add(input.value);
      if (b.dataset.g === 'cancel') return w.close();
      if (b.dataset.g === 'practice') {
        w.close();
        return app.walkthrough();
      }
      if (b.dataset.g !== 'save') return;
      if (input.value.trim()) add(input.value);
      const err = panel.querySelector('.err');
      b.disabled = true;
      b.textContent = 'looking at your folders…';
      try {
        await api.post('/api/prefs', { name: panel.querySelector('[name=name]').value, editor: panel.querySelector('[name=editor]').value, look: panel.querySelector('[name=look]').value });
        const next = await api.post('/api/settings', { roots });
        w.close();
        app.setState(next);
        if (welcome) app.afterSetup?.();
        balloon({ title: welcome ? `say hi to your ${plural(next.projects.length, 'project')}!` : 'saved', text: welcome ? 'a quick tour is starting.' : `watching ${plural(next.projects.length, 'folder')}.`, timeout: 4000 });
      } catch (ex) {
        err.hidden = false;
        err.textContent = ex.message;
        b.disabled = false;
        b.textContent = welcome ? 'meet my projects' : 'save';
      }
    });
    if (welcome && !roots.length) setTimeout(() => input.focus(), 80);
  }

  function tabStudio(panel, s) {
    const st = s.studio;
    const opt = (name, list, value) => `<select class="select" name="${name}" style="width:auto">${list.map(([v, l]) => `<option value="${v}" ${value === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    panel.innerHTML = `
      <label class="field"><span>your studio's name (on the sign over the door)</span><input class="input" name="sname" maxlength="32" value="${esc(st.name)}" placeholder="${esc(`${s.name || app.state.user || 'my'}'s studio`)}"></label>
      <div class="field"><span>wallpaper</span><div class="swatches">${Object.entries(WALLS).map(([k, c]) => `<button class="sw ${st.style.wall === k ? 'on' : ''}" data-wall="${k}" style="background:${c}" title="${k}" aria-label="${k}"></button>`).join('')}</div></div>
      <div class="row" style="gap:14px">
        <label class="row" style="gap:6px">floor ${opt('floor', [['wood', 'wood'], ['checker', 'checker'], ['carpet', 'carpet'], ['tatami', 'tatami']], st.style.floor)}</label>
        <label class="row" style="gap:6px">window ${opt('view', [['city', 'city'], ['beach', 'beach'], ['mountains', 'mountains'], ['rain', 'rainy day'], ['stars', 'stars'], ['space', 'space'], ['garden', 'garden']], st.style.view)}</label>
        <label class="row" style="gap:6px">light ${opt('light', [['real', 'follow the clock'], ['day', 'always day'], ['golden', 'golden hour'], ['night', 'always night']], st.style.light)}</label>
      </div>
      <div class="row" style="gap:14px;margin-top:12px">
        <label class="row" style="gap:6px">chatter voice ${opt('voice', [['sweet', 'sweet'], ['sassy', 'sassy'], ['quiet', 'quiet']], s.voice)}</label>
        <label class="row" style="gap:6px">how chatty ${opt('chatter', [['lots', 'lots'], ['some', 'some'], ['quiet', 'rarely']], s.chatter)}</label>
      </div>
      <div class="row" style="gap:14px;margin-top:12px">
        <label class="row" style="gap:6px">sound ${opt('ambience', [['off', 'off'], ['rain', 'soft rain'], ['radio', 'garden radio (record player)']], s.ambience)}</label>
        <label class="check"><input type="checkbox" name="cat" ${st.cat !== false ? 'checked' : ''}> studio cat</label>
      </div>
      <h4 style="margin-top:14px">on the walls</h4>
      <div class="row"><button class="btn small" data-x="board">write on the whiteboard</button><button class="btn small" data-x="note">+ sticky note</button><button class="btn small" data-x="photo">+ photo polaroid</button></div>
      <p class="small-print">the room also decorates itself with the seasons, and earns a trophy for every project you ship, a plant that grows when you revive ghosts, and a "lessons" book for every 5 ideas you let go.</p>`;
    const saveStyle = (style) => prefs({ studio: { style } });
    panel.addEventListener('click', (e) => {
      const wb = e.target.closest('[data-wall]');
      if (wb) {
        panel.querySelectorAll('[data-wall]').forEach((x) => x.classList.toggle('on', x === wb));
        return saveStyle({ wall: wb.dataset.wall });
      }
      const x = e.target.closest('[data-x]')?.dataset.x;
      if (x === 'board') ui.board(e.target);
      if (x === 'note') ui.wallNote(e.target);
      if (x === 'photo') ui.wallPhoto(e.target);
    });
    panel.addEventListener('change', (e) => {
      const n = e.target.name;
      if (['floor', 'view', 'light'].includes(n)) saveStyle({ [n]: e.target.value });
      if (n === 'voice' || n === 'chatter') prefs({ [n]: e.target.value });
      if (n === 'ambience') {
        setAmbience(e.target.value);
        prefs({ ambience: e.target.value });
      }
      if (n === 'cat') prefs({ studio: { cat: e.target.checked } });
      if (n === 'sname') prefs({ studio: { name: e.target.value } });
    });
  }

  function tabYou(panel) {
    const traits = ui.meTraits();
    panel.innerHTML = `
      <div class="dress">
        <div class="dress-preview"><canvas width="${folk.SPRITE_W}" height="${folk.SPRITE_H}"></canvas></div>
        <div>
          <p style="margin-top:0">this is you. you live in the studio too: you walk over to whatever you're working on, and relax in your chair when you're not.</p>
          <button class="btn primary" data-me>dress up</button>
        </div>
      </div>`;
    panel.querySelector('canvas').getContext('2d').drawImage(folk.person(meSeed(), { mood: 'lively', traits }).stand, 0, 0);
    panel.querySelector('[data-me]').addEventListener('click', (e) => ui.dressUp('me', e.target));
  }

  function tabPresence(panel, s) {
    const n = s.nudge;
    panel.innerHTML = `
      <label class="check"><input type="checkbox" name="auto" ${app.state.autostart ? 'checked' : ''}> start brainchildren when I log in to my computer <span class="muted">(quietly, in the background)</span></label>
      <fieldset class="group"><legend>weekly nudge</legend>
        <label class="check"><input type="checkbox" name="non" ${n.on ? 'checked' : ''}> send me a soft desktop notification once a week</label>
        <div class="row" style="margin-top:8px;gap:8px">on <select class="select" name="day" style="width:auto">${DAYS.map((d, i) => `<option value="${i}" ${n.day === i ? 'selected' : ''}>${d}</option>`).join('')}</select> after <select class="select" name="hour" style="width:auto">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${n.hour === h ? 'selected' : ''}>${h}:00</option>`).join('')}</select> <button class="btn small" data-x="test">send a test</button></div>
        <p class="small-print">it says something like "2 ghosts, 1 cold egg · desk: plant diary (next: reminders)". clicking it opens your studio. it needs brainchildren running, so pair it with "start when I log in".</p>
      </fieldset>
      <fieldset class="group"><legend>focus sessions</legend>
        <label class="row" style="gap:6px">resume starts a <input class="input" type="number" name="fm" min="5" max="120" value="${s.focusMinutes || 25}" style="width:70px"> minute focus timer</label>
      </fieldset>
      <fieldset class="group"><legend>from the terminal</legend>
        <p style="margin:0 0 6px">lay eggs without opening the app. run this once in the brainchildren folder:</p>
        <pre class="mono code-box">npm link</pre>
        <p style="margin:6px 0">then, from any terminal:</p>
        <pre class="mono code-box">brainchildren add "a playlist that matches the weather"
brainchildren add "plant reminders" --note "text when the soil is dry"
brainchildren status
brainchildren open</pre>
        <p class="small-print">adding works even when brainchildren is closed: the egg appears next time it starts.</p>
      </fieldset>`;
    panel.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'auto')
        app.run(async () => {
          app.setState(await api.post('/api/autostart', { on: t.checked }));
          balloon({ title: app.practice ? 'in your real studio, this makes brainchildren start when you log in' : t.checked ? 'brainchildren will start when you log in ✿' : 'it won’t start on its own anymore', timeout: 4000 });
        });
      if (t.name === 'non') prefs({ nudge: { on: t.checked } });
      if (t.name === 'day') prefs({ nudge: { day: Number(t.value) } });
      if (t.name === 'hour') prefs({ nudge: { hour: Number(t.value) } });
      if (t.name === 'fm') prefs({ focusMinutes: Number(t.value) });
    });
    panel.addEventListener('click', (e) => {
      if (e.target.closest('[data-x=test]'))
        app.run(async () => {
          const r = await api.post('/api/nudge/test');
          balloon({ title: r.practice ? 'in your real studio, this sends a desktop notification' : r.ok ? 'sent! check your notifications' : "couldn't show a notification on this computer", timeout: 4000 });
        });
    });
  }

  function tabLife(panel, s) {
    panel.innerHTML = `
      <div class="row" style="gap:16px">
        <label class="row" style="gap:6px">naps after <input class="input" type="number" name="sleepDays" min="3" max="120" value="${s.sleepDays}" style="width:70px"> days untouched</label>
        <label class="row" style="gap:6px">ghost after <input class="input" type="number" name="ghostDays" min="4" max="365" value="${s.ghostDays}" style="width:70px"> days</label>
        <button class="btn small" data-x="save">save</button>
      </div>
      <fieldset class="group"><legend>time machine</legend>
        <p class="small-print" style="margin:0 0 8px">peek at your studio in the future to see who'll fade if nothing changes. it's only a preview and resets when you reload.</p>
        <div class="range-row"><input type="range" name="time" min="0" max="90" value="${clock.offsetDays}"><b class="time-label">${clock.offsetDays ? `+${plural(clock.offsetDays, 'day')} (${fmtDate(clock.now())})` : 'today'}</b></div>
      </fieldset>`;
    panel.addEventListener('input', (e) => {
      if (e.target.name !== 'time') return;
      clock.offsetDays = e.target.value;
      panel.querySelector('.time-label').textContent = clock.offsetDays ? `+${plural(clock.offsetDays, 'day')} (${fmtDate(clock.now())})` : 'today';
      app.remodel();
    });
    panel.addEventListener('click', (e) => {
      if (!e.target.closest('[data-x=save]')) return;
      app.run(async () => {
        app.setState(await api.post('/api/settings', { sleepDays: Number(panel.querySelector('[name=sleepDays]').value), ghostDays: Number(panel.querySelector('[name=ghostDays]').value) }));
        balloon({ title: 'saved', timeout: 2500 });
      });
    });
  }

  function tabHidden(panel) {
    const list = model().hidden;
    panel.innerHTML = list.length
      ? `<p style="margin-top:0">folders you said aren't projects. they stay hidden everywhere until you bring them back.</p><ul class="binlist">${list.map((c) => `<li><div class="grow"><b>${esc(c.p.folder)}</b><div class="muted mono">${esc(c.p.path)}</div></div><button class="btn small" data-unhide="${c.key}">it's a project</button></li>`).join('')}</ul>`
      : '<p class="empty">nothing hidden.<br>right-click a folder that isn\'t really a project (images, downloads…) and pick "not a project".</p>';
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-unhide]');
      if (b) ui.notAProject(get(b.dataset.unhide), false);
    });
  }

  return ui;
}

// shrink a photo to a tiny pixel polaroid (stored inside your data file)
function pixelPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 40;
      const k = size / Math.max(img.width, img.height);
      const w = Math.max(8, Math.round(img.width * k));
      const h = Math.max(8, Math.round(img.height * k));
      const small = document.createElement('canvas');
      small.width = w;
      small.height = h;
      const ctx = small.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      resolve(small.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error("couldn't read that picture"));
    img.src = URL.createObjectURL(file);
  });
}
