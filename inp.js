/*!
 * WaterNet - EPANET INP reader/writer and project helpers.
 * Supports the core hydraulic subset: junctions, reservoirs, tanks,
 * pipes, pumps and TCV valves, with SI/US unit conversion.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WaterNetInp = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FT = 0.3048;
  const IN = 25.4;

  const FLOW_TO_LPS = {
    CFS: 28.316846592,
    GPM: 0.0630901964,
    MGD: 43.8126364,
    IMGD: 52.6168472,
    AFD: 14.2764116,
    LPS: 1,
    LPM: 1 / 60,
    MLD: 1000 / 86400,
    CMH: 1000 / 3600,
    CMD: 1000 / 86400,
    CMS: 1000
  };
  const US_UNITS = ['CFS', 'GPM', 'MGD', 'IMGD', 'AFD'];

  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }
  function fmt(v, digits) {
    if (!Number.isFinite(Number(v))) return '0';
    const d = digits === undefined ? 4 : digits;
    return String(Math.round(Number(v) * Math.pow(10, d)) / Math.pow(10, d));
  }

  function parseTimeHours(token) {
    if (token === undefined || token === null) return 0;
    const s = String(token).trim();
    if (!s) return 0;
    if (s.indexOf(':') >= 0) {
      const parts = s.split(':').map(Number);
      return (parts[0] || 0) + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  function timeLabel(hours) {
    const total = Math.round(Math.max(0, hours) * 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  function inpTime(hours) {
    const h = Math.floor(hours + 1e-9);
    const m = Math.round((hours - h) * 60);
    return h + ':' + String(m).padStart(2, '0');
  }

  function splitLine(line) {
    const clean = line.replace(/;.*$/, '').trim();
    if (!clean) return [];
    return clean.split(/\s+/);
  }

  function parseInp(text, fallbackName) {
    const warnings = [];
    const sections = new Map();
    let current = '_';
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    lines.forEach(function (raw) {
      const line = raw.replace(/\r$/, '');
      const m = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (m) {
        current = m[1].trim().toUpperCase();
        if (!sections.has(current)) sections.set(current, []);
        return;
      }
      if (current === '_') return;
      if (line.trim()) sections.get(current).push(line);
    });

    const optionTokens = [];
    (sections.get('OPTIONS') || []).forEach(function (line) {
      const parts = splitLine(line);
      if (parts.length >= 2) optionTokens.push(parts);
    });
    function option(name, fallback) {
      for (let i = 0; i < optionTokens.length; i++) {
        if (optionTokens[i][0].toUpperCase() === name.toUpperCase()) return optionTokens[i][1];
      }
      return fallback;
    }

    const unitCode = String(option('UNITS', 'LPS')).toUpperCase();
    const flowFactor = FLOW_TO_LPS[unitCode] || 1;
    const isUS = US_UNITS.indexOf(unitCode) >= 0;
    if (!FLOW_TO_LPS[unitCode]) warnings.push('Unknown unit system "' + unitCode + '"; assuming LPS.');
    const lenFactor = isUS ? FT : 1;
    const pipeDiamFactor = isUS ? IN : 1; // EPANET SI pipes use mm
    const tankDiamFactor = isUS ? FT : 1;

    function length(v) { return num(v) * lenFactor; }
    function head(v) { return num(v) * lenFactor; }
    function pipeDiam(v) { return num(v) * pipeDiamFactor; }
    function tankDiam(v) { return num(v) * tankDiamFactor; }
    function flow(v) { return num(v) * flowFactor; }

    const patterns = {};
    (sections.get('PATTERNS') || []).forEach(function (line) {
      const parts = splitLine(line);
      if (parts.length < 2) return;
      const id = parts[0];
      if (!patterns[id]) patterns[id] = [];
      for (let i = 1; i < parts.length; i++) {
        const v = Number(parts[i]);
        if (Number.isFinite(v)) patterns[id].push(v);
      }
    });

    const curves = {};
    (sections.get('CURVES') || []).forEach(function (line) {
      const parts = splitLine(line);
      if (parts.length < 3) return;
      const id = parts[0];
      if (!curves[id]) curves[id] = [];
      curves[id].push({ x: flow(parts[1]), y: head(parts[2]) });
    });
    Object.keys(curves).forEach(function (id) {
      curves[id].sort(function (a, b) { return a.x - b.x; });
    });

    const nodes = [];
    const nodeById = new Map();
    function addNode(node) {
      if (!node.id) return;
      if (nodeById.has(node.id)) {
        warnings.push('Duplicate node ID ' + node.id + ' was skipped.');
        return;
      }
      node.x = num(node.x, 0);
      node.y = num(node.y, 0);
      nodeById.set(node.id, node);
      nodes.push(node);
    }

    const defaultPattern = option('PATTERN', '');

    (sections.get('JUNCTIONS') || []).forEach(function (line) {
      const p = splitLine(line);
      if (p.length < 2) return;
      addNode({
        id: p[0],
        type: 'junction',
        elevation: length(p[1]),
        demand: flow(p[2] || 0),
        pattern: p[3] || defaultPattern || '',
        x: 0,
        y: 0
      });
    });

    (sections.get('RESERVOIRS') || []).forEach(function (line) {
      const p = splitLine(line);
      if (p.length < 2) return;
      addNode({
        id: p[0],
        type: 'reservoir',
        elevation: 0,
        head: head(p[1]),
        pattern: p[2] || '',
        x: 0,
        y: 0
      });
    });

    (sections.get('TANKS') || []).forEach(function (line) {
      const p = splitLine(line);
      if (p.length < 6) return;
      const elev = head(p[1]);
      const init = head(p[2]);
      const min = head(p[3]);
      const max = head(p[4]);
      const diam = tankDiam(p[5]);
      if (p[7] && num(p[7]) > 0) warnings.push('Tank ' + p[0] + ' uses a volume curve; only the cylindrical approximation is supported.');
      addNode({
        id: p[0],
        type: 'tank',
        elevation: elev,
        level: Math.max(0, init),
        minLevel: Math.max(0, min),
        maxLevel: Math.max(min, max),
        diameter: Math.max(0.1, diam),
        x: 0,
        y: 0
      });
    });

    // Coordinate pass before links so exported geometry is available.
    (sections.get('COORDINATES') || []).forEach(function (line) {
      const p = splitLine(line);
      if (p.length < 3) return;
      const n = nodeById.get(p[0]);
      if (n) { n.x = num(p[1]); n.y = num(p[2]); }
    });

    // Additional demand categories.
    (sections.get('DEMANDS') || []).forEach(function (line) {
      const p = splitLine(line);
      if (p.length < 2) return;
      const n = nodeById.get(p[0]);
      if (!n || n.type !== 'junction') return;
      n.demand = num(n.demand, 0) + flow(p[1]);
      if (p[2] && !n.pattern) n.pattern = p[2];
    });

    const links = [];
    const linkById = new Map();
    function addLink(link) {
      if (!link.id) return;
      if (linkById.has(link.id)) {
        warnings.push('Duplicate link ID ' + link.id + ' was skipped.');
        return;
      }
      if (!nodeById.has(link.from) || !nodeById.has(link.to)) {
        warnings.push('Link ' + link.id + ' references a missing node and was skipped.');
        return;
      }
      linkById.set(link.id, link);
      links.push(link);
    }

    (sections.get('PIPES') || []).forEach(function (line) {
      const p = splitLine(line);
      if (p.length < 6) return;
      const status = (p[7] || 'OPEN').toUpperCase().replace('CV', 'OPEN');
      addLink({
        id: p[0],
        type: 'pipe',
        from: p[1],
        to: p[2],
        length: Math.max(0.01, length(p[3])),
        diameter: Math.max(1, pipeDiam(p[4])),
        roughness: Math.max(1, num(p[5], 120)),
        minorLoss: Math.max(0, num(p[6], 0)),
        status: status === 'CLOSED' ? 'CLOSED' : 'OPEN'
      });
    });

    (sections.get('PUMPS') || []).forEach(function (line) {
      const p = splitLine(line);
      if (p.length < 3) return;
      const pump = {
        id: p[0],
        type: 'pump',
        from: p[1],
        to: p[2],
        shutoffHead: 40,
        maxFlow: 30,
        speed: 1,
        status: 'OPEN'
      };
      let curveId = null;
      for (let i = 3; i < p.length; i++) {
        const key = p[i].toUpperCase();
        if (key === 'HEAD' && p[i + 1]) curveId = p[i + 1];
        else if (key === 'POWER') {
          const power = num(p[i + 1], 10);
          const q = 30;
          pump.shutoffHead = Math.max(5, power * 1000 / (9.81 * Math.max(0.001, q / 1000)));
          pump.maxFlow = q;
          warnings.push('Pump ' + pump.id + ' uses a POWER definition; approximated with a head curve.');
        } else if (key === 'SPEED') pump.speed = Math.max(0, num(p[i + 1], 1));
        else if (key === 'PATTERN') { /* demand pattern not used for pumps */ }
      }
      if (curveId && curves[curveId] && curves[curveId].length) {
        const pts = curves[curveId].filter(function (pt) { return pt.x >= 0; });
        if (pts.length) {
          const h0 = Math.max.apply(null, pts.map(function (pt) { return pt.y; }));
          const last = pts[pts.length - 1];
          let qmax = last.x;
          if (last.y > 0.01) {
            const b = (h0 - last.y) / Math.max(1e-9, last.x * last.x);
            qmax = b > 0 ? Math.sqrt(h0 / b) : last.x * 1.2;
          }
          pump.shutoffHead = h0 > 0 ? h0 : 30;
          pump.maxFlow = Math.max(1, qmax);
        } else {
          warnings.push('Pump curve ' + curveId + ' has no usable points.');
        }
      } else if (!curveId) {
        warnings.push('Pump ' + pump.id + ' has no head curve; using defaults.');
      }
      addLink(pump);
    });

    (sections.get('VALVES') || []).forEach(function (line) {
      const p = splitLine(line);
      if (p.length < 5) return;
      const vtype = (p[4] || 'TCV').toUpperCase();
      let setting = head(p[5]);
      if (vtype === 'TCV') {
        setting = num(p[5], 0);
      } else {
        warnings.push('Valve ' + p[0] + ' (' + vtype + ') is modelled as a TCV loss; advanced valve controls are not supported.');
        setting = Math.max(0.01, num(p[6], 0.1));
      }
      addLink({
        id: p[0],
        type: 'valve',
        valveType: vtype,
        from: p[1],
        to: p[2],
        diameter: Math.max(1, pipeDiam(p[3])),
        setting: setting,
        status: 'OPEN'
      });
    });

    (sections.get('STATUS') || []).forEach(function (line) {
      const p = splitLine(line);
      if (p.length < 2) return;
      const l = linkById.get(p[0]);
      if (!l) return;
      const v = p[1].toUpperCase();
      if (v === 'CLOSED') l.status = 'CLOSED';
      else if (v === 'OPEN') l.status = 'OPEN';
      else if (l.type === 'pump' && Number.isFinite(Number(v))) l.speed = Math.max(0, Number(v));
    });

    const timesSection = (sections.get('TIMES') || []).map(splitLine);
    function timeOption(name, fallback) {
      for (let i = 0; i < timesSection.length; i++) {
        const parts = timesSection[i];
        // Time keywords contain spaces ("Hydraulic Timestep"), so join all but the value.
        const key = parts.slice(0, -1).join(' ').toUpperCase();
        if (key === name.toUpperCase()) return parts[parts.length - 1];
      }
      return fallback;
    }
    const duration = parseTimeHours(timeOption('DURATION', option('DURATION', '0:00')));
    const hydraulicStep = parseTimeHours(timeOption('HYDRAULIC TIMESTEP', '1:00')) || 1;
    const patternStep = parseTimeHours(timeOption('PATTERN TIMESTEP', '1:00')) || 1;
    const demandMultiplier = num(option('DEMAND MULTIPLIER', 1), 1);
    const title = (sections.get('TITLE') || []).filter(function (l) { return !/^\s*;/.test(l); }).map(function (l) { return l.trim(); }).filter(Boolean).join(' ');

    // Fallback layout for nodes without coordinates.
    const hasCoords = nodes.some(function (n) { return n.x !== 0 || n.y !== 0; });
    if (!hasCoords) layoutNodes(nodes, links);
    else {
      nodes.forEach(function (n, i) {
        if (n.x === 0 && n.y === 0) {
          const neighbor = links.find(function (l) { return l.from === n.id || l.to === n.id; });
          const other = neighbor ? nodeById.get(neighbor.from === n.id ? neighbor.to : neighbor.from) : null;
          if (other && (other.x !== 0 || other.y !== 0)) {
            n.x = other.x + 70 * Math.cos(i);
            n.y = other.y + 70 * Math.sin(i);
          } else {
            n.x = (i % 5) * 90;
            n.y = Math.floor(i / 5) * 90;
          }
        }
      });
    }

    nodes.forEach(function (n) {
      if (n.type === 'junction' && !n.pattern && defaultPattern && patterns[defaultPattern]) n.pattern = defaultPattern;
    });

    const project = {
      format: 'waternet',
      version: 1,
      name: (title || fallbackName || 'Imported network').slice(0, 80),
      units: 'SI',
      sourceUnits: unitCode,
      options: {
        duration: Math.max(0, duration),
        hydraulicStep: hydraulicStep,
        demandMultiplier: demandMultiplier,
        patternStep: patternStep
      },
      patterns: patterns,
      nodes: nodes,
      links: links
    };

    if (!nodes.length) warnings.push('No nodes were found in this INP file.');
    if (!links.length) warnings.push('No links were found in this INP file.');
    if (duration <= 0) warnings.push('INP duration is 0; WaterNet will run a single steady-state snapshot.');

    return { project: project, warnings: warnings };
  }

  function layoutNodes(nodes, links) {
    // Simple spring-ish layout: sources on the left, then BFS layers.
    const byId = new Map(nodes.map(function (n) { return [n.id, n]; }));
    const adj = new Map();
    nodes.forEach(function (n) { adj.set(n.id, []); });
    links.forEach(function (l) {
      if (adj.has(l.from)) adj.get(l.from).push(l.to);
      if (adj.has(l.to)) adj.get(l.to).push(l.from);
    });
    const sources = nodes.filter(function (n) { return n.type !== 'junction'; });
    const seen = new Set();
    const layers = [];
    let frontier = sources.length ? sources.map(function (n) { return n.id; }) : [nodes[0] && nodes[0].id];
    frontier.forEach(function (id) { seen.add(id); });
    while (frontier.length) {
      layers.push(frontier);
      const next = [];
      frontier.forEach(function (id) {
        (adj.get(id) || []).forEach(function (nb) {
          if (!seen.has(nb)) { seen.add(nb); next.push(nb); }
        });
      });
      frontier = next;
    }
    const remaining = nodes.filter(function (n) { return !seen.has(n.id); });
    if (remaining.length) layers.push(remaining.map(function (n) { return n.id; }));
    layers.forEach(function (layer, li) {
      layer.forEach(function (id, i) {
        const n = byId.get(id);
        if (!n) return;
        n.x = li * 130;
        n.y = (layer.length - 1) * 55 - i * 110;
      });
    });
  }

  function toInp(project) {
    const nodes = project.nodes || [];
    const links = project.links || [];
    const opt = project.options || {};
    const patterns = project.patterns || {};
    const out = [];
    out.push('[TITLE]');
    out.push(' ' + (project.name || 'WaterNet model'));
    out.push('; Exported by WaterNet');
    out.push('');
    out.push('[JUNCTIONS]');
    out.push(';ID              Elev            Demand          Pattern');
    nodes.filter(function (n) { return n.type === 'junction'; }).forEach(function (n, i) {
      out.push(pad(n.id, 16) + pad(fmt(n.elevation), 16) + pad(fmt(n.demand), 16) + (n.pattern || ''));
    });
    out.push('');
    out.push('[RESERVOIRS]');
    out.push(';ID              Head            Pattern');
    nodes.filter(function (n) { return n.type === 'reservoir'; }).forEach(function (n) {
      out.push(pad(n.id, 16) + pad(fmt(n.head), 16) + (n.pattern || ''));
    });
    out.push('');
    out.push('[TANKS]');
    out.push(';ID              Elevation       InitLevel       MinLevel        MaxLevel        Diameter        MinVol  VolCurve');
    nodes.filter(function (n) { return n.type === 'tank'; }).forEach(function (n) {
      out.push(pad(n.id, 16) + pad(fmt(n.elevation), 16) + pad(fmt(n.level), 16) + pad(fmt(n.minLevel), 16) + pad(fmt(n.maxLevel), 16) + pad(fmt(n.diameter), 16) + '0');
    });
    out.push('');
    out.push('[PIPES]');
    out.push(';ID              Node1           Node2           Length          Diameter        Roughness       MinorLoss       Status');
    links.filter(function (l) { return l.type === 'pipe'; }).forEach(function (l) {
      out.push(pad(l.id, 16) + pad(l.from, 16) + pad(l.to, 16) + pad(fmt(l.length), 16) + pad(fmt(l.diameter), 16) + pad(fmt(l.roughness), 16) + pad(fmt(l.minorLoss || 0), 16) + (l.status || 'OPEN'));
    });
    out.push('');
    out.push('[PUMPS]');
    out.push(';ID              Node1           Node2           Parameters');
    const pumps = links.filter(function (l) { return l.type === 'pump'; });
    pumps.forEach(function (l) {
      out.push(pad(l.id, 16) + pad(l.from, 16) + pad(l.to, 16) + 'HEAD ' + l.id + '_curve' + (num(l.speed, 1) !== 1 ? ' SPEED ' + fmt(l.speed, 3) : ''));
    });
    out.push('');
    out.push('[VALVES]');
    out.push(';ID              Node1           Node2           Diameter        Type    Setting MinorLoss');
    links.filter(function (l) { return l.type === 'valve'; }).forEach(function (l) {
      out.push(pad(l.id, 16) + pad(l.from, 16) + pad(l.to, 16) + pad(fmt(l.diameter), 16) + 'TCV     ' + pad(fmt(l.setting), 8) + '0');
    });
    out.push('');
    out.push('[PATTERNS]');
    out.push(';ID              Multipliers');
    Object.keys(patterns).forEach(function (id) {
      const vals = patterns[id] || [];
      for (let i = 0; i < vals.length; i += 6) {
        const chunk = vals.slice(i, i + 6).map(function (v) { return fmt(v, 4); });
        out.push(pad(id, 16) + chunk.join(' '));
      }
    });
    out.push('');
    out.push('[CURVES]');
    out.push(';ID              Flow            Head');
    pumps.forEach(function (l) {
      const h0 = Math.max(0.01, num(l.shutoffHead, 40));
      const qmax = Math.max(0.1, num(l.maxFlow, 30));
      out.push(pad(l.id + '_curve', 16) + pad('0', 16) + fmt(h0));
      out.push(pad(l.id + '_curve', 16) + pad(fmt(qmax / 2), 16) + fmt(h0 * 0.75));
      out.push(pad(l.id + '_curve', 16) + pad(fmt(qmax), 16) + '0');
    });
    out.push('');
    out.push('[COORDINATES]');
    out.push(';Node            X-Coord         Y-Coord');
    nodes.forEach(function (n) {
      out.push(pad(n.id, 16) + pad(fmt(n.x), 16) + fmt(n.y));
    });
    out.push('');
    out.push('[OPTIONS]');
    out.push(' Units           LPS');
    out.push(' Headloss        H-W');
    out.push(' Demand Multiplier ' + fmt(opt.demandMultiplier || 1, 3));
    out.push(' Pattern         ' + (opt.defaultPattern || Object.keys(patterns)[0] || '1'));
    out.push(' Trials          120');
    out.push(' Accuracy        0.000001');
    out.push('');
    out.push('[TIMES]');
    out.push(' Duration        ' + inpTime(opt.duration || 0));
    out.push(' Hydraulic Timestep ' + inpTime(opt.hydraulicStep || 1));
    out.push(' Pattern Timestep ' + inpTime(opt.patternStep || 1));
    out.push('');
    out.push('[REPORT]');
    out.push(' Status          YES');
    out.push(' Summary         YES');
    out.push('');
    out.push('[END]');
    out.push('');
    return out.join('\n');
  }

  function pad(s, n) {
    const str = String(s === undefined || s === null ? '' : s);
    return str.length >= n ? str + ' ' : str + new Array(n - str.length + 1).join(' ');
  }

  function cloneProject(project) {
    return JSON.parse(JSON.stringify(project));
  }

  function normalizeProject(project) {
    const p = project || {};
    p.format = 'waternet';
    p.version = 1;
    p.name = p.name || 'Untitled network';
    p.options = Object.assign({ duration: 24, hydraulicStep: 1, demandMultiplier: 1, patternStep: 1 }, p.options || {});
    p.patterns = p.patterns || {};
    p.nodes = Array.isArray(p.nodes) ? p.nodes : [];
    p.links = Array.isArray(p.links) ? p.links : [];
    p.nodes.forEach(function (n) {
      n.x = num(n.x, 0);
      n.y = num(n.y, 0);
      if (n.type === 'junction') {
        n.elevation = num(n.elevation, 0);
        n.demand = num(n.demand, 0);
        n.pattern = n.pattern || '';
      } else if (n.type === 'reservoir') {
        n.head = num(n.head, 50);
      } else if (n.type === 'tank') {
        n.elevation = num(n.elevation, 0);
        n.level = num(n.level, 5);
        n.minLevel = num(n.minLevel, 0);
        n.maxLevel = Math.max(n.minLevel, num(n.maxLevel, 10));
        n.diameter = Math.max(0.1, num(n.diameter, 10));
      }
    });
    p.links.forEach(function (l) {
      l.status = l.status || 'OPEN';
      if (l.type === 'pipe') {
        l.length = Math.max(0.01, num(l.length, 100));
        l.diameter = Math.max(1, num(l.diameter, 200));
        l.roughness = Math.max(1, num(l.roughness, 120));
        l.minorLoss = Math.max(0, num(l.minorLoss, 0));
      } else if (l.type === 'pump') {
        l.shutoffHead = Math.max(0.01, num(l.shutoffHead, 40));
        l.maxFlow = Math.max(0.1, num(l.maxFlow, 30));
        l.speed = num(l.speed, 1);
      } else if (l.type === 'valve') {
        l.diameter = Math.max(1, num(l.diameter, 200));
        l.setting = Math.max(0, num(l.setting, 0));
        l.valveType = l.valveType || 'TCV';
      }
    });
    return p;
  }

  return {
    parseInp: parseInp,
    toInp: toInp,
    cloneProject: cloneProject,
    normalizeProject: normalizeProject,
    parseTimeHours: parseTimeHours,
    timeLabel: timeLabel,
    inpTime: inpTime,
    FLOW_TO_LPS: FLOW_TO_LPS
  };
});
