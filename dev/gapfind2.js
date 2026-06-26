/*
 * Dev-only gap-finder v2 (posterior). Like gapfind.js, but instead of scoring a
 * candidate move against the single planted truth (which mixes skill + luck), it
 * averages each candidate over many RESAMPLED hidden-fossil layouts consistent
 * with what's currently revealed — i.e. the solver's own posterior. Luck averages
 * out, leaving only config-robust (skill) regret: a move that is genuinely better
 * given the information the solver has.
 *
 *   node gapfind2.js [scenarioIdx 0..2] [N games] [K samples]
 *
 * Candidates are focused (the solver's move + its 8 neighbours + the top-weight
 * covered tiles) to keep the posterior rollouts tractable.
 */
const FS = require('../solver.js');

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function genBoard(rows, cols, rng, hpC) { const b = FS.makeBoard(rows, cols, 1); for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const hp = hpC[Math.floor(rng() * hpC.length)]; b.cells[r][c] = hp === 0 ? { state: 'empty', hp: 0, dmg: 0, fossil: null } : { state: 'covered', hp, dmg: 0, fossil: null }; } return b; }
function placeFossils(b, K, rng) { const truth = {}, foots = [], used = {}; let id = 0, att = 0; while (foots.length < K && att++ < 4000) { const sh = FS.SHAPES[Math.floor(rng() * FS.SHAPES.length)]; const r = Math.floor(rng() * b.rows), c = Math.floor(rng() * b.cols); const cells = sh.cells.map(d => [r + d[0], c + d[1]]); if (!cells.every(([rr, cc]) => FS.inBounds(b, rr, cc) && b.cells[rr][cc].state === 'covered')) continue; if (!cells.every(([rr, cc]) => !used[rr + ',' + cc])) continue; const fid = 'F' + (id++); cells.forEach(([rr, cc]) => { used[rr + ',' + cc] = true; truth[rr + ',' + cc] = fid; }); foots.push({ id: fid, shape: sh.id, cells }); } return { truth, foots, ok: foots.length === K }; }

function tagReveal(b, fossils, byId, truth, foots, r, c) { const key = r + ',' + c; if (truth[key]) { const fid = truth[key]; let f = byId[fid]; if (!f) { f = { id: fid, cells: [], footprint: null, complete: false }; byId[fid] = f; fossils.push(f); } b.cells[r][c].state = 'fossil'; b.cells[r][c].fossil = fid; f.cells.push([r, c]); const gt = foots.find(x => x.id === fid); f.footprint = { shape: gt.shape, cells: gt.cells }; } else b.cells[r][c].state = 'empty'; }
function refresh(b, fossils) { for (const f of fossils) f.complete = !!(f.footprint && f.footprint.cells.every(cc => b.cells[cc[0]][cc[1]].state === 'fossil')); }
function cloneState(b, fossils) { const nb = FS.makeBoard(b.rows, b.cols, 0); for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) { const x = b.cells[r][c]; nb.cells[r][c] = { state: x.state, hp: x.hp, dmg: x.dmg, fossil: x.fossil }; } const nf = [], nbyId = {}; for (const f of fossils) { const cf = { id: f.id, cells: f.cells.map(c => c.slice()), footprint: f.footprint ? { shape: f.footprint.shape, cells: f.footprint.cells.map(c => c.slice()) } : null, complete: f.complete }; nf.push(cf); nbyId[f.id] = cf; } return { b: nb, fossils: nf, byId: nbyId }; }
function playOut(b, fossils, byId, truth, foots, K, cap) { let h = 0; while (h < cap) { refresh(b, fossils); const rec = FS.recommend(b, fossils, K); if (rec.mode === 'done') return h; if (!rec.hit || rec.mode === 'stuck') return cap; const res = FS.applyHit(b, rec.hit[0], rec.hit[1]); h++; for (const br of res.breaks) tagReveal(b, fossils, byId, truth, foots, br[0], br[1]); } return cap; }
function relType(M, C) { if (M[0] === C[0] && M[1] === C[1]) return 'same tile'; const dr = Math.abs(M[0] - C[0]), dc = Math.abs(M[1] - C[1]); if (dr + dc === 1) return 'orth-neighbor'; if (dr === 1 && dc === 1) return 'diagonal'; if (dr + dc === 2) return '2-away'; return 'far'; }

// A hidden-fossil layout consistent with what's currently revealed: keep the known
// (revealed) fossils, then sample the remaining ones into the covered region.
function sampleHiddenTruth(b, fossils, target, rng) {
  const truth = {}, foots = [], used = {};
  for (const f of fossils) { if (!f.footprint) continue; for (const cc of f.footprint.cells) { truth[cc[0] + ',' + cc[1]] = f.id; used[cc[0] + ',' + cc[1]] = 1; } foots.push({ id: f.id, shape: f.footprint.shape, cells: f.footprint.cells.map(c => c.slice()) }); }
  let placed = 0, need = target - fossils.length, tries = 0;
  while (placed < need && tries++ < 400) {
    const sh = FS.SHAPES[(rng() * 3) | 0], r = (rng() * b.rows) | 0, c = (rng() * b.cols) | 0;
    const cells = sh.cells.map(d => [r + d[0], c + d[1]]);
    if (!cells.every(([rr, cc]) => FS.inBounds(b, rr, cc) && b.cells[rr][cc].state === 'covered' && !used[rr + ',' + cc])) continue;
    const fid = 'H' + placed; cells.forEach(([rr, cc]) => { used[rr + ',' + cc] = 1; truth[rr + ',' + cc] = fid; }); foots.push({ id: fid, shape: sh.id, cells }); placed++;
  }
  return placed === need ? { truth, foots } : null;
}

