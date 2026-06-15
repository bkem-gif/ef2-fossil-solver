/*
 * Dev-only gap-finder. The harness plants the fossils, so it knows the ground
 * truth the solver doesn't. At every position in many simulated games it tries
 * EVERY covered tile as the next move, plays the rest out with the solver, and
 * measures how much the best single swap would have saved vs the solver's own
 * choice (a 1-ply swap regret, with hindsight). It groups the high-regret
 * positions by (mode | where the better move was) to surface systematic gaps.
 *
 *   node gapfind.js [scenarioIdx 0..2] [N games]
 *
 * Caveat: regret uses the planted truth, so EXPLORE-mode regret is mostly luck
 * (swapping onto a tile that happens to be a fossil — irreducible). The skill
 * signal is COMPLETE/PINPOINT-mode regret: a move that is better regardless of
 * the hidden config (like the completion-probe tie-break). Read the grouped
 * output with that in mind.
 */
const FS = require('./solver.js');

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function genBoard(rows, cols, rng, hpC) { const b = FS.makeBoard(rows, cols, 1); for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const hp = hpC[Math.floor(rng() * hpC.length)]; b.cells[r][c] = hp === 0 ? { state: 'empty', hp: 0, dmg: 0, fossil: null } : { state: 'covered', hp, dmg: 0, fossil: null }; } return b; }
function placeFossils(b, K, rng) { const truth = {}, foots = [], used = {}; let id = 0, att = 0; while (foots.length < K && att++ < 4000) { const sh = FS.SHAPES[Math.floor(rng() * FS.SHAPES.length)]; const r = Math.floor(rng() * b.rows), c = Math.floor(rng() * b.cols); const cells = sh.cells.map(d => [r + d[0], c + d[1]]); if (!cells.every(([rr, cc]) => FS.inBounds(b, rr, cc) && b.cells[rr][cc].state === 'covered')) continue; if (!cells.every(([rr, cc]) => !used[rr + ',' + cc])) continue; const fid = 'F' + (id++); cells.forEach(([rr, cc]) => { used[rr + ',' + cc] = true; truth[rr + ',' + cc] = fid; }); foots.push({ id: fid, shape: sh.id, cells }); } return { truth, foots, ok: foots.length === K }; }

function tagReveal(b, fossils, byId, truth, foots, r, c) { const key = r + ',' + c; if (truth[key]) { const fid = truth[key]; let f = byId[fid]; if (!f) { f = { id: fid, cells: [], footprint: null, complete: false }; byId[fid] = f; fossils.push(f); } b.cells[r][c].state = 'fossil'; b.cells[r][c].fossil = fid; f.cells.push([r, c]); const gt = foots.find(x => x.id === fid); f.footprint = { shape: gt.shape, cells: gt.cells }; } else b.cells[r][c].state = 'empty'; }
function refresh(b, fossils) { for (const f of fossils) f.complete = !!(f.footprint && f.footprint.cells.every(cc => b.cells[cc[0]][cc[1]].state === 'fossil')); }
function cloneState(b, fossils) { const nb = FS.makeBoard(b.rows, b.cols, 0); for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) { const x = b.cells[r][c]; nb.cells[r][c] = { state: x.state, hp: x.hp, dmg: x.dmg, fossil: x.fossil }; } const nf = [], nbyId = {}; for (const f of fossils) { const cf = { id: f.id, cells: f.cells.map(c => c.slice()), footprint: f.footprint ? { shape: f.footprint.shape, cells: f.footprint.cells.map(c => c.slice()) } : null, complete: f.complete }; nf.push(cf); nbyId[f.id] = cf; } return { b: nb, fossils: nf, byId: nbyId }; }
function playOut(b, fossils, byId, truth, foots, K, cap) { let h = 0; while (h < cap) { refresh(b, fossils); const rec = FS.recommend(b, fossils, K); if (rec.mode === 'done') return h; if (!rec.hit || rec.mode === 'stuck') return cap; const res = FS.applyHit(b, rec.hit[0], rec.hit[1]); h++; for (const br of res.breaks) tagReveal(b, fossils, byId, truth, foots, br[0], br[1]); } return cap; }

