// ===== State =====
let DATA = null;
let currentView = 'by-connector';
let currentConnectorId = null;
let currentWireType = null;
let wireViewLevel = 'baseline'; // baseline | 1 | 10 | 100 | 1000
let showNotCompatible = true;
let cmpA = null, cmpB = null, cmpWire = null;
let searchQuery = '';
let charts = [];

const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

function fmtOhm(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toFixed(3) + ' Ω';
}
function fmtCV(v) {
  if (v === null || v === undefined) return 'N/A (n=1)';
  return `CV ${v}%`;
}
function destroyCharts() { charts.forEach(c => c.destroy()); charts = []; }

// ===== Theme =====
(function initTheme() {
  const root = document.documentElement;
  let d = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  root.setAttribute('data-theme', d);
  const toggle = $('#themeToggle');
  function setIcon() {
    toggle.innerHTML = d === 'dark'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }
  setIcon();
  toggle.addEventListener('click', () => {
    d = d === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', d);
    setIcon();
    render();
  });
})();

// ===== Mobile nav =====
$('#mobileMenuBtn').addEventListener('click', () => $('#mobileNav').classList.add('open'));
$('#mobileNavClose').addEventListener('click', () => $('#mobileNav').classList.remove('open'));
$$('#mobileNav .nav-item').forEach(btn => btn.addEventListener('click', () => {
  setView(btn.dataset.view);
  $('#mobileNav').classList.remove('open');
}));

// ===== Nav wiring =====
$$('#navList .nav-item').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));

function setView(view) {
  currentView = view;
  currentConnectorId = null;
  $$('#navList .nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  render();
}

// ===== Chart color helpers =====
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  return {
    text: cs.getPropertyValue('--color-text').trim(),
    muted: cs.getPropertyValue('--color-text-muted').trim(),
    grid: cs.getPropertyValue('--color-divider').trim(),
    primary: cs.getPropertyValue('--color-primary').trim(),
    success: cs.getPropertyValue('--color-success').trim(),
    error: cs.getPropertyValue('--color-error').trim(),
    warning: cs.getPropertyValue('--color-warning').trim(),
    surface: cs.getPropertyValue('--color-surface').trim(),
  };
}

// ===== Data loading =====
fetch('./assets/data.json').then(r => r.json()).then(d => {
  DATA = d;
  render();
}).catch(err => {
  $('#mainContent').innerHTML = `<div class="empty-state"><h3>Failed to load data</h3><p>${err}</p></div>`;
});

// ===== Main render dispatcher =====
function render() {
  destroyCharts();
  if (!DATA) return;
  if (currentView === 'by-connector') {
    currentConnectorId ? renderConnectorDetail() : renderConnectorList();
  } else if (currentView === 'by-wire') {
    renderByWireType();
  } else if (currentView === 'compare') {
    renderCompare();
  } else if (currentView === 'about') {
    renderAbout();
  }
}

