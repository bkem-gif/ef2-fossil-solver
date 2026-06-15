/*
 * Dev-only benchmark. Plays full games against hidden fossils using a policy
 * and reports average hammers to uncover them all. Run: node bench.js
 *
 * Models the real information: on revealing any fossil cell you see the shape,
 * so the footprint is known on first contact (completion is then exact).
 */
const FS = require('./solver.js');

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function genBoard(rows, cols, rng, hpChoices) {
  const b = FS.makeBoard(rows, cols, 1);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const hp = hpChoices[Math.floor(rng() * hpChoices.length)];
    b.cells[r][c] = hp === 0 ? { state: 'empty', hp: 0, dmg: 0, fossil: null }
                             : { state: 'covered', hp: hp, dmg: 0, fossil: null };
  }
  return b;
}

function placeFossils(b, K, rng) {
  const truth = {}, foots = [], used = {};
  let id = 0, attempts = 0;
  while (foots.length < K && attempts++ < 4000) {
    const shape = FS.SHAPES[Math.floor(rng() * FS.SHAPES.length)];
    const r = Math.floor(rng() * b.rows), c = Math.floor(rng() * b.cols);
    const cells = shape.cells.map(d => [r + d[0], c + d[1]]);
    if (!cells.every(([rr, cc]) => FS.inBounds(b, rr, cc) && b.cells[rr][cc].state === 'covered')) continue;
    if (!cells.every(([rr, cc]) => !used[rr + ',' + cc])) continue;
    const fid = 'F' + (id++);
    cells.forEach(([rr, cc]) => { used[rr + ',' + cc] = true; truth[rr + ',' + cc] = fid; });
    foots.push({ id: fid, shape: shape.id, cells });
  }
  return { truth, foots, ok: foots.length === K };
}

function simulate(b, info, K, recommendFn, cap) {
  const fossils = [], byId = {};
  let hammers = 0, empties = 0;
  function tagReveal(r, c) {
    const key = r + ',' + c;
    if (info.truth[key]) {
      const fid = info.truth[key];
      let f = byId[fid];
      if (!f) { f = { id: fid, cells: [], footprint: null, complete: false, candidates: [] }; byId[fid] = f; fossils.push(f); }
      b.cells[r][c].state = 'fossil'; b.cells[r][c].fossil = fid; f.cells.push([r, c]);
      const gt = info.foots.find(x => x.id === fid);
      f.footprint = { shape: gt.shape, cells: gt.cells };
    } else {
      b.cells[r][c].state = 'empty'; empties++;
    }
  }
  function refresh() {
    for (const f of fossils) f.complete = !!(f.footprint && f.footprint.cells.every(cc => b.cells[cc[0]][cc[1]].state === 'fossil'));
  }
  while (hammers < cap) {
    refresh();
    const rec = recommendFn(b, fossils, K);
    if (rec.mode === 'done') return { hammers, done: true, empties };
    if (!rec.hit || rec.mode === 'stuck') return { hammers, done: false, stuck: true, empties };
    const res = FS.applyHit(b, rec.hit[0], rec.hit[1]);
    hammers++;
    for (const br of res.breaks) tagReveal(br[0], br[1]);
  }
  return { hammers, done: false, cap: true, empties };
}

function simulateKnown(b, info, K, cap) {
  const fossils = info.foots.map(ft => ({ id: ft.id, cells: [], footprint: { shape: ft.shape, cells: ft.cells }, complete: false }));
  const byId = {}; fossils.forEach(f => byId[f.id] = f);
  let hammers = 0;
  function tagReveal(r, c) { const key = r + ',' + c; if (info.truth[key]) { b.cells[r][c].state = 'fossil'; b.cells[r][c].fossil = info.truth[key]; byId[info.truth[key]].cells.push([r, c]); } else b.cells[r][c].state = 'empty'; }
  function refresh() { for (const f of fossils) f.complete = f.footprint.cells.every(cc => b.cells[cc[0]][cc[1]].state === 'fossil'); }
  while (hammers < cap) { refresh(); const rec = FS.recommend(b, fossils, K); if (rec.mode === 'done') return { hammers, done: true }; if (!rec.hit) return { hammers, done: false }; const res = FS.applyHit(b, rec.hit[0], rec.hit[1]); hammers++; for (const br of res.breaks) tagReveal(br[0], br[1]); }
  return { hammers, done: false };
}

