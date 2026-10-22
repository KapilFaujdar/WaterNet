/* WaterNet application */
(function () {
  'use strict';

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };
  const STORAGE_KEY = 'waternet.project.v1';
  const PREFS_KEY = 'waternet.prefs.v1';
  const VERSION = '1.1.2';

  const PRESSURE_STOPS = [
    [-10, '#b71c1c'], [0, '#d32f2f'], [10, '#f57c00'], [20, '#fbc02d'],
    [30, '#7cb342'], [40, '#26a69a'], [50, '#1e88e5'], [60, '#5e35b1']
  ];
  const VELOCITY_STOPS = [
    [0, '#64b5f6'], [0.5, '#26a69a'], [1, '#9ccc65'], [1.5, '#ffca28'],
    [2.5, '#f4511e'], [4, '#b71c1c']
  ];
  const FLOW_STOPS = [
    [0, '#90caf9'], [0.25, '#26c6da'], [0.5, '#66bb6a'], [0.75, '#ffca28'], [1, '#e64a19']
  ];
  const HEADLOSS_STOPS = [
    [0, '#90caf9'], [0.25, '#4dd0e1'], [0.5, '#9ccc65'], [0.75, '#ffb300'], [1, '#e53935']
  ];
  const TYPE_META = {
    junction: { label: 'Junction', icon: 'i-junction', cls: 'junction' },
    reservoir: { label: 'Reservoir', icon: 'i-reservoir', cls: 'reservoir' },
    tank: { label: 'Tank', icon: 'i-tank', cls: 'tank' },
    pipe: { label: 'Pipe', icon: 'i-pipe', cls: 'pipe' },
    pump: { label: 'Pump', icon: 'i-pump', cls: 'pump' },
    valve: { label: 'Valve', icon: 'i-valve', cls: 'valve' }
  };
  const TOOL_HINTS = {
    junction: 'Click or tap the map to place a junction.',
    pipe: 'Click or tap the start node, then the end node.',
    pump: 'Click or tap the suction node, then the discharge node.',
    tank: 'Click or tap the map to place a tank.',
    reservoir: 'Click or tap the map to place a reservoir.',
    valve: 'Click or tap the upstream node, then the downstream node.'
  };
  const TOOL_KEYS = {
    j: 'junction',
    l: 'pipe',
    p: 'pump',
    t: 'tank',
    r: 'reservoir',
    v: 'valve',
    s: 'select'
  };
  const DATA_HEAD = '<div class="data-head" aria-hidden="true"><span></span><span>ID</span><span>Details</span><span>Value</span><span></span></div>';

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }
  function esc(v) {
    return String(v === undefined || v === null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmt(v, digits) {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
    const d = digits === undefined ? 1 : digits;
    return Number(v).toFixed(d);
  }
  function fmtInt(v) {
    if (!Number.isFinite(Number(v))) return '—';
    return Math.round(Number(v)).toLocaleString('en-US');
  }
  function slug(s) {
    return String(s || 'waternet').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'waternet';
  }
  function timeLabel(h) { return window.WaterNetInp.timeLabel(h); }
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(function (c) { return c + c; }).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mixColor(a, b, t) {
    const ca = hexToRgb(a), cb = hexToRgb(b);
    const r = Math.round(lerp(ca[0], cb[0], t));
    const g = Math.round(lerp(ca[1], cb[1], t));
    const bl = Math.round(lerp(ca[2], cb[2], t));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }
  function colorAt(stops, value) {
    if (!Number.isFinite(value)) return '#90a4ae';
    if (value <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (value <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i];
        const t = (value - a[0]) / Math.max(1e-9, b[0] - a[0]);
        return mixColor(a[1], b[1], clamp(t, 0, 1));
      }
    }
    return stops[stops.length - 1][1];
  }
  function pressureColor(p) {
    if (p === null || p === undefined) return '#90a4ae';
    return colorAt(PRESSURE_STOPS, p);
  }
  function gradientCss(stops, min, max) {
    const parts = stops.map(function (s) {
      const pct = clamp((s[0] - min) / Math.max(1e-9, max - min) * 100, 0, 100);
      return s[1] + ' ' + pct.toFixed(1) + '%';
    });
    return 'linear-gradient(90deg,' + parts.join(',') + ')';
  }

  function loadPrefs() {
    let prefs = { theme: 'light', labels: true };
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) prefs = Object.assign(prefs, JSON.parse(raw));
      else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) prefs.theme = 'dark';
    } catch (e) { /* ignore */ }
    return prefs;
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch (e) { /* ignore */ }
  }

  const state = {
    project: null,
    results: null,
    resultIndex: 0,
    view: 'map',
    tool: 'select',
    selection: null,
    linkStart: null,
    pointerWorld: null,
    hoverNode: null,
    camera: { x: 0, y: 0, scale: 0.4 },
    cameraReady: false,
    mapSize: { w: 0, h: 0, dpr: 1 },
    prefs: loadPrefs(),
    history: [],
    future: [],
    stale: false,
    busy: false,
    playing: false,
    playTimer: null,
    dataKind: 'nodes',
    search: '',
    chartKind: 'node',
    chartVerb: 'flow',
    chartNode: null,
    chartLink: null,
    sheetOpen: false,
    installPrompt: null,
    lastSaved: null,
    toastTimer: null,
    ghostClickUntil: 0
  };

  let dom = {};
  let ctx = null;
  let pointers = new Map();
  let gesture = null;
  let suppressTap = false;

  /* ================= persistence ================= */

  function loadProject() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.links)) return null;
      return window.WaterNetInp.normalizeProject(parsed);
    } catch (e) {
      return null;
    }
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
      state.lastSaved = new Date();
    } catch (e) {
      toast('Could not save locally. Storage may be full.');
    }
  }
  function pushHistory() {
    state.history.push(JSON.stringify(state.project));
    if (state.history.length > 40) state.history.shift();
    state.future = [];
    updateUndoButtons();
  }
  function updateUndoButtons() {
    if (dom.btnUndo) dom.btnUndo.disabled = state.history.length === 0;
    if (dom.btnRedo) dom.btnRedo.disabled = state.future.length === 0;
  }
  function undo() {
    if (!state.history.length) return;
    closeSheet();
    state.future.push(JSON.stringify(state.project));
    state.project = window.WaterNetInp.normalizeProject(JSON.parse(state.history.pop()));
    state.selection = null;
    state.linkStart = null;
    state.stale = !!state.results;
    persist();
    refreshAfterEdit();
    toast('Undone');
  }
  function redo() {
    if (!state.future.length) return;
    closeSheet();
    state.history.push(JSON.stringify(state.project));
    state.project = window.WaterNetInp.normalizeProject(JSON.parse(state.future.pop()));
    state.selection = null;
    state.linkStart = null;
    state.stale = !!state.results;
    persist();
    refreshAfterEdit();
    toast('Redone');
  }

  function refreshAfterEdit(opts) {
    opts = opts || {};
    state.project = window.WaterNetInp.normalizeProject(state.project);
    if (state.selection) {
      const exists = state.selection.kind === 'node'
        ? state.project.nodes.some(function (n) { return n.id === state.selection.id; })
        : state.project.links.some(function (l) { return l.id === state.selection.id; });
      if (!exists) state.selection = null;
    }
    if (opts.fit) fitCamera();
    persist();
    renderBrand();
    renderMapChrome();
    renderMap();
    updateUndoButtons();
    if (state.view === 'results') renderResults();
    if (state.view === 'data') renderData();
    if (state.view === 'more') renderMore();
  }

  function mutate(fn, opts) {
    pushHistory();
    fn();
    if (state.results) state.stale = true;
    refreshAfterEdit(opts);
  }

  /* ================= init ================= */

  function init() {
    applyTheme();
    dom = {
      app: $('#app'),
      brandSub: $('#brandSub'),
      navVersion: $('#navVersion'),
      btnUndo: $('#btnUndo'),
      btnRedo: $('#btnRedo'),
      btnMenu: $('#btnMenu'),
      main: $('#main'),
      canvas: $('#mapCanvas'),
      mapShell: $('#mapShell'),
      mapStatus: $('#mapStatus'),
      mapStatusText: $('#mapStatusText'),
      layerBtn: $('#layerBtn'),
      layerLabel: $('#layerLabel'),
      mapEmpty: $('#mapEmpty'),
      emptyAddNode: $('#emptyAddNode'),
      emptySamples: $('#emptySamples'),
      mapBottom: $('#mapBottom'),
      mapLegend: $('#mapLegend'),
      timebar: $('#timebar'),
      timebarLabel: $('#timebarLabel'),
      timebarMeta: $('#timebarMeta'),
      timeSlider: $('#timeSlider'),
      playBtn: $('#playBtn'),
      toolDock: $('#toolDock'),
      resultsBody: $('#resultsBody'),
      resultsSub: $('#resultsSub'),
      simBadge: $('#simBadge'),
      dataStats: $('#dataStats'),
      dataList: $('#dataList'),
      dataSearch: $('#dataSearch'),
      dataSeg: $('#dataSeg'),
      dataAdd: $('#dataAdd'),
      morePage: $('#morePage'),
      sheetLayer: $('#sheetLayer'),
      sheet: $('#sheet'),
      sheetContent: $('#sheetContent'),
      sheetScrim: $('#sheetScrim'),
      toast: $('#toast'),
      fileInput: $('#fileInput'),
      viewMap: $('#view-map'),
      viewResults: $('#view-results'),
      viewData: $('#view-data'),
      viewMore: $('#view-more')
    };
    ctx = dom.canvas.getContext('2d');

    const stored = loadProject();
    if (stored) {
      state.project = stored;
    } else {
      state.project = window.WaterNetInp.normalizeProject(window.WaterNetSamples.get('blank'));
    }

    bindStaticEvents();
    resizeCanvas();
    if (!state.cameraReady) fitCamera();
    renderAll();
    requestAnimationFrame(function () {
      resizeCanvas();
      if (!state.cameraReady) fitCamera();
      renderMap();
    });
    registerServiceWorker();

    const initialView = new URLSearchParams(location.search).get('view');
    if (initialView && ['map', 'results', 'data', 'more'].indexOf(initialView) !== -1) {
      switchView(initialView);
    }
  }

  function renderAll() {
    renderBrand();
    renderMapChrome();
    renderMap();
    renderData();
    renderMore();
    updateUndoButtons();
  }

  function renderBrand() {
    if (!dom.brandSub) return;
    if (dom.navVersion) dom.navVersion.textContent = 'v' + VERSION;
    const n = state.project ? state.project.nodes.length : 0;
    const l = state.project ? state.project.links.length : 0;
    dom.brandSub.textContent = n || l
      ? state.project.name + ' · ' + n + ' node' + (n === 1 ? '' : 's') + ' · ' + l + ' link' + (l === 1 ? '' : 's')
      : 'Water distribution modeling';
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.prefs.theme === 'dark' ? 'dark' : 'light');
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', state.prefs.theme === 'dark' ? '#031c26' : '#075a72');
  }

  /* ================= navigation ================= */

  function switchView(view) {
    if (state.view === view) return;
    stopPlay();
    closeSheet();
    state.view = view;
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + view); });
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === view); });
    if (view === 'map') {
      requestAnimationFrame(function () {
        resizeCanvas();
        renderMap();
      });
    } else if (view === 'results') {
      renderResults();
    } else if (view === 'data') {
      renderData();
    } else if (view === 'more') {
      renderMore();
    }
  }

  /* ================= map camera & drawing ================= */

  function resizeCanvas() {
    if (!dom.canvas || !dom.mapShell) return;
    const rect = dom.mapShell.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    state.mapSize = { w: w, h: h, dpr: dpr };
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (dom.canvas.width !== pw || dom.canvas.height !== ph) {
      dom.canvas.width = pw;
      dom.canvas.height = ph;
    }
    if (!state.cameraReady && rect.width > 0) fitCamera();
    renderMap();
  }

  function worldToScreen(x, y) {
    const s = state.mapSize, c = state.camera;
    return {
      x: s.w / 2 + (x - c.x) * c.scale,
      y: s.h / 2 - (y - c.y) * c.scale
    };
  }
  function screenToWorld(x, y) {
    const s = state.mapSize, c = state.camera;
    return {
      x: c.x + (x - s.w / 2) / c.scale,
      y: c.y - (y - s.h / 2) / c.scale
    };
  }

  function fitCamera() {
    const s = state.mapSize;
    if (!s.w || !s.h) return;
    const nodes = state.project.nodes;
    if (!nodes.length) {
      state.camera = { x: 0, y: 0, scale: 0.3 };
      state.cameraReady = true;
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    });
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const wide = window.matchMedia('(min-width: 1000px)').matches;
    const top = wide ? 84 : 66, bottom = wide ? 96 : 140;
    const padL = wide ? 96 : 34, padR = 34;
    const availW = Math.max(30, s.w - padL - padR);
    const availH = Math.max(30, s.h - top - bottom);
    let scale = Math.min(availW / bw, availH / bh);
    if (bw < 40 && bh < 40) scale = Math.min(1.4, scale);
    scale = clamp(scale, 0.035, 8);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const targetX = padL + availW / 2;
    const targetY = top + availH / 2;
    state.camera = {
      x: midX - (targetX - s.w / 2) / scale,
      y: midY - (s.h / 2 - targetY) / scale,
      scale: scale
    };
    state.cameraReady = true;
  }

  function zoomAt(px, py, factor) {
    const before = screenToWorld(px, py);
    state.camera.scale = clamp(state.camera.scale * factor, 0.025, 20);
    const s = state.camera.scale;
    state.camera.x = before.x - (px - state.mapSize.w / 2) / s;
    state.camera.y = before.y + (py - state.mapSize.h / 2) / s;
    renderMap();
  }

  function gridStep() {
    const target = 82 / state.camera.scale;
    const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, target))));
    const m = target / pow;
    let step = pow;
    if (m >= 7) step = pow * 10;
    else if (m >= 3) step = pow * 5;
    else if (m >= 1.5) step = pow * 2;
    return Math.max(1e-6, step);
  }

  function drawGrid(w, h, colors) {
    const scale = state.camera.scale;
    const step = gridStep();
    const left = state.camera.x - (w / 2) / scale;
    const right = state.camera.x + (w / 2) / scale;
    const top = state.camera.y + (h / 2) / scale;
    const bottom = state.camera.y - (h / 2) / scale;
    ctx.lineWidth = 1;
    const startX = Math.floor(left / step) * step;
    const startY = Math.floor(bottom / step) * step;
    if ((right - left) / step < 200) {
      for (let x = startX; x <= right + step; x += step) {
        const sx = Math.round(worldToScreen(x, 0).x) + .5;
        const major = Math.abs(Math.round(x / step) % 5) === 0;
        ctx.strokeStyle = major ? colors.gridMajor : colors.grid;
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
      }
      for (let y = startY; y <= top + step; y += step) {
        const sy = Math.round(worldToScreen(0, y).y) + .5;
        const major = Math.abs(Math.round(y / step) % 5) === 0;
        ctx.strokeStyle = major ? colors.gridMajor : colors.grid;
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
      }
    }
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function currentSnapshot() {
    if (!state.results || !state.results.snapshots.length) return null;
    return state.results.snapshots[clamp(state.resultIndex, 0, state.results.snapshots.length - 1)] || null;
  }
  function getNode(id) { return state.project.nodes.find(function (n) { return n.id === id; }) || null; }
  function getLink(id) { return state.project.links.find(function (l) { return l.id === id; }) || null; }

  function linkMetricConfig() {
    const res = state.results;
    if (!res || !res.snapshots.length) return null;
    let maxFlow = 0, maxVel = 0, maxLoss = 0;
    res.snapshots.forEach(function (snap) {
      Object.keys(snap.links).forEach(function (id) {
        const lr = snap.links[id];
        maxFlow = Math.max(maxFlow, Math.abs(lr.flowLps));
        maxVel = Math.max(maxVel, lr.velocity || 0);
        maxLoss = Math.max(maxLoss, lr.headloss || 0);
      });
    });
    if (state.layer === 'flow') {
      maxFlow = Math.max(1, maxFlow);
      return {
        key: 'flow', label: 'Flow', unit: 'L/s', min: 0, max: maxFlow,
        stops: FLOW_STOPS.map(function (s) { return [s[0] * maxFlow, s[1]]; }),
        get: function (lr) { return Math.abs(lr.flowLps); },
        labels: ['0', fmt(maxFlow / 2, 0), fmt(maxFlow, 0)]
      };
    }
    if (state.layer === 'headloss') {
      maxLoss = Math.max(0.5, maxLoss);
      return {
        key: 'headloss', label: 'Headloss', unit: 'm', min: 0, max: maxLoss,
        stops: HEADLOSS_STOPS.map(function (s) { return [s[0] * maxLoss, s[1]]; }),
        get: function (lr) { return lr.headloss || 0; },
        labels: ['0', fmt(maxLoss / 2, 1), fmt(maxLoss, 1)]
      };
    }
    return {
      key: 'velocity', label: 'Velocity', unit: 'm/s', min: 0, max: Math.max(1, maxVel),
      stops: VELOCITY_STOPS,
      get: function (lr) { return lr.velocity || 0; },
      labels: ['0', '1', '2', '3+']
    };
  }
  // Default link colouring.
  state.layer = 'flow';

  function renderMap() {
    if (!ctx || !state.mapSize.w) return;
    const w = state.mapSize.w, h = state.mapSize.h, dpr = state.mapSize.dpr;
    const css = getComputedStyle(document.documentElement);
    const colors = {
      bg: css.getPropertyValue('--map-bg').trim() || '#e7f0f4',
      grid: css.getPropertyValue('--map-grid').trim() || 'rgba(0,0,0,.06)',
      gridMajor: css.getPropertyValue('--map-grid-major').trim() || 'rgba(0,0,0,.1)',
      text: css.getPropertyValue('--text').trim() || '#102a35',
      muted: css.getPropertyValue('--muted').trim() || '#738d99',
      surface: css.getPropertyValue('--surface').trim() || '#fff',
      primary: css.getPropertyValue('--primary').trim() || '#087a96',
      line: css.getPropertyValue('--line').trim() || '#dbe8ee'
    };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);
    drawGrid(w, h, colors);

    const snap = currentSnapshot();
    const metric = linkMetricConfig();
    const project = state.project;
    const fontFamily = css.getPropertyValue('--font').trim() || 'sans-serif';
    const selected = state.selection;

    // Links first.
    project.links.forEach(function (l) {
      const a = getNode(l.from), b = getNode(l.to);
      if (!a || !b) return;
      const pa = worldToScreen(a.x, a.y), pb = worldToScreen(b.x, b.y);
      if ((pa.x < -80 && pb.x < -80) || (pa.x > w + 80 && pb.x > w + 80) ||
          (pa.y < -80 && pb.y < -80) || (pa.y > h + 80 && pb.y > h + 80)) return;
      const lr = snap && snap.links[l.id] ? snap.links[l.id] : null;
      const closed = (l.status || 'OPEN') === 'CLOSED';
      const isSel = selected && selected.kind === 'link' && selected.id === l.id;
      let color = closed ? '#9fb3bc' : '#7f9caa';
      if (lr && metric && !closed) color = colorAt(metric.stops, metric.get(lr));
      if (isSel) color = colors.primary;
      const width = l.type === 'pipe' ? clamp(1.8 + num(l.diameter, 200) / 150, 2, 8) : 3.2;

      if (isSel) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0,176,199,.24)';
        ctx.lineWidth = width + 10;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = isSel ? width + 1.4 : width;
      ctx.lineCap = 'round';
      if (closed) ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      ctx.restore();

      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const len = Math.hypot(dx, dy);
      if (len > 26 && l.type === 'pipe') {
        let dir = 1;
        if (lr && lr.flowLps < 0) dir = -1;
        let ux = dx / len * dir, uy = dy / len * dir;
        const cx = pa.x + dx * 0.58, cy = pa.y + dy * 0.58;
        const size = clamp(width * 1.6, 4.5, 7.5);
        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(cx + ux * size, cy + uy * size);
        ctx.lineTo(cx - ux * size * 0.75 + uy * size * 0.62, cy - uy * size * 0.75 - ux * size * 0.62);
        ctx.lineTo(cx - ux * size * 0.75 - uy * size * 0.62, cy - uy * size * 0.75 + ux * size * 0.62);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      if (l.type === 'pump') {
        let ux = dx, uy = dy;
        if (len > 0.01) { ux /= len; uy /= len; }
        if (lr && lr.flowLps < 0) { ux = -ux; uy = -uy; }
        ctx.save();
        ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2);
        ctx.fillStyle = colors.surface; ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mx + ux * 5.4, my + uy * 5.4);
        ctx.lineTo(mx - ux * 3.4 + uy * 4.4, my - uy * 3.4 - ux * 4.4);
        ctx.lineTo(mx - ux * 3.4 - uy * 4.4, my - uy * 3.4 + ux * 4.4);
        ctx.closePath();
        ctx.fillStyle = color; ctx.fill();
        ctx.restore();
      } else if (l.type === 'valve') {
        ctx.save();
        ctx.fillStyle = colors.surface;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(mx - 8, my - 7); ctx.lineTo(mx, my); ctx.lineTo(mx - 8, my + 7); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mx + 8, my - 7); ctx.lineTo(mx, my); ctx.lineTo(mx + 8, my + 7); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    });

    if (state.linkStart) {
      const start = getNode(state.linkStart);
      if (start) {
        const p = worldToScreen(start.x, start.y);
        const target = state.hoverNode && state.hoverNode !== state.linkStart ? getNode(state.hoverNode) : null;
        let q = state.pointerWorld ? worldToScreen(state.pointerWorld.x, state.pointerWorld.y) : p;
        if (target) q = worldToScreen(target.x, target.y);
        ctx.save();
        ctx.strokeStyle = colors.primary;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        ctx.restore();
      }
    }

    // Nodes.
    project.nodes.forEach(function (n) {
      const p = worldToScreen(n.x, n.y);
      if (p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) return;
      const isSel = selected && selected.kind === 'node' && selected.id === n.id;
      const nr = snap && snap.nodes[n.id] ? snap.nodes[n.id] : null;
      const disconnected = nr && nr.connected === false;
      let fill = '#4f8ea5';
      if (nr && n.type === 'junction') fill = pressureColor(nr.pressure);
      if (disconnected) fill = '#9aaeb7';

      if (n.type === 'junction') {
        const r = isSel ? 8.5 : 6.5;
        ctx.save();
        if (isSel) {
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(0,176,199,.22)'; ctx.lineWidth = 7; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = fill; ctx.fill();
        ctx.lineWidth = 2.2; ctx.strokeStyle = colors.surface; ctx.stroke();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.stroke();
        if (disconnected) {
          ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
          ctx.strokeStyle = '#9aaeb7'; ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.restore();
      } else if (n.type === 'reservoir') {
        ctx.save();
        if (isSel) {
          roundRect(p.x - 13, p.y - 13, 26, 26, 9);
          ctx.strokeStyle = 'rgba(0,176,199,.3)'; ctx.lineWidth = 6; ctx.stroke();
        }
        roundRect(p.x - 8.5, p.y - 8.5, 17, 17, 4.5);
        ctx.fillStyle = '#2f6dc4'; ctx.fill();
        ctx.strokeStyle = colors.surface; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(p.x - 4.5, p.y + 1.5); ctx.quadraticCurveTo(p.x - 2, p.y - 1, p.x + 0.5, p.y + 1.5); ctx.quadraticCurveTo(p.x + 3, p.y + 4, p.x + 5, p.y + 1.5); ctx.stroke();
        ctx.restore();
      } else if (n.type === 'tank') {
        const bw2 = 18, bh2 = 20;
        const x0 = p.x - bw2 / 2, y0 = p.y - bh2 / 2;
        const lvl = nr && nr.level !== null && nr.level !== undefined ? nr.level : num(n.level, 0);
        const minL = num(n.minLevel, 0), maxL = Math.max(minL + 0.01, num(n.maxLevel, 10));
        const ratio = clamp((lvl - minL) / (maxL - minL), 0, 1);
        ctx.save();
        if (isSel) {
          roundRect(x0 - 5, y0 - 5, bw2 + 10, bh2 + 10, 8);
          ctx.strokeStyle = 'rgba(0,176,199,.3)'; ctx.lineWidth = 6; ctx.stroke();
        }
        roundRect(x0, y0, bw2, bh2, 4);
        ctx.fillStyle = colors.surface; ctx.fill();
        ctx.save(); ctx.clip();
        const waterH = Math.max(0, (bh2 - 5) * ratio);
        ctx.fillStyle = 'rgba(47,157,196,.75)';
        ctx.fillRect(x0, y0 + bh2 - waterH - 2, bw2, waterH + 2);
        ctx.restore();
        roundRect(x0, y0, bw2, bh2, 4);
        ctx.strokeStyle = '#247fa8'; ctx.lineWidth = 1.8; ctx.stroke();
        ctx.strokeStyle = 'rgba(36,127,168,.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(p.x, y0 + 2, bw2 / 2 - 1.5, 3, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      if (state.prefs.labels) {
        ctx.save();
        ctx.font = '600 10.5px ' + fontFamily;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = colors.bg;
        ctx.lineWidth = 3.5;
        const labelY = p.y + (n.type === 'junction' ? 10 : 13);
        ctx.strokeText(n.id, p.x, labelY);
        ctx.fillStyle = disconnected ? colors.muted : colors.text;
        ctx.fillText(n.id, p.x, labelY);
        ctx.restore();
      }
    });

    // Selected link label.
    if (selected && selected.kind === 'link') {
      const l = getLink(selected.id);
      if (l) {
        const a = getNode(l.from), b = getNode(l.to);
        if (a && b) {
          const pa = worldToScreen(a.x, a.y), pb = worldToScreen(b.x, b.y);
          const lr = snap && snap.links[l.id];
          let text = l.id;
          if (lr) {
            text += '  ·  ' + fmt(lr.flowLps, 1) + ' L/s';
          }
          ctx.save();
          ctx.font = '700 10px ' + fontFamily;
          const tw = ctx.measureText(text).width;
          const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
          let lx = mx - tw / 2 - 8, ly = my - 26;
          roundRect(lx, ly, tw + 16, 21, 7);
          ctx.fillStyle = colors.surface; ctx.fill();
          ctx.strokeStyle = colors.primary; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = colors.primary;
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText(text, lx + 8, ly + 11);
          ctx.restore();
        }
      }
    }
  }

  function renderMapChrome() {
    if (!dom.mapStatusText) return;
    const snap = currentSnapshot();
    const hasNodes = state.project.nodes.length > 0;
    const empty = !hasNodes;
    dom.mapEmpty.hidden = !empty;
    dom.mapStatus.classList.toggle('live', !!snap && !state.stale);
    dom.mapStatus.classList.toggle('stale', !!state.stale);
    if (empty) {
      dom.mapStatusText.textContent = 'Empty canvas';
    } else if (state.stale) {
      dom.mapStatusText.textContent = 'Results out of date';
    } else if (snap) {
      const minP = snap.summary.minPressure;
      dom.mapStatusText.textContent = timeLabel(snap.time) + ' · min P ' + (minP ? fmt(minP.value, 1) : '—') + ' m';
    } else {
      dom.mapStatusText.textContent = 'Design view · ' + state.project.nodes.length + ' node' + (state.project.nodes.length === 1 ? '' : 's');
    }
    dom.layerBtn.disabled = !snap;
    dom.layerBtn.style.opacity = snap ? '' : '.5';
    if (dom.layerLabel) {
      dom.layerLabel.textContent = state.layer === 'flow' ? 'Flow' : state.layer === 'headloss' ? 'Headloss' : 'Velocity';
    }
    dom.timebar.hidden = !snap;
    dom.mapLegend.hidden = !snap;
    if (snap) renderTimebar();
    renderLegend();
  }

  function renderTimebar() {
    const res = state.results;
    if (!res) return;
    const max = res.snapshots.length - 1;
    const snap = currentSnapshot();
    if (!snap) return;
    if (dom.timebarLabel) dom.timebarLabel.textContent = 't = ' + timeLabel(snap.time);
    if (dom.timebarMeta) {
      dom.timebarMeta.textContent = snap.summary.totalDemandLps.toFixed(0) + ' L/s demand · ' + res.snapshots.length + ' steps';
    }
    if (dom.timeSlider) {
      dom.timeSlider.max = String(max);
      if (document.activeElement !== dom.timeSlider) dom.timeSlider.value = String(state.resultIndex);
    }
    updatePlayButtons();
  }

  function renderLegend() {
    if (!dom.mapLegend) return;
    const snap = currentSnapshot();
    if (!snap) { dom.mapLegend.hidden = true; return; }
    const metric = linkMetricConfig();
    const pressureLabels = ['0', '20', '40+'];
    let html = '<div class="legend-item"><div class="legend-title">Pressure <span>m</span></div>' +
      '<div class="legend-bar" style="background:' + gradientCss(PRESSURE_STOPS, 0, 60) + '"></div>' +
      '<div class="legend-scale">' + pressureLabels.map(function (l) { return '<span>' + l + '</span>'; }).join('') + '</div></div>';
    if (metric) {
      html += '<div class="legend-item"><div class="legend-title">' + metric.label + ' <span>' + metric.unit + '</span></div>' +
        '<div class="legend-bar" style="background:' + gradientCss(metric.stops, metric.min, metric.max) + '"></div>' +
        '<div class="legend-scale">' + metric.labels.map(function (l) { return '<span>' + l + '</span>'; }).join('') + '</div></div>';
    }
    dom.mapLegend.innerHTML = html;
    dom.mapLegend.hidden = false;
  }

  function updatePlayButtons() {
    const icon = state.playing ? 'i-pause' : 'i-play';
    $$('#playBtn use, #resPlay use').forEach(function (u) {
      u.setAttribute('href', '#' + icon);
    });
    if (dom.playBtn) dom.playBtn.setAttribute('aria-label', state.playing ? 'Pause timeline' : 'Play timeline');
  }

  /* ================= map interaction ================= */

  function pick(sx, sy) {
    let best = null, bestDist = 22;
    for (let i = state.project.nodes.length - 1; i >= 0; i--) {
      const n = state.project.nodes[i];
      const p = worldToScreen(n.x, n.y);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bestDist) { bestDist = d; best = { kind: 'node', id: n.id }; }
    }
    if (best) return best;
    let bestLink = null, linkDist = 10;
    state.project.links.forEach(function (l) {
      const a = getNode(l.from), b = getNode(l.to);
      if (!a || !b) return;
      const pa = worldToScreen(a.x, a.y), pb = worldToScreen(b.x, b.y);
      const d = distToSegment(sx, sy, pa.x, pa.y, pb.x, pb.y);
      const limit = l.type === 'pipe' ? 9 : 14;
      if (d < limit && d < linkDist) { linkDist = d; bestLink = { kind: 'link', id: l.id }; }
    });
    return bestLink;
  }
  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.0001) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
  }

  function selectItem(kind, id, openSheet) {
    state.selection = kind && id ? { kind: kind, id: id } : null;
    state.linkStart = null;
    state.hoverNode = null;
    renderMap();
    if (openSheet && state.selection) {
      if (kind === 'node') openNodeEditor(id);
      else openLinkEditor(id);
    }
  }

  function handleTap(sx, sy) {
    const hit = pick(sx, sy);
    const world = screenToWorld(sx, sy);
    if (state.tool === 'select') {
      if (hit) selectItem(hit.kind, hit.id, true);
      else { selectItem(null, null, false); closeSheet(); }
      return;
    }
    if (state.tool === 'junction' || state.tool === 'tank' || state.tool === 'reservoir') {
      if (hit && hit.kind === 'node') {
        toast('Choose an empty spot for a new ' + TYPE_META[state.tool].label.toLowerCase() + '.');
        return;
      }
      addNode(state.tool, world.x, world.y);
      return;
    }
    if (state.tool === 'pipe' || state.tool === 'pump' || state.tool === 'valve') {
      if (!hit || hit.kind !== 'node') {
        toast('Select an existing node to connect.');
        return;
      }
      if (!state.linkStart) {
        state.linkStart = hit.id;
        state.pointerWorld = world;
        renderMap();
        toast('Now select the ' + (state.tool === 'pump' ? 'discharge' : 'end') + ' node.');
      } else if (state.linkStart === hit.id) {
        state.linkStart = null;
        state.hoverNode = null;
        renderMap();
        toast('Connection cancelled.');
      } else {
        const from = state.linkStart;
        state.linkStart = null;
        state.hoverNode = null;
        addLink(state.tool, from, hit.id);
      }
    }
  }

  function addNode(type, x, y) {
    const prefix = type === 'junction' ? 'J' : type === 'tank' ? 'T' : 'R';
    let i = 1;
    while (state.project.nodes.some(function (n) { return n.id === prefix + i; })) i++;
    const id = prefix + i;
    const defaultPattern = Object.keys(state.project.patterns)[0] || '';
    const node = {
      id: id,
      type: type,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10
    };
    if (type === 'junction') {
      node.elevation = 0; node.demand = 0; node.pattern = defaultPattern;
    } else if (type === 'tank') {
      node.elevation = 0; node.level = 5; node.minLevel = 0; node.maxLevel = 10; node.diameter = 10;
    } else {
      node.elevation = 0; node.head = 50;
    }
    mutate(function () {
      state.project.nodes.push(node);
    });
    setTool('select');
    selectItem('node', id, true);
  }

  function addLink(type, from, to) {
    const prefix = type === 'pipe' ? 'P' : type === 'pump' ? 'PU' : 'V';
    let i = 1;
    while (state.project.links.some(function (l) { return l.id === prefix + i; })) i++;
    const id = prefix + i;
    const a = getNode(from), b = getNode(to);
    const dist = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 100;
    const link = { id: id, type: type, from: from, to: to, status: 'OPEN' };
    if (type === 'pipe') {
      link.length = Math.max(1, Math.round(dist));
      link.diameter = 200; link.roughness = 120; link.minorLoss = 0;
    } else if (type === 'pump') {
      link.shutoffHead = 40; link.maxFlow = 30; link.speed = 1;
    } else {
      link.diameter = 200; link.setting = 5; link.valveType = 'TCV';
    }
    mutate(function () {
      state.project.links.push(link);
    });
    setTool('select');
    selectItem('link', id, true);
  }

  function setTool(tool) {
    state.tool = tool;
    state.linkStart = null;
    state.hoverNode = null;
    if (tool !== 'select') state.selection = null;
    $$('.tool', dom.toolDock).forEach(function (b) {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    dom.canvas.style.cursor = tool === 'select' ? 'grab' : 'crosshair';
    renderMap();
    if (TOOL_HINTS[tool]) toast(TOOL_HINTS[tool]);
  }

  function bindMapPointerEvents() {
    const canvas = dom.canvas;
    canvas.addEventListener('pointerdown', function (e) {
      if (state.sheetOpen) return;
      try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or stale pointer */ }
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      pointers.set(e.pointerId, { x: x, y: y, sx: x, sy: y, t: Date.now() });
      if (pointers.size === 2) {
        if (gesture && gesture.kind === 'node' && gesture.moved) finishNodeDrag();
        const pts = Array.from(pointers.values());
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        gesture = {
          kind: 'pinch',
          dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
          mid: mid,
          world: screenToWorld(mid.x, mid.y),
          cam: { x: state.camera.x, y: state.camera.y, scale: state.camera.scale }
        };
        suppressTap = true;
        return;
      }
      if (pointers.size > 2) return;
      suppressTap = false;
      const hit = pick(x, y);
      if (state.tool === 'select' && hit && hit.kind === 'node') {
        const n = getNode(hit.id);
        if (n) {
          gesture = {
            kind: 'node', id: hit.id, startWorld: screenToWorld(x, y),
            origX: n.x, origY: n.y, moved: false, historyPushed: false
          };
          selectItem('node', hit.id, false);
          canvas.style.cursor = 'grabbing';
          return;
        }
      }
      if (state.tool === 'select' && hit && hit.kind === 'link') {
        selectItem('link', hit.id, false);
      }
      gesture = { kind: 'pan', sx: x, sy: y, cam: { x: state.camera.x, y: state.camera.y, scale: state.camera.scale }, moved: false };
      canvas.style.cursor = 'grabbing';
    });

    canvas.addEventListener('pointermove', function (e) {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const p = pointers.get(e.pointerId);
      if (p) { p.x = x; p.y = y; }
      if (pointers.size >= 2 && gesture && gesture.kind === 'pinch') {
        const pts = Array.from(pointers.values());
        if (pts.length >= 2) {
          const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
          const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          let scale = gesture.cam.scale * (dist / gesture.dist);
          scale = clamp(scale, 0.025, 20);
          state.camera.scale = scale;
          state.camera.x = gesture.world.x - (mid.x - state.mapSize.w / 2) / scale;
          state.camera.y = gesture.world.y + (mid.y - state.mapSize.h / 2) / scale;
          renderMap();
        }
        return;
      }
      if (!gesture) {
        if (state.tool === 'select' && e.pointerType !== 'touch') {
          canvas.style.cursor = pick(x, y) ? 'pointer' : 'grab';
        }
        if (state.tool === 'pipe' || state.tool === 'pump' || state.tool === 'valve') {
          state.pointerWorld = screenToWorld(x, y);
          const hit = pick(x, y);
          state.hoverNode = hit && hit.kind === 'node' ? hit.id : null;
          if (state.linkStart) renderMap();
        }
        return;
      }
      if (gesture.kind === 'pan') {
        const dx = x - gesture.sx, dy = y - gesture.sy;
        if (Math.hypot(dx, dy) > 4) gesture.moved = true;
        if (gesture.moved) {
          state.camera.x = gesture.cam.x - dx / state.camera.scale;
          state.camera.y = gesture.cam.y + dy / state.camera.scale;
          renderMap();
        }
      } else if (gesture.kind === 'node') {
        const n = getNode(gesture.id);
        if (!n) return;
        const world = screenToWorld(x, y);
        const dx = world.x - gesture.startWorld.x;
        const dy = world.y - gesture.startWorld.y;
        if (!gesture.moved && Math.hypot(dx, dy) * state.camera.scale > 4) {
          gesture.moved = true;
          if (!gesture.historyPushed) { pushHistory(); gesture.historyPushed = true; }
        }
        if (gesture.moved) {
          n.x = Math.round((gesture.origX + dx) * 10) / 10;
          n.y = Math.round((gesture.origY + dy) * 10) / 10;
          if (state.results) state.stale = true;
          renderMap();
        }
      }
    });

    function endPointer(e) {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (!p) return;
      const wasPinch = gesture && gesture.kind === 'pinch';
      if (wasPinch) {
        if (pointers.size < 2) { gesture = null; }
        suppressTap = true;
        setTimeout(function () { suppressTap = false; }, 60);
        return;
      }
      const dx = p.x - p.sx, dy = p.y - p.sy;
      const tap = Math.hypot(dx, dy) < 9 && (Date.now() - p.t) < 700;
      if (tap && e.pointerType && e.pointerType !== 'mouse') {
        // Touch taps synthesise a click after pointerup. If the tap opens a
        // sheet, that click can land on the scrim (or a control) and close or
        // activate it, so swallow the ghost click at document level.
        state.ghostClickUntil = performance.now() + 700;
      }
      if (gesture && gesture.kind === 'node') {
        if (!gesture.moved && tap) {
          selectItem('node', gesture.id, true);
        } else if (gesture.moved) {
          finishNodeDrag();
        }
        gesture = null;
        canvas.style.cursor = state.tool === 'select' ? 'grab' : 'crosshair';
        return;
      }
      if (gesture && gesture.kind === 'pan') {
        gesture = null;
        canvas.style.cursor = state.tool === 'select' ? 'grab' : 'crosshair';
        if (tap && !suppressTap) handleTap(p.x, p.y);
        return;
      }
      gesture = null;
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', function (e) {
      pointers.delete(e.pointerId);
      gesture = null;
      suppressTap = false;
    });
    canvas.addEventListener('pointerleave', function () {
      if (!pointers.size) {
        state.pointerWorld = null;
        if (state.linkStart) renderMap();
      }
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }

  function finishNodeDrag() {
    persist();
    state.stale = !!state.results;
    renderMapChrome();
    renderBrand();
    updateUndoButtons();
    if (state.view === 'data') renderData();
    if (state.view === 'more') renderMore();
    if (state.view === 'results') renderResults();
  }

  /* ================= sheets ================= */

  function openSheet(html, label, mode) {
    dom.sheetContent.innerHTML = html;
    dom.sheet.classList.toggle('modal', mode === 'modal');
    dom.sheetLayer.classList.add('open');
    dom.sheetLayer.setAttribute('aria-hidden', 'false');
    dom.sheet.setAttribute('aria-label', label || 'Panel');
    state.sheetOpen = true;
    dom.sheetContent.scrollTop = 0;
  }
  function closeSheet() {
    if (!state.sheetOpen) return;
    state.sheetOpen = false;
    dom.sheetLayer.classList.remove('open');
    dom.sheetLayer.setAttribute('aria-hidden', 'true');
  }
  function sheetHead(icon, cls, title, sub) {
    return '<div class="sheet-head">' +
      '<div class="row-icon ' + cls + '"><svg class="icon"><use href="#' + icon + '"/></svg></div>' +
      '<div style="min-width:0"><div class="sheet-title">' + esc(title) + '</div>' + (sub ? '<div class="sheet-sub">' + esc(sub) + '</div>' : '') + '</div>' +
      '<button class="icon-btn sheet-close" data-close type="button" aria-label="Close"><svg class="icon"><use href="#i-close"/></svg></button>' +
      '</div>';
  }

  function openMenu() {
    const installRow = state.installPrompt
      ? rowButton('install', 'i-install', 'install', 'Install WaterNet', 'Add to your home screen')
      : rowButton('install-help', 'i-install', 'install', 'Install WaterNet', 'Use your browser menu → Add to Home screen');
    const html = sheetHead('i-settings', '', 'Project menu', state.project.name) +
      '<div class="sheet-list">' +
      rowButton('samples', 'i-map', 'junction', 'Model library', 'Load an example network') +
      rowButton('import', 'i-upload', 'pipe', 'Import EPANET INP', 'Open a .inp model') +
      rowButton('export-inp', 'i-download', 'tank', 'Export INP', 'Write an EPANET-compatible file') +
      rowButton('save-json', 'i-download', 'pump', 'Download project copy', 'Save as WaterNet .json') +
      rowButton('theme', state.prefs.theme === 'dark' ? 'i-sun' : 'i-moon', 'valve', 'Switch to ' + (state.prefs.theme === 'dark' ? 'light' : 'dark') + ' mode', 'Change the app appearance') +
      installRow +
      rowButton('help', 'i-info', '', 'How to use WaterNet', 'Quick start and model notes') +
      rowButton('new', 'i-trash', '', 'New blank network', 'Clear the canvas and start over') +
      '</div>' +
      '<p class="hint" style="text-align:center">WaterNet v' + VERSION + ' · built-in hydraulic engine</p>';
    openSheet(html, 'Project menu');
  }

  function rowButton(action, icon, cls, title, sub, right) {
    return '<button class="menu-row" data-action="' + action + '" type="button">' +
      '<div class="row-icon ' + cls + '"><svg class="icon"><use href="#' + icon + '"/></svg></div>' +
      '<div class="menu-main"><div class="menu-title">' + esc(title) + '</div>' + (sub ? '<div class="menu-sub">' + esc(sub) + '</div>' : '') + '</div>' +
      (right || '<span class="row-chevron"><svg class="icon"><use href="#i-chevron"/></svg></span>') +
      '</button>';
  }

  function openSamples() {
    const html = sheetHead('i-map', '', 'Model library', 'Start from an example or a clean canvas') +
      '<div class="sheet-list">' +
      window.WaterNetSamples.list.map(function (s) {
        return '<button class="menu-row" data-sample="' + s.id + '" type="button">' +
          '<div class="row-icon junction"><svg class="icon"><use href="#i-map"/></svg></div>' +
          '<div class="menu-main"><div class="menu-title">' + esc(s.name) + '</div><div class="menu-sub">' + esc(s.description) + '</div></div>' +
          '<span class="row-chevron"><svg class="icon"><use href="#i-chevron"/></svg></span>' +
          '</button>';
      }).join('') +
      '</div>' +
      '<p class="hint">Loading a model replaces the current network. You can undo with the arrow in the header.</p>';
    openSheet(html, 'Model library');
  }

  function loadSample(id) {
    const sample = window.WaterNetSamples.get(id);
    pushHistory();
    state.project = window.WaterNetInp.normalizeProject(sample);
    state.results = null;
    state.stale = false;
    state.selection = null;
    state.linkStart = null;
    state.resultIndex = 0;
    state.chartNode = null;
    state.chartLink = null;
    fitCamera();
    persist();
    closeSheet();
    renderBrand();
    renderMapChrome();
    renderMap();
    renderData();
    renderMore();
    switchView('map');
    toast('Loaded ' + sample.name);
  }

  function openAbout() {
    const html = sheetHead('i-droplet', 'junction', 'About WaterNet', 'v' + VERSION + ' · ' + state.project.nodes.length + ' node' + (state.project.nodes.length === 1 ? '' : 's') + ' · ' + state.project.links.length + ' link' + (state.project.links.length === 1 ? '' : 's')) +
      '<div class="confirm-body">' +
      '<p><strong>WaterNet</strong> is a water distribution modeling tool for desktop and mobile. It combines a map-based network editor with a global gradient algorithm (GGA) hydraulic solver for steady-state and extended-period simulation.</p>' +
      '<p><strong>Hydraulics</strong><br>Hazen–Williams headloss, minor losses, demand-driven junctions, reservoirs, cylindrical tanks, pumps with quadratic head curves, and TCV valves. Results are solved to tight continuity and energy tolerances.</p>' +
      '<p><strong>Interoperability</strong><br>Reads and writes EPANET 2.x INP files, including SI and common US unit systems. Advanced EPANET features such as rule-based controls, PRV/PSV/FCV valves, water quality and MSX are not modeled.</p>' +
      '<p><strong>Attribution</strong><br>The EPANET name and format originate from the U.S. EPA and the Open Water Analytics EPANET project. WaterNet is an independent app and is not affiliated with or endorsed by EPA or OWA.</p>' +
      '<p class="tiny">Engineering results should be reviewed by a qualified professional before use in design or operation.</p>' +
      '</div>';
    openSheet(html, 'About WaterNet', 'modal');
  }

  function openHelp() {
    const html = sheetHead('i-info', '', 'How to use WaterNet', 'Build, simulate, inspect') +
      '<div class="confirm-body">' +
      '<p><strong>1 · Set a source</strong><br>Add a reservoir (fixed head) or a tank (variable level). Every connected network needs at least one source.</p>' +
      '<p><strong>2 · Draw the network</strong><br>Place junctions, then use the pipe, pump or valve tool. Select a start node and an end node to connect them.</p>' +
      '<p><strong>3 · Edit properties</strong><br>Select any node or link to open its editor. Set elevations, demands, pipe sizes and pump curves.</p>' +
      '<p><strong>4 · Simulate</strong><br>Open Simulate, choose a duration and step, then run. Use the time slider or play button to inspect pressures and flows over the day.</p>' +
      '<p><strong>Gestures</strong><br>Drag a node to move it · drag the map to pan · pinch or scroll to zoom · press F (or select Fit) to frame the network.</p>' +
      '<p><strong>Keyboard</strong><br>J junction · L pipe · P pump · T tank · R reservoir · V valve · S select · F fit · Ctrl+Z undo · Ctrl+Y redo.</p>' +
      '<p><strong>Model notes</strong><br>Demands are L/s and pressures are metres of head. Pumps use a shutoff head and maximum flow, producing a quadratic head curve. Closed links are excluded from the solve.</p>' +
      '</div>';
    openSheet(html, 'How to use WaterNet', 'modal');
  }

  function openConfirm(title, message, confirmLabel, danger, onConfirm) {
    const html = sheetHead('i-warning', '', title, 'This action can be undone') +
      '<div class="confirm-body">' + message + '</div>' +
      '<div class="sheet-actions">' +
      '<button class="btn btn-ghost" data-close type="button">Cancel</button>' +
      '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" id="confirmBtn" type="button">' + esc(confirmLabel) + '</button>' +
      '</div>';
    openSheet(html, title, 'modal');
    const btn = $('#confirmBtn', dom.sheetContent);
    if (btn) btn.addEventListener('click', function () {
      closeSheet();
      setTimeout(onConfirm, 80);
    });
  }

  function openWarnings(title, warnings, sub) {
    const html = sheetHead('i-warning', '', title, sub || (warnings.length + ' notes')) +
      '<div class="confirm-body">' +
      warnings.map(function (w) { return '<div class="warning-row"><svg class="icon"><use href="#i-warning"/></svg><span>' + esc(w) + '</span></div>'; }).join('') +
      '</div>' +
      '<div class="sheet-actions"><button class="btn btn-primary" data-close type="button">Got it</button></div>';
    openSheet(html, title, 'modal');
  }

  function menuAction(action) {
    if (action === 'samples') { openSamples(); return; }
    if (action === 'import') { closeSheet(); dom.fileInput.click(); return; }
    if (action === 'export-inp') { closeSheet(); exportInp(); return; }
    if (action === 'save-json') { closeSheet(); downloadProject(); return; }
    if (action === 'theme') {
      state.prefs.theme = state.prefs.theme === 'dark' ? 'light' : 'dark';
      savePrefs(); applyTheme(); closeSheet(); renderMap();
      if (state.view === 'more') renderMore();
      return;
    }
    if (action === 'install' || action === 'install-help') { closeSheet(); promptInstall(); return; }
    if (action === 'help') { openHelp(); return; }
    if (action === 'new') {
      openConfirm('New blank network?', 'This clears the current model. Your work can be restored with Undo.', 'Start blank', true, function () {
        pushHistory();
        state.project = window.WaterNetInp.normalizeProject(window.WaterNetSamples.get('blank'));
        state.results = null;
        state.stale = false;
        state.selection = null;
        state.linkStart = null;
        state.resultIndex = 0;
        fitCamera();
        persist();
        renderAll();
        switchView('map');
        setTool('junction');
      });
      return;
    }
    if (action === 'run') { switchView('results'); runSimulation(); return; }
    if (action === 'appearance') {
      state.prefs.theme = state.prefs.theme === 'dark' ? 'light' : 'dark';
      savePrefs(); applyTheme(); renderMore(); if (state.view === 'map') renderMap();
      return;
    }
    if (action === 'labels') {
      state.prefs.labels = !state.prefs.labels;
      savePrefs(); renderMore(); renderMap();
      return;
    }
  }

  /* ================= editors ================= */

  function typeMeta(t) { return TYPE_META[t] || TYPE_META.junction; }

  function metricBox(items) {
    return '<div class="metric-box">' + items.map(function (it) {
      return '<div class="metric"><div class="m-label">' + esc(it.label) + '</div><div class="m-value">' + it.value + (it.unit ? '<small>' + esc(it.unit) + '</small>' : '') + '</div></div>';
    }).join('') + '</div>';
  }

  function openNodeEditor(id) {
    const n = getNode(id);
    if (!n) return;
    const meta = typeMeta(n.type);
    const snap = currentSnapshot();
    const nr = snap && snap.nodes[id] ? snap.nodes[id] : null;
    const staleNote = state.stale ? ' · last run' : '';
    let fields = '';
    if (n.type === 'junction') {
      fields =
        '<div class="form-grid">' +
        field('ID', '<input name="id" value="' + esc(n.id) + '" autocomplete="off" required>', true) +
        '</div>' +
        '<div class="form-grid">' +
        field('Elevation', numberInput('elevation', n.elevation, 'm', '0.1')) +
        field('Base demand', numberInput('demand', n.demand, 'L/s', '0.1')) +
        field('Demand pattern', patternSelect(n.pattern), true) +
        '</div>';
    } else if (n.type === 'reservoir') {
      fields =
        '<div class="form-grid">' +
        field('ID', '<input name="id" value="' + esc(n.id) + '" autocomplete="off" required>', true) +
        field('Total head', numberInput('head', n.head, 'm', '0.1')) +
        '</div>';
    } else if (n.type === 'tank') {
      fields =
        '<div class="form-grid">' +
        field('ID', '<input name="id" value="' + esc(n.id) + '" autocomplete="off" required>', true) +
        field('Bottom elevation', numberInput('elevation', n.elevation, 'm', '0.1')) +
        field('Diameter', numberInput('diameter', n.diameter, 'm', '0.1')) +
        field('Initial level', numberInput('level', n.level, 'm', '0.1')) +
        field('Minimum level', numberInput('minLevel', n.minLevel, 'm', '0.1')) +
        field('Maximum level', numberInput('maxLevel', n.maxLevel, 'm', '0.1')) +
        '</div>';
    }
    let metrics = '';
    if (nr) {
      if (n.type === 'junction') {
        metrics = metricBox([
          { label: 'Pressure' + staleNote, value: fmt(nr.pressure, 1), unit: 'm' },
          { label: 'Head', value: fmt(nr.head, 1), unit: 'm' },
          { label: 'Demand', value: fmt(nr.demandLps, 1), unit: 'L/s' },
          { label: 'Net flow', value: fmt(nr.netFlowLps, 1), unit: 'L/s' }
        ]);
      } else if (n.type === 'tank') {
        metrics = metricBox([
          { label: 'Level' + staleNote, value: fmt(nr.level, 1), unit: 'm' },
          { label: 'Head', value: fmt(nr.head, 1), unit: 'm' },
          { label: 'Net flow', value: fmt(nr.netFlowLps, 1), unit: 'L/s' },
          { label: 'Volume', value: fmt(Math.PI * Math.pow(n.diameter / 2, 2) * num(nr.level, 0), 0), unit: 'm³' }
        ]);
      } else {
        metrics = metricBox([
          { label: 'Head', value: fmt(nr.head, 1), unit: 'm' },
          { label: 'Net flow', value: fmt(nr.netFlowLps, 1), unit: 'L/s' },
          { label: 'Type', value: 'Fixed head' },
          { label: 'Elevation', value: fmt(n.elevation, 1), unit: 'm' }
        ]);
      }
    } else {
      metrics = metricBox([
        { label: 'Type', value: meta.label },
        { label: 'Status', value: 'Not simulated' }
      ]);
    }
    const connected = state.project.links.filter(function (l) { return l.from === id || l.to === id; }).length;
    const html = sheetHead(meta.icon, meta.cls, n.id, meta.label + ' · ' + connected + ' connection' + (connected === 1 ? '' : 's')) +
      '<form id="editorForm" novalidate>' + fields + metrics +
      '<div class="sheet-actions">' +
      '<button class="btn btn-ghost icon-only" type="button" id="deleteItem" aria-label="Delete"><svg class="icon"><use href="#i-trash"/></svg></button>' +
      '<button class="btn btn-primary" type="submit">Save changes</button>' +
      '</div>' +
      '<p class="hint">Node IDs must be unique. Changing an ID updates connected links.</p>' +
      '</form>';
    openSheet(html, 'Edit ' + n.id);

    const form = $('#editorForm', dom.sheetContent);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      saveNodeEditor(n, form);
    });
    $('#deleteItem', dom.sheetContent).addEventListener('click', function () {
      deleteNode(n.id, connected);
    });
  }

  function numberInput(name, value, unit, step) {
    return '<input name="' + name + '" type="number" inputmode="decimal" step="' + (step || 'any') + '" value="' + esc(value) + '" data-unit="' + esc(unit || '') + '">';
  }
  function field(label, inputHtml, full) {
    return '<div class="field' + (full ? ' full' : '') + '"><label>' + esc(label) + '</label>' + inputHtml + '</div>';
  }
  function patternSelect(current) {
    const keys = Object.keys(state.project.patterns);
    let opts = '<option value="">Constant (1.0)</option>';
    keys.forEach(function (k) {
      opts += '<option value="' + esc(k) + '"' + (k === current ? ' selected' : '') + '>' + esc(k) + ' · ' + state.project.patterns[k].length + ' steps</option>';
    });
    return '<select name="pattern">' + opts + '</select>';
  }

  function saveNodeEditor(n, form) {
    const fd = new FormData(form);
    const newId = String(fd.get('id') || '').trim();
    if (!newId) { toast('Enter a node ID.'); return; }
    if (/\s/.test(newId)) { toast('Node IDs cannot contain spaces.'); return; }
    if (state.project.nodes.some(function (x) { return x.id === newId && x !== n; })) {
      toast('A node with ID ' + newId + ' already exists.'); return;
    }
    const vals = {};
    ['elevation', 'demand', 'head', 'level', 'minLevel', 'maxLevel', 'diameter'].forEach(function (k) {
      if (fd.has(k)) vals[k] = num(fd.get(k), 0);
    });
    if (n.type === 'junction') {
      if (!Number.isFinite(vals.elevation) || !Number.isFinite(vals.demand)) { toast('Check the numeric fields.'); return; }
    }
    if (n.type === 'tank') {
      if (!(vals.diameter > 0)) { toast('Tank diameter must be greater than zero.'); return; }
      if (vals.minLevel < 0) { toast('Minimum level cannot be negative.'); return; }
      if (vals.maxLevel <= vals.minLevel) { toast('Maximum level must be above minimum level.'); return; }
      if (vals.level < vals.minLevel || vals.level > vals.maxLevel) { toast('Initial level must be within the tank range.'); return; }
    }
    const oldId = n.id;
    mutate(function () {
      n.id = newId;
      Object.keys(vals).forEach(function (k) { n[k] = vals[k]; });
      if (n.type === 'junction') n.pattern = String(fd.get('pattern') || '');
      if (oldId !== newId) {
        state.project.links.forEach(function (l) {
          if (l.from === oldId) l.from = newId;
          if (l.to === oldId) l.to = newId;
        });
      }
    });
    state.selection = { kind: 'node', id: newId };
    closeSheet();
    renderMap();
    toast('Saved ' + newId);
  }

  function openLinkEditor(id) {
    const l = getLink(id);
    if (!l) return;
    const meta = typeMeta(l.type);
    const snap = currentSnapshot();
    const lr = snap && snap.links[id] ? snap.links[id] : null;
    const staleNote = state.stale ? ' · last run' : '';
    let fields = '';
    if (l.type === 'pipe') {
      fields =
        '<div class="form-grid">' +
        field('ID', '<input name="id" value="' + esc(l.id) + '" autocomplete="off" required>', true) +
        field('Diameter', numberInput('diameter', l.diameter, 'mm', '1')) +
        field('Length', numberInput('length', l.length, 'm', '1')) +
        field('Roughness (C)', numberInput('roughness', l.roughness, '', '1')) +
        field('Minor loss (K)', numberInput('minorLoss', l.minorLoss, '', '0.1')) +
        '</div>';
    } else if (l.type === 'pump') {
      fields =
        '<div class="form-grid">' +
        field('ID', '<input name="id" value="' + esc(l.id) + '" autocomplete="off" required>', true) +
        field('Shutoff head', numberInput('shutoffHead', l.shutoffHead, 'm', '0.1')) +
        field('Maximum flow', numberInput('maxFlow', l.maxFlow, 'L/s', '0.1')) +
        field('Speed factor', numberInput('speed', l.speed, '', '0.05')) +
        '</div>';
    } else {
      const vtypes = ['TCV'];
      fields =
        '<div class="form-grid">' +
        field('ID', '<input name="id" value="' + esc(l.id) + '" autocomplete="off" required>', true) +
        field('Diameter', numberInput('diameter', l.diameter, 'mm', '1')) +
        field('Loss coefficient', numberInput('setting', l.setting, 'K', '0.1')) +
        field('Valve type', '<select name="valveType">' + vtypes.map(function (v) { return '<option' + (v === (l.valveType || 'TCV') ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select>') +
        '</div>' +
        '<p class="hint">WaterNet supports throttling control valves (TCV). The setting is a minor-loss coefficient.</p>';
    }
    fields += '<div class="form-grid" style="margin-top:11px"><div class="field full"><label>Status</label><select name="status">' +
      '<option value="OPEN"' + ((l.status || 'OPEN') !== 'CLOSED' ? ' selected' : '') + '>Open</option>' +
      '<option value="CLOSED"' + ((l.status || 'OPEN') === 'CLOSED' ? ' selected' : '') + '>Closed</option>' +
      '</select></div></div>';
    let metrics = '';
    if (lr) {
      if (l.type === 'pump') {
        metrics = metricBox([
          { label: 'Flow' + staleNote, value: fmt(lr.flowLps, 1), unit: 'L/s' },
          { label: 'Head gain', value: fmt(lr.headGain, 1), unit: 'm' },
          { label: 'Status', value: lr.status === 'CHECK' ? 'Check valve' : 'Open' },
          { label: 'From → to', value: esc(l.from) + ' → ' + esc(l.to) }
        ]);
      } else {
        metrics = metricBox([
          { label: 'Flow' + staleNote, value: fmt(lr.flowLps, 1), unit: 'L/s' },
          { label: 'Velocity', value: fmt(lr.velocity, 2), unit: 'm/s' },
          { label: 'Headloss', value: fmt(lr.headloss, 2), unit: 'm' },
          { label: 'Direction', value: lr.flowLps >= 0 ? esc(l.from) + ' → ' + esc(l.to) : esc(l.to) + ' → ' + esc(l.from) }
        ]);
      }
    } else {
      metrics = metricBox([
        { label: 'Type', value: meta.label },
        { label: 'Status', value: 'Not simulated' }
      ]);
    }
    const html = sheetHead(meta.icon, meta.cls, l.id, meta.label + ' · ' + l.from + ' → ' + l.to) +
      '<form id="editorForm" novalidate>' +
      '<div class="endpoint-row"><span class="node-pill">' + esc(l.from) + '</span><span class="arrow">→</span><span class="node-pill">' + esc(l.to) + '</span>' +
      '<button class="btn btn-sm btn-ghost swap" type="button" id="swapEnds">Swap</button></div>' +
      '<div style="height:11px"></div>' + fields + metrics +
      '<div class="sheet-actions">' +
      '<button class="btn btn-ghost icon-only" type="button" id="deleteItem" aria-label="Delete"><svg class="icon"><use href="#i-trash"/></svg></button>' +
      '<button class="btn btn-primary" type="submit">Save changes</button>' +
      '</div>' +
      '<p class="hint">Pipe diameters are in millimetres; lengths and heads are in metres. Closed links are removed from the hydraulic solve.</p>' +
      '</form>';
    openSheet(html, 'Edit ' + l.id);

    const form = $('#editorForm', dom.sheetContent);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      saveLinkEditor(l, form);
    });
    $('#deleteItem', dom.sheetContent).addEventListener('click', function () {
      deleteLink(l.id);
    });
    const swap = $('#swapEnds', dom.sheetContent);
    if (swap) swap.addEventListener('click', function () {
      mutate(function () {
        const tmp = l.from; l.from = l.to; l.to = tmp;
      });
      openLinkEditor(l.id);
    });
  }

  function saveLinkEditor(l, form) {
    const fd = new FormData(form);
    const newId = String(fd.get('id') || '').trim();
    if (!newId) { toast('Enter a link ID.'); return; }
    if (/\s/.test(newId)) { toast('Link IDs cannot contain spaces.'); return; }
    if (state.project.links.some(function (x) { return x.id === newId && x !== l; })) {
      toast('A link with ID ' + newId + ' already exists.'); return;
    }
    const vals = {};
    ['diameter', 'length', 'roughness', 'minorLoss', 'shutoffHead', 'maxFlow', 'speed', 'setting'].forEach(function (k) {
      if (fd.has(k)) vals[k] = num(fd.get(k), 0);
    });
    if (l.type === 'pipe') {
      if (!(vals.length > 0) || !(vals.diameter > 0) || !(vals.roughness > 0)) {
        toast('Length, diameter and roughness must be positive.'); return;
      }
    } else if (l.type === 'pump') {
      if (!(vals.maxFlow > 0) || vals.shutoffHead < 0 || vals.speed < 0) {
        toast('Check the pump values.'); return;
      }
    } else if (!(vals.diameter > 0)) {
      toast('Valve diameter must be positive.'); return;
    }
    const oldId = l.id;
    mutate(function () {
      l.id = newId;
      Object.keys(vals).forEach(function (k) { l[k] = vals[k]; });
      l.status = String(fd.get('status') || 'OPEN');
    });
    state.selection = { kind: 'link', id: newId };
    closeSheet();
    renderMap();
    toast('Saved ' + newId);
  }

  function deleteNode(id, connections) {
    openConfirm('Delete ' + id + '?',
      '<p>This removes the node' + (connections ? ' and its <strong>' + connections + '</strong> connected link' + (connections === 1 ? '' : 's') : '') + '.</p>',
      'Delete node', true, function () {
        mutate(function () {
          state.project.nodes = state.project.nodes.filter(function (n) { return n.id !== id; });
          state.project.links = state.project.links.filter(function (l) { return l.from !== id && l.to !== id; });
        });
        state.selection = null;
        closeSheet();
        renderMap();
        toast('Deleted ' + id);
      });
  }
  function deleteLink(id) {
    openConfirm('Delete ' + id + '?', '<p>This removes the link from the network.</p>', 'Delete link', true, function () {
      mutate(function () {
        state.project.links = state.project.links.filter(function (l) { return l.id !== id; });
      });
      state.selection = null;
      closeSheet();
      renderMap();
      toast('Deleted ' + id);
    });
  }

  /* ================= simulation ================= */

  function runSimulation(opts) {
    opts = opts || {};
    if (state.busy) return;
    const project = state.project;
    if (!project.nodes.length) { toast('Add at least one node before simulating.'); return; }
    if (!project.links.length) { toast('Add at least one link before simulating.'); return; }
    state.busy = true;
    const runBtn = $('#runBtn');
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.innerHTML = '<span class="spinner"></span> Solving…';
    }
    const started = performance.now();
    setTimeout(function () {
      let result;
      try {
        result = window.WaterNetSolver.simulate(project, project.options);
      } catch (err) {
        state.busy = false;
        if (runBtn) { runBtn.disabled = false; runBtn.textContent = 'Run simulation'; }
        toast('Simulation failed: ' + (err && err.message ? err.message : 'unknown error'));
        return;
      }
      result.runtimeMs = Math.round(performance.now() - started);
      state.results = result;
      state.stale = false;
      state.busy = false;
      let idx = 0;
      if (opts.peak) {
        let best = -Infinity;
        result.snapshots.forEach(function (s, i) {
          if (s.summary.totalDemandLps > best) { best = s.summary.totalDemandLps; idx = i; }
        });
      } else if (opts.keepIndex) {
        idx = clamp(state.resultIndex, 0, result.snapshots.length - 1);
      }
      state.resultIndex = idx;
      state.chartNode = null;
      state.chartLink = null;
      ensureChartTargets();
      renderMapChrome();
      renderMap();
      if (state.view === 'results') renderResults();
      if (!opts.silent) {
        const snap = currentSnapshot();
        const worst = snap && snap.summary.minPressure;
        toast((result.ok ? 'Converged' : 'Finished with warnings') + ' in ' + result.runtimeMs + ' ms' +
          (worst ? ' · min pressure ' + fmt(worst.value, 1) + ' m' : ''));
      }
    }, 30);
  }

  function ensureChartTargets() {
    const res = state.results;
    if (!res) return;
    const snap = currentSnapshot();
    if (!state.chartNode || !getNode(state.chartNode)) {
      state.chartNode = snap && snap.summary.minPressure ? snap.summary.minPressure.id : (state.project.nodes.find(function (n) { return n.type !== 'reservoir'; }) || {}).id;
    }
    if (!state.chartLink || !getLink(state.chartLink)) {
      state.chartLink = snap && snap.summary.maxVelocity ? snap.summary.maxVelocity.id : (state.project.links[0] || {}).id;
    }
  }

  function setResultIndex(index) {
    if (!state.results) return;
    state.resultIndex = clamp(Math.round(index), 0, state.results.snapshots.length - 1);
    const mapSlider = dom.timeSlider;
    if (mapSlider) mapSlider.value = String(state.resultIndex);
    const resSlider = $('#resTime');
    if (resSlider) resSlider.value = String(state.resultIndex);
    renderTimebar();
    renderMapChrome();
    renderMap();
    renderResultsLive();
  }

  function stopPlay() {
    if (state.playTimer) clearInterval(state.playTimer);
    state.playTimer = null;
    state.playing = false;
    updatePlayButtons();
  }
  function togglePlay() {
    if (!state.results) return;
    if (state.playing) { stopPlay(); return; }
    state.playing = true;
    if (state.resultIndex >= state.results.snapshots.length - 1) setResultIndex(0);
    updatePlayButtons();
    state.playTimer = setInterval(function () {
      if (!state.results) { stopPlay(); return; }
      if (state.resultIndex >= state.results.snapshots.length - 1) { stopPlay(); return; }
      setResultIndex(state.resultIndex + 1);
    }, 750);
  }

  /* ================= results view ================= */

  function scenarioDurationOptions(current) {
    const values = [0, 6, 12, 24, 48, 72];
    if (!values.includes(current)) values.push(current);
    values.sort(function (a, b) { return a - b; });
    return values.map(function (v) {
      return '<option value="' + v + '"' + (Math.abs(v - current) < 1e-9 ? ' selected' : '') + '>' + (v === 0 ? 'Single period' : v + ' h') + '</option>';
    }).join('');
  }
  function stepOptions(current) {
    const values = [0.25, 0.5, 1, 2, 4];
    if (!values.includes(current)) values.push(current);
    values.sort(function (a, b) { return a - b; });
    return values.map(function (v) {
      return '<option value="' + v + '"' + (Math.abs(v - current) < 1e-9 ? ' selected' : '') + '>' + (v < 1 ? Math.round(v * 60) + ' min' : v + ' h') + '</option>';
    }).join('');
  }

  function renderResults() {
    if (!dom.resultsBody) return;
    const res = state.results;
    const has = !!(res && res.snapshots && res.snapshots.length);
    const stale = state.stale;
    if (dom.resultsBody) dom.resultsBody.classList.toggle('no-results', !has);
    if (dom.simBadge) {
      dom.simBadge.className = 'badge ' + (!has ? '' : stale ? 'warn' : res.ok ? 'ok' : 'warn');
      dom.simBadge.textContent = !has ? 'Not run' : stale ? 'Out of date' : res.ok ? 'Converged' : 'Warnings';
    }
    if (dom.resultsSub) {
      dom.resultsSub.textContent = has
        ? state.project.name + ' · ' + (res.duration > 0 ? res.duration + ' h · ' + res.snapshots.length + ' steps' : 'steady state') + (stale ? ' · model changed' : '')
        : 'Steady state and extended-period hydraulics';
    }
    const opts = state.project.options;
    let html = '';
    html += '<div class="card run-card">' +
      '<div class="run-options">' +
      '<div class="field"><label>Duration</label><select id="optDuration">' + scenarioDurationOptions(num(opts.duration, 24)) + '</select></div>' +
      '<div class="field"><label>Time step</label><select id="optStep">' + stepOptions(num(opts.hydraulicStep, 1)) + '</select></div>' +
      '<div class="field"><label>Demand factor</label><input id="optDemand" type="number" inputmode="decimal" step="0.05" min="0" max="5" value="' + esc(opts.demandMultiplier || 1) + '"></div>' +
      '</div>' +
      '<div class="run-status">' +
      '<span class="dot ' + (!has ? '' : stale ? 'warn' : res.ok ? 'ok' : 'warn') + '"></span>' +
      '<div><strong>' + (!has ? 'Ready to simulate' : stale ? 'Model changed since this run' : res.ok ? 'Hydraulics converged' : 'Completed with warnings') + '</strong>' +
      '<span>' + (state.busy ? 'Solving network…' : has ? res.snapshots.length + ' snapshots · ' + (res.runtimeMs || 0) + ' ms solve' : 'Demand-driven GGA · Hazen–Williams') + '</span></div>' +
      '</div>' +
      '<button class="btn btn-primary btn-block" id="runBtn" type="button"' + (state.busy ? ' disabled' : '') + '>' +
      '<svg class="icon"><use href="#i-play"/></svg>' + (has ? 'Run again' : 'Run simulation') + '</button>' +
      '<p class="hint">Tanks start at their initial levels. Demand patterns follow the project pattern timestep.</p>' +
      '</div>';

    if (!has) {
      html += '<div class="card empty-card"><div class="empty-state">' +
        '<div class="icon-wrap"><svg class="icon"><use href="#i-gauge"/></svg></div>' +
        '<h3>No results yet</h3>' +
        '<p>Run the built-in solver to see pressures, flows, velocities and tank levels across your network.</p>' +
        '<button class="btn btn-primary" id="emptyRun" type="button">Run simulation</button>' +
        '</div></div>';
      dom.resultsBody.innerHTML = html;
      bindResultsEvents();
      return;
    }

    if (stale) {
      html += '<div class="card stale-card" style="border-color:var(--warn);background:var(--warn-soft)">' +
        '<div style="display:flex;gap:9px;align-items:flex-start;color:var(--warn);font-size:11.5px;line-height:1.45">' +
        '<svg class="icon" style="width:17px;height:17px;flex:none"><use href="#i-warning"/></svg>' +
        '<div><strong style="display:block">Results are out of date</strong>The network changed after this simulation. Run again to refresh pressures and flows.</div>' +
        '</div></div>';
    }

    const snap = currentSnapshot();
    const minP = snap.summary.minPressure;
    const maxP = snap.summary.maxPressure;
    const maxV = snap.summary.maxVelocity;
    html += '<div class="kpi-grid">' +
      kpi('Min pressure', fmt(minP && minP.value, 1), 'm', minP ? minP.id : '—', (minP && minP.value < 0) ? 'bad' : (minP && minP.value < 10 ? 'warn' : 'good'), 'kpiMin') +
      kpi('Max pressure', fmt(maxP && maxP.value, 1), 'm', maxP ? maxP.id : '—', 'info', 'kpiMax') +
      kpi('Max velocity', fmt(maxV && maxV.value, 2), 'm/s', maxV ? maxV.id : '—', (maxV && maxV.value > 3) ? 'warn' : '', 'kpiVel') +
      kpi('Demand', fmt(snap.summary.totalDemandLps, 0), 'L/s', snap.summary.sourceSupplyLps.toFixed(0) + ' L/s supplied', '', 'kpiDemand') +
      '</div>';

    html += '<div class="card time-card">' +
      '<div class="time-head">' +
      '<div class="time-big" id="resTimeLabel">' + timeLabel(snap.time) + '</div>' +
      '<div class="time-sub" id="resTimeSub">' + res.snapshots.length + ' snapshots · ' + (res.duration > 0 ? res.duration + ' h period' : 'single period') + '</div>' +
      '<div class="time-actions"><button class="mini-btn" id="resPlay" type="button" aria-label="Play timeline"><svg class="icon"><use href="#i-play"/></svg></button></div>' +
      '</div>' +
      '<input class="range" type="range" id="resTime" min="0" max="' + (res.snapshots.length - 1) + '" step="1" value="' + state.resultIndex + '" aria-label="Simulation time">' +
      '</div>';

    ensureChartTargets();
    const nodeOptions = state.project.nodes.map(function (n) {
      return '<option value="' + esc(n.id) + '"' + (n.id === state.chartNode ? ' selected' : '') + '>' + esc(n.id) + ' · ' + typeMeta(n.type).label + '</option>';
    }).join('');
    const linkOptions = state.project.links.map(function (l) {
      return '<option value="' + esc(l.id) + '"' + (l.id === state.chartLink ? ' selected' : '') + '>' + esc(l.id) + ' · ' + typeMeta(l.type).label + '</option>';
    }).join('');
    html += '<div class="card chart-card">' +
      '<div class="card-head"><div><h3>Time series</h3><div class="sub">Inspect the selected asset across the simulation</div></div></div>' +
      '<div class="segmented" style="margin-top:0">' +
      '<button data-chart-kind="node" class="' + (state.chartKind === 'node' ? 'active' : '') + '" type="button">Node</button>' +
      '<button data-chart-kind="link" class="' + (state.chartKind === 'link' ? 'active' : '') + '" type="button">Link</button>' +
      '</div>' +
      '<div class="chart-head">' +
      '<select id="chartTarget">' + (state.chartKind === 'node' ? nodeOptions : linkOptions) + '</select>' +
      (state.chartKind === 'link'
        ? '<div class="segmented" style="margin:0;width:170px;margin-left:auto"><button data-chart-verb="flow" class="' + (state.chartVerb !== 'velocity' ? 'active' : '') + '" type="button">Flow</button><button data-chart-verb="velocity" class="' + (state.chartVerb === 'velocity' ? 'active' : '') + '" type="button">Velocity</button></div>'
        : '') +
      '</div>' +
      '<div class="chart-wrap"><canvas id="chartCanvas"></canvas></div>' +
      '<div class="chart-legend"><span><i style="background:var(--primary)"></i>' + chartLegendLabel() + '</span><span><i style="background:var(--accent)"></i>current time</span></div>' +
      '</div>';

    html += '<div class="card critical-card"><div class="card-head"><div><h3>Lowest pressures</h3><div class="sub" id="criticalSub">At ' + timeLabel(snap.time) + '</div></div><span class="badge ' + (minP && minP.value < 0 ? 'bad' : '') + '">' + (minP ? fmt(minP.value, 1) + ' m min' : '') + '</span></div>' +
      '<div id="criticalList"></div></div>';

    html += '<div class="card warnings-card"><div class="card-head"><div><h3>Warnings</h3><div class="sub">' + (res.warnings.length ? res.warnings.length + ' item' + (res.warnings.length === 1 ? '' : 's') : 'No issues detected') + '</div></div>' +
      '<svg class="icon" style="color:' + (res.warnings.length ? 'var(--warn)' : 'var(--ok)') + '"><use href="#' + (res.warnings.length ? 'i-warning' : 'i-check') + '"/></svg></div>' +
      (res.warnings.length
        ? res.warnings.map(function (w) { return '<div class="warning-row"><svg class="icon"><use href="#i-warning"/></svg><span>' + esc(w) + '</span></div>'; }).join('')
        : '<div class="warning-row"><svg class="icon" style="color:var(--ok)"><use href="#i-check"/></svg><span>All junctions are connected and the hydraulic solve converged.</span></div>') +
      '</div>';

    dom.resultsBody.innerHTML = html;
    bindResultsEvents();
    renderCriticalList();
    renderChart();
  }

  function kpi(label, value, unit, sub, cls, id) {
    return '<div class="kpi ' + (cls || '') + '" id="' + id + '"><div class="k-label">' + esc(label) + '</div>' +
      '<div class="k-value">' + value + '<small>' + esc(unit) + '</small></div>' +
      '<div class="k-sub">' + esc(sub) + '</div></div>';
  }

  function chartLegendLabel() {
    if (state.chartKind === 'link') return state.chartVerb === 'velocity' ? 'Velocity (m/s)' : 'Flow (L/s)';
    const n = state.chartNode ? getNode(state.chartNode) : null;
    return n && n.type === 'tank' ? 'Tank level (m)' : 'Pressure (m)';
  }

  function bindResultsEvents() {
    const body = dom.resultsBody;
    body.onclick = function (e) {
      const t = e.target.closest('button');
      if (!t) {
        const row = e.target.closest('[data-critical-node]');
        if (row) {
          const id = row.getAttribute('data-critical-node');
          state.selection = { kind: 'node', id: id };
          switchView('map');
          focusItem('node', id);
          setTimeout(function () { openNodeEditor(id); }, 220);
        }
        return;
      }
      if (t.id === 'runBtn' || t.id === 'emptyRun') { runSimulation({ keepIndex: true }); return; }
      if (t.id === 'resPlay') { togglePlay(); return; }
      if (t.dataset.chartKind) {
        state.chartKind = t.dataset.chartKind;
        ensureChartTargets();
        renderResults();
        return;
      }
      if (t.dataset.chartVerb) {
        state.chartVerb = t.dataset.chartVerb;
        renderResults();
        return;
      }
    };
    body.oninput = function (e) {
      if (e.target.id === 'resTime') {
        setResultIndex(num(e.target.value, 0));
      }
    };
    body.onchange = function (e) {
      const id = e.target.id;
      if (id === 'optDuration') {
        state.project.options.duration = num(e.target.value, 24);
        state.stale = !!state.results;
        persist();
        renderResults();
      } else if (id === 'optStep') {
        state.project.options.hydraulicStep = num(e.target.value, 1);
        state.stale = !!state.results;
        persist();
        renderResults();
      } else if (id === 'optDemand') {
        state.project.options.demandMultiplier = clamp(num(e.target.value, 1), 0.05, 5);
        state.stale = !!state.results;
        persist();
        renderResults();
      } else if (id === 'chartTarget') {
        if (state.chartKind === 'node') state.chartNode = e.target.value;
        else state.chartLink = e.target.value;
        renderChart();
      }
    };
  }

  function renderResultsLive() {
    if (!state.results || state.view !== 'results') return;
    const snap = currentSnapshot();
    if (!snap) return;
    const label = $('#resTimeLabel');
    if (label) label.textContent = timeLabel(snap.time);
    const slider = $('#resTime');
    if (slider && document.activeElement !== slider) slider.value = String(state.resultIndex);
    const minP = snap.summary.minPressure, maxP = snap.summary.maxPressure, maxV = snap.summary.maxVelocity;
    setKpi('kpiMin', fmt(minP && minP.value, 1), minP ? minP.id : '—');
    setKpi('kpiMax', fmt(maxP && maxP.value, 1), maxP ? maxP.id : '—');
    setKpi('kpiVel', fmt(maxV && maxV.value, 2), maxV ? maxV.id : '—');
    setKpi('kpiDemand', fmt(snap.summary.totalDemandLps, 0), snap.summary.sourceSupplyLps.toFixed(0) + ' L/s supplied');
    const sub = $('#criticalSub');
    if (sub) sub.textContent = 'At ' + timeLabel(snap.time);
    renderCriticalList();
    renderChart();
  }
  function setKpi(id, value, sub) {
    const el = document.getElementById(id);
    if (!el) return;
    const v = el.querySelector('.k-value');
    const s = el.querySelector('.k-sub');
    if (v) {
      const unit = v.querySelector('small');
      v.childNodes[0].nodeValue = value;
      if (!unit) v.insertAdjacentHTML('beforeend', '<small>m</small>');
    }
    if (s) s.textContent = sub;
  }

  function renderCriticalList() {
    const el = $('#criticalList');
    if (!el) return;
    const snap = currentSnapshot();
    if (!snap) return;
    const nodes = state.project.nodes.filter(function (n) { return n.type === 'junction'; })
      .map(function (n) { return { id: n.id, p: snap.nodes[n.id] ? snap.nodes[n.id].pressure : null }; })
      .filter(function (r) { return r.p !== null && r.p !== undefined; })
      .sort(function (a, b) { return a.p - b.p; })
      .slice(0, 5);
    if (!nodes.length) { el.innerHTML = '<div class="list-empty">No junction results.</div>'; return; }
    const maxRef = Math.max(60, nodes[0].p + 1);
    el.innerHTML = nodes.map(function (r) {
      const width = clamp(Math.abs(r.p) / maxRef * 100, 4, 100);
      const color = pressureColor(r.p);
      return '<div class="critical-row" data-critical-node="' + esc(r.id) + '">' +
        '<div class="critical-name">' + esc(r.id) + '</div>' +
        '<div class="critical-bar"><i style="width:' + width + '%;background:' + color + '"></i></div>' +
        '<div class="critical-val">' + fmt(r.p, 1) + ' <small>m</small></div>' +
        '</div>';
    }).join('');
  }

  function chartSeries() {
    const res = state.results;
    if (!res || !res.snapshots.length) return null;
    let label, unit, color, values, digits;
    if (state.chartKind === 'link') {
      const l = state.chartLink ? getLink(state.chartLink) : null;
      if (!l) return null;
      const isVel = state.chartVerb === 'velocity';
      label = (isVel ? 'Velocity' : 'Flow') + ' — ' + l.id;
      unit = isVel ? 'm/s' : 'L/s';
      color = '#087a96';
      digits = isVel ? 2 : 1;
      values = res.snapshots.map(function (s) {
        const lr = s.links[l.id];
        if (!lr) return null;
        return isVel ? lr.velocity : lr.flowLps;
      });
    } else {
      const n = state.chartNode ? getNode(state.chartNode) : null;
      if (!n) return null;
      const isTank = n.type === 'tank';
      label = (isTank ? 'Tank level' : 'Pressure') + ' — ' + n.id;
      unit = 'm';
      color = '#087a96';
      digits = 1;
      values = res.snapshots.map(function (s) {
        const nr = s.nodes[n.id];
        if (!nr) return null;
        return isTank ? nr.level : nr.pressure;
      });
    }
    return { label: label, unit: unit, color: color, values: values, digits: digits, times: res.snapshots.map(function (s) { return s.time; }) };
  }

  function renderChart() {
    const canvas = $('#chartCanvas');
    if (!canvas) return;
    const series = chartSeries();
    const wrap = canvas.parentElement;
    const rect = wrap.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const w = rect.width, h = rect.height;
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const muted = css.getPropertyValue('--muted').trim() || '#738d99';
    const line = css.getPropertyValue('--line').trim() || '#dbe8ee';
    const text = css.getPropertyValue('--text').trim() || '#102a35';
    const primary = css.getPropertyValue('--primary').trim() || '#087a96';
    const font = css.getPropertyValue('--font').trim() || 'sans-serif';
    if (!series) {
      c.fillStyle = muted; c.font = '12px ' + font; c.textAlign = 'center';
      c.fillText('No chart data', w / 2, h / 2);
      return;
    }
    const vals = series.values.filter(function (v) { return v !== null && v !== undefined && Number.isFinite(v); });
    if (!vals.length) {
      c.fillStyle = muted; c.font = '12px ' + font; c.textAlign = 'center';
      c.fillText('No values for this asset', w / 2, h / 2);
      return;
    }
    let min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (max - min < 0.001) { max = min + 1; min = min - 1; }
    const pad = (max - min) * 0.12;
    min -= pad; max += pad;
    const m = { l: 38, r: 10, t: 10, b: 22 };
    const iw = w - m.l - m.r, ih = h - m.t - m.b;
    const n = series.values.length;
    const xAt = function (i) { return m.l + (n <= 1 ? iw / 2 : i * iw / (n - 1)); };
    const yAt = function (v) { return m.t + ih - (v - min) / (max - min) * ih; };
    // grid
    c.strokeStyle = line; c.lineWidth = 1;
    c.font = '9.5px ' + font; c.fillStyle = muted; c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let g = 0; g <= 3; g++) {
      const v = min + (max - min) * g / 3;
      const y = Math.round(yAt(v)) + .5;
      c.beginPath(); c.moveTo(m.l, y); c.lineTo(w - m.r, y); c.stroke();
      c.fillText(v.toFixed(series.digits), m.l - 6, y);
    }
    // x labels
    c.textAlign = 'center'; c.textBaseline = 'top';
    const ticks = Math.min(5, n);
    for (let k = 0; k < ticks; k++) {
      const i = ticks === 1 ? 0 : Math.round(k * (n - 1) / (ticks - 1));
      c.fillText(timeLabel(series.times[i]), xAt(i), h - m.b + 6);
    }
    // area + line
    const grad = c.createLinearGradient(0, m.t, 0, m.t + ih);
    grad.addColorStop(0, 'rgba(8,122,150,.22)');
    grad.addColorStop(1, 'rgba(8,122,150,0)');
    c.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const v = series.values[i];
      if (v === null || v === undefined || !Number.isFinite(v)) { started = false; continue; }
      if (!started) { c.moveTo(xAt(i), yAt(v)); started = true; }
      else c.lineTo(xAt(i), yAt(v));
    }
    const lastV = series.values[n - 1];
    if (started) {
      c.lineTo(xAt(n - 1), m.t + ih);
      c.lineTo(xAt(0), m.t + ih);
      c.closePath();
      c.fillStyle = grad; c.fill();
    }
    c.beginPath();
    started = false;
    for (let i = 0; i < n; i++) {
      const v = series.values[i];
      if (v === null || v === undefined || !Number.isFinite(v)) { started = false; continue; }
      if (!started) { c.moveTo(xAt(i), yAt(v)); started = true; }
      else c.lineTo(xAt(i), yAt(v));
    }
    c.strokeStyle = primary; c.lineWidth = 2.4; c.lineJoin = 'round'; c.lineCap = 'round';
    if (n === 1) {
      c.beginPath(); c.arc(xAt(0), yAt(series.values[0]), 3.5, 0, Math.PI * 2); c.fillStyle = primary; c.fill();
    } else c.stroke();

    // current time marker
    const idx = clamp(state.resultIndex, 0, n - 1);
    const cv = series.values[idx];
    if (cv !== null && cv !== undefined && Number.isFinite(cv)) {
      const x = xAt(idx), y = yAt(cv);
      c.setLineDash([4, 4]); c.strokeStyle = css.getPropertyValue('--accent').trim() || '#00b0c7'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, m.t); c.lineTo(x, m.t + ih); c.stroke();
      c.setLineDash([]);
      c.beginPath(); c.arc(x, y, 4.5, 0, Math.PI * 2);
      c.fillStyle = primary; c.fill();
      c.strokeStyle = css.getPropertyValue('--surface').trim() || '#fff'; c.lineWidth = 2; c.stroke();
    }
    // current value label
    if (cv !== null && cv !== undefined && Number.isFinite(cv)) {
      c.font = '700 10px ' + font;
      c.fillStyle = text;
      c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText(fmt(cv, series.digits) + ' ' + series.unit, m.l + 2, m.t + 2);
    }
  }

  /* ================= data view ================= */

  function totalDemand() {
    return state.project.nodes.reduce(function (sum, n) {
      return sum + (n.type === 'junction' ? num(n.demand, 0) : 0);
    }, 0);
  }
  function renderData() {
    if (!dom.dataStats) return;
    const nodes = state.project.nodes.length;
    const links = state.project.links.length;
    const pipeLength = state.project.links.reduce(function (s, l) { return s + (l.type === 'pipe' ? num(l.length, 0) : 0); }, 0);
    dom.dataStats.innerHTML =
      '<div class="stat"><b>' + nodes + '</b><span>Nodes</span></div>' +
      '<div class="stat"><b>' + links + '</b><span>Links</span></div>' +
      '<div class="stat"><b>' + (pipeLength / 1000).toFixed(2) + '</b><span>Pipe km</span></div>' +
      '<div class="stat"><b>' + totalDemand().toFixed(0) + '</b><span>Demand L/s</span></div>';
    $$('button', dom.dataSeg).forEach(function (b) { b.classList.toggle('active', b.dataset.kind === state.dataKind); });
    renderDataList();
  }

  function renderDataList() {
    if (!dom.dataList) return;
    const snap = currentSnapshot();
    const q = state.search.trim().toLowerCase();
    let html = '';
    if (state.dataKind === 'nodes') {
      const list = state.project.nodes.slice().sort(function (a, b) { return a.id.localeCompare(b.id, undefined, { numeric: true }); })
        .filter(function (n) {
          if (!q) return true;
          return n.id.toLowerCase().includes(q) || n.type.includes(q);
        });
      if (!list.length) {
        html = '<div class="list-empty">' + (state.project.nodes.length ? 'No matching nodes.' : 'No nodes yet. Use + to add a junction.') + '</div>';
      } else {
        html = DATA_HEAD;
        list.forEach(function (n) {
          const meta = typeMeta(n.type);
          const nr = snap && snap.nodes[n.id];
          let sub = '', value = '', vlabel = '';
          if (n.type === 'junction') {
            sub = 'Junction · elev ' + fmt(n.elevation, 0) + ' m · ' + fmt(n.demand, 1) + ' L/s';
            if (nr) { value = fmt(nr.pressure, 1); vlabel = 'Pressure m'; } else { value = fmt(n.elevation, 0); vlabel = 'Elev m'; }
          } else if (n.type === 'reservoir') {
            sub = 'Reservoir · head ' + fmt(n.head, 1) + ' m';
            if (nr) { value = fmt(nr.head, 1); vlabel = 'Head m'; } else { value = fmt(n.head, 1); vlabel = 'Head m'; }
          } else {
            sub = 'Tank · Ø ' + fmt(n.diameter, 1) + ' m · ' + fmt(n.level, 1) + ' m level';
            if (nr) { value = fmt(nr.level, 1); vlabel = 'Level m'; } else { value = fmt(n.level, 1); vlabel = 'Level m'; }
          }
          html += '<div class="data-row" data-kind="node" data-id="' + esc(n.id) + '" role="button" tabindex="0">' +
            '<div class="row-icon ' + meta.cls + '"><svg class="icon"><use href="#' + meta.icon + '"/></svg></div>' +
            '<div class="row-main"><div class="row-title">' + esc(n.id) + '</div><div class="row-sub">' + esc(sub) + '</div></div>' +
            '<div class="row-value"><b>' + value + '</b><span>' + vlabel + '</span></div>' +
            '<div class="row-chevron"><svg class="icon"><use href="#i-chevron"/></svg></div>' +
            '</div>';
        });
      }
    } else {
      const list = state.project.links.slice().sort(function (a, b) { return a.id.localeCompare(b.id, undefined, { numeric: true }); })
        .filter(function (l) {
          if (!q) return true;
          return l.id.toLowerCase().includes(q) || l.type.includes(q) || (l.from + ' ' + l.to).toLowerCase().includes(q);
        });
      if (!list.length) {
        html = '<div class="list-empty">' + (state.project.links.length ? 'No matching links.' : 'No links yet. Use the pipe tool on the map.') + '</div>';
      } else {
        html = DATA_HEAD;
        list.forEach(function (l) {
          const meta = typeMeta(l.type);
          const lr = snap && snap.links[l.id];
          let sub = l.from + ' → ' + l.to;
          if (l.type === 'pipe') sub = l.from + ' → ' + l.to + ' · ' + fmt(l.length, 0) + ' m · Ø' + fmt(l.diameter, 0);
          else if (l.type === 'pump') sub = l.from + ' → ' + l.to + ' · ' + fmt(l.shutoffHead, 0) + ' m shutoff';
          else sub = l.from + ' → ' + l.to + ' · ' + (l.valveType || 'TCV');
          html += '<div class="data-row" data-kind="link" data-id="' + esc(l.id) + '" role="button" tabindex="0">' +
            '<div class="row-icon ' + meta.cls + '"><svg class="icon"><use href="#' + meta.icon + '"/></svg></div>' +
            '<div class="row-main"><div class="row-title">' + esc(l.id) + '</div><div class="row-sub">' + esc(sub) + '</div></div>' +
            '<div class="row-value"><b>' + (lr ? fmt(lr.flowLps, 1) : fmt(l.type === 'pipe' ? l.diameter : l.diameter || 0, 0)) + '</b><span>' + (lr ? 'Flow L/s' : (l.type === 'pipe' ? 'Diam mm' : 'Diam mm')) + '</span></div>' +
            '<div class="row-chevron"><svg class="icon"><use href="#i-chevron"/></svg></div>' +
            '</div>';
        });
      }
    }
    dom.dataList.innerHTML = html;
  }

  function jumpToItem(kind, id) {
    state.selection = { kind: kind, id: id };
    switchView('map');
    focusItem(kind, id);
    setTimeout(function () {
      if (kind === 'node') openNodeEditor(id);
      else openLinkEditor(id);
    }, 220);
  }
  function focusItem(kind, id) {
    let x = 0, y = 0;
    if (kind === 'node') {
      const n = getNode(id);
      if (!n) return;
      x = n.x; y = n.y;
    } else {
      const l = getLink(id);
      if (!l) return;
      const a = getNode(l.from), b = getNode(l.to);
      if (!a || !b) return;
      x = (a.x + b.x) / 2; y = (a.y + b.y) / 2;
    }
    state.camera.x = x;
    state.camera.y = y;
    state.camera.scale = Math.max(state.camera.scale, 0.25);
    renderMap();
  }

  /* ================= more view ================= */

  function renderMore() {
    if (!dom.morePage) return;
    const nodes = state.project.nodes.length;
    const links = state.project.links.length;
    const pipeKm = state.project.links.reduce(function (s, l) { return s + (l.type === 'pipe' ? num(l.length, 0) : 0); }, 0) / 1000;
    const installSub = state.installPrompt ? 'Install on this device' : 'Use browser menu → Add to Home screen';
    const hasRes = !!state.results;
    dom.morePage.innerHTML =
      '<div class="page-head"><div><h1>Project</h1><p>Model, files and app settings</p></div>' +
      '<span class="badge ' + (hasRes && !state.stale ? 'ok' : '') + '">' + (hasRes && !state.stale ? 'Simulated' : 'Design') + '</span></div>' +
      '<div class="project-hero">' +
      '<div class="hero-label">Water network</div>' +
      '<input id="projectName" value="' + esc(state.project.name) + '" maxlength="60" aria-label="Project name">' +
      '<div class="hero-meta">SI units · ' + (state.project.options.duration > 0 ? state.project.options.duration + ' h simulation' : 'steady state') + (state.lastSaved ? ' · saved ' + state.lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '') + '</div>' +
      '<div class="hero-stats"><div><b>' + nodes + '</b><span>Nodes</span></div><div><b>' + links + '</b><span>Links</span></div><div><b>' + pipeKm.toFixed(1) + '</b><span>Pipe km</span></div><div><b>' + totalDemand().toFixed(0) + '</b><span>L/s peak base</span></div></div>' +
      '</div>' +

      '<div class="menu-card">' +
      rowButton('run', 'i-gauge', 'junction', hasRes ? 'Open simulation' : 'Run a simulation', state.stale ? 'Results are out of date' : 'Pressures, flows and tank levels') +
      rowButton('samples', 'i-map', 'tank', 'Model library', 'Example networks and blank canvas') +
      '</div>' +

      '<div class="menu-card">' +
      rowButton('import', 'i-upload', 'pipe', 'Import EPANET INP', 'Read a .inp model, SI or US units') +
      rowButton('export-inp', 'i-download', 'pipe', 'Export EPANET INP', 'Write a compatible ' + slug(state.project.name) + '.inp') +
      rowButton('save-json', 'i-download', 'pump', 'Download project file', 'Keep a WaterNet .json copy') +
      '</div>' +

      '<div class="menu-card">' +
      '<button class="menu-row" data-action="appearance" type="button"><div class="row-icon valve"><svg class="icon"><use href="#' + (state.prefs.theme === 'dark' ? 'i-sun' : 'i-moon') + '"/></svg></div><div class="menu-main"><div class="menu-title">Dark mode</div><div class="menu-sub">Match your environment</div></div><span class="switch ' + (state.prefs.theme === 'dark' ? 'on' : '') + '"></span></button>' +
      '<button class="menu-row" data-action="labels" type="button"><div class="row-icon junction"><svg class="icon"><use href="#i-junction"/></svg></div><div class="menu-main"><div class="menu-title">Map labels</div><div class="menu-sub">Show node IDs on the map</div></div><span class="switch ' + (state.prefs.labels ? 'on' : '') + '"></span></button>' +
      rowButton('install', 'i-install', 'reservoir', 'Install WaterNet', installSub) +
      '</div>' +

      '<div class="menu-card">' +
      rowButton('help', 'i-info', '', 'How to use WaterNet', 'Quick start, gestures and model notes') +
      rowButton('about', 'i-droplet', '', 'About WaterNet', 'v' + VERSION + ' · engine, EPANET format and credits') +
      '</div>' +

      '<div class="more-footer"><b>WaterNet ' + VERSION + '</b><br>Built-in GGA hydraulic engine · Hazen–Williams<br>Reads and writes EPANET 2.x INP files<br>Vibe Coded by Kapil Faujdar</div>';
  }

  /* ================= import / export ================= */

  function downloadFile(filename, content, mime) {
    try {
      const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
      toast('Downloaded ' + filename);
    } catch (e) {
      toast('Download failed: ' + e.message);
    }
  }
  function exportInp() {
    const text = window.WaterNetInp.toInp(state.project);
    downloadFile(slug(state.project.name) + '.inp', text, 'text/plain;charset=utf-8');
  }
  function downloadProject() {
    const copy = JSON.parse(JSON.stringify(state.project));
    copy.exportedAt = new Date().toISOString();
    downloadFile(slug(state.project.name) + '.waternet.json', JSON.stringify(copy, null, 2), 'application/json');
  }

  function importFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      const text = String(reader.result || '');
      const isJson = /\.json$/i.test(file.name) || /^\s*\{/.test(text);
      try {
        let project;
        let warnings = [];
        if (isJson) {
          const obj = JSON.parse(text);
          if (!obj || !Array.isArray(obj.nodes) || !Array.isArray(obj.links)) throw new Error('Not a WaterNet project file.');
          project = window.WaterNetInp.normalizeProject(obj);
        } else {
          const parsed = window.WaterNetInp.parseInp(text, file.name.replace(/\.inp$/i, ''));
          project = parsed.project;
          warnings = parsed.warnings;
        }
        pushHistory();
        state.project = project;
        state.results = null;
        state.stale = false;
        state.selection = null;
        state.linkStart = null;
        state.resultIndex = 0;
        state.chartNode = null;
        state.chartLink = null;
        fitCamera();
        persist();
        renderAll();
        switchView('map');
        const msg = 'Imported ' + project.nodes.length + ' node' + (project.nodes.length === 1 ? '' : 's') + ' and ' + project.links.length + ' link' + (project.links.length === 1 ? '' : 's') + '.';
        if (warnings.length) openWarnings('Import notes', warnings, msg);
        else toast(msg);
      } catch (err) {
        toast('Import failed: ' + (err && err.message ? err.message : 'invalid file'));
      }
    };
    reader.onerror = function () { toast('Could not read that file.'); };
    reader.readAsText(file);
  }

  /* ================= install / SW ================= */

  function promptInstall() {
    if (state.installPrompt) {
      state.installPrompt.prompt();
      state.installPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') toast('Installing WaterNet…');
        state.installPrompt = null;
        if (state.view === 'more') renderMore();
      });
    } else {
      toast('Open your browser menu and choose “Add to Home screen” to install WaterNet.');
    }
  }
  function registerServiceWorker() {
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* offline support unavailable */ });
      });
    }
  }

  /* ================= toast ================= */

  function toast(message) {
    if (!dom.toast) return;
    dom.toast.innerHTML = message;
    dom.toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { dom.toast.classList.remove('show'); }, 2800);
  }

  /* ================= static events ================= */

  function bindStaticEvents() {
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchView(tab.dataset.view); });
    });
    dom.btnMenu.addEventListener('click', openMenu);
    dom.btnUndo.addEventListener('click', undo);
    dom.btnRedo.addEventListener('click', redo);
    dom.mapStatus.addEventListener('click', function () { switchView('results'); });
    dom.layerBtn.addEventListener('click', function () {
      if (!state.results) return;
      state.layer = state.layer === 'velocity' ? 'flow' : state.layer === 'flow' ? 'headloss' : 'velocity';
      renderMapChrome();
      renderMap();
      toast('Link colouring: ' + (state.layer === 'headloss' ? 'headloss' : state.layer));
    });
    dom.playBtn.addEventListener('click', togglePlay);
    dom.timeSlider.addEventListener('input', function (e) { setResultIndex(num(e.target.value, 0)); });

    dom.toolDock.addEventListener('click', function (e) {
      const b = e.target.closest('.tool');
      if (!b) return;
      if (b.dataset.action === 'fit') { fitCamera(); renderMap(); return; }
      if (b.dataset.tool) setTool(b.dataset.tool);
    });
    dom.emptyAddNode.addEventListener('click', function () {
      switchView('map');
      setTool('junction');
    });
    dom.emptySamples.addEventListener('click', openSamples);

    dom.sheetScrim.addEventListener('click', closeSheet);
    document.addEventListener('click', function (e) {
      const fresh = state.ghostClickUntil && performance.now() < state.ghostClickUntil;
      state.ghostClickUntil = 0;
      if (fresh && e.target.closest && e.target.closest('#sheetLayer')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeSheet(); return; }
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !tag.match(/input|textarea|select/)) {
        if (key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
        else if (key === 'y') { e.preventDefault(); redo(); }
        return;
      }
      if (state.sheetOpen || state.view !== 'map') return;
      if (e.metaKey || e.ctrlKey || e.altKey || tag.match(/input|textarea|select/)) return;
      if (TOOL_KEYS[key]) {
        e.preventDefault();
        setTool(TOOL_KEYS[key]);
        return;
      }
      if (key === 'f') {
        e.preventDefault();
        fitCamera();
        renderMap();
      } else if (key === '+' || key === '=') {
        e.preventDefault();
        zoomAt(state.mapSize.w / 2, state.mapSize.h / 2, 1.2);
      } else if (key === '-' || key === '_') {
        e.preventDefault();
        zoomAt(state.mapSize.w / 2, state.mapSize.h / 2, 1 / 1.2);
      }
    });
    dom.sheetContent.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) { closeSheet(); return; }
      const sample = e.target.closest('[data-sample]');
      if (sample) { loadSample(sample.dataset.sample); return; }
      const action = e.target.closest('[data-action]');
      if (action) { menuAction(action.dataset.action); return; }
      if (e.target.closest('[data-theme-toggle]')) {
        state.prefs.theme = state.prefs.theme === 'dark' ? 'light' : 'dark';
        savePrefs(); applyTheme(); closeSheet(); renderMap(); if (state.view === 'more') renderMore();
      }
    });

    dom.dataSearch.addEventListener('input', function (e) {
      state.search = e.target.value;
      renderDataList();
    });
    dom.dataSeg.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      state.dataKind = b.dataset.kind;
      $$('button', dom.dataSeg).forEach(function (x) { x.classList.toggle('active', x === b); });
      renderDataList();
    });
    dom.dataAdd.addEventListener('click', function () {
      switchView('map');
      setTool('junction');
    });
    dom.dataList.addEventListener('click', function (e) {
      const row = e.target.closest('.data-row');
      if (row) jumpToItem(row.dataset.kind, row.dataset.id);
    });
    dom.dataList.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('.data-row');
      if (row) { e.preventDefault(); jumpToItem(row.dataset.kind, row.dataset.id); }
    });

    dom.morePage.addEventListener('click', function (e) {
      const row = e.target.closest('[data-action]');
      if (!row) return;
      const action = row.dataset.action;
      if (action === 'about') { openAbout(); return; }
      if (action === 'theme') { menuAction('appearance'); return; }
      menuAction(action);
    });
    dom.morePage.addEventListener('change', function (e) {
      if (e.target.id === 'projectName') {
        const value = e.target.value.trim().slice(0, 60);
        if (!value) { e.target.value = state.project.name; return; }
        state.project.name = value;
        persist(); renderBrand();
        if (state.view === 'results') renderResults();
      }
    });
    dom.fileInput.addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      importFile(file);
      e.target.value = '';
    });

    bindMapPointerEvents();
    const ro = new ResizeObserver(function () { resizeCanvas(); });
    ro.observe(dom.mapShell);
    window.addEventListener('resize', function () {
      resizeCanvas();
      if (state.view === 'results') renderChart();
    });
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      state.installPrompt = e;
      if (state.view === 'more') renderMore();
    });
    window.addEventListener('appinstalled', function () {
      state.installPrompt = null;
      toast('WaterNet installed.');
      if (state.view === 'more') renderMore();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopPlay();
    });
  }

  init();
})();
