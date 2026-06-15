/*
 * EF2 Fossil Excavation — solver core (pure logic, no DOM, no network).
 *
 * Mechanics modelled:
 *  - Hitting a covered cell deals +2 to it and +1 to each orthogonally
 *    adjacent covered cell. Damage accumulates; a cell breaks at dmg >= hp.
 *  - You may only hit covered cells (never empty/dug cells).
 *  - Fossils are rigid 4-cell shapes: 1x4 horizontal, 4x1 vertical, 2x2.
 *    To uncover a fossil every one of its cells must be broken.
 *  - Fossils may touch each other; they are told apart by colour on reveal.
 *
 * Board model: { rows, cols, cells[r][c] } where a cell is
 *    { state: 'covered'|'empty'|'fossil', hp, dmg, fossil }
 *  - 'covered'  : not yet broken (invariant: dmg < hp)
 *  - 'empty'    : broken, nothing underneath (cannot be hit, cannot hold a fossil)
 *  - 'fossil'   : broken, part of fossil id `fossil`
 */
(function (root) {
  'use strict';

  var SHAPES = [
    { id: 'h4', name: '1x4 →', cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
    { id: 'v4', name: '4x1 ↓', cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
    { id: 'sq', name: '2x2',   cells: [[0, 0], [0, 1], [1, 0], [1, 1]] }
  ];
  var ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function makeBoard(rows, cols, fillHp) {
    var cells = [];
    for (var r = 0; r < rows; r++) {
      var row = [];
      for (var c = 0; c < cols; c++) {
        row.push(fillHp > 0
          ? { state: 'covered', hp: fillHp, dmg: 0, fossil: null }
          : { state: 'empty', hp: 0, dmg: 0, fossil: null });
      }
      cells.push(row);
    }
    return { rows: rows, cols: cols, cells: cells };
  }

  function inBounds(b, r, c) { return r >= 0 && r < b.rows && c >= 0 && c < b.cols; }
  function cellAt(b, r, c) { return b.cells[r][c]; }
  function isCovered(b, r, c) { return inBounds(b, r, c) && b.cells[r][c].state === 'covered'; }

  function orthoNeighbors(b, r, c) {
    var out = [];
    for (var i = 0; i < ORTHO.length; i++) {
      var nr = r + ORTHO[i][0], nc = c + ORTHO[i][1];
      if (inBounds(b, nr, nc)) out.push([nr, nc]);
    }
    return out;
  }

  // Non-mutating preview of a hit at (r,c). Returns the cells it would touch,
  // each with the damage dealt and whether it would break.
  function simulateHit(b, r, c) {
    var res = { hit: [r, c], touched: [], breaks: [] };
    if (!isCovered(b, r, c)) return res;
    function add(rr, cc, amt) {
      if (!isCovered(b, rr, cc)) return;
      var cell = cellAt(b, rr, cc);
      var need = cell.hp - cell.dmg;
      var newDmg = cell.dmg + amt;
      var breaks = newDmg >= cell.hp;
      res.touched.push({ r: rr, c: cc, hp: cell.hp, dealt: amt, need: need, newDmg: newDmg, breaks: breaks });
      if (breaks) res.breaks.push([rr, cc]);
    }
    add(r, c, 2);
    var ns = orthoNeighbors(b, r, c);
    for (var i = 0; i < ns.length; i++) add(ns[i][0], ns[i][1], 1);
    return res;
  }

  // Mutating apply of a hit. Returns the cells that just broke (still flagged
  // 'covered' until the caller tags them empty/fossil).
  function applyHit(b, r, c) {
    if (!isCovered(b, r, c)) return { ok: false, breaks: [] };
    var breaks = [];
    function bump(rr, cc, amt) {
      if (!isCovered(b, rr, cc)) return;
      var cell = cellAt(b, rr, cc);
      cell.dmg += amt;
      if (cell.dmg >= cell.hp) breaks.push([rr, cc]);
    }
    bump(r, c, 2);
    var ns = orthoNeighbors(b, r, c);
    for (var i = 0; i < ns.length; i++) bump(ns[i][0], ns[i][1], 1);
    return { ok: true, breaks: breaks };
  }

  // Every shape placement whose cells are all currently covered — i.e. every
  // spot an undiscovered fossil could still occupy.
  function candidatePlacements(b) {
    var out = [];
    for (var s = 0; s < SHAPES.length; s++) {
      var shape = SHAPES[s];
      for (var r = 0; r < b.rows; r++) {
        for (var c = 0; c < b.cols; c++) {
          var ok = true, cells = [];
          for (var k = 0; k < shape.cells.length; k++) {
            var rr = r + shape.cells[k][0], cc = c + shape.cells[k][1];
            if (!isCovered(b, rr, cc)) { ok = false; break; }
            cells.push([rr, cc]);
          }
          if (ok) out.push({ shape: shape.id, cells: cells });
        }
      }
    }
    return out;
  }

  // weight[r][c] = number of candidate placements covering that cell.
  function cellWeights(b, placements) {
    var w = [];
    for (var r = 0; r < b.rows; r++) { w.push(new Array(b.cols).fill(0)); }
    for (var i = 0; i < placements.length; i++) {
      var cs = placements[i].cells;
      for (var j = 0; j < cs.length; j++) w[cs[j][0]][cs[j][1]]++;
    }
    return w;
  }

  // Given the revealed cells of one fossil, which full footprints are still
  // consistent: a shape placement that contains all revealed cells, whose
  // other cells are still covered (diggable). length===1 => footprint known.
  function fossilFootprints(b, fossilCells) {
    function key(r, c) { return r + ',' + c; }
    var want = {};
    for (var i = 0; i < fossilCells.length; i++) want[key(fossilCells[i][0], fossilCells[i][1])] = true;
    var out = [];
    for (var s = 0; s < SHAPES.length; s++) {
      var shape = SHAPES[s];
      for (var r = 0; r < b.rows; r++) {
        for (var c = 0; c < b.cols; c++) {
          var cells = [], inb = true;
          for (var k = 0; k < shape.cells.length; k++) {
            var rr = r + shape.cells[k][0], cc = c + shape.cells[k][1];
            if (!inBounds(b, rr, cc)) { inb = false; break; }
            cells.push([rr, cc]);
          }
          if (!inb) continue;
          var cset = {};
          for (var m = 0; m < cells.length; m++) cset[key(cells[m][0], cells[m][1])] = true;
          var containsAll = true;
          for (var wk in want) { if (!cset[wk]) { containsAll = false; break; } }
          if (!containsAll) continue;
          var fits = true;
          for (var n = 0; n < cells.length; n++) {
            var kk = key(cells[n][0], cells[n][1]);
            if (want[kk]) continue;                 // already this fossil
            if (!isCovered(b, cells[n][0], cells[n][1])) { fits = false; break; } // rest must be diggable
          }
          if (fits) out.push({ shape: shape.id, cells: cells });
        }
      }
    }
    return out;
  }

  // Minimum (near-minimum) multiset of hits to break every target cell.
  // Hits land on covered cells (targets or their covered neighbours).
  function completionPlan(b, targets) {
    function key(r, c) { return r + ',' + c; }
    var tlist = [];
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (!isCovered(b, t[0], t[1])) continue;
      var cell = cellAt(b, t[0], t[1]);
      var need = cell.hp - cell.dmg;
      if (need > 0) tlist.push({ r: t[0], c: t[1], need: need });
    }
    if (tlist.length === 0) return { hits: [] };

    var Hmap = {};
    function addH(r, c) { if (isCovered(b, r, c)) Hmap[key(r, c)] = [r, c]; }
    for (var a = 0; a < tlist.length; a++) {
      addH(tlist[a].r, tlist[a].c);
      var ns = orthoNeighbors(b, tlist[a].r, tlist[a].c);
      for (var n = 0; n < ns.length; n++) addH(ns[n][0], ns[n][1]);
    }
    var H = [];
    for (var hk in Hmap) H.push(Hmap[hk]);

    // contrib[i][j] = damage hit H[i] deals to target tlist[j]
    var contrib = [];
    for (var hi = 0; hi < H.length; hi++) {
      var row = [];
      for (var tj = 0; tj < tlist.length; tj++) {
        var v = 0;
        var dr = Math.abs(H[hi][0] - tlist[tj].r), dc = Math.abs(H[hi][1] - tlist[tj].c);
        if (dr === 0 && dc === 0) v += 2; else if (dr + dc === 1) v += 1;
        row.push(v);
      }
      contrib.push(row);
    }
    var needs = tlist.map(function (t) { return t.need; });

    function greedy() {
      var rem = needs.slice(), hits = [], guard = 0;
      while (rem.some(function (v) { return v > 0; }) && guard++ < 200) {
        var best = -1, bestVal = -1;
        for (var i = 0; i < H.length; i++) {
          var val = 0;
          for (var j = 0; j < rem.length; j++) val += Math.min(contrib[i][j], Math.max(0, rem[j]));
          if (val > bestVal) { bestVal = val; best = i; }
        }
        if (bestVal <= 0) break;
        for (var j2 = 0; j2 < rem.length; j2++) rem[j2] -= contrib[best][j2];
        hits.push(H[best]);
      }
      return hits;
    }

    var bestHits = greedy();
    var KMAX = bestHits.length;
    var nodes = { n: 0 };

    function lowerBound(rem) {
      var tot = 0;
      for (var i = 0; i < rem.length; i++) if (rem[i] > 0) tot += rem[i];
      return Math.ceil(tot / 6);
    }
    function dfs(start, left, rem) {
      if (rem.every(function (v) { return v <= 0; })) return [];
      if (left <= 0) return null;
      if (lowerBound(rem) > left) return null;
      if (nodes.n++ > 200000) return null; // safety: fall back to greedy
      for (var i = start; i < H.length; i++) {
        var nrem = rem.slice();
        for (var j = 0; j < rem.length; j++) nrem[j] -= contrib[i][j];
        var sub = dfs(i, left - 1, nrem);
        if (sub) return [H[i]].concat(sub);
      }
      return null;
    }
    for (var k = 1; k < KMAX; k++) {
      var sol = dfs(0, k, needs.slice());
      if (sol) { bestHits = sol; break; }
    }
    return { hits: bestHits };
  }

  function getStats(b) {
    var covered = 0, empty = 0, fossil = 0;
    for (var r = 0; r < b.rows; r++) for (var c = 0; c < b.cols; c++) {
      var st = b.cells[r][c].state;
      if (st === 'covered') covered++; else if (st === 'empty') empty++; else fossil++;
    }
    return { covered: covered, empty: empty, fossil: fossil };
  }

  // Deep-copy a board so a hit can be simulated without mutating the original.
  function cloneBoard(b) {
    var cells = [];
    for (var r = 0; r < b.rows; r++) {
      var row = [];
      for (var c = 0; c < b.cols; c++) { var x = b.cells[r][c]; row.push({ state: x.state, hp: x.hp, dmg: x.dmg, fossil: x.fossil }); }
      cells.push(row);
    }
    return { rows: b.rows, cols: b.cols, cells: cells };
  }

  // Among the hits that finish the known fossils in the SAME minimal number of
  // swings (K), prefer the one whose +1 splash also probes the most promising
  // covered cells — a free look at where the next fossil might be. Hitting the
  // fossil cell directly often wastes the splash (and overkills); landing the
  // finishing blow from a high-likelihood neighbour reveals a tile for free.
  // Returns null if nothing beats the planner's own first hit. Never adds a swing.
  function bestCompletionHit(b, targets, K) {
    var w = cellWeights(b, candidatePlacements(b));
    var cand = {};
    function add(r, c) { if (isCovered(b, r, c)) cand[r + ',' + c] = [r, c]; }
    for (var t = 0; t < targets.length; t++) {
      add(targets[t][0], targets[t][1]);
      var ns = orthoNeighbors(b, targets[t][0], targets[t][1]);
      for (var n = 0; n < ns.length; n++) add(ns[n][0], ns[n][1]);
    }
    var best = null, bestScore = -Infinity;
    for (var key in cand) {
      var r = cand[key][0], c = cand[key][1];
      // reject any hit that would push completion past K total swings
      var copy = cloneBoard(b);
      applyHit(copy, r, c);
      var rem = [];
      for (var ti = 0; ti < targets.length; ti++) if (isCovered(copy, targets[ti][0], targets[ti][1])) rem.push(targets[ti]);
      if (1 + (rem.length ? completionPlan(copy, rem).hits.length : 0) > K) continue;
      // score the free exploration: likelihood-weighted progress minus overkill
      var sim = simulateHit(b, r, c), prog = 0, waste = 0;
      for (var s = 0; s < sim.touched.length; s++) {
        var cell = sim.touched[s], wt = w[cell.r][cell.c];
        if (cell.breaks) waste += Math.max(0, cell.newDmg - cell.hp);
        prog += wt * (Math.min(cell.dealt, cell.need) / Math.max(1, cell.need));
      }
      var score = prog - waste * 2;
      if (score > bestScore) { bestScore = score; best = [r, c]; }
    }
    return best;
  }

  /*
   * recommend(board, fossils, target) -> next best swing.
   *   fossils: [{ id, color, cells:[[r,c]...], footprint:{shape,cells}|null, complete:bool }]
   * Returns { mode, hit:[r,c]|null, reason, plan?, fossilId? }.
   */
  function recommend(b, fossils, target) {
    fossils = fossils || [];
    var done = 0;
    for (var f = 0; f < fossils.length; f++) if (fossils[f].complete) done++;
    if (target && done >= target) {
      return { mode: 'done', hit: null, reason: 'All ' + target + ' fossils uncovered.' };
    }

    // 1) Completion: clear every still-covered cell of every fossil whose
    // footprint is known, JOINTLY in the fewest swings. Solving them together
    // lets one swing's +1 splash chip cells of two adjacent fossils at once.
    // With known footprints there is never a reason to "explore".
    var jointTargets = [], knownFossils = [], tkey = {};
    for (var i = 0; i < fossils.length; i++) {
      var fo = fossils[i];
      if (fo.complete || !fo.footprint) continue;
      var rem = fo.footprint.cells.filter(function (cc) { return isCovered(b, cc[0], cc[1]); });
      if (!rem.length) continue;
      knownFossils.push(fo);
      for (var j = 0; j < rem.length; j++) { var k = rem[j][0] + ',' + rem[j][1]; if (!tkey[k]) { tkey[k] = 1; jointTargets.push(rem[j]); } }
    }
    if (jointTargets.length) {
      var plan = completionPlan(b, jointTargets).hits;
      if (plan.length) {
        var bestHit = bestCompletionHit(b, jointTargets, plan.length) || plan[0];
        return {
          mode: 'complete',
          hit: bestHit,
          fossilId: knownFossils.length === 1 ? knownFossils[0].id : null,
          plan: plan,
          reason: 'Clear ' + knownFossils.length + ' known fossil' + (knownFossils.length > 1 ? 's' : '') +
            ' — ' + jointTargets.length + ' covered cell(s) left, ' + plan.length + ' swing(s) to finish.'
        };
      }
    }

    // 2) Exploration (and disambiguation of nicked-but-unknown fossils).
    var placements = candidatePlacements(b);
    var w = cellWeights(b, placements);

    // Boost cells that could complete a fossil we've already nicked.
    var boosted = false;
    for (var n = 0; n < fossils.length; n++) {
      var nf = fossils[n];
      if (nf.complete || nf.footprint) continue;
      var foots = fossilFootprints(b, nf.cells);
      for (var ff = 0; ff < foots.length; ff++) {
        var fc = foots[ff].cells;
        for (var g = 0; g < fc.length; g++) {
          if (isCovered(b, fc[g][0], fc[g][1])) { w[fc[g][0]][fc[g][1]] += 8; boosted = true; }
        }
      }
    }

    var best = null;
    for (var r = 0; r < b.rows; r++) {
      for (var c = 0; c < b.cols; c++) {
        if (!isCovered(b, r, c)) continue;
        var sim = simulateHit(b, r, c);
        var progress = 0, waste = 0, craterCovered = sim.touched.length;
        for (var ti = 0; ti < sim.touched.length; ti++) {
          var t = sim.touched[ti];
          var wt = w[t.r][t.c];
          if (t.breaks) waste += Math.max(0, t.newDmg - t.hp);
          progress += wt * (Math.min(t.dealt, t.need) / Math.max(1, t.need));
        }
        // Score by fossil-likelihood progress, NOT by "can I pop a tile this swing".
        // Rewarding immediate breaks makes the probe crack low-value junk tiles early;
        // steering chip damage onto the most-likely fossil tiles instead is ~11% fewer
        // swings in Monte-Carlo (and breaks ~4 fewer empty tiles per game).
        var score = progress - waste * 2 + craterCovered * 0.01;
        if (!best || score > best.score) {
          best = { r: r, c: c, score: score, sim: sim, weight: w[r][c], breaks: sim.breaks.length };
        }
      }
    }

    if (!best || best.score <= 0) {
      return {
        mode: 'stuck', hit: best ? [best.r, best.c] : null,
        reason: 'No covered region can still hold an undiscovered fossil. Re-check the tags, or all fossils may already be found.'
      };
    }

    var reasonParts = [];
    reasonParts.push('R' + (best.r + 1) + ' C' + (best.c + 1) + ' sits on ' + best.weight + ' possible fossil placement(s)');
    if (best.breaks > 0) reasonParts.push('reveals ' + best.breaks + ' cell(s) this swing');
    else reasonParts.push('chips it toward breaking');
    return {
      mode: boosted ? 'pinpoint' : 'explore',
      hit: [best.r, best.c],
      reason: (boosted ? 'Closing in on a found fossil. ' : 'Probing the most promising covered cells. ') + reasonParts.join('; ') + '.'
    };
  }

  var API = {
    SHAPES: SHAPES,
    makeBoard: makeBoard,
    inBounds: inBounds,
    cellAt: cellAt,
    isCovered: isCovered,
    orthoNeighbors: orthoNeighbors,
    simulateHit: simulateHit,
    applyHit: applyHit,
    candidatePlacements: candidatePlacements,
    cellWeights: cellWeights,
    fossilFootprints: fossilFootprints,
    completionPlan: completionPlan,
    getStats: getStats,
    recommend: recommend
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.FS = API;
})(typeof window !== 'undefined' ? window : this);
