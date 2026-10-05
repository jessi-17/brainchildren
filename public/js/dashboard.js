// The dashboard: everything brainchildren knows, as numbers, charts and lists.
// Chart colours come from a validated palette (two categorical slots and a
// one-hue ordinal ramp); text always stays in ink, never in series colours.
import { STAGES, ENERGY, CAUSES, DAY, clock, esc, ago, plural, short } from './life.js';
import { thumbHtml } from './look.js';
import { icons } from './icons.js';

const COLOR = {
  s1: '#2a78d6',
  s2: '#eb6834',
  deemph: '#c9c5da',
  grid: '#ebe8f3',
  axis: '#c9c5da',
  ink: '#2b2a5e',
  ink2: '#6c6896',
  stage: { egg: '#86b6ef', hatchling: '#3987e5', growing: '#256abf', shipped: '#104281' },
  energy: { lively: '#0d366b', awake: '#1c5cab', bored: '#2a78d6', asleep: '#5598e7', ghost: '#86b6ef' },
};
const STATUS_ICON = { lively: '☀', awake: '○', bored: '~', asleep: '☾', ghost: '◌', egg: '◒', cold: '❄' };
const MAX_DESK = 3;

export function createDashboard(app) {
  const root = document.getElementById('dashboard');
  const f = { q: '', stage: 'all', attention: false };
  const asTable = new Set();
  let fadingAll = false;
  let sort = { col: 'touched', dir: -1 };

  root.innerHTML = `
    <div class="win dash-win active" role="region" aria-label="dashboard">
      <header class="win-title"><span class="win-icon">${icons.taskmgr}</span><span class="win-name">Dashboard</span><button class="win-close" data-act="back" aria-label="back to the studio">×</button></header>
      <div class="dash-scroll">
        <div class="dash-filters" role="search">
          <input class="input dash-search" type="search" placeholder="search projects and ideas" aria-label="search">
          <div class="chips" role="group" aria-label="stage">
            ${['all', 'egg', 'hatchling', 'growing', 'shipped'].map((s) => `<button class="chip" data-stage="${s}">${s === 'all' ? 'everything' : `${STAGES[s].emoji} ${STAGES[s].label}`}</button>`).join('')}
          </div>
          <label class="check"><input type="checkbox" data-attention> needs attention only</label>
          <span class="grow"></span>
          <button class="btn small" data-act="rescan">↻ rescan folders</button>
          <button class="btn small" data-act="back">← back to the studio</button>
        </div>
        <div class="dash-body"></div>
      </div>
    </div>`;
  const body = root.querySelector('.dash-body');
  const tip = document.createElement('div');
  tip.className = 'dash-tip';
  tip.hidden = true;
  document.body.append(tip);

  // ------------------------------------------------------------ data

  const needsAttention = (c) => !c.frozen && ['asleep', 'ghost', 'cold'].includes(c.energy);
  const all = () => app.model.creatures.filter((c) => !c.letGo && !c.gone);
  const filtered = () => {
    const q = f.q.trim().toLowerCase();
    return all().filter(
      (c) =>
        (f.stage === 'all' || c.stage === f.stage) &&
        (!f.attention || needsAttention(c)) &&
        (!q || `${c.name} ${c.p?.folder || ''} ${c.p?.bio || ''} ${c.idea?.note || ''}`.toLowerCase().includes(q)),
    );
  };
  const touched = (c) => (c.type === 'egg' ? c.idea.createdAt : c.p.lastTouched);

  // ------------------------------------------------------------ render

  function render() {
    if (root.hidden || !app.model) return;
    const m = app.model;
    const rows = filtered();
    const live = rows.filter((c) => !c.frozen);
    const projects = live.filter((c) => c.type === 'project');
    const eggs = live.filter((c) => c.type === 'egg');
    const attention = live.filter(needsAttention).sort((a, b) => b.days - a.days);
    const ghosts = live.filter((c) => c.energy === 'ghost').length;
    const asleep = live.filter((c) => c.energy === 'asleep').length;
    const desk = m.desk;
    const bin = m.bin;
    const causes = {};
    for (const c of bin) causes[c.letGo.cause] = (causes[c.letGo.cause] || 0) + 1;
    const topCause = Object.entries(causes).sort((a, b) => b[1] - a[1])[0];

    for (const chip of root.querySelectorAll('[data-stage]')) chip.setAttribute('aria-pressed', String(chip.dataset.stage === f.stage));
    root.querySelector('[data-attention]').checked = f.attention;

    const kpi = (label, value, sub, attrs = '') =>
      `<button class="kpi" ${attrs}><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span><span class="kpi-sub">${sub}</span></button>`;

    body.innerHTML = `
      <div class="kpis">
        ${kpi('projects', projects.length, `${projects.filter((c) => c.stage === 'growing').length} growing · ${projects.filter((c) => c.stage === 'hatchling').length} hatchlings`, 'data-stage="all"')}
        ${kpi('eggs', eggs.length, eggs.some((c) => c.energy === 'cold') ? `${eggs.filter((c) => c.energy === 'cold').length} getting cold` : 'ideas not started yet', 'data-stage="egg"')}
        ${kpi('on the desk', `${desk.length}/${MAX_DESK}`, desk.length ? esc(desk.map((c) => short(c.name, 14)).join(', ')) : 'nothing in focus yet', 'data-scroll="desk"')}
        ${kpi('need attention', attention.length, attention.length ? `${plural(ghosts, 'ghost')} · ${asleep} asleep` : 'everyone is doing fine', 'data-attention-kpi')}
        ${kpi('shipped', live.filter((c) => c.stage === 'shipped').length, 'out in the world', 'data-stage="shipped"')}
        ${kpi('frozen', rows.filter((c) => c.frozen).length, 'kept for later', 'data-open="freezer"')}
        ${kpi('let go', bin.length, topCause ? `mostly: ${esc(CAUSES[topCause[0]])}` : 'nothing yet', 'data-open="bin"')}
      </div>
      <div class="dash-grid">
        ${card('fading', "who's fading", `days since you last touched each one. past ${m.settings.sleepDays} days they nap, past ${m.settings.ghostDays} they turn into ghosts.`, 'wide')}
        <section class="dash-card" id="dash-desk">
          <h3>on the desk</h3>
          <p class="dash-sub">up to ${MAX_DESK} projects you're focusing on, with the next step from their checklist.</p>
          ${deskList(desk, m)}
        </section>
        <section class="dash-card">
          <h3>needs attention</h3>
          <p class="dash-sub">napping, ghosts and cold eggs, longest-ignored first.</p>
          ${attentionList(attention)}
        </section>
        ${card('weeks', 'new ideas per week', 'folders you started and eggs you laid, last 12 weeks.')}
        ${card('stages', 'how far things got', 'click a stage to filter everything by it.')}
        ${card('energy', "how everyone's doing", 'every creature, by how recently you touched it.')}
        ${card('causes', 'why ideas ended', 'the reasons you picked when letting go. nothing was deleted from your computer.')}
        <section class="dash-card full">
          <h3>everything <span class="muted">(${rows.length})</span></h3>
          ${projectTable(rows)}
        </section>
      </div>`;

    const draw = {
      fading: (W) => fadingChart(rows, m, W),
      weeks: (W) => weeksChart(rows, W),
      stages: (W) => stagesChart(live, W),
      energy: (W) => energyChart(projects, W),
      causes: (W) => causesChart(causes, W),
    };
    for (const [id, fn] of Object.entries(draw)) {
      const el = body.querySelector(`[data-chart="${id}"]`);
      const { svg, table, empty } = fn(el.clientWidth || 400);
      el.innerHTML = empty ? `<p class="dash-empty">${empty}</p>` : asTable.has(id) ? table : svg;
      body.querySelector(`[data-table="${id}"]`).hidden = !!empty;
      body.querySelector(`[data-table="${id}"]`).textContent = asTable.has(id) ? 'chart' : 'table';
    }
  }

  const card = (id, title, sub, cls = '') => `
    <section class="dash-card ${cls}">
      <div class="dash-card-head"><h3>${title}</h3><button class="btn small" data-table="${id}">table</button></div>
      <p class="dash-sub">${sub}</p>
      <div class="dash-chart" data-chart="${id}"></div>
    </section>`;

  const thumbSlot = (c, size = 26) => thumbHtml(c, size);
  const status = (c) => `<span class="status ${c.frozen ? 'frozen' : c.energy}">${c.frozen ? '❄ frozen' : `${STATUS_ICON[c.energy]} ${ENERGY[c.energy].label}`}</span>`;

  function deskList(desk, m) {
    const candidates = m.live.filter((c) => c.type === 'project' && !c.onDesk);
    const slots = [];
    for (let i = 0; i < MAX_DESK; i++) {
      const c = desk[i];
      if (c) {
        const next = c.p.todos?.open?.[0]?.text;
        slots.push(`
          <li class="desk-item">
            ${thumbSlot(c, 34)}
            <div class="grow">
              <button class="link strong" data-props="${c.key}">${esc(c.name)}</button> ${status(c)}
              <div class="muted">${next ? `next: ${esc(short(next, 70))}` : `touched ${ago(c.p.lastTouched)} · no checklist yet`}</div>
            </div>
            <button class="btn small" data-desk-off="${c.id}">take off</button>
          </li>`);
      } else {
        slots.push(`
          <li class="desk-item free">
            <span class="desk-free">★</span>
            <div class="grow">
              <span class="muted">empty desk</span>
              ${candidates.length ? `<div class="row"><select class="select" data-desk-pick aria-label="pick a project for this desk">${candidates.sort((a, b) => a.days - b.days).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><button class="btn small" data-desk-on>put here</button></div>` : ''}
            </div>
          </li>`);
      }
    }
    return `<ul class="dash-list">${slots.join('')}</ul>`;
  }

  function attentionList(list) {
    if (!list.length) return '<p class="dash-empty">everyone is doing fine ✿</p>';
    return `<ul class="dash-list">${list
      .slice(0, 8)
      .map(
        (c) => `
        <li class="desk-item">
          ${thumbSlot(c)}
          <div class="grow">
            <button class="link strong" data-props="${c.key}">${esc(c.name)}</button> ${status(c)}
            <div class="muted">${c.type === 'egg' ? `laid ${ago(c.idea.createdAt)}` : `last touched ${ago(c.p.lastTouched)}`}</div>
          </div>
          <div class="row tight">
            <button class="btn small" data-revive="${c.key}">${c.type === 'egg' ? 'keep warm' : 'revive'}</button>
            <button class="btn small" data-freeze="${c.key}">freeze</button>
            <button class="btn small danger" data-letgo="${c.key}">let go…</button>
          </div>
        </li>`,
      )
      .join('')}</ul>${list.length > 8 ? `<p class="dash-sub">and ${list.length - 8} more. tick "needs attention only" to see them all below.</p>` : ''}`;
  }

  // ------------------------------------------------------------ table

  const COLS = [
    ['name', 'name', (c) => c.name.toLowerCase()],
    ['stage', 'stage', (c) => ['egg', 'hatchling', 'growing', 'shipped'].indexOf(c.stage)],
    ['status', 'status', (c) => (c.frozen ? 9 : ['lively', 'awake', 'egg', 'bored', 'asleep', 'cold', 'ghost'].indexOf(c.energy))],
    ['touched', 'last touched', (c) => touched(c)],
    ['age', 'age', (c) => c.age],
    ['todo', 'checklist', (c) => (c.p?.todos ? c.p.todos.done / Math.max(1, c.p.todos.done + c.p.todos.openCount) : -1)],
    ['files', 'files', (c) => (c.type === 'egg' ? -1 : c.p.files)],
  ];

  function projectTable(rows) {
    if (!rows.length) return '<p class="dash-empty">nothing matches. try another filter.</p>';
    const key = COLS.find((c) => c[0] === sort.col)[2];
    const sorted = [...rows].sort((a, b) => {
      const va = key(a);
      const vb = key(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
    const head = COLS.map(([id, label]) => `<th><button data-sort="${id}" aria-sort="${sort.col === id ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">${label}${sort.col === id ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`).join('');
    const body = sorted
      .map((c) => {
        const t = c.p?.todos;
        const total = t ? t.done + t.openCount : 0;
        return `
        <tr data-row="${c.key}" tabindex="0">
          <td class="name"><span>${thumbSlot(c, 24)}${esc(c.name)}${c.onDesk ? ' <span class="desk-star" title="on the desk">★</span>' : ''}</span></td>
          <td>${STAGES[c.stage].emoji} ${STAGES[c.stage].label}</td>
          <td>${status(c)}</td>
          <td class="num">${ago(touched(c))}</td>
          <td class="num">${plural(c.age, 'day')}</td>
          <td>${total ? `<span class="meter"><i style="width:${Math.round((t.done / total) * 100)}%"></i></span><span class="num">${t.done}/${total}</span>` : '<span class="muted">—</span>'}</td>
          <td class="num">${c.type === 'egg' ? '—' : c.p.files}</td>
        </tr>`;
      })
      .join('');
    return `<div class="list"><table class="table dash-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  // ------------------------------------------------------------ charts
  // each returns { svg, table } for the measured width, or { empty }

  function fadingChart(rows, m, W) {
    const list = rows.filter((c) => !c.frozen).sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
    if (!list.length) return { empty: 'nothing to show for this filter.' };
    const shown = fadingAll ? list : list.slice(0, 12);
    const { sleepDays, ghostDays } = m.settings;
    const labelW = Math.round(Math.min(180, Math.max(104, W * 0.3)));
    const right = 44;
    const top = 28;
    const rowH = 26;
    const barH = 14;
    const axisH = 34;
    const biggest = Math.max(ghostDays + 4, ...shown.map((c) => c.days));
    const step = biggest <= 35 ? 7 : biggest <= 70 ? 14 : biggest <= 180 ? 30 : 90;
    const max = Math.ceil(biggest / step) * step;
    const plotW = Math.max(60, W - labelW - right);
    const x = (d) => labelW + (plotW * Math.min(d, max)) / max;
    const H = top + shown.length * rowH + axisH;
    let g = '';
    for (let t = 0; t <= max; t += step) {
      g += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 4}" y2="${H - axisH}" stroke="${t ? COLOR.grid : COLOR.axis}"/>`;
      g += `<text x="${x(t)}" y="${H - axisH + 15}" class="tick" text-anchor="middle">${t}</text>`;
    }
    g += `<text x="${labelW + plotW}" y="${H - 4}" class="tick" text-anchor="end">days since last touched</text>`;
    const marks = [
      [sleepDays, `naps at ${sleepDays}`],
      [ghostDays, `ghost at ${ghostDays}`],
    ];
    for (const [d, label] of marks) {
      if (d > max) continue;
      g += `<line x1="${x(d)}" x2="${x(d)}" y1="${top - 8}" y2="${H - axisH}" stroke="${COLOR.ink2}" stroke-dasharray="3 3"/>`;
      g += `<text x="${x(d)}" y="${top - 13}" class="tick strong" text-anchor="middle">${label}</text>`;
    }
    shown.forEach((c, i) => {
      const y = top + i * rowH + (rowH - barH) / 2;
      const w = Math.max(2, x(c.days) - labelW);
      const fading = c.days >= sleepDays;
      g += `<text x="${labelW - 8}" y="${y + barH - 3}" text-anchor="end" class="lbl">${esc(short(c.name, 24))}${c.type === 'egg' ? ' (egg)' : ''}</text>`;
      g += `<path d="${hbar(labelW, y, w, barH)}" fill="${fading ? COLOR.s1 : COLOR.deemph}"/>`;
      g += `<text x="${labelW + w + 6}" y="${y + barH - 3}" class="val">${c.days}</text>`;
      g += `<rect class="hit" x="0" y="${top + i * rowH}" width="${W}" height="${rowH}" tabindex="0" data-key="${c.key}" data-tip="${c.days === 0 ? 'touched today' : plural(c.days, 'day')}" data-tip-label="${esc(c.name)} · ${esc(ENERGY[c.energy].label)}"/>`;
    });
    const key = `<div class="dash-legend"><span><i style="background:${COLOR.s1}"></i>napping or worse</span><span><i style="background:${COLOR.deemph}"></i>still fresh</span></div>`;
    const more = list.length > 12 ? `<button class="link" data-fading-all>${fadingAll ? 'show the top 12' : `show all ${list.length}`}</button>` : '';
    return {
      svg: `${key}<svg width="${W}" height="${H}" role="img" aria-label="days since each project was last touched">${g}</svg>${more}`,
      table: tableHtml(['name', 'days since touched', 'status'], list.map((c) => [c.name, c.days, ENERGY[c.energy].label])),
    };
  }

  function weeksChart(rows, W) {
    const N = 12;
    const first = weekStart(clock.now()) - (N - 1) * 7 * DAY;
    const weeks = Array.from({ length: N }, (_, i) => ({ start: first + i * 7 * DAY, folders: 0, eggs: 0 }));
    const add = (t, k) => {
      const i = Math.floor((t - first) / (7 * DAY));
      if (i >= 0 && i < N) weeks[i][k]++;
    };
    for (const c of rows) {
      if (c.type === 'project') {
        add(c.p.born, 'folders');
        if (c.egg) add(c.egg.createdAt, 'eggs');
      } else add(c.idea.createdAt, 'eggs');
    }
    const biggest = Math.max(1, ...weeks.map((w) => w.folders + w.eggs));
    const step = Math.max(1, niceStep(biggest / 4));
    const max = Math.ceil(biggest / step) * step;
    const left = 30;
    const right = 10;
    const top = 18;
    const plotH = 150;
    const bottom = 26;
    const H = top + plotH + bottom;
    const band = (W - left - right) / N;
    const colW = Math.min(24, band * 0.62);
    const y0 = top + plotH;
    const h = (v) => (plotH * v) / max;
    let g = '';
    for (let t = 0; t <= max; t += step) {
      g += `<line x1="${left}" x2="${W - right}" y1="${y0 - h(t)}" y2="${y0 - h(t)}" stroke="${t ? COLOR.grid : COLOR.axis}"/>`;
      g += `<text x="${left - 6}" y="${y0 - h(t) + 4}" class="tick" text-anchor="end">${t}</text>`;
    }
    const every = Math.max(1, Math.ceil((N * 48) / (W - left - right)));
    const topWeek = weeks.reduce((a, b) => (b.folders + b.eggs >= a.folders + a.eggs ? b : a));
    weeks.forEach((w, i) => {
      const x = left + band * i + (band - colW) / 2;
      const h1 = h(w.folders);
      const gap = w.folders && w.eggs ? 2 : 0;
      const h2 = Math.max(0, h(w.eggs) - gap);
      if (w.folders) g += w.eggs ? `<rect x="${x}" y="${y0 - h1}" width="${colW}" height="${h1}" fill="${COLOR.s1}"/>` : `<path d="${vbar(x, y0, colW, h1)}" fill="${COLOR.s1}"/>`;
      if (w.eggs) g += `<path d="${vbar(x, y0 - h1 - gap, colW, h2)}" fill="${COLOR.s2}"/>`;
      if ((N - 1 - i) % every === 0) g += `<text x="${x + colW / 2}" y="${y0 + 17}" class="tick" text-anchor="middle">${shortDate(w.start)}</text>`;
      if (w === topWeek && w.folders + w.eggs) g += `<text x="${x + colW / 2}" y="${y0 - h(w.folders + w.eggs) - 6}" class="val" text-anchor="middle">${w.folders + w.eggs}</text>`;
      g += `<rect class="hit" x="${left + band * i}" y="${top}" width="${band}" height="${plotH}" tabindex="0" data-tip="${plural(w.folders, 'folder')}, ${plural(w.eggs, 'egg')}" data-tip-label="week of ${shortDate(w.start)}"/>`;
    });
    const legend = `<div class="dash-legend"><span><i style="background:${COLOR.s1}"></i>folders started</span><span><i style="background:${COLOR.s2}"></i>eggs laid</span></div>`;
    return {
      svg: `${legend}<svg width="${W}" height="${H}" role="img" aria-label="new folders and eggs per week">${g}</svg>`,
      table: tableHtml(['week of', 'folders started', 'eggs laid'], weeks.map((w) => [shortDate(w.start), w.folders, w.eggs])),
    };
  }

  function stagesChart(live, W) {
    const stages = ['egg', 'hatchling', 'growing', 'shipped'];
    const counts = stages.map((s) => live.filter((c) => c.stage === s).length);
    if (!live.length) return { empty: 'nothing here yet.' };
    const labelW = 104;
    const right = 36;
    const rowH = 30;
    const barH = 16;
    const max = Math.max(1, ...counts);
    const H = rowH * stages.length + 6;
    let g = `<line x1="${labelW}" x2="${labelW}" y1="0" y2="${H - 6}" stroke="${COLOR.axis}"/>`;
    stages.forEach((s, i) => {
      const y = i * rowH + (rowH - barH) / 2;
      const w = counts[i] ? Math.max(3, ((W - labelW - right) * counts[i]) / max) : 0;
      g += `<text x="${labelW - 8}" y="${y + barH - 3}" text-anchor="end" class="lbl">${STAGES[s].emoji} ${STAGES[s].label}</text>`;
      if (w) g += `<path d="${hbar(labelW, y, w, barH)}" fill="${COLOR.stage[s]}"/>`;
      g += `<text x="${labelW + w + 6}" y="${y + barH - 3}" class="val">${counts[i]}</text>`;
      g += `<rect class="hit" x="0" y="${i * rowH}" width="${W}" height="${rowH}" tabindex="0" data-stage="${s}" data-tip="${counts[i]}" data-tip-label="${STAGES[s].label} · click to filter"/>`;
    });
    return {
      svg: `<svg width="${W}" height="${H}" role="img" aria-label="how many projects are at each stage">${g}</svg>`,
      table: tableHtml(['stage', 'count'], stages.map((s, i) => [STAGES[s].label, counts[i]])),
    };
  }

  function energyChart(projects, W) {
    const order = ['lively', 'awake', 'bored', 'asleep', 'ghost'];
    const counts = order.map((e) => projects.filter((c) => c.energy === e).length);
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) return { empty: 'no project folders in this view.' };
    const barH = 22;
    const H = barH + 4;
    let x = 0;
    let g = '';
    const parts = order.map((e, i) => ({ e, n: counts[i] })).filter((p) => p.n);
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      const w = ((W - 2 * (parts.length - 1)) * p.n) / total;
      g += last ? `<path d="${hbar(x, 2, w, barH)}" fill="${COLOR.energy[p.e]}"/>` : `<rect x="${x}" y="2" width="${w}" height="${barH}" fill="${COLOR.energy[p.e]}"/>`;
      g += `<rect class="hit" x="${x}" y="0" width="${w + 2}" height="${H}" tabindex="0" data-tip="${p.n} of ${total}" data-tip-label="${ENERGY[p.e].label}"/>`;
      x += w + 2;
    });
    const legend = `<div class="dash-legend wrap">${order.map((e, i) => `<span><i style="background:${COLOR.energy[e]}"></i>${STATUS_ICON[e]} ${ENERGY[e].label} <b>${counts[i]}</b></span>`).join('')}</div>`;
    return {
      svg: `<svg width="${W}" height="${H}" role="img" aria-label="projects by how recently they were touched">${g}</svg>${legend}`,
      table: tableHtml(['energy', 'projects'], order.map((e, i) => [ENERGY[e].label, counts[i]])),
    };
  }

  function causesChart(causes, W) {
    const list = Object.entries(causes).sort((a, b) => b[1] - a[1]);
    if (!list.length) return { empty: "you haven't let anything go yet." };
    const labelW = Math.min(190, Math.max(120, W * 0.42));
    const right = 30;
    const rowH = 28;
    const barH = 14;
    const max = list[0][1];
    const H = rowH * list.length + 4;
    let g = `<line x1="${labelW}" x2="${labelW}" y1="0" y2="${H - 4}" stroke="${COLOR.axis}"/>`;
    list.forEach(([cause, n], i) => {
      const y = i * rowH + (rowH - barH) / 2;
      const w = Math.max(3, ((W - labelW - right) * n) / max);
      g += `<text x="${labelW - 8}" y="${y + barH - 3}" text-anchor="end" class="lbl">${esc(CAUSES[cause] || cause)}</text>`;
      g += `<path d="${hbar(labelW, y, w, barH)}" fill="${COLOR.s1}"/>`;
      g += `<text x="${labelW + w + 6}" y="${y + barH - 3}" class="val">${n}</text>`;
      g += `<rect class="hit" x="0" y="${i * rowH}" width="${W}" height="${rowH}" tabindex="0" data-tip="${plural(n, 'idea')}" data-tip-label="${esc(CAUSES[cause] || cause)}"/>`;
    });
    return {
      svg: `<svg width="${W}" height="${H}" role="img" aria-label="reasons ideas were let go">${g}</svg>`,
      table: tableHtml(['reason', 'ideas'], list.map(([cause, n]) => [CAUSES[cause] || cause, n])),
    };
  }

  // ------------------------------------------------------------ helpers

  function hbar(x0, y, w, h, r = 4) {
    r = Math.min(r, w, h / 2);
    return `M${x0} ${y}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - r)}z`;
  }
  function vbar(x, y0, w, h, r = 4) {
    if (h <= 0) return '';
    r = Math.min(r, h, w / 2);
    return `M${x} ${y0}v${-(h - r)}a${r} ${r} 0 0 1 ${r} ${-r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - r}z`;
  }
  function niceStep(raw) {
    if (raw <= 1) return 1;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const k = raw / pow;
    return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 5 ? 5 : 10) * pow;
  }
  function weekStart(t) {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  }
  const shortDate = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  function tableHtml(head, rows) {
    return `<div class="list"><table class="table dash-table"><thead><tr>${head.map((h) => `<th><span>${esc(h)}</span></th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td class="${typeof v === 'number' ? 'num' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  // ------------------------------------------------------------ tooltip

  function showTip(t, x, y) {
    tip.replaceChildren();
    const value = document.createElement('b');
    value.textContent = t.dataset.tip;
    const label = document.createElement('span');
    label.textContent = t.dataset.tipLabel || '';
    tip.append(value, label);
    tip.hidden = false;
    tip.style.left = `${Math.min(innerWidth - tip.offsetWidth - 8, x + 14)}px`;
    tip.style.top = `${Math.max(8, y - tip.offsetHeight - 10)}px`;
  }
  const hideTip = () => (tip.hidden = true);
  root.addEventListener('pointermove', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t) showTip(t, e.clientX, e.clientY);
    else hideTip();
  });
  root.addEventListener('pointerleave', hideTip);
  root.addEventListener('focusin', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) return;
    const r = t.getBoundingClientRect();
    showTip(t, r.left + Math.min(r.width, 200), r.top + r.height / 2);
  });
  root.addEventListener('focusout', hideTip);
  root.querySelector('.dash-scroll').addEventListener('scroll', hideTip, { passive: true });

  // ------------------------------------------------------------ events

  const byKey = (k) => app.model.byKey.get(k);
  root.addEventListener('click', (e) => {
    const t = e.target;
    const on = (sel) => t.closest(sel);
    let el;
    if (on('[data-act=back]')) return app.showView('studio');
    if (on('[data-act=rescan]')) return app.rescan();
    if ((el = on('[data-stage]'))) {
      f.stage = f.stage === el.dataset.stage && el.closest('svg') ? 'all' : el.dataset.stage;
      return render();
    }
    if (on('[data-attention-kpi]')) {
      f.attention = !f.attention;
      return render();
    }
    if ((el = on('[data-open]'))) return el.dataset.open === 'bin' ? app.ui.bin(el) : app.ui.freezer(el);
    if (on('[data-scroll]')) return document.getElementById('dash-desk')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if ((el = on('[data-table]'))) {
      const id = el.dataset.table;
      if (asTable.has(id)) asTable.delete(id);
      else asTable.add(id);
      return render();
    }
    if (on('[data-fading-all]')) {
      fadingAll = !fadingAll;
      return render();
    }
    if ((el = on('[data-sort]'))) {
      const col = el.dataset.sort;
      sort = { col, dir: sort.col === col ? -sort.dir : col === 'name' ? 1 : -1 };
      return render();
    }
    if ((el = on('[data-desk-off]'))) return app.ui.desk(byKey(`p:${el.dataset.deskOff}`), false, el);
    if ((el = on('[data-desk-on]'))) {
      const id = el.parentElement.querySelector('[data-desk-pick]').value;
      return app.ui.desk(byKey(`p:${id}`), true, el);
    }
    if ((el = on('[data-revive]'))) return app.ui.revive(byKey(el.dataset.revive), el);
    if ((el = on('[data-freeze]'))) return app.ui.freeze(byKey(el.dataset.freeze));
    if ((el = on('[data-letgo]'))) return app.ui.letGo(byKey(el.dataset.letgo), el);
    if ((el = on('[data-props]') || on('[data-key]') || on('[data-row]'))) {
      return app.ui.props(el.dataset.props || el.dataset.key || el.dataset.row, el);
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const el = e.target.closest?.('[data-key], [data-row], .hit[data-stage]');
    if (!el) return;
    e.preventDefault();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  let typing;
  root.querySelector('.dash-search').addEventListener('input', (e) => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      f.q = e.target.value;
      render();
    }, 140);
  });
  root.querySelector('[data-attention]').addEventListener('change', (e) => {
    f.attention = e.target.checked;
    render();
  });
  let resizing;
  addEventListener('resize', () => {
    clearTimeout(resizing);
    resizing = setTimeout(render, 150);
  });

  return { root, render };
}