// naive baseline: clear in reading order, early-stop at K fossils
function naiveRecommend(b, fossils, target) {
  let done = 0; for (const f of fossils) if (f.complete) done++;
  if (done >= target) return { mode: 'done', hit: null };
  for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++)
    if (FS.isCovered(b, r, c)) return { mode: 'explore', hit: [r, c] };
  return { mode: 'stuck', hit: null };
}

function run(label, N, rows, cols, K, hpChoices, recommendFn) {
  let total = 0, done = 0, fails = 0, max = 0, skipped = 0, emp = 0; const all = [];
  for (let s = 0; s < N; s++) {
    const rng = mulberry32(1000 + s);
    const b = genBoard(rows, cols, rng, hpChoices);
    const info = placeFossils(b, K, rng);
    if (!info.ok) { skipped++; continue; }
    const r = simulate(b, info, K, recommendFn, 2000);
    if (r.done) { done++; total += r.hammers; emp += r.empties; max = Math.max(max, r.hammers); all.push(r.hammers); }
    else fails++;
  }
  all.sort((a, b) => a - b);
  const mean = done ? total / done : 0;
  const median = all.length ? all[Math.floor(all.length / 2)] : 0;
  console.log(`${label.padEnd(34)} solved ${done}/${N - skipped}  mean=${mean.toFixed(1)}  median=${median}  max=${max}  emptiesBroken=${(emp / done).toFixed(1)}` + (fails ? `  FAILS=${fails}` : ''));
  return { mean, median, max, done };
}

function runOracle(label, N, rows, cols, K, hpChoices) {
  let total = 0, done = 0;
  for (let s = 0; s < N; s++) {
    const rng = mulberry32(1000 + s);
    const b = genBoard(rows, cols, rng, hpChoices);
    const info = placeFossils(b, K, rng);
    if (!info.ok) continue;
    const r = simulateKnown(b, info, K, 2000);
    if (r.done) { done++; total += r.hammers; }
  }
  console.log(`${label.padEnd(34)} ORACLE (positions known) mean=${(total / done).toFixed(1)}`);
  return total / done;
}

function zeros(b) { const w = []; for (let r = 0; r < b.rows; r++) w.push(new Array(b.cols).fill(0)); return w; }

function buildSampleWeights(b, fossils, target, nSamples) {
  let undisc = target - fossils.length; if (undisc < 0) undisc = 0;
  const w = zeros(b);
  if (undisc === 0) return w;
  let good = 0;
  for (let s = 0; s < nSamples; s++) {
    const occ = {}; const chosen = []; let placed = 0, tries = 0;
    while (placed < undisc && tries++ < 300) {
      const shape = FS.SHAPES[(Math.random() * 3) | 0];
      const r = (Math.random() * b.rows) | 0, c = (Math.random() * b.cols) | 0;
      const cells = shape.cells.map(d => [r + d[0], c + d[1]]);
      if (!cells.every(([rr, cc]) => FS.isCovered(b, rr, cc))) continue;
      if (!cells.every(([rr, cc]) => !occ[rr + ',' + cc])) continue;
      cells.forEach(([rr, cc]) => occ[rr + ',' + cc] = true); chosen.push(cells); placed++;
    }
    if (placed === undisc) { good++; for (const cells of chosen) for (const [rr, cc] of cells) w[rr][cc]++; }
  }
  return w;
}

