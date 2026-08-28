// ===== State =====
let DATA = null;
let currentView = 'by-connector';
let currentConnectorId = null;
let currentWireType = null;
let wireViewLevel = 'baseline';
let showNotCompatible = true;
let cmpA = null, cmpB = null, cmpWire = null;
let searchQuery = '';
let charts = [];
let p3TrialToggle = {}; // per chart-instance key -> {mean:true, 1:false, 2:false, 3:false}
let showUncertaintyBand = true;
let heatmapSort = null; // {wire, dir}

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
function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }

function gradientColor(tested, possible) {
  if (tested === 0) return isDark() ? '#ff5c6a' : '#c0182b';
  const f = tested / possible;
  const fClamped = Math.max(0.2, Math.min(1, f));
  const hue = ((fClamped - 0.2) / 0.8) * 120;
  const light = isDark() ? 62 : 36;
  const sat = isDark() ? 75 : 68;
  return `hsl(${hue.toFixed(0)}, ${sat}%, ${light}%)`;
}

// ===== DMM uncertainty interpolation =====
// Given |V| in mV and current level (string key '1'|'10'|'100'|'1000'), return ± error in mV,
// log-linearly interpolated between breakpoints (extrapolated flat outside range).
function dmmErrorMv(absVmV, currentKey) {
  const table = DATA.dmm_uncertainty_mV[currentKey];
  if (!table || absVmV <= 0) return table ? table[0][1] : 0.0035;
  if (absVmV <= table[0][0]) return table[0][1];
  if (absVmV >= table[table.length-1][0]) return table[table.length-1][1];
  for (let i = 0; i < table.length-1; i++) {
    const [v0,e0] = table[i], [v1,e1] = table[i+1];
    if (absVmV >= v0 && absVmV <= v1) {
      const t = (Math.log(absVmV)-Math.log(v0))/(Math.log(v1)-Math.log(v0));
      return e0 + t*(e1-e0);
    }
  }
  return table[table.length-1][1];
}
// Convert a resistance reading + current(mA) into ± resistance uncertainty band (ohms)
function resistanceUncertainty(rOhm, currentMA) {
  if (rOhm === null || rOhm === undefined) return null;
  const I_A = currentMA/1000;
  const vMv = Math.abs(rOhm * I_A) * 1000; // V = IR, in mV
  const errMv = dmmErrorMv(vMv, String(currentMA));
  return (errMv/1000) / I_A; // ohms
}

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
    maroon: cs.getPropertyValue('--color-maroon').trim(),
  };
}
function hexToRgba(hex, alpha) {
  // handles hsl() or hex; fallback simple
  if (hex.startsWith('#')) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return hex;
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
  } else if (currentView === 'heatmap') {
    renderHeatmap();
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
      <span>Wire-type coverage: <span class="legend-gradient-bar"></span></span>
      <span>0/5 → not compatible</span>
      <span>5/5 → compatible</span>
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
          const color = gradientColor(a.n_wire_types_tested, a.n_wire_types_possible);
          let valEl;
          if (a.compat_status === 'not_compatible') {
            valEl = `<span class="card-line-val" style="color:${color}">Not compatible <span class="card-line-frac">(0/${a.n_wire_types_possible})</span></span>`;
          } else {
            valEl = `<span class="card-line-val" style="color:${color}">${fmtOhm(a.mean_ohm)} avg <span class="card-line-frac">(${a.n_wire_types_tested}/${a.n_wire_types_possible})</span></span>`;
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
  const wireRows = DATA.wire_order.map(w => {
    const awg = parseInt(w.slice(0,2));
    const wd = c.phase1.by_awg[awg]?.by_wire?.[w];
    return { w, awg, wd };
  }).filter(r => r.wd);

  const rows = wireRows.map(({w, awg, wd}) => {
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
  <div class="chart-row">
    <div class="chart-container">
      <div class="chart-subtitle">Connector resistance (preload → load applied → postload → reconnection)</div>
      <canvas id="p2ChartConn" height="110"></canvas>
    </div>
    <div class="chart-container">
      <div class="chart-subtitle">Wire resistance — did the connector damage the wire? (pre vs post)</div>
      <canvas id="p2ChartWire" height="110"></canvas>
    </div>
  </div>`;

  function drawP2(wire) {
    const trials = c.phase2[wire];
    const colors = themeColors();
    const trialColors = [colors.primary, colors.success, colors.warning];

    const connStages = ['preload','load_applied','postload','reconnection'];
    const connLabels = ['Preload','Load Applied','Postload','Reconnection'];
    const connDatasets = trials.map((t, i) => ({
      label: `Trial ${t.trial}`,
      data: connStages.map(s => t[s+'_ohm']),
      borderColor: trialColors[i % 3],
      backgroundColor: trialColors[i % 3],
      tension: 0.3, spanGaps: true,
    }));
    const ctx1 = $('#p2ChartConn').getContext('2d');
    charts.push(new Chart(ctx1, {
      type: 'line',
      data: { labels: connLabels, datasets: connDatasets },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: colors.text } } },
        scales: {
          x: { ticks: { color: colors.muted }, grid: { color: colors.grid } },
          y: { ticks: { color: colors.muted }, grid: { color: colors.grid }, title: { display: true, text: 'Ohms', color: colors.muted } }
        }
      }
    }));

    const wireStages = ['wire_resistance_pre','wire_resistance_post'];
    const wireLabels = ['Pre-load (wire)','Post-load (wire)'];
    const wireDatasets = trials.map((t, i) => ({
      label: `Trial ${t.trial}`,
      data: wireStages.map(s => t[s+'_ohm']),
      borderColor: trialColors[i % 3],
      backgroundColor: trialColors[i % 3],
      tension: 0.3, spanGaps: true,
    }));
    const ctx2 = $('#p2ChartWire').getContext('2d');
    charts.push(new Chart(ctx2, {
      type: 'line',
      data: { labels: wireLabels, datasets: wireDatasets },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: colors.text } } },
        scales: {
          x: { ticks: { color: colors.muted }, grid: { color: colors.grid } },
          y: { ticks: { color: colors.muted }, grid: { color: colors.grid }, title: { display: true, text: 'Ohms', color: colors.muted } }
        }
      }
    }));
  }
  drawP2(wires[0]);
  $$('#p2WireChips .chip').forEach(chip => chip.addEventListener('click', () => {
    $$('#p2WireChips .chip').forEach(c2 => c2.classList.remove('active'));
    chip.classList.add('active');
    destroyCharts();
    drawP2(chip.dataset.wire);
  }));
}

// ---- Phase 3: shared helpers for uncertainty band + overlap flag ----
function computeP3PointStats(byCurrent, currents) {
  // returns array aligned with currents: {mean, lower, upper, trials:[{trial,imm,dwell}]}
  return currents.map(cur => {
    const trials = byCurrent[cur] || [];
    const immVals = trials.map(t => t.immediate_ohm).filter(v => v !== null && v !== undefined);
    const mean = immVals.length ? immVals.reduce((a,b)=>a+b,0)/immVals.length : null;
    const unc = mean !== null ? resistanceUncertainty(mean, cur) : null;
    return {
      current: cur, mean,
      lower: mean !== null ? Math.max(0, mean - unc) : null,
      upper: mean !== null ? mean + unc : null,
      unc,
      trials
    };
  });
}
function flagOverlaps(points) {
  // returns array of booleans same length: true if this point's band overlaps an ADJACENT point's band
  const flags = points.map(() => false);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.mean === null) continue;
    const neighbors = [i-1, i+1].filter(j => j >= 0 && j < points.length);
    for (const j of neighbors) {
      const q = points[j];
      if (q.mean === null) continue;
      const overlap = p.lower <= q.upper && q.lower <= p.upper;
      if (overlap) { flags[i] = true; flags[j] = true; }
    }
  }
  return flags;
}

function renderP3Section(c) {
  const el = $('#p3Section');
  if (!c.phase3) {
    el.innerHTML = `<div class="empty-state"><h3>No Phase 3 data</h3><p>This connector was not tested in Phase 3.</p></div>`;
    return;
  }
  const wires = Object.keys(c.phase3);
  el.innerHTML = `<div class="chip-row" id="p3WireChips">${wires.map((w,i) => `<button class="chip ${i===0?'active':''}" data-wire="${w}">${DATA.wire_labels[w] || w}</button>`).join('')}</div>
  <div class="chip-row" id="p3TrialChips"></div>
  <div class="chart-container">
    <canvas id="p3Chart" height="90"></canvas>
    <div class="chart-footnote">
      <label class="uncertainty-toggle"><input type="checkbox" id="p3UncToggle" ${showUncertaintyBand?'checked':''}> Show DMM measurement-uncertainty band</label>
      <span><span class="overlap-flag">*</span> = error bands overlap adjacent current step (values not statistically distinguishable)</span>
    </div>
  </div>`;

  let activeWire = wires[0];
  let trialState = { mean: true, 1: false, 2: false, 3: false };

  function drawP3() {
    const byCurrent = c.phase3[activeWire];
    const currents = [1,10,100,1000].filter(cur => byCurrent[cur]);
    const colors = themeColors();
    const points = computeP3PointStats(byCurrent, currents);
    const overlapFlags = flagOverlaps(points);

    const datasets = [];
    if (showUncertaintyBand) {
      datasets.push({
        label: 'Upper bound', data: points.map(p => p.upper), borderWidth: 0, pointRadius: 0,
        fill: '+1', backgroundColor: hexToRgba(colors.primary, 0.15), order: 5, spanGaps: true,
      });
      datasets.push({
        label: 'Lower bound', data: points.map(p => p.lower), borderWidth: 0, pointRadius: 0,
        fill: false, order: 5, spanGaps: true,
      });
    }
    if (trialState.mean) {
      datasets.push({
        label: 'Mean (immediate)', data: points.map(p => p.mean), borderColor: colors.primary,
        backgroundColor: colors.primary, tension: 0.3, order: 1, spanGaps: true,
        pointStyle: points.map((p,i) => overlapFlags[i] ? 'star' : 'circle'),
        pointRadius: points.map((p,i) => overlapFlags[i] ? 7 : 4),
      });
      const dwellVals = currents.map(cur => {
        const trials = byCurrent[cur];
        const vals = trials.map(t => t.dwell_ohm).filter(v => v !== null);
        return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
      });
      datasets.push({ label: 'Mean (dwell)', data: dwellVals, borderColor: colors.warning, backgroundColor: colors.warning, tension: 0.3, order: 2, spanGaps: true, borderDash: [4,3] });
    }
    const trialColors = { 1: colors.success, 2: colors.error, 3: colors.maroon };
    [1,2,3].forEach(tn => {
      if (!trialState[tn]) return;
      const immData = currents.map(cur => {
        const t = (byCurrent[cur]||[]).find(x => x.trial === tn);
        return t ? t.immediate_ohm : null;
      });
      datasets.push({ label: `Trial ${tn} (immediate)`, data: immData, borderColor: trialColors[tn], backgroundColor: trialColors[tn], tension: 0.3, order: 3, spanGaps: true, borderDash: [2,2] });
    });

    const ctx = $('#p3Chart').getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: { labels: currents.map(c2 => c2 + ' mA'), datasets },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: colors.text, filter: item => item.text !== 'Upper bound' && item.text !== 'Lower bound' } },
          title: { display: true, text: 'Resistance vs current (log scale), mean of trials', color: colors.text },
          tooltip: {
            callbacks: {
              afterLabel: (ctx2) => {
                const idx = ctx2.dataIndex;
                if (overlapFlags[idx] && (ctx2.dataset.label||'').includes('Mean')) {
                  return `± ${points[idx].unc?.toFixed(4)} Ω uncertainty — overlaps adjacent point`;
                }
                return '';
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: colors.muted }, grid: { color: colors.grid } },
          y: { type: 'logarithmic', ticks: { color: colors.muted }, grid: { color: colors.grid }, title: { display: true, text: 'Ohms', color: colors.muted } }
        }
      }
    });
    charts.push(chart);
  }

  function renderTrialChips() {
    const maxTrials = Math.max(...Object.values(c.phase3[activeWire]).map(arr => arr.length), 0);
    const chipsEl = $('#p3TrialChips');
    let html = `<button class="chip trial-chip ${trialState.mean?'active':''}" data-t="mean">Mean</button>`;
    for (let i=1;i<=Math.min(maxTrials,3);i++) html += `<button class="chip trial-chip ${trialState[i]?'active':''}" data-t="${i}">Trial ${i}</button>`;
    chipsEl.innerHTML = html;
    $$('#p3TrialChips .chip').forEach(chip => chip.addEventListener('click', () => {
      const t = chip.dataset.t === 'mean' ? 'mean' : parseInt(chip.dataset.t);
      trialState[t] = !trialState[t];
      chip.classList.toggle('active', trialState[t]);
      destroyCharts();
      drawP3();
    }));
  }

  renderTrialChips();
  drawP3();
  $$('#p3WireChips .chip').forEach(chip => chip.addEventListener('click', () => {
    $$('#p3WireChips .chip').forEach(c2 => c2.classList.remove('active'));
    chip.classList.add('active');
    activeWire = chip.dataset.wire;
    trialState = { mean: true, 1: false, 2: false, 3: false };
    renderTrialChips();
    destroyCharts();
    drawP3();
  }));
  $('#p3UncToggle').addEventListener('change', e => {
    showUncertaintyBand = e.target.checked;
    destroyCharts();
    drawP3();
  });
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
          <td>${r.compatible ? `<span class="${r.nTrials < 3 ? 'low-trial-count' : ''}">${r.nTrials}</span>` : '—'}</td>
          <td>${r.compatible ? fmtCV(r.cv) : '—'}</td>
          <td>${r.notSpecified ? '<span class="badge badge-partial">Connector not specified for this wire type</span>' : ''}</td>
        </tr>
      `).join('')}</tbody>
    </table>
  `;
}

function inRange(rangeStr, awg) {
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

  const A = DATA.connectors[cmpA], B = DATA.connectors[cmpB];
  const availableWires = DATA.wire_order.filter(w => {
    const hasA = A.phase3 && A.phase3[w];
    const hasB = B.phase3 && B.phase3[w];
    return hasA || hasB;
  });
  if (!cmpWire || !availableWires.includes(cmpWire)) cmpWire = availableWires[0] || DATA.wire_order[0];

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
      <div class="section-title">Detailed Comparison (resistance vs current)</div>
      <div class="chip-row" id="cmpWireChips">${availableWires.map(w => `<button class="chip ${w===cmpWire?'active':''}" data-wire="${w}">${DATA.wire_labels[w]}</button>`).join('')}</div>
      <div class="chart-container">
        <canvas id="cmpChart" height="100"></canvas>
        <div class="chart-footnote">
          <label class="uncertainty-toggle"><input type="checkbox" id="cmpUncToggle" ${showUncertaintyBand?'checked':''}> Show DMM measurement-uncertainty band</label>
          <span><span class="overlap-flag">*</span> = error bands overlap adjacent current step</span>
        </div>
      </div>
    </div>
  `;

  $('#cmpASel').addEventListener('change', e => { cmpA = e.target.value; renderCompare(); });
  $('#cmpBSel').addEventListener('change', e => { cmpB = e.target.value; renderCompare(); });
  $$('#cmpWireChips .chip').forEach(chip => chip.addEventListener('click', () => { cmpWire = chip.dataset.wire; renderCompare(); }));
  $('#cmpUncToggle').addEventListener('change', e => { showUncertaintyBand = e.target.checked; destroyCharts(); drawCmpChart(); });

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

    if (valA !== null && valB === null) { clsA = 'cmp-cell-green'; }
    else if (valB !== null && valA === null) { clsB = 'cmp-cell-green'; }
    else if (valA !== null && valB !== null) {
      let betterVal, betterCV, worseVal, betterIsA;
      if (valA <= valB) { betterVal = valA; betterCV = wdA.cv_pct || 0; worseVal = valB; betterIsA = true; }
      else { betterVal = valB; betterCV = wdB.cv_pct || 0; worseVal = valA; betterIsA = false; }
      const tolerance = (betterCV / 100) * betterVal;
      const isTie = Math.abs(worseVal - betterVal) <= Math.max(tolerance, 0);
      if (betterIsA) { clsA = 'cmp-cell-green'; clsB = isTie ? 'cmp-cell-green' : 'cmp-cell-red'; }
      else { clsB = 'cmp-cell-green'; clsA = isTie ? 'cmp-cell-green' : 'cmp-cell-red'; }
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

  function seriesStats(conn) {
    const byCurrent = conn.phase3?.[cmpWire];
    if (!byCurrent) return currents.map(() => ({mean:null,lower:null,upper:null}));
    return computeP3PointStats(byCurrent, currents);
  }
  const statsA = seriesStats(A), statsB = seriesStats(B);
  const flagsA = flagOverlaps(statsA), flagsB = flagOverlaps(statsB);

  const datasets = [];
  if (showUncertaintyBand) {
    datasets.push({ label:'A upper', data: statsA.map(p=>p.upper), borderWidth:0, pointRadius:0, fill:'+1', backgroundColor: hexToRgba(colors.primary,0.12), order:6, spanGaps:true });
    datasets.push({ label:'A lower', data: statsA.map(p=>p.lower), borderWidth:0, pointRadius:0, fill:false, order:6, spanGaps:true });
    datasets.push({ label:'B upper', data: statsB.map(p=>p.upper), borderWidth:0, pointRadius:0, fill:'+1', backgroundColor: hexToRgba(colors.warning,0.12), order:6, spanGaps:true });
    datasets.push({ label:'B lower', data: statsB.map(p=>p.lower), borderWidth:0, pointRadius:0, fill:false, order:6, spanGaps:true });
  }
  datasets.push({
    label: A.name, data: statsA.map(p=>p.mean), borderColor: colors.primary, backgroundColor: colors.primary,
    tension: 0.3, spanGaps: true, order:1,
    pointStyle: statsA.map((p,i)=> flagsA[i] ? 'star' : 'circle'),
    pointRadius: statsA.map((p,i)=> flagsA[i] ? 7 : 4),
  });
  datasets.push({
    label: B.name, data: statsB.map(p=>p.mean), borderColor: colors.warning, backgroundColor: colors.warning,
    tension: 0.3, spanGaps: true, order:2,
    pointStyle: statsB.map((p,i)=> flagsB[i] ? 'star' : 'circle'),
    pointRadius: statsB.map((p,i)=> flagsB[i] ? 7 : 4),
  });

  const ctx = $('#cmpChart').getContext('2d');
  const chart = new Chart(ctx, {
    type: 'line',
    data: { labels: currents.map(c => c + ' mA'), datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: colors.text, filter: item => !item.text.endsWith('upper') && !item.text.endsWith('lower') } },
        title: { display: true, text: `${DATA.wire_labels[cmpWire]} — immediate resistance vs current (log scale)`, color: colors.text }
      },
      scales: {
        x: { ticks: { color: colors.muted }, grid: { color: colors.grid } },
        y: { type: 'logarithmic', ticks: { color: colors.muted }, grid: { color: colors.grid }, title: { display: true, text: 'Ohms', color: colors.muted } }
      }
    }
  });
  charts.push(chart);
}