// ============================================================
// VIEW: By Connector — List
// ============================================================
function renderConnectorList() {
  const main = $('#mainContent');
  const ids = Object.keys(DATA.connectors).sort((a,b) => DATA.connectors[a].name.localeCompare(DATA.connectors[b].name));
  const filtered = ids.filter(id => DATA.connectors[id].name.toLowerCase().includes(searchQuery.toLowerCase()));

  main.innerHTML = `
    <div class="topbar">
      <div>
        <div class="page-title">By Connector</div>
        <div class="page-sub">${filtered.length} connectors · Phase 1 baseline resistance by AWG</div>
      </div>
      <input type="text" class="search-input" placeholder="Search connectors…" id="connSearch" value="${searchQuery}">
    </div>
    <div class="legend-row">
      <span><span class="legend-dot" style="background:var(--color-success)"></span>Compatible</span>
      <span><span class="legend-dot" style="background:var(--color-warning)"></span>Partial coverage</span>
      <span><span class="legend-dot" style="background:var(--color-text-faint)"></span>Not compatible</span>
    </div>
    <div class="card-grid" id="connGrid"></div>
  `;
  $('#connSearch').addEventListener('input', e => { searchQuery = e.target.value; renderConnectorList(); });
  $('#connSearch').focus();
  $('#connSearch').selectionStart = $('#connSearch').value.length;

  const grid = $('#connGrid');
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><h3>No connectors found</h3><p>Try a different search term.</p></div>`;
    return;
  }
  filtered.forEach(id => {
    const c = DATA.connectors[id];
    const flagCount = c.notes.length;
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-title">${c.name}</div>
      <div class="card-meta">
        <span>${c.reusable === 'yes' ? 'Limited stock' : 'Reusable'}</span>
        ${c.intended_range ? `<span>· Rated ${c.intended_range} AWG</span>` : ''}
        ${flagCount ? `<span>· ${flagCount} note${flagCount>1?'s':''}</span>` : ''}
      </div>
      <div class="card-lines">
        ${DATA.awgs.map(awg => {
          const a = c.phase1.by_awg[awg];
          let valEl;
          if (a.compat_status === 'not_compatible') {
            valEl = `<span class="card-line-val na">Not compatible</span>`;
          } else if (a.compat_status === 'partial') {
            valEl = `<span class="card-line-val partial">${fmtOhm(a.mean_ohm)} avg <span style="font-weight:400;font-size:var(--text-xs)">(${a.n_wire_types_tested}/${a.n_wire_types_possible} types)</span></span>`;
          } else {
            valEl = `<span class="card-line-val">${fmtOhm(a.mean_ohm)} avg</span>`;
          }
          return `<div class="card-line"><span class="card-line-label">${awg} AWG</span>${valEl}</div>`;
        }).join('')}
      </div>
    `;
    card.addEventListener('click', () => { currentConnectorId = id; render(); window.scrollTo(0,0); });
    grid.appendChild(card);
  });
}

// ============================================================
// VIEW: By Connector — Detail
// ============================================================
function renderConnectorDetail() {
  const main = $('#mainContent');
  const c = DATA.connectors[currentConnectorId];
  main.innerHTML = `
    <div class="detail-header">
      <button class="back-btn" id="backBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg> Back to connectors</button>
    </div>
    <div class="topbar">
      <div>
        <div class="page-title">${c.name}</div>
        <div class="page-sub">${c.reusable === 'yes' ? 'Limited stock / single-use' : 'Reusable'} ${c.intended_range ? `· Manufacturer rated ${c.intended_range} AWG` : ''} ${c.name_phase1 && c.name_phase1 !== c.name ? `· Phase 1 name: ${c.name_phase1}` : ''}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Phase 1 — Baseline Resistance</div>
      <div id="p1Table"></div>
    </div>

    <div class="section">
      <div class="section-title">Phase 2 — Mechanical Load / Dwell Response</div>
      <div id="p2Section"></div>
    </div>

    <div class="section">
      <div class="section-title">Phase 3 — Current Sensitivity</div>
      <div id="p3Section"></div>
    </div>

    <div class="section">
      <div class="section-title">Notes &amp; Flags</div>
      <div id="notesSection"></div>
    </div>
  `;
  $('#backBtn').addEventListener('click', () => { currentConnectorId = null; render(); window.scrollTo(0,0); });

  renderP1Table(c);
  renderP2Section(c);
  renderP3Section(c);
  renderNotesSection(c);
}