// expected swings-to-finish if we play [cr,cc] now, averaged over K posterior samples
function candidateMean(b, fossils, cr, cc, target, K, rng) {
  let sum = 0, valid = 0;
  for (let k = 0; k < K; k++) {
    const samp = sampleHiddenTruth(b, fossils, target, rng); if (!samp) continue;
    const st = cloneState(b, fossils);
    const res = FS.applyHit(st.b, cr, cc); for (const br of res.breaks) tagReveal(st.b, st.fossils, st.byId, samp.truth, samp.foots, br[0], br[1]);
    sum += 1 + playOut(st.b, st.fossils, st.byId, samp.truth, samp.foots, target, 400); valid++;
  }
  return valid ? sum / valid : Infinity;
}

function analyzeGame(rows, cols, K, hp, samples, seed, logs) {
  const rng = mulberry32(seed), erng = mulberry32(999983 + seed * 7);
  const b = genBoard(rows, cols, rng, hp); const info = placeFossils(b, K, rng); if (!info.ok) return;
  const fossils = [], byId = {}; let h = 0;
  while (h < 400) {
    refresh(b, fossils); const rec = FS.recommend(b, fossils, K);
    if (rec.mode === 'done' || !rec.hit || rec.mode === 'stuck') break;
    // focused candidates: solver's move + 8 neighbours + top-weight covered tiles
    const W = FS.cellWeights(b, FS.candidatePlacements(b)); const cand = {}; const add = (r, c) => { if (FS.isCovered(b, r, c)) cand[r + ',' + c] = [r, c]; };
    add(rec.hit[0], rec.hit[1]);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) add(rec.hit[0] + dr, rec.hit[1] + dc);
    const covered = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (FS.isCovered(b, r, c)) covered.push([r, c, W[r][c]]);
    covered.sort((a, b2) => b2[2] - a[2]).slice(0, 8).forEach(([r, c]) => add(r, c));
    let recMean = Infinity, bestMean = Infinity, bestC = null;
    for (const key in cand) {
      const [cr, cc] = cand[key]; const m = candidateMean(b, fossils, cr, cc, K, samples, erng);
      if (cr === rec.hit[0] && cc === rec.hit[1]) recMean = m;
      if (m < bestMean) { bestMean = m; bestC = [cr, cc]; }
    }
    const reg = recMean - bestMean;
    if (reg >= 0.5) logs.push({ seed, step: h, mode: rec.mode, reg, rel: relType(rec.hit, bestC) });
    const res = FS.applyHit(b, rec.hit[0], rec.hit[1]); h++; for (const br of res.breaks) tagReveal(b, fossils, byId, info.truth, info.foots, br[0], br[1]);
  }
}

const scen = [['8x10 hp[3,4] K5', 10, 8, 5, [3, 4]], ['8x10 hp[2,3,4] K5', 10, 8, 5, [2, 3, 4]], ['6x6 hp[1,2,3] K3', 6, 6, 3, [1, 2, 3]]];
const idx = parseInt(process.argv[2] || '2', 10), N = parseInt(process.argv[3] || '12', 10), K = parseInt(process.argv[4] || '12', 10);
const [name, rows, cols, Kf, hp] = scen[idx];
console.log(`\n=== gap-finder v2 (posterior): ${name}, ${N} games, ${K} samples/candidate ===`);
const logs = []; for (let s = 0; s < N; s++) analyzeGame(rows, cols, Kf, hp, K, 1000 + s, logs);
const tot = logs.reduce((a, x) => a + x.reg, 0);
const byMode = {}; logs.forEach(x => byMode[x.mode] = (byMode[x.mode] || 0) + x.reg);
console.log(`positions with expected regret>=0.5: ${logs.length}   summed expected regret: ${tot.toFixed(1)}`);
console.log('summed expected regret by mode:', Object.fromEntries(Object.entries(byMode).map(([k, v]) => [k, +v.toFixed(1)])));
const groups = {}; for (const x of logs) { const k = x.mode + ' | better=' + x.rel; const g = (groups[k] = groups[k] || { n: 0, reg: 0 }); g.n++; g.reg += x.reg; }
console.log('\n-- expected regret grouped by (mode | where the better move was) --');
Object.entries(groups).sort((a, b) => b[1].reg - a[1].reg).forEach(([k, g]) => console.log(`  ${k.padEnd(32)} n=${String(g.n).padStart(3)}  sumExpRegret=${g.reg.toFixed(1)}  avg=${(g.reg / g.n).toFixed(2)}`));
console.log('\n-- top 10 by expected regret --');
logs.sort((a, b) => b.reg - a.reg).slice(0, 10).forEach(x => console.log(`  seed${x.seed} step${x.step} ${x.mode.padEnd(8)} expRegret=${x.reg.toFixed(2)} better=${x.rel}`));