// ============================================================
// VIEW: Phase 1 Matrix (Heatmap)
// ============================================================
function renderHeatmap() {
  const main = $('#mainContent');
  main.innerHTML = `
    <div class="topbar">
      <div>
        <div class="page-title">Phase 1 Matrix</div>
        <div class="page-sub">All connectors × all wire types — mean resistance and CV%. Click a wire-type header to sort.</div>
      </div>
      <input type="text" class="search-input" placeholder="Filter connectors…" id="hmSearch">
    </div>
    <div class="heatmap-scroll"><div id="hmTableWrap"></div></div>
  `;
  $('#hmSearch').addEventListener('input', e => { renderHeatmapTable(e.target.value); });
  renderHeatmapTable('');
}

function renderHeatmapTable(filterText) {
  const wrap = $('#hmTableWrap');
  let connIds = Object.keys(DATA.connectors);
  if (filterText) connIds = connIds.filter(id => DATA.connectors[id].name.toLowerCase().includes(filterText.toLowerCase()));

  function getCell(cid, wire) {
    const awg = parseInt(wire.slice(0,2));
    const wd = DATA.connectors[cid].phase1.by_awg[awg]?.by_wire?.[wire];
    return wd && wd.status !== 'not_compatible' ? wd : null;
  }

  if (heatmapSort) {
    const { wire, dir } = heatmapSort;
    connIds.sort((a,b) => {
      const ca = getCell(a, wire), cb = getCell(b, wire);
      const va = ca ? ca.mean_ohm : null, vb = cb ? cb.mean_ohm : null;
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return dir === 'asc' ? va - vb : vb - va;
    });
  } else {
    connIds.sort((a,b) => DATA.connectors[a].name.localeCompare(DATA.connectors[b].name));
  }

  const headerCells = DATA.wire_order.map(w => {
    const sortIndicator = heatmapSort && heatmapSort.wire === w ? (heatmapSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="wire-col-header" data-wire="${w}">${DATA.wire_labels[w]}${sortIndicator}</th>`;
  }).join('');

  const bodyRows = connIds.map(cid => {
    const cells = DATA.wire_order.map(w => {
      const wd = getCell(cid, w);
      if (!wd) return `<td class="hm-cell hm-na">—</td>`;
      const awg = parseInt(w.slice(0,2));
      const color = gradientColor(1,1); // compatible cell always green-ish base; use CV for shading intensity instead
      return `<td class="hm-cell"><span class="hm-mean" style="color:${gradientColor(DATA.connectors[cid].phase1.by_awg[awg].n_wire_types_tested, DATA.connectors[cid].phase1.by_awg[awg].n_wire_types_possible)}">${fmtOhm(wd.mean_ohm)}</span><span class="hm-cv">${fmtCV(wd.cv_pct)}</span></td>`;
    }).join('');
    return `<tr><td class="connector-name-cell">${DATA.connectors[cid].name}</td>${cells}</tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="heatmap-table">
      <thead><tr><th class="connector-corner">Connector</th>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;

  $$('.wire-col-header').forEach(th => th.addEventListener('click', () => {
    const w = th.dataset.wire;
    if (heatmapSort && heatmapSort.wire === w) {
      heatmapSort = heatmapSort.dir === 'asc' ? { wire: w, dir: 'desc' } : null;
    } else {
      heatmapSort = { wire: w, dir: 'asc' };
    }
    renderHeatmapTable(filterText);
  }));
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
      <p>Voltage drop measured across six mechanical stages at a constant 100 mA test current, converted to resistance. Two charts separate connector performance from wire condition: the connector-resistance chart (preload → load applied → postload → reconnection) shows how the connector itself behaves under physical stress and reconnection; the wire-resistance chart (pre-load vs post-load) isolates whether the connector damaged the wire itself during testing.</p>

      <h3>Phase 3 — Current Sensitivity</h3>
      <p>Voltage drop swept across four current levels (1, 10, 100, 1000 mA), each with an immediate reading and a delayed "dwell" reading (30s for the first three steps, 60s for 1000 mA). Charts show the mean immediate/dwell curve by default; toggle individual trials on to see raw trial-level scatter, useful for spotting single-trial outliers hidden by averaging.</p>

      <h3>Measurement Uncertainty at Low Voltage Drop</h3>
      <p>The Keithley DMM6500 has a fixed-floor uncertainty term (roughly ±0.0035 mV) that dominates at very small voltage drops, regardless of range or test current. At 1 mA, most connectors produce sub-1 mV drops, so this floor term alone can represent 5–58% of the reading depending on how small the drop is. This means some of the apparent "current sensitivity" seen at 1 mA (and occasionally 10 mA) in Phase 3 charts is measurement noise rather than a real physical effect — at these currents, contact self-heating is nanowatts to low microwatts, far too small to meaningfully shift metal-contact resistance. Phase 3 charts show a shaded band reflecting this calculated uncertainty (toggle on/off), and mark a point with <span class="overlap-flag">*</span> when its uncertainty band overlaps an adjacent current step's band — meaning the two readings are not statistically distinguishable given instrument precision alone.</p>

      <h3>Compatibility Status &amp; Coverage Gradient</h3>
      <p>Each AWG line on a connector card shows a fraction (e.g. "3/5") of how many of the five wire types in that AWG have valid trial data, colored on a gradient from red (0 or 1 of 5 tested) through yellow (3 of 5) to green (5 of 5, fully compatible). A 0/5 line is marked "Not compatible" in a brighter red. The same gradient colors the mean-resistance figures in the Phase 1 Matrix view.</p>
      <p>Manufacturer-rated AWG ranges (from connector reference data) are informational only — if test data shows a connector actually works with a wire outside its rated range, the measured result is shown as-is, flagged with "Connector not specified for this wire type" rather than being hidden.</p>

      <h3>Variability (CV%)</h3>
      <p>Coefficient of variation — standard deviation divided by mean, as a percentage — describes how consistent repeated trials were for a given connector/wire combination. Lower is more consistent. When only one valid trial exists, this shows as "N/A (n=1)" since variability can't be computed from a single point. In the By Wire Type view, any row backed by fewer than 3 trials shows its trial count in maroon as a caution flag.</p>

      <h3>Compare Logic</h3>
      <p>In the baseline comparison table, the connector with lower mean resistance for a given wire type is always shown in green. The higher-resistance connector is also shown green (a "tie") only if its value falls within the better connector's own coefficient-of-variation band around the better connector's mean — otherwise it's shown in red. This avoids a noisy, high-variability connector falsely appearing tied with a much better performer. The Compare charts carry the same DMM uncertainty band and overlap flag as the By Connector Phase 3 charts.</p>

      <h3>Phase 1 Matrix</h3>
      <p>A single scrollable table showing every connector (rows) against every wire type (columns) for Phase 1 baseline data — mean resistance and CV% per cell, colored using the same coverage gradient. Click any wire-type column header to sort all connectors by that wire's mean resistance (ascending, then descending, then back to alphabetical).</p>

      <h3>Data Corrections Applied</h3>
      <p>Four Phase 3 readings flagged as likely decimal-point transcription errors (roughly 5–15x off from the paired immediate/dwell reading) were corrected after manual review: WASPP / 30 AWG Magnet Wire, Fluke Networks MT-8203-20 Intellitone / 14 AWG Silicone Stranded, 3M Scotchlok 951 / 14 AWG PVC Stranded, and Posi-Tap Yellow / 14 AWG PVC Stranded.</p>
    </div>
  `;
}