function renderP1Table(c) {
  const el = $('#p1Table');
  let rows = '';
  DATA.awgs.forEach(awg => {
    const a = c.phase1.by_awg[awg];
    DATA.wire_order.filter(w => parseInt(w) || w.startsWith(String(awg))).forEach(w => {});
  });
  // build rows per fixed wire order, grouped visually by whether tested
  const wireRows = DATA.wire_order.map(w => {
    const awg = parseInt(w.slice(0,2));
    const wd = c.phase1.by_awg[awg]?.by_wire?.[w];
    return { w, awg, wd };
  }).filter(r => r.wd);

  rows = wireRows.map(({w, awg, wd}) => {
    const naRow = wd.status === 'not_compatible';
    return `<tr class="${naRow ? 'na-row' : ''}">
      <td>${DATA.wire_labels[w]}</td>
      <td>${awg}</td>
      <td>${naRow ? 'Not compatible' : fmtOhm(wd.mean_ohm)}</td>
      <td>${wd.n_trials}</td>
      <td>${naRow ? '—' : fmtCV(wd.cv_pct)}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Wire Type</th><th>AWG</th><th>Mean Resistance</th><th>Trials</th><th>Variability</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderP2Section(c) {
  const el = $('#p2Section');
  if (!c.phase2) {
    el.innerHTML = `<div class="empty-state"><h3>No Phase 2 data</h3><p>This connector was not tested in Phase 2.</p></div>`;
    return;
  }
  const wires = Object.keys(c.phase2);
  el.innerHTML = `<div class="chip-row" id="p2WireChips">${wires.map((w,i) => `<button class="chip ${i===0?'active':''}" data-wire="${w}">${DATA.wire_labels[w] || w}</button>`).join('')}</div>
  <div class="chart-container"><canvas id="p2Chart" height="90"></canvas></div>`;

  function drawP2(wire) {
    const trials = c.phase2[wire];
    const stages = ['wire_resistance_pre','preload','load_applied','postload','wire_resistance_post','reconnection'];
    const stageLabels = ['Pre-load','Preload','Load Applied','Postload','Post-load','Reconnection'];
    const colors = themeColors();
    const datasets = trials.map((t, i) => ({
      label: `Trial ${t.trial}`,
      data: stages.map(s => t[s+'_ohm']),
      borderColor: [colors.primary, colors.success, colors.warning][i % 3],
      backgroundColor: [colors.primary, colors.success, colors.warning][i % 3],
      tension: 0.3, spanGaps: true,
    }));
    const ctx = $('#p2Chart').getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: { labels: stageLabels, datasets },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: colors.text } }, title: { display: true, text: 'Resistance across mechanical load stages (Ω)', color: colors.text } },
        scales: {
          x: { ticks: { color: colors.muted }, grid: { color: colors.grid } },
          y: { ticks: { color: colors.muted }, grid: { color: colors.grid }, title: { display: true, text: 'Ohms', color: colors.muted } }
        }
      }
    });
    charts.push(chart);
  }
  drawP2(wires[0]);
  $$('#p2WireChips .chip').forEach(chip => chip.addEventListener('click', () => {
    $$('#p2WireChips .chip').forEach(c2 => c2.classList.remove('active'));
    chip.classList.add('active');
    destroyCharts();
    drawP2(chip.dataset.wire);
  }));
}

function renderP3Section(c) {
  const el = $('#p3Section');
  if (!c.phase3) {
    el.innerHTML = `<div class="empty-state"><h3>No Phase 3 data</h3><p>This connector was not tested in Phase 3.</p></div>`;
    return;
  }
  const wires = Object.keys(c.phase3);
  el.innerHTML = `<div class="chip-row" id="p3WireChips">${wires.map((w,i) => `<button class="chip ${i===0?'active':''}" data-wire="${w}">${DATA.wire_labels[w] || w}</button>`).join('')}</div>
  <div class="chart-container"><canvas id="p3Chart" height="90"></canvas></div>`;

  function drawP3(wire) {
    const byCurrent = c.phase3[wire];
    const currents = [1,10,100,1000].filter(cur => byCurrent[cur]);
    const colors = themeColors();
    const immData = currents.map(cur => {
      const trials = byCurrent[cur];
      const vals = trials.map(t => t.immediate_ohm).filter(v => v !== null);
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
    });
    const dwellData = currents.map(cur => {
      const trials = byCurrent[cur];
      const vals = trials.map(t => t.dwell_ohm).filter(v => v !== null);
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
    });
    const ctx = $('#p3Chart').getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: currents.map(c2 => c2 + ' mA'),
        datasets: [
          { label: 'Immediate', data: immData, borderColor: colors.primary, backgroundColor: colors.primary, tension: 0.3 },
          { label: 'Dwell', data: dwellData, borderColor: colors.warning, backgroundColor: colors.warning, tension: 0.3 },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: colors.text } }, title: { display: true, text: 'Resistance vs current (log scale), mean of trials', color: colors.text } },
        scales: {
          x: { ticks: { color: colors.muted }, grid: { color: colors.grid } },
          y: { type: 'logarithmic', ticks: { color: colors.muted }, grid: { color: colors.grid }, title: { display: true, text: 'Ohms', color: colors.muted } }
        }
      }
    });
    charts.push(chart);
  }
  drawP3(wires[0]);
  $$('#p3WireChips .chip').forEach(chip => chip.addEventListener('click', () => {
    $$('#p3WireChips .chip').forEach(c2 => c2.classList.remove('active'));
    chip.classList.add('active');
    charts = charts.filter(ch => { ch.destroy(); return false; });
    drawP3(chip.dataset.wire);
  }));
}

function renderNotesSection(c) {
  const el = $('#notesSection');
  if (!c.notes.length) {
    el.innerHTML = `<div class="empty-state"><h3>No notes recorded</h3></div>`;
    return;
  }
  el.innerHTML = `<div class="notes-list">${c.notes.map(n => `
    <div class="note-item">
      <div class="note-meta"><span>Phase ${n.phase}</span><span>${DATA.wire_labels[n.wire_id] || n.wire_id}</span><span>Trial ${n.trial}</span></div>
      ${n.note}
    </div>
  `).join('')}</div>`;
}

// ============================================================
// VIEW: By Wire Type
// ============================================================
function renderByWireType() {
  const main = $('#mainContent');
  if (!currentWireType) currentWireType = DATA.wire_order[0];

  main.innerHTML = `
    <div class="topbar">
      <div>
        <div class="page-title">By Wire Type</div>
        <div class="page-sub">Connector rankings for a given wire type and current level</div>
      </div>
    </div>
    <div class="chip-row" id="wireChips">
      ${DATA.wire_order.map(w => `<button class="chip ${w===currentWireType?'active':''}" data-wire="${w}">${DATA.wire_labels[w]}</button>`).join('')}
    </div>
    <div class="tabs" id="levelTabs">
      <button class="tab-btn ${wireViewLevel==='baseline'?'active':''}" data-level="baseline">Baseline (Phase 1)</button>
      <button class="tab-btn ${wireViewLevel==='1'?'active':''}" data-level="1">1 mA</button>
      <button class="tab-btn ${wireViewLevel==='10'?'active':''}" data-level="10">10 mA</button>
      <button class="tab-btn ${wireViewLevel==='100'?'active':''}" data-level="100">100 mA</button>
      <button class="tab-btn ${wireViewLevel==='1000'?'active':''}" data-level="1000">1000 mA</button>
    </div>
    <div style="display:flex; justify-content:flex-end; margin-bottom:var(--space-3);">
      <button class="btn btn-ghost ${showNotCompatible?'active':''}" id="toggleNC">${showNotCompatible ? 'Hide' : 'Show'} not-compatible rows</button>
    </div>
    <div id="wireRankTable"></div>
  `;

  $$('#wireChips .chip').forEach(chip => chip.addEventListener('click', () => { currentWireType = chip.dataset.wire; renderByWireType(); }));
  $$('#levelTabs .tab-btn').forEach(tab => tab.addEventListener('click', () => { wireViewLevel = tab.dataset.level; renderByWireType(); }));
  $('#toggleNC').addEventListener('click', () => { showNotCompatible = !showNotCompatible; renderByWireType(); });

  renderWireRankTable();
}

function renderWireRankTable() {
  const el = $('#wireRankTable');
  const wire = currentWireType;
  const awg = parseInt(wire.slice(0,2));
  const rows = [];

  Object.keys(DATA.connectors).forEach(cid => {
    const c = DATA.connectors[cid];
    let meanOhm = null, cv = null, nTrials = 0, compatible = true;

    if (wireViewLevel === 'baseline') {
      const wd = c.phase1.by_awg[awg]?.by_wire?.[wire];
      if (wd) { meanOhm = wd.mean_ohm; cv = wd.cv_pct; nTrials = wd.n_trials; compatible = wd.status !== 'not_compatible'; }
      else compatible = false;
    } else {
      const byCurrent = c.phase3?.[wire]?.[parseInt(wireViewLevel)];
      if (byCurrent && byCurrent.length) {
        const vals = [];
        byCurrent.forEach(t => { if (t.immediate_ohm !== null) vals.push(t.immediate_ohm); if (t.dwell_ohm !== null) vals.push(t.dwell_ohm); });
        if (vals.length) {
          meanOhm = Math.round(vals.reduce((a,b)=>a+b,0)/vals.length*1000)/1000;
          nTrials = byCurrent.length;
          if (vals.length >= 2) {
            const m = vals.reduce((a,b)=>a+b,0)/vals.length;
            const sd = Math.sqrt(vals.reduce((a,b)=>a+(b-m)**2,0)/(vals.length-1));
            cv = m ? Math.round(sd/m*1000)/10 : null;
          }
        } else compatible = false;
      } else compatible = false;
    }
    rows.push({ cid, name: c.name, meanOhm, cv, nTrials, compatible, notSpecified: c.intended_range && !inRange(c.intended_range, awg) });
  });

  let filtered = showNotCompatible ? rows : rows.filter(r => r.compatible);
  filtered.sort((a,b) => {
    if (a.compatible !== b.compatible) return a.compatible ? -1 : 1;
    if (a.meanOhm === null) return 1;
    if (b.meanOhm === null) return -1;
    return a.meanOhm - b.meanOhm;
  });

  el.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Rank</th><th>Connector</th><th>Mean Resistance</th><th>Trials</th><th>Variability</th><th></th></tr></thead>
      <tbody>${filtered.map((r,i) => `
        <tr class="${!r.compatible ? 'na-row grayed' : ''}">
          <td>${r.compatible ? i+1 : '—'}</td>
          <td>${r.name}</td>
          <td>${r.compatible ? fmtOhm(r.meanOhm) : 'Not compatible'}</td>
          <td>${r.compatible ? r.nTrials : '—'}</td>
          <td>${r.compatible ? fmtCV(r.cv) : '—'}</td>
          <td>${r.notSpecified ? '<span class="badge badge-partial">Connector not specified for this wire type</span>' : ''}</td>
        </tr>
      `).join('')}</tbody>
    </table>
  `;
}

function inRange(rangeStr, awg) {
  // e.g. "18-22" or "10-12" or "14-18"
  const parts = rangeStr.split('-').map(s => parseInt(s.trim()));
  if (parts.length !== 2) return true;
  const [lo, hi] = [Math.min(...parts), Math.max(...parts)];
  return awg >= lo && awg <= hi;
}

// ============================================================
// VIEW: Compare
// ============================================================
function renderCompare() {
  const main = $('#mainContent');
  const connIds = Object.keys(DATA.connectors).sort((a,b) => DATA.connectors[a].name.localeCompare(DATA.connectors[b].name));
  if (!cmpA) cmpA = connIds[0];
  if (!cmpB) cmpB = connIds[1] || connIds[0];
  if (!cmpWire) cmpWire = DATA.wire_order[0];

  main.innerHTML = `
    <div class="topbar">
      <div>
        <div class="page-title">Compare Connectors</div>
        <div class="page-sub">Phase 1 baseline comparison across all wire types, then detailed current-response charts</div>
      </div>
    </div>
    <div class="compare-select-row">
      <div class="select-box">
        <label>Connector A</label>
        <select id="cmpASel">${connIds.map(id => `<option value="${id}" ${id===cmpA?'selected':''}>${DATA.connectors[id].name}</option>`).join('')}</select>
      </div>
      <div class="select-box">
        <label>Connector B</label>
        <select id="cmpBSel">${connIds.map(id => `<option value="${id}" ${id===cmpB?'selected':''}>${DATA.connectors[id].name}</option>`).join('')}</select>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Baseline Resistance by Wire Type (Phase 1)</div>
      <div id="baselineTable"></div>
    </div>
    <div class="section">
      <div class="section-title">Detailed Comparison</div>
      <div class="chip-row" id="cmpWireChips">${DATA.wire_order.map(w => `<button class="chip ${w===cmpWire?'active':''}" data-wire="${w}">${DATA.wire_labels[w]}</button>`).join('')}</div>
      <div class="chart-container"><canvas id="cmpChart" height="100"></canvas></div>
    </div>
  `;

  $('#cmpASel').addEventListener('change', e => { cmpA = e.target.value; renderCompare(); });
  $('#cmpBSel').addEventListener('change', e => { cmpB = e.target.value; renderCompare(); });
  $$('#cmpWireChips .chip').forEach(chip => chip.addEventListener('click', () => { cmpWire = chip.dataset.wire; renderCompare(); }));

  renderBaselineTable();
  drawCmpChart();
}

function renderBaselineTable() {
  const el = $('#baselineTable');
  const A = DATA.connectors[cmpA], B = DATA.connectors[cmpB];
  const rows = DATA.wire_order.map(w => {
    const awg = parseInt(w.slice(0,2));
    const wdA = A.phase1.by_awg[awg]?.by_wire?.[w];
    const wdB = B.phase1.by_awg[awg]?.by_wire?.[w];
    const valA = wdA && wdA.status !== 'not_compatible' ? wdA.mean_ohm : null;
    const valB = wdB && wdB.status !== 'not_compatible' ? wdB.mean_ohm : null;
    let clsA = 'cmp-cell-neutral', clsB = 'cmp-cell-neutral';
    if (valA !== null && valB === null) clsA = 'cmp-cell-green';
    else if (valB !== null && valA === null) clsB = 'cmp-cell-green';
    else if (valA !== null && valB !== null) {
      const cvA = wdA.cv_pct || 0, cvB = wdB.cv_pct || 0;
      const tolerance = Math.max(cvA, cvB, 5) / 100 * Math.max(valA, valB);
      if (Math.abs(valA - valB) <= tolerance) { clsA = 'cmp-cell-green'; clsB = 'cmp-cell-green'; }
      else if (valA < valB) { clsA = 'cmp-cell-green'; clsB = 'cmp-cell-red'; }
      else { clsB = 'cmp-cell-green'; clsA = 'cmp-cell-red'; }
    }
    return { w, valA, valB, clsA, clsB };
  });
  el.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Wire Type</th><th>${A.name}</th><th>${B.name}</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td>${DATA.wire_labels[r.w]}</td>
          <td class="${r.clsA}">${r.valA !== null ? fmtOhm(r.valA) : 'Not compatible'}</td>
          <td class="${r.clsB}">${r.valB !== null ? fmtOhm(r.valB) : 'Not compatible'}</td>
        </tr>
      `).join('')}</tbody>
    </table>
  `;
}

function drawCmpChart() {
  const A = DATA.connectors[cmpA], B = DATA.connectors[cmpB];
  const colors = themeColors();
  const currents = [1,10,100,1000];
  function seriesFor(conn) {
    return currents.map(cur => {
      const trials = conn.phase3?.[cmpWire]?.[cur];
      if (!trials || !trials.length) return null;
      const vals = [];
      trials.forEach(t => { if (t.immediate_ohm !== null) vals.push(t.immediate_ohm); });
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
    });
  }
  const ctx = $('#cmpChart').getContext('2d');
  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: currents.map(c => c + ' mA'),
      datasets: [
        { label: A.name, data: seriesFor(A), borderColor: colors.primary, backgroundColor: colors.primary, tension: 0.3, spanGaps: true },
        { label: B.name, data: seriesFor(B), borderColor: colors.warning, backgroundColor: colors.warning, tension: 0.3, spanGaps: true },
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: colors.text } }, title: { display: true, text: `${DATA.wire_labels[cmpWire]} — immediate resistance vs current (log scale)`, color: colors.text } },
      scales: {
        x: { ticks: { color: colors.muted }, grid: { color: colors.grid } },
        y: { type: 'logarithmic', ticks: { color: colors.muted }, grid: { color: colors.grid }, title: { display: true, text: 'Ohms', color: colors.muted } }
      }
    }
  });
  charts.push(chart);
}

