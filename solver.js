/*!
 * WaterNet hydraulic engine
 * Global Gradient Algorithm (Todini) for pressurized water networks.
 * SI units internally: m, m3/s, m3.
 * Model input uses m for heads/lengths, mm for diameters, L/s for demands.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WaterNetSolver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const G = 9.80665;
  const HW_EXP = 1.852;
  const HW_COEF = 10.674;
  const M3_PER_L = 0.001;
  const D2R = Math.PI / 180;

  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }
  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }
  function sign(v) {
    return v < 0 ? -1 : 1;
  }
  function areaOf(diameterMm) {
    const d = Math.max(1e-5, num(diameterMm) / 1000);
    return Math.PI * d * d / 4;
  }
  function hwResistance(lengthM, diameterMm, c) {
    const d = Math.max(1e-5, num(diameterMm) / 1000);
    const cc = Math.max(1, num(c, 120));
    return HW_COEF * Math.max(0.001, num(lengthM)) / (Math.pow(cc, HW_EXP) * Math.pow(d, 4.871));
  }
  function minorCoef(k, diameterMm) {
    const d = Math.max(1e-5, num(diameterMm) / 1000);
    return 8 * Math.max(0, num(k)) / (G * Math.PI * Math.PI * Math.pow(d, 4));
  }

  function patternMultiplier(project, patternId, timeHours) {
    const patterns = project.patterns || {};
    const list = patterns[patternId];
    if (!Array.isArray(list) || !list.length) return 1;
    const step = Math.max(0.01, num(project.options && project.options.patternStep, 1));
    const idx = ((Math.floor(timeHours / step) % list.length) + list.length) % list.length;
    const v = Number(list[idx]);
    return Number.isFinite(v) ? v : 1;
  }

  /* ---------- model preparation ---------- */

  function prepareLink(link) {
    const type = link.type || 'pipe';
    const l = {
      id: link.id,
      type,
      from: link.from,
      to: link.to,
      q: 0,
      h: 0,
      g: 1,
      E: 0,
      dq: 0
    };
    if (type === 'pump') {
      l.h0 = Math.max(0.01, num(link.shutoffHead, 40));
      const qmax = Math.max(0.0001, num(link.maxFlow, 30) / 1000);
      l.b = l.h0 / (qmax * qmax);
      l.speed = clamp(num(link.speed, 1), 0, 5);
      l.area = 0;
      l.diameter = 0;
    } else if (type === 'valve') {
      l.diameter = Math.max(1, num(link.diameter, 200));
      l.km = minorCoef(num(link.setting, 0), l.diameter);
      l.r = 0;
      l.area = areaOf(l.diameter);
    } else {
      l.diameter = Math.max(1, num(link.diameter, 200));
      l.r = hwResistance(link.length, l.diameter, link.roughness);
      l.km = minorCoef(link.minorLoss, l.diameter);
      l.area = areaOf(l.diameter);
    }
    return l;
  }

  function linkLoss(l, q) {
    const aq = Math.abs(q);
    if (l.type === 'pump') {
      // h = Ha - Hb = -(h0*speed^2 - b*q^2)  (positive q = pump direction)
      const s2 = l.speed * l.speed;
      const qe = Math.max(q, 0);
      return {
        h: -(l.h0 * s2 - l.b * qe * qe),
        g: 2 * l.b * qe + 1e-7
      };
    }
    if (l.type === 'valve') {
      return {
        h: sign(q) * l.km * aq * aq,
        g: 2 * l.km * aq + 1e-9
      };
    }
    return {
      h: sign(q) * (l.r * Math.pow(aq, HW_EXP) + l.km * aq * aq),
      g: HW_EXP * l.r * Math.pow(aq, HW_EXP - 1) + 2 * l.km * aq + 1e-9
    };
  }

  /* ---------- linear algebra ---------- */

  function solveDense(A, b, n) {
    // Cholesky for symmetric positive definite A (row-major), returns x.
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = A[i * n + j];
        for (let k = 0; k < j; k++) sum -= A[i * n + k] * A[j * n + k];
        if (i === j) {
          A[i * n + i] = Math.sqrt(Math.max(sum, 1e-14));
        } else {
          A[i * n + j] = sum / (A[j * n + j] || 1e-14);
        }
      }
    }
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = b[i];
      for (let k = 0; k < i; k++) sum -= A[i * n + k] * y[k];
      y[i] = sum / (A[i * n + i] || 1e-14);
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let sum = y[i];
      for (let k = i + 1; k < n; k++) sum -= A[k * n + i] * x[k];
      x[i] = sum / (A[i * n + i] || 1e-14);
    }
    return x;
  }

  function pcg(links, idx, diag, rhs, n) {
    // Jacobi-preconditioned conjugate gradient on the weighted Laplacian.
    const x = new Float64Array(n);
    const r = Float64Array.from(rhs);
    const z = new Float64Array(n);
    const p = new Float64Array(n);
    const Ap = new Float64Array(n);
    let rhsNorm = 0;
    for (let i = 0; i < n; i++) rhsNorm += rhs[i] * rhs[i];
    rhsNorm = Math.sqrt(rhsNorm);
    if (rhsNorm < 1e-14) return x;
    for (let i = 0; i < n; i++) z[i] = r[i] / (diag[i] || 1e-12);
    p.set(z);
    let rz = 0;
    for (let i = 0; i < n; i++) rz += r[i] * z[i];
    const maxIter = Math.min(400, Math.max(30, n * 2));
    const tol = rhsNorm * 1e-8;
    for (let it = 0; it < maxIter; it++) {
      Ap.fill(0);
      for (let k = 0; k < links.length; k++) {
        const l = links[k];
        const w = 1 / l.g;
        const ia = idx.has(l.from) ? idx.get(l.from) : -1;
        const ib = idx.has(l.to) ? idx.get(l.to) : -1;
        if (ia < 0 && ib < 0) continue;
        let diff = 0;
        if (ib >= 0) diff += p[ib];
        if (ia >= 0) diff -= p[ia];
        if (ia >= 0) Ap[ia] -= w * diff;
        if (ib >= 0) Ap[ib] += w * diff;
      }
      let pAp = 0;
      for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
      if (!(pAp > 0)) break;
      const alpha = rz / pAp;
      let rnorm = 0;
      for (let i = 0; i < n; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
        rnorm += r[i] * r[i];
      }
      if (Math.sqrt(rnorm) <= tol) break;
      for (let i = 0; i < n; i++) z[i] = r[i] / (diag[i] || 1e-12);
      let rzNew = 0;
      for (let i = 0; i < n; i++) rzNew += r[i] * z[i];
      const beta = rzNew / (rz || 1e-30);
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
      rz = rzNew;
    }
    return x;
  }

  /* ---------- one hydraulic snapshot ---------- */

  function solveStep(project, ctx) {
    ctx = ctx || {};
    const demandMultiplier = num(ctx.demandMultiplier, 1);
    const time = num(ctx.time, 0);
    const tankLevels = ctx.tankLevels || new Map();
    const warnings = [];

    const allNodes = project.nodes || [];
    const nodeById = new Map();
    allNodes.forEach(function (n) { nodeById.set(n.id, n); });

    const fixed = new Map();
    allNodes.forEach(function (n) {
      if (n.type === 'reservoir') {
        fixed.set(n.id, num(n.head, 0));
      } else if (n.type === 'tank') {
        const lvl = tankLevels.has(n.id) ? tankLevels.get(n.id) : num(n.level, 0);
        fixed.set(n.id, num(n.elevation, 0) + lvl);
      }
    });

    const junctions = allNodes.filter(function (n) { return n.type === 'junction'; });
    const demands = new Map();
    junctions.forEach(function (n) {
      const base = num(n.demand, 0) * M3_PER_L;
      demands.set(n.id, base * patternMultiplier(project, n.pattern, time) * demandMultiplier);
    });

    const rawLinks = [];
    (project.links || []).forEach(function (l) {
      if ((l.status || 'OPEN') === 'CLOSED') return;
      if (!nodeById.has(l.from) || !nodeById.has(l.to) || l.from === l.to) {
        warnings.push('Link ' + l.id + ' was ignored (invalid endpoints).');
        return;
      }
      if (l.type !== 'pipe' && l.type !== 'pump' && l.type !== 'valve') return;
      rawLinks.push(prepareLink(l));
    });

    // Union-find to locate components without any fixed-head source.
    const uf = new Map();
    allNodes.forEach(function (n) { uf.set(n.id, n.id); });
    function find(x) {
      let r = x;
      while (uf.get(r) !== r) r = uf.get(r);
      while (uf.get(x) !== r) { const nx = uf.get(x); uf.set(x, r); x = nx; }
      return r;
    }
    function union(a, b) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) uf.set(ra, rb);
    }
    rawLinks.forEach(function (l) { union(l.from, l.to); });
    const sourced = new Set();
    allNodes.forEach(function (n) { if (fixed.has(n.id)) sourced.add(find(n.id)); });
    const disconnected = new Set();
    junctions.forEach(function (n) {
      if (!sourced.has(find(n.id))) disconnected.add(n.id);
    });

    const links = rawLinks.filter(function (l) {
      return !disconnected.has(l.from) && !disconnected.has(l.to);
    });

    const solJunctions = junctions.filter(function (n) { return !disconnected.has(n.id); });
    const idx = new Map();
    solJunctions.forEach(function (n, i) { idx.set(n.id, i); });
    const nJ = solJunctions.length;

    if (disconnected.size) {
      warnings.push(disconnected.size + ' junction' + (disconnected.size === 1 ? '' : 's') + ' isolated from any reservoir/tank.');
    }

    const H = new Float64Array(nJ);
    if (fixed.size) {
      let sum = 0;
      fixed.forEach(function (h) { sum += h; });
      H.fill(sum / fixed.size);
    }

    let positiveDemand = 0;
    demands.forEach(function (d) { if (d > 0) positiveDemand += d; });
    const qInit = clamp(positiveDemand / Math.max(1, links.length) * 0.5, 0.0002, 0.02);
    links.forEach(function (l) {
      if (l.type === 'pump') l.q = Math.max(1e-5, 0.5 * l.speed * Math.sqrt(l.h0 / l.b));
      else l.q = Math.max(1e-5, qInit);
    });

    const flowTol = 1e-9;
    const headTol = 1e-5;
    let iterations = 0;
    let converged = false;
    let message = '';
    let lastRes = null;

    function evaluate(Harr) {
      let maxC = 0;
      let maxE = 0;
      const C = new Float64Array(nJ);
      for (let k = 0; k < links.length; k++) {
        const l = links[k];
        const res = linkLoss(l, l.q);
        l.h = res.h;
        l.g = Math.max(res.g, 1e-9);
        const ha = fixed.has(l.from) ? fixed.get(l.from) : Harr[idx.get(l.from)];
        const hb = fixed.has(l.to) ? fixed.get(l.to) : Harr[idx.get(l.to)];
        l.E = l.h + hb - ha;
        const ae = Math.abs(l.E);
        if (ae > maxE) maxE = ae;
        if (idx.has(l.from)) C[idx.get(l.from)] -= l.q;
        if (idx.has(l.to)) C[idx.get(l.to)] += l.q;
      }
      for (let i = 0; i < nJ; i++) {
        C[i] -= demands.get(solJunctions[i].id) || 0;
        const ac = Math.abs(C[i]);
        if (ac > maxC) maxC = ac;
      }
      return { maxC: maxC, maxE: maxE, C: C };
    }

    function residualNorm(r) {
      return Math.max(r.maxC / flowTol, r.maxE / headTol, 1e-30);
    }

    if (nJ > 0 && links.length > 0) {
      for (let it = 1; it <= 120; it++) {
        iterations = it;
        const res = evaluate(H);
        lastRes = res;
        if (res.maxC <= flowTol && res.maxE <= headTol) {
          converged = true;
          break;
        }

        const S = new Float64Array(nJ * nJ);
        const rhs = new Float64Array(nJ);
        rhs.set(res.C);
        const diag = new Float64Array(nJ);
        for (let k = 0; k < links.length; k++) {
          const l = links[k];
          const w = 1 / l.g;
          const ia = idx.has(l.from) ? idx.get(l.from) : -1;
          const ib = idx.has(l.to) ? idx.get(l.to) : -1;
          if (ia >= 0) {
            rhs[ia] += l.E * w;
            S[ia * nJ + ia] += w;
            diag[ia] += w;
            if (ib >= 0) S[ia * nJ + ib] -= w;
          }
          if (ib >= 0) {
            rhs[ib] -= l.E * w;
            S[ib * nJ + ib] += w;
            diag[ib] += w;
            if (ia >= 0) S[ib * nJ + ia] -= w;
          }
        }
        for (let i = 0; i < nJ; i++) S[i * nJ + i] += 1e-10;

        let dH;
        try {
          dH = nJ <= 220 ? solveDense(S, rhs, nJ) : pcg(links, idx, diag, rhs, nJ);
        } catch (err) {
          message = 'Linear solver failed.';
          break;
        }
        if (!dH) { message = 'Linear solver failed.'; break; }
        let bad = false;
        for (let i = 0; i < nJ; i++) if (!Number.isFinite(dH[i])) bad = true;
        if (bad) { message = 'Numerical instability in linear solver.'; break; }

        for (let k = 0; k < links.length; k++) {
          const l = links[k];
          const dha = idx.has(l.from) ? dH[idx.get(l.from)] : 0;
          const dhb = idx.has(l.to) ? dH[idx.get(l.to)] : 0;
          l.dq = (-l.E - (dhb - dha)) / l.g;
        }

        let maxdH = 0;
        for (let i = 0; i < nJ; i++) maxdH = Math.max(maxdH, Math.abs(dH[i]));
        let alpha = maxdH > 400 ? 400 / maxdH : 1;
        const qStart = links.map(function (l) { return l.q; });
        const base = residualNorm(res);
        let accepted = false;
        for (let ls = 0; ls < 7; ls++) {
          const Ht = new Float64Array(nJ);
          for (let i = 0; i < nJ; i++) Ht[i] = H[i] + alpha * dH[i];
          for (let k = 0; k < links.length; k++) {
            const l = links[k];
            let q = qStart[k] + alpha * l.dq;
            if (l.type === 'pump') q = Math.max(0, q);
            l.q = q;
          }
          const res2 = evaluate(Ht);
          if (residualNorm(res2) <= base || alpha < 1e-4) {
            H.set(Ht);
            lastRes = res2;
            accepted = true;
            break;
          }
          alpha *= 0.5;
        }
        if (!accepted) {
          for (let k = 0; k < links.length; k++) links[k].q = qStart[k];
          message = 'Newton iteration stalled.';
          break;
        }
      }
      if (iterations >= 120 && !converged) message = message || 'Maximum iterations reached.';
    } else if (nJ === 0) {
      converged = true;
      // Directly evaluate links between fixed-head nodes.
      links.forEach(function (l) {
        const dH = (fixed.get(l.from) || 0) - (fixed.get(l.to) || 0);
        if (l.type === 'pump') {
          const s2 = l.speed * l.speed;
          const q2 = (l.h0 * s2 + dH) / l.b;
          l.q = q2 > 0 ? Math.sqrt(q2) : 0;
        } else if (l.type === 'valve') {
          l.q = l.km > 0 ? sign(dH) * Math.sqrt(Math.abs(dH) / l.km) : 0;
        } else {
          l.q = sign(dH) * Math.pow(Math.abs(dH) / Math.max(l.r, 1e-12), 1 / HW_EXP);
        }
        const res = linkLoss(l, l.q);
        l.h = res.h;
        l.g = Math.max(res.g, 1e-9);
        l.E = l.h + (fixed.get(l.to) || 0) - (fixed.get(l.from) || 0);
      });
    } else if (links.length === 0) {
      message = 'No active links in the model.';
    }

    if (!converged) {
      warnings.push('Hydraulic solution did not fully converge' + (message ? ': ' + message : '.'));
    }

    /* ---------- package results ---------- */

    const net = new Map();
    allNodes.forEach(function (n) { net.set(n.id, 0); });
    links.forEach(function (l) {
      net.set(l.from, (net.get(l.from) || 0) - l.q);
      net.set(l.to, (net.get(l.to) || 0) + l.q);
    });

    const nodeResults = {};
    allNodes.forEach(function (n) {
      if (n.type === 'junction') {
        const connected = !disconnected.has(n.id);
        const head = connected ? H[idx.get(n.id)] : null;
        nodeResults[n.id] = {
          id: n.id,
          type: 'junction',
          connected: connected,
          head: head,
          pressure: head === null ? null : head - num(n.elevation, 0),
          demandLps: num(n.demand, 0) * patternMultiplier(project, n.pattern, time) * demandMultiplier,
          netFlowLps: (net.get(n.id) || 0) * 1000
        };
      } else if (n.type === 'reservoir') {
        const head = fixed.get(n.id);
        nodeResults[n.id] = {
          id: n.id,
          type: 'reservoir',
          connected: true,
          head: head,
          pressure: head - num(n.elevation, 0),
          level: null,
          demandLps: 0,
          netFlowLps: (net.get(n.id) || 0) * 1000
        };
      } else if (n.type === 'tank') {
        const head = fixed.get(n.id);
        const lvl = tankLevels.has(n.id) ? tankLevels.get(n.id) : num(n.level, 0);
        nodeResults[n.id] = {
          id: n.id,
          type: 'tank',
          connected: true,
          head: head,
          pressure: lvl,
          level: lvl,
          demandLps: 0,
          netFlowLps: (net.get(n.id) || 0) * 1000
        };
      }
    });

    const linkResults = {};
    links.forEach(function (l) {
      const vel = l.area > 0 ? Math.abs(l.q) / l.area : 0;
      let flowLps = l.q * 1000;
      if (l.type === 'pump' && flowLps < 0) flowLps = 0;
      linkResults[l.id] = {
        id: l.id,
        type: l.type,
        from: l.from,
        to: l.to,
        flowLps: flowLps,
        velocity: l.type === 'pump' ? 0 : vel,
        headloss: Math.abs(l.h),
        headGain: l.type === 'pump' ? -l.h : 0,
        status: (l.type === 'pump' && flowLps <= 1e-5) ? 'CHECK' : 'OPEN'
      };
    });

    let maxPressure = null, minPressure = null, maxVelocity = null;
    solJunctions.forEach(function (n) {
      const r = nodeResults[n.id];
      if (r.pressure === null) return;
      if (!maxPressure || r.pressure > maxPressure.value) maxPressure = { id: n.id, value: r.pressure };
      if (!minPressure || r.pressure < minPressure.value) minPressure = { id: n.id, value: r.pressure };
    });
    links.forEach(function (l) {
      if (l.type === 'pump') return;
      const v = linkResults[l.id].velocity;
      if (!maxVelocity || v > maxVelocity.value) maxVelocity = { id: l.id, value: v };
    });

    let totalDemand = 0;
    solJunctions.forEach(function (n) { totalDemand += Math.max(0, demands.get(n.id) || 0); });
    let sourceOutflow = 0;
    fixed.forEach(function (h, id) {
      const outflow = -(net.get(id) || 0);
      if (outflow > 0) sourceOutflow += outflow;
    });

    const negative = solJunctions.filter(function (n) {
      const p = nodeResults[n.id].pressure;
      return p !== null && p < 0;
    });
    if (negative.length) {
      warnings.push(negative.length + ' junction' + (negative.length === 1 ? '' : 's') + ' with negative pressure.');
    }
    if (maxVelocity && maxVelocity.value > 3) {
      warnings.push('High velocity (' + maxVelocity.value.toFixed(2) + ' m/s) in ' + maxVelocity.id + '.');
    }
    links.forEach(function (l) {
      if (l.type === 'pump' && l.q <= 1e-7) warnings.push('Pump ' + l.id + ' is at shutoff / check-valve closure.');
    });

    return {
      ok: converged,
      time: time,
      iterations: iterations,
      converged: converged,
      message: message,
      warnings: warnings,
      nodes: nodeResults,
      links: linkResults,
      summary: {
        totalDemandLps: totalDemand * 1000,
        sourceSupplyLps: sourceOutflow * 1000,
        maxPressure: maxPressure,
        minPressure: minPressure,
        maxVelocity: maxVelocity,
        junctionCount: solJunctions.length,
        disconnectedCount: disconnected.size
      }
    };
  }

  /* ---------- extended period simulation ---------- */

  function simulate(project, opts) {
    opts = opts || {};
    const options = Object.assign({}, project.options || {}, opts);
    const duration = Math.max(0, num(options.duration, 24));
    const step = clamp(num(options.hydraulicStep, 1), 1 / 60, 24);
    const demandMultiplier = num(options.demandMultiplier, 1);
    const snapshots = [];
    const warnings = [];
    const times = [];
    if (duration <= 0) {
      times.push(0);
    } else {
      const count = Math.floor(duration / step + 1e-9);
      for (let i = 0; i <= count; i++) times.push(Math.round(i * step * 1000) / 1000);
    }

    const tanks = (project.nodes || []).filter(function (n) { return n.type === 'tank'; });
    const levels = new Map();
    tanks.forEach(function (t) {
      const min = num(t.minLevel, 0);
      const max = Math.max(min, num(t.maxLevel, 10));
      levels.set(t.id, clamp(num(t.level, min), min, max));
    });

    let allConverged = true;
    for (let ti = 0; ti < times.length; ti++) {
      const t = times[ti];
      const snap = solveStep(project, {
        time: t,
        demandMultiplier: demandMultiplier,
        tankLevels: levels
      });
      snap.time = t;
      if (!snap.converged) allConverged = false;
      snap.warnings.forEach(function (w) { if (warnings.indexOf(w) < 0) warnings.push(w); });

      // Advance tank levels with the net inflow over this step.
      if (ti < times.length - 1) {
        const dt = times[ti + 1] - t;
        tanks.forEach(function (tank) {
          const res = snap.nodes[tank.id];
          if (!res) return;
          const min = num(tank.minLevel, 0);
          const max = Math.max(min, num(tank.maxLevel, 10));
          const diam = Math.max(0.1, num(tank.diameter, 10));
          const area = Math.PI * diam * diam / 4;
          let lvl = levels.get(tank.id) + (res.netFlowLps / 1000) * dt * 3600 / area;
          if (lvl > max + 1e-6) {
            const msg = 'Tank ' + tank.id + ' reached its maximum level.';
            if (warnings.indexOf(msg) < 0) warnings.push(msg);
            lvl = max;
          }
          if (lvl < min - 1e-6) {
            const msg = 'Tank ' + tank.id + ' reached its minimum level.';
            if (warnings.indexOf(msg) < 0) warnings.push(msg);
            lvl = min;
          }
          snap.nodes[tank.id].levelEnd = lvl;
          levels.set(tank.id, lvl);
        });
      } else {
        tanks.forEach(function (tank) {
          if (snap.nodes[tank.id]) snap.nodes[tank.id].levelEnd = levels.get(tank.id);
        });
      }
      snapshots.push(snap);
    }

    // Mark stale tank heads in results as start-of-step values (documented in UI).
    return {
      ok: allConverged,
      snapshots: snapshots,
      warnings: warnings,
      duration: duration,
      step: step,
      scenario: {
        duration: duration,
        hydraulicStep: step,
        demandMultiplier: demandMultiplier
      }
    };
  }

  return {
    version: '1.0.0',
    constants: { G: G, HW_EXP: HW_EXP, HW_COEF: HW_COEF },
    simulate: simulate,
    solveStep: solveStep,
    patternMultiplier: patternMultiplier,
    hwResistance: hwResistance,
    areaOf: areaOf
  };
});