function relType(M, C) { if (M[0] === C[0] && M[1] === C[1]) return 'same tile'; const dr = Math.abs(M[0] - C[0]), dc = Math.abs(M[1] - C[1]); if (dr + dc === 1) return 'orth-neighbor'; if (dr === 1 && dc === 1) return 'diagonal'; if (dr + dc === 2) return '2-away'; return 'far'; }

function analyzeGame(rows, cols, K, hp, seed, logs) {
  const rng = mulberry32(seed); const b = genBoard(rows, cols, rng, hp); const info = placeFossils(b, K, rng); if (!info.ok) return;
  const fossils = [], byId = {}; let h = 0; const cap = 400;
  while (h < cap) {
    refresh(b, fossils); const rec = FS.recommend(b, fossils, K);
    if (rec.mode === 'done' || !rec.hit || rec.mode === 'stuck') break;
    const cands = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (FS.isCovered(b, r, c)) cands.push([r, c]);
    let bestC = null, bestS = Infinity, recS = Infinity;
    for (const [cr, cc] of cands) {
      const st = cloneState(b, fossils); const res = FS.applyHit(st.b, cr, cc); for (const br of res.breaks) tagReveal(st.b, st.fossils, st.byId, info.truth, info.foots, br[0], br[1]);
      const s = 1 + playOut(st.b, st.fossils, st.byId, info.truth, info.foots, K, cap);
      if (cr === rec.hit[0] && cc === rec.hit[1]) recS = s;
      if (s < bestS) { bestS = s; bestC = [cr, cc]; }
    }
    const regret = recS - bestS;
    if (regret >= 1) {
      const simM = FS.simulateHit(b, rec.hit[0], rec.hit[1]), simC = FS.simulateHit(b, bestC[0], bestC[1]);
      logs.push({ seed, step: h, mode: rec.mode, regret, rel: relType(rec.hit, bestC), mBreaks: simM.breaks.length, cBreaks: simC.breaks.length });
    }
    const res = FS.applyHit(b, rec.hit[0], rec.hit[1]); h++; for (const br of res.breaks) tagReveal(b, fossils, byId, info.truth, info.foots, br[0], br[1]);
  }
}

const scen = [['8x10 hp[3,4] K5', 10, 8, 5, [3, 4]], ['8x10 hp[2,3,4] K5', 10, 8, 5, [2, 3, 4]], ['6x6 hp[1,2,3] K3', 6, 6, 3, [1, 2, 3]]];
const idx = parseInt(process.argv[2] || '2', 10), N = parseInt(process.argv[3] || '40', 10);
const [name, rows, cols, K, hp] = scen[idx];
console.log(`\n=== gap-finder: ${name}, ${N} games (1-ply swap regret vs planted truth) ===`);
const logs = []; for (let s = 0; s < N; s++) analyzeGame(rows, cols, K, hp, 1000 + s, logs);
const total = logs.reduce((a, x) => a + x.regret, 0);
const byMode = {}; logs.forEach(x => byMode[x.mode] = (byMode[x.mode] || 0) + x.regret);
console.log(`positions with regret>=1: ${logs.length}   summed regret: ${total}`);
console.log('summed regret by mode:', JSON.stringify(byMode));
const groups = {}; for (const x of logs) { const k = (x.mode + ' | better=' + x.rel); const g = (groups[k] = groups[k] || { n: 0, reg: 0, mB: 0, cB: 0 }); g.n++; g.reg += x.regret; g.mB += x.mBreaks; g.cB += x.cBreaks; }
console.log('\n-- regret grouped by (mode | where the better move was), sorted by total regret --');
Object.entries(groups).sort((a, b) => b[1].reg - a[1].reg).forEach(([k, g]) => console.log(`  ${k.padEnd(32)} n=${String(g.n).padStart(3)}  sumRegret=${String(g.reg).padStart(4)}  recBreaks=${(g.mB / g.n).toFixed(1)} bestBreaks=${(g.cB / g.n).toFixed(1)}`));
console.log('\n-- top 10 highest-regret positions --');
logs.sort((a, b) => b.regret - a.regret).slice(0, 10).forEach(x => console.log(`  seed${x.seed} step${x.step} ${x.mode.padEnd(8)} regret=${x.regret} better=${x.rel} (recBreaks ${x.mBreaks}, bestBreaks ${x.cBreaks})`));