// ============================================================
// VIEW: About
// ============================================================
function renderAbout() {
  const main = $('#mainContent');
  main.innerHTML = `
    <div class="topbar"><div><div class="page-title">About This Data</div></div></div>
    <div class="about-content">
      <p>This tool explores connector-to-wire resistance test data collected in three phases using a 4-wire Kelvin measurement setup on a Keithley DMM, then a Fluke 5560A constant-current source with Keithley DMM6500 for Phase 2/3 voltage-drop measurements.</p>

      <h3>Phase 1 — Baseline Resistance</h3>
      <p>Static resistance measurements taken with a 4-wire Kelvin connection via a Keithley DMM in autoranging mode (no fixed test current — whatever the meter supplied). Each connector was tested against up to 15 wire types across 3 trials. This is the baseline resistance shown on connector cards and used throughout the app as the primary "how good is this connector" number.</p>

      <h3>Phase 2 — Mechanical Load Response</h3>
      <p>Voltage drop measured across six mechanical stages (pre-load, preload, load applied, postload, post-load, reconnection) at a constant 100 mA test current, converted to resistance. This reveals how connectors behave under physical stress and reconnection.</p>

      <h3>Phase 3 — Current Sensitivity</h3>
      <p>Voltage drop swept across four current levels (1, 10, 100, 1000 mA), each with an immediate reading and a delayed "dwell" reading (30s for the first three steps, 60s for 1000 mA). This shows how resistance changes with current draw and over time under load.</p>

      <h3>Compatibility Status</h3>
      <ul>
        <li><strong>Compatible</strong> — valid trial data exists for every wire type of a given AWG.</li>
        <li><strong>Partial</strong> — data exists for some but not all wire types of that AWG; the average shown only reflects the tested subset.</li>
        <li><strong>Not compatible</strong> — no valid trial data exists for any wire type of that AWG (mechanically incompatible, not tested, or all attempts invalid).</li>
      </ul>
      <p>Manufacturer-rated AWG ranges (from connector reference data) are informational only — if test data shows a connector actually works with a wire outside its rated range, the measured result is shown as-is, flagged with "Connector not specified for this wire type" rather than being hidden.</p>

      <h3>Variability (CV%)</h3>
      <p>Coefficient of variation — standard deviation divided by mean, as a percentage — describes how consistent repeated trials were for a given connector/wire combination. Lower is more consistent. When only one valid trial exists, this shows as "N/A (n=1)" since variability can't be computed from a single point.</p>

      <h3>Data Corrections Applied</h3>
      <p>Four Phase 3 readings flagged as likely decimal-point transcription errors (roughly 5–15x off from the paired immediate/dwell reading) were corrected after manual review: WASPP6 / 30 AWG Magnet Wire, Fluke Networks MT-8203-20 Intellitone / 14 AWG Silicone Stranded, 3M Scotchlok 951 / 14 AWG PVC Stranded, and Posi-Tap Yellow / 14 AWG PVC Stranded.</p>
    </div>
  `;
}