function makeRec(opts) {
  opts = opts || {};
  const wImm = opts.wImm != null ? opts.wImm : 1000;
  const wProg = opts.wProg != null ? opts.wProg : 10;
  const wWaste = opts.wWaste != null ? opts.wWaste : 0.5;
  const wAdj = opts.wAdj != null ? opts.wAdj : 0;
  const mode = opts.weightMode || 'count';
  const nS = opts.nSamples != null ? opts.nSamples : 250;
  const breakBonus = opts.breakBonus != null ? opts.breakBonus : 0;
  const compAsWeight = !!opts.compAsWeight;
  return function (b, fossils, target) {
    let done = 0; for (const f of fossils) if (f.complete) done++;
    if (target && done >= target) return { mode: 'done', hit: null };
    if (!compAsWeight) {
      let bestComp = null;
      for (const fo of fossils) {
        if (fo.complete || !fo.footprint) continue;
        const remaining = fo.footprint.cells.filter(cc => FS.isCovered(b, cc[0], cc[1]));
        if (!remaining.length) continue;
        const plan = FS.completionPlan(b, remaining).hits;
        if (!plan.length) continue;
        if (!bestComp || plan.length < bestComp.plan.length) bestComp = { plan };
      }
      if (bestComp) return { mode: 'complete', hit: bestComp.plan[0] };
    }
    const w = mode === 'sample' ? buildSampleWeights(b, fossils, target, nS) : FS.cellWeights(b, FS.candidatePlacements(b));
    for (const nf of fossils) {
      if (nf.complete) continue;
      if (nf.footprint) { if (compAsWeight) for (const cc of nf.footprint.cells) if (FS.isCovered(b, cc[0], cc[1])) w[cc[0]][cc[1]] += 100; continue; }
      for (const ft of FS.fossilFootprints(b, nf.cells)) for (const [rr, cc] of ft.cells) if (FS.isCovered(b, rr, cc)) w[rr][cc] += 8;
    }
    let best = null;
    for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) {
      if (!FS.isCovered(b, r, c)) continue;
      const sim = FS.simulateHit(b, r, c);
      let imm = 0, prog = 0, waste = 0;
      for (const t of sim.touched) {
        const wt = w[t.r][t.c];
        if (t.breaks) { imm += wt; waste += Math.max(0, t.newDmg - t.hp); }
        prog += wt * (Math.min(t.dealt, t.need) / Math.max(1, t.need));
      }
      let adj = 0;
      if (wAdj) { if (b.cells[r][c].dmg > 0) adj++; for (const [nr, nc] of FS.orthoNeighbors(b, r, c)) if (FS.isCovered(b, nr, nc) && b.cells[nr][nc].dmg > 0) adj++; }
      const score = imm * wImm + prog * wProg - waste * wWaste + sim.touched.length * 0.01 + adj * wAdj + sim.breaks.length * breakBonus;
      if (!best || score > best.score) best = { r, c, score };
    }
    if (!best) return { mode: 'stuck', hit: null };
    return { mode: 'explore', hit: [best.r, best.c] };
  };
}

// Shared completion gate (joint, same as shipped) — returns a hit or null.
function jointCompletion(b, fossils) {
  const jt = [], tk = {};
  for (const fo of fossils) {
    if (fo.complete || !fo.footprint) continue;
    for (const cc of fo.footprint.cells) if (FS.isCovered(b, cc[0], cc[1])) { const k = cc[0] + ',' + cc[1]; if (!tk[k]) { tk[k] = 1; jt.push(cc); } }
  }
  if (!jt.length) return null;
  const plan = FS.completionPlan(b, jt).hits;
  return plan.length ? plan[0] : null;
}

// Score the marginal-weighted explorer move (the shipped no-break-rush scoring).
function marginalProbe(b, w) {
  let best = null;
  for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) {
    if (!FS.isCovered(b, r, c)) continue;
    const sim = FS.simulateHit(b, r, c);
    let prog = 0, waste = 0;
    for (const t of sim.touched) { const wt = w[t.r][t.c]; if (t.breaks) waste += Math.max(0, t.newDmg - t.hp); prog += wt * (Math.min(t.dealt, t.need) / Math.max(1, t.need)); }
    const score = prog - waste * 2 + sim.touched.length * 0.01;
    if (!best || score > best.score) best = { r, c, score };
  }
  return best ? [best.r, best.c] : null;
}

