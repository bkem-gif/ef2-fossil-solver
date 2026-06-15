/*
 * EF2 Fossil Excavation — field metrics.
 *
 * Turns a live board snapshot into the same numbers the Monte-Carlo benchmark
 * reports (swings, empty tiles broken, fossils cleared), so real games can be
 * compared against the simulated baselines documented in BENCHMARKING.md.
 *
 * Two metrics are exact from a single snapshot and need no swing-counting:
 *   - emptiesBroken: broken tiles that are not part of any fossil (search waste).
 *   - fossils found / uncovered, tiles cleared.
 * Empties-broken is also HP-independent (it measures the search, not tile
 * toughness), which is why it is the robust headline comparison.
 *
 * Exposes window.FXMetrics.
 */
(function (root) {
  'use strict';

  // Reference baselines from BENCHMARKING.md (reveal-on-contact Monte-Carlo,
  // 200 games/board). `empties` is HP-independent so it is a single number;
  // `swings`/`floor` depend on tile HP and are given as [softer, tougher] ranges.
  var BENCH = [
    { key: '8x10_K5', rows: 10, cols: 8, K: 5, label: '8×10, 5 fossils',
      empties: 21.7, swings: [30.3, 36.7], floor: [19.2, 21.5] },
    { key: '6x6_K3', rows: 6, cols: 6, K: 3, label: '6×6, 3 fossils',
      empties: 8.5, swings: [10.5, 10.5], floor: [8.0, 8.0] }
  ];

  function classify(rows, cols, K) {
    for (var i = 0; i < BENCH.length; i++) {
      var b = BENCH[i];
      if (b.rows === rows && b.cols === cols && b.K === K) return b;
    }
    return null;
  }

  // Field metrics from one board snapshot + the revealed fossils.
  //   board   : FS board (cells[r][c].state)
  //   fossils : [{ footprint:{cells}, complete }]
  //   swings  : observed hammer count so far (server- or client-counted)
  //   target  : fossils to find (chestCount)
  function compute(board, fossils, swings, target) {
    fossils = fossils || [];
    var rows = board.rows, cols = board.cols, total = rows * cols;
    var fcell = {};
    fossils.forEach(function (f) {
      (f.footprint ? f.footprint.cells : []).forEach(function (cc) { fcell[cc[0] + ',' + cc[1]] = 1; });
    });
    var covered = 0, broken = 0, fossilBroken = 0;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var st = board.cells[r][c].state;
      if (st === 'covered') { covered++; }
      else {
        broken++;
        if (st === 'fossil') fossilBroken++;
      }
    }
    var found = fossils.length, excavated = 0;
    fossils.forEach(function (f) { if (f.complete) excavated++; });

    // Fewest swings to finish every fossil already revealed, from here (exact).
    var jt = [], seen = {};
    fossils.forEach(function (f) {
      if (f.complete || !f.footprint) return;
      f.footprint.cells.forEach(function (cc) {
        if (board.cells[cc[0]][cc[1]].state === 'covered') {
          var k = cc[0] + ',' + cc[1];
          if (!seen[k]) { seen[k] = 1; jt.push(cc); }
        }
      });
    });
    var toFinish = jt.length ? FS.completionPlan(board, jt).hits.length : 0;

    return {
      total: total, covered: covered, broken: broken,
      empties: broken - fossilBroken, fossilTiles: fossilBroken,
      found: found, excavated: excavated, target: target || 0,
      pctCleared: total ? Math.round(broken / total * 100) : 0,
      swings: swings || 0, toFinish: toFinish,
      done: !!(target && excavated >= target)
    };
  }

  /* ---------------- history (localStorage) ---------------- */
  var HKEY = 'fx_field_history_v1';
  function load() {
    try { var v = JSON.parse(localStorage.getItem(HKEY) || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function save(list) { try { localStorage.setItem(HKEY, JSON.stringify(list.slice(-50))); } catch (e) {} }
  // Record one finished mine (idempotent on mine id). Returns the updated list.
  function record(entry) {
    var list = load();
    if (!entry || entry.id == null) return list;
    for (var i = 0; i < list.length; i++) if (list[i].id === entry.id) return list;
    list.push(entry);
    save(list);
    return list;
  }
  function summary() {
    var l = load();
    if (!l.length) return null;
    var sw = 0, em = 0;
    l.forEach(function (e) { sw += e.swings || 0; em += e.empties || 0; });
    return { n: l.length, meanSwings: sw / l.length, meanEmpties: em / l.length, list: l };
  }

  root.FXMetrics = {
    BENCH: BENCH,
    classify: classify,
    compute: compute,
    history: { load: load, record: record, summary: summary }
  };
})(typeof window !== 'undefined' ? window : this);