// (1) Forced-cell deduction: sample valid joint configs of the hidden fossils.
// Any covered tile that holds a fossil in EVERY config is a guaranteed hit —
// strike it directly. Otherwise probe by the (joint) marginal.
function dedRec(b, fossils, target) {
  let done = 0; for (const f of fossils) if (f.complete) done++;
  if (target && done >= target) return { mode: 'done', hit: null };
  const ch = jointCompletion(b, fossils); if (ch) return { mode: 'complete', hit: ch };
  const undisc = Math.max(0, target - fossils.length);
  if (undisc === 0) return { mode: 'stuck', hit: null };
  const nS = 400, w = zeros(b); let good = 0;
  for (let s = 0; s < nS; s++) {
    const occ = {}, chosen = []; let placed = 0, tries = 0;
    while (placed < undisc && tries++ < 400) {
      const shape = FS.SHAPES[(Math.random() * 3) | 0];
      const r = (Math.random() * b.rows) | 0, c = (Math.random() * b.cols) | 0;
      const cells = shape.cells.map(d => [r + d[0], c + d[1]]);
      if (!cells.every(([rr, cc]) => FS.isCovered(b, rr, cc)) || !cells.every(([rr, cc]) => !occ[rr + ',' + cc])) continue;
      cells.forEach(([rr, cc]) => occ[rr + ',' + cc] = true); chosen.push(cells); placed++;
    }
    if (placed === undisc) { good++; const cov = {}; for (const cells of chosen) for (const [rr, cc] of cells) cov[rr + ',' + cc] = 1; for (const k in cov) { const p = k.split(',').map(Number); w[p[0]][p[1]]++; } }
  }
  if (good > 0) {
    const forced = [];
    for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) if (FS.isCovered(b, r, c) && w[r][c] === good) forced.push([r, c]);
    if (forced.length) { const plan = FS.completionPlan(b, forced).hits; if (plan.length) return { mode: 'pinpoint', hit: plan[0] }; }
  }
  const hit = marginalProbe(b, w);
  return hit ? { mode: 'explore', hit } : { mode: 'stuck', hit: null };
}

// (2) Commit-to-densest: dig out the single most-likely 4-tile placement (max
// summed marginal) as if it were a fossil, via the completion planner.
function commitRec(b, fossils, target) {
  let done = 0; for (const f of fossils) if (f.complete) done++;
  if (target && done >= target) return { mode: 'done', hit: null };
  const ch = jointCompletion(b, fossils); if (ch) return { mode: 'complete', hit: ch };
  const undisc = Math.max(0, target - fossils.length);
  if (undisc === 0) return { mode: 'stuck', hit: null };
  const placements = FS.candidatePlacements(b);
  if (!placements.length) return { mode: 'stuck', hit: null };
  const w = FS.cellWeights(b, placements);
  let bestP = null;
  for (const p of placements) { let s = 0; for (const cell of p.cells) s += w[cell[0]][cell[1]]; if (!bestP || s > bestP.s) bestP = { p, s }; }
  const targets = bestP.p.cells.filter(cc => FS.isCovered(b, cc[0], cc[1]));
  const plan = FS.completionPlan(b, targets).hits;
  return plan.length ? { mode: 'explore', hit: plan[0] } : { mode: 'stuck', hit: null };
}

const N = parseInt(process.argv[2] || '300', 10);
console.log(`\n=== ${N} games per scenario ===`);
const scenarios = [
  ['8x10 hp[3,4] K5', 10, 8, 5, [3, 4]],
  ['8x10 hp[2,3,4] K5', 10, 8, 5, [2, 3, 4]],
  ['6x6 hp[1,2,3] K3', 6, 6, 3, [1, 2, 3]]
];
// Explorer experiment log (8x10 HP[3,4] K5, mean swings; oracle floor = 21.5):
//   old break-rush (immediate*1000) ... 41.3   <- the bug we fixed
//   SHIPPED: no break-rush marginal .. 36.7   <- adopted
//   forced-cell deduction ............ 36.7   tied (forced tiles already carry max marginal weight)
//   commit-to-densest placement ...... 38.2   worse (wastes swings when the guess isn't a fossil)
//   sample-posterior weights ......... ~36.9  tied with cheap count weights (no gain)
//   concentration / splash bonus ..... 40.2   worse (clustering breaks more junk)
//   interleave explore+complete ...... 47.5   worse (refuted the co-optimize hypothesis)
// Takeaway: the marginal probe is at the practical floor. The 36.7->21.5 gap to the
// positions-known oracle is the irreducible cost of not knowing where fossils are
// (~log2(#legal layouts) informative probes), not algorithmic slack.
const variants = [
  ['SHIPPED (no break-rush marginal probe)', FS.recommend],
  ['deduction: forced-cell + sample probe', dedRec],
  ['commit to densest placement', commitRec]
];
for (const [label, fn] of variants) {
  console.log(`\n-- ${label} --`);
  scenarios.forEach(s => run(s[0], N, s[1], s[2], s[3], s[4], fn));
}
if (process.env.ORACLE) { console.log('\n-- ORACLE floor --'); scenarios.forEach(s => runOracle(s[0], N, s[1], s[2], s[3], s[4])); }
