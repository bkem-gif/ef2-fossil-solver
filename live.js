/*
 * EF2 Fossil Excavation — exact solver view.
 *
 * Reads the exact board (HP grid + fossil footprints) straight from the running
 * game via the runtime's read-only observer endpoint, and shows the fewest-swing
 * way to uncover every fossil — updating itself as you play. Fully offline; it
 * never sends a move to the game.
 *
 * Exposes window.FXLive: { init(container), _debug }.
 */
(function (root) {
  'use strict';

  var COLORS = {
    cov: ['#f4e3c4', '#d9b873', '#6b4f1d'], emp: ['#dcd6c8', '#c4bca7'],
    fos: ['#cfe6a8', '#9cc45a'], tgt: '#2f6fb0'
  };
  var GAME_BOARD_URL = 'http://localhost:8080/endlessfrontier2/solver/board';
  var GAME_FOSSILS_URL = 'http://localhost:8080/endlessfrontier2/solver/fossils';

  var L = { els: {}, rec: null, last: null, target: 5, timer: null, mineLevel: null,
            swings: 0, swingSrc: 'client', mineId: null, _lastHP: null, _rswings: 0,
            metrics: null, bench: null };

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }
  function setStatus(t) { if (L.els.status) L.els.status.textContent = t; }

  /* ---------------- read the game's exact board ---------------- */
  function mapShapeId(shape) {
    var s = ('' + (shape || '')).toLowerCase();
    if (s.indexOf('square') >= 0) return 'sq';
    if (s.indexOf('vline') >= 0) return 'v4';
    if (s.indexOf('hline') >= 0) return 'h4';
    return null;
  }
  function shapeName(id) {
    for (var i = 0; i < FS.SHAPES.length; i++) if (FS.SHAPES[i].id === id) return FS.SHAPES[i].name;
    return 'fossil';
  }
  // grid + fossil list -> { rows, cols, cells:[[{ state, hp }]] }
  function specFromGame(b, fossils) {
    var blocks = b.blocks || [];
    var rows = b.yNum || blocks.length, cols = b.xNum || (blocks[0] ? blocks[0].length : 0);
    var fset = {};
    (fossils || []).forEach(function (box) { (box.coordinates || []).forEach(function (p) { fset[p.y + ',' + p.x] = 1; }); });
    var cells = [];
    for (var r = 0; r < rows; r++) {
      var row = [];
      for (var c = 0; c < cols; c++) {
        var hp = (blocks[r] && blocks[r][c]) || 0;
        if (hp > 0) row.push({ state: 'covered', hp: hp });
        else if (fset[r + ',' + c]) row.push({ state: 'fossil' });
        else row.push({ state: 'empty' });
      }
      cells.push(row);
    }
    return { rows: rows, cols: cols, cells: cells };
  }
  // Build solver state from the game data and produce the next swing. Fossils
  // come straight from the game (exact footprints, kept distinct even when two
  // touch), so no connectivity grouping or shape-guessing is needed.
  function tickFromGame(b, fossils) {
    var spec = specFromGame(b, fossils);
    L.mineLevel = b.mineLevel;
    if (b.chestCount) L.target = b.chestCount;
    var board = FS.makeBoard(spec.rows, spec.cols, 0);
    for (var r = 0; r < spec.rows; r++) for (var c = 0; c < spec.cols; c++) {
      var cell = spec.cells[r][c];
      if (cell.state === 'covered') board.cells[r][c] = { state: 'covered', hp: cell.hp || 1, dmg: 0, fossil: null };
      else if (cell.state === 'fossil') board.cells[r][c] = { state: 'fossil', hp: 0, dmg: 0, fossil: null };
      else board.cells[r][c] = { state: 'empty', hp: 0, dmg: 0, fossil: null };
    }
    var fossilObjs = (fossils || []).map(function (box, i) {
      var fc = (box.coordinates || []).map(function (p) { return [p.y, p.x]; });
      return { id: 'g' + i, cells: fc, footprint: { shape: mapShapeId(box.shape), cells: fc }, complete: !!box.fullyExcavated };
    });
    var st = { board: board, fossils: fossilObjs };
    L.last = { spec: spec, state: st };
    var done = 0; for (var i = 0; i < fossilObjs.length; i++) if (fossilObjs[i].complete) done++;
    L.rec = FS.recommend(board, fossilObjs, L.target);
    var predicted = {};
    fossilObjs.forEach(function (f) { if (!f.complete) f.footprint.cells.forEach(function (cc) { if (board.cells[cc[0]][cc[1]].state === 'covered') predicted[cc[0] + ',' + cc[1]] = true; }); });
    renderBoard(spec, L.rec, predicted);
    renderMove(L.rec, done);
    renderFossils(fossilObjs);
    L.metrics = FXMetrics.compute(board, fossilObjs, L.swings, L.target);
    L.bench = FXMetrics.classify(spec.rows, spec.cols, L.target);
    if (L.metrics.done && L.mineId != null) {
      FXMetrics.history.record({ id: L.mineId, level: L.mineLevel, rows: spec.rows, cols: spec.cols,
        K: L.target, swings: L.metrics.swings, empties: L.metrics.empties, approx: L.swingSrc !== 'server', ts: Date.now() });
    }
    renderMetrics(L.metrics, L.bench);
    return L.last;
  }

  /* ---------------- render ---------------- */
  function renderMove(rec, done) {
    var m = L.els.move; if (!m) return;
    if (!rec) { m.style.background = 'var(--surface-2)'; m.style.borderColor = 'var(--border-strong)'; m.style.color = 'var(--muted)'; m.textContent = 'Waiting for the game…'; return; }
    if (rec.mode === 'done') {
      m.style.background = 'rgba(120,180,90,0.18)'; m.style.borderColor = '#9cc45a'; m.style.color = 'var(--text)';
      m.innerHTML = '<div style="font-size:17px;font-weight:800">✓ All ' + L.target + ' fossils uncovered!</div>';
      return;
    }
    var modeTxt = ({ explore: 'Probing', pinpoint: 'Closing in', complete: 'Finishing up', stuck: 'Nothing to do' })[rec.mode] || rec.mode;
    if (rec.hit) {
      m.style.background = 'rgba(47,111,176,0.13)'; m.style.borderColor = COLORS.tgt; m.style.color = 'var(--text)';
      m.innerHTML = '<div style="font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)">Next swing — hammer this tile in the game</div>'
        + '<div style="font-size:21px;font-weight:800;margin-top:1px">🔨 Row ' + (rec.hit[0] + 1) + ' &middot; Col ' + (rec.hit[1] + 1) + '</div>'
        + '<div style="font-size:12px;color:var(--muted);margin-top:1px">' + modeTxt + ' &middot; ' + done + ' of ' + L.target + ' fossils done</div>';
    } else {
      m.style.background = 'var(--surface-2)'; m.style.borderColor = 'var(--border-strong)'; m.style.color = 'var(--text)';
      m.innerHTML = '<div style="font-weight:700">' + modeTxt + '</div>' + (rec.reason ? '<div style="font-size:12px;color:var(--muted)">' + rec.reason + '</div>' : '');
    }
  }
  function renderBoard(spec, rec, predicted) {
    predicted = predicted || {};
    var host = L.els.board; host.innerHTML = '';
    var TH = 30, hit = rec && rec.hit;
    var grid = el('div'); grid.style.cssText = 'display:grid;grid-template-columns:repeat(' + spec.cols + ',' + TH + 'px);gap:2px';
    for (var r = 0; r < spec.rows; r++) for (var c = 0; c < spec.cols; c++) {
      var cell = spec.cells[r][c], pk = r + ',' + c;
      var d = el('div');
      d.style.cssText = 'width:' + TH + 'px;height:' + TH + 'px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;box-sizing:border-box;border:1px solid transparent;';
      if (cell.state === 'covered') { d.style.background = COLORS.cov[0]; d.style.color = COLORS.cov[2]; d.style.borderColor = COLORS.cov[1]; d.textContent = cell.hp; }
      else if (cell.state === 'fossil') { d.style.background = COLORS.fos[0]; d.style.borderColor = COLORS.fos[1]; }
      else { d.style.background = COLORS.emp[0]; d.style.borderColor = COLORS.emp[1]; }
      if (predicted[pk] && cell.state === 'covered') { d.style.background = COLORS.fos[0]; d.style.outline = '2px dashed ' + COLORS.fos[1]; d.style.outlineOffset = '-2px'; }
      if (hit && hit[0] === r && hit[1] === c) {
        d.style.background = '#e24b4a'; d.style.color = '#fff'; d.style.borderColor = '#e24b4a';
        d.style.outline = 'none'; d.style.fontWeight = '800';
        d.style.position = 'relative'; d.style.zIndex = '1'; d.style.animation = 'fxpulse 1.2s ease-out infinite';
      }
      grid.appendChild(d);
    }
    host.appendChild(grid);
  }
  function renderFossils(fossils) {
    var host = L.els.fossilList; if (!host) return; host.innerHTML = '';
    if (!fossils || !fossils.length) { host.appendChild(el('div', { class: 'hint' }, 'No fossils yet.')); return; }
    fossils.forEach(function (f) {
      var row = el('div'); row.style.cssText = 'display:flex;align-items:center;gap:7px;margin:3px 0;font-size:12px;';
      var dot = el('span'); dot.style.cssText = 'width:11px;height:11px;border-radius:3px;background:' + (f.complete ? COLORS.fos[1] : COLORS.tgt) + ';flex:none;'; row.appendChild(dot);
      var label = el('span'); label.style.flex = '1';
      if (f.complete) label.innerHTML = shapeName(f.footprint.shape) + ' — <b>uncovered ✓</b>';
      else {
        var left = f.footprint.cells.filter(function (cc) { return L.last.state.board.cells[cc[0]][cc[1]].state === 'covered'; }).length;
        label.innerHTML = shapeName(f.footprint.shape) + ' — <b>' + left + ' cell' + (left === 1 ? '' : 's') + ' left</b>';
      }
      row.appendChild(label);
      host.appendChild(row);
    });
  }

  /* ---------------- field metrics ---------------- */
  function totalHP(blocks) {
    var s = 0; (blocks || []).forEach(function (row) { (row || []).forEach(function (v) { s += (+v) || 0; }); });
    return s;
  }
  // Source the observed swing count: the runtime counts board progressions
  // exactly (j.swings); before it is restarted we approximate client-side by
  // watching total HP drop between polls (under-counts only on burst hits).
  function updateSwings(j) {
    var b = j.board, id = b && b.id, hp = totalHP(b && b.blocks);
    if (id !== L.mineId) { L.mineId = id; L._lastHP = null; L._rswings = 0; }
    if (typeof j.swings === 'number') { L.swings = j.swings; L.swingSrc = 'server'; }
    else { if (L._lastHP != null && hp < L._lastHP) L._rswings++; L.swings = L._rswings; L.swingSrc = 'client'; }
    L._lastHP = hp;
  }
  function rng(a) { var lo = Math.round(a[0]), hi = Math.round(a[1]); return lo === hi ? ('' + lo) : (lo + '–' + hi); }
  function tile(label, big, sub, accent) {
    return '<div style="padding:8px 10px;border-radius:9px;background:var(--surface-2);border:1px solid var(--border-strong)">'
      + '<div style="font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)">' + label + '</div>'
      + '<div style="font-size:20px;font-weight:800;line-height:1.1;margin-top:2px;color:' + (accent || 'var(--text)') + '">' + big + '</div>'
      + (sub ? '<div style="font-size:11px;color:var(--muted);margin-top:1px">' + sub + '</div>' : '')
      + '</div>';
  }
  function scorecardHTML(m, bench) {
    if (!bench) return '<div class="hint" style="margin-top:9px">Mine cleared in ' + m.swings + ' swings, ' + m.empties + ' empties broken.</div>';
    var dEmp = m.empties - bench.empties;
    var empTxt = dEmp <= 0
      ? '<b style="color:#3a9d54">' + Math.abs(dEmp).toFixed(1) + ' fewer</b> empties than the sim average'
      : '<b style="color:#d08214">' + dEmp.toFixed(1) + ' more</b> empties than the sim average';
    var swTxt = m.swings <= bench.swings[1]
      ? 'swings within the simulated range'
      : '<b style="color:#d08214">' + (m.swings - Math.round(bench.swings[1])) + ' over</b> the simulated swing range';
    return '<div style="margin-top:9px;padding:9px 11px;border-radius:9px;background:rgba(120,180,90,0.12);border:1px solid #9cc45a;font-size:12px;color:var(--text)">'
      + '<b>Mine cleared.</b> ' + m.swings + ' swings · ' + m.empties + ' empties — ' + empTxt + ', ' + swTxt + '.</div>';
  }
  function historyHTML() {
    var s = FXMetrics.history.summary(); if (!s) return '';
    return '<div class="hint" style="margin-top:8px">Your last ' + s.n + ' mine' + (s.n === 1 ? '' : 's') + ': avg '
      + s.meanSwings.toFixed(1) + ' swings · ' + s.meanEmpties.toFixed(1) + ' empties broken.</div>';
  }
  function renderMetrics(m, bench) {
    var host = L.els.metrics; if (!host) return;
    var swSub = bench ? ('sim ' + rng(bench.swings) + ' · floor ' + rng(bench.floor)) : 'no sim baseline for this size';
    var empSub = bench ? ('sim ' + bench.empties.toFixed(1) + (m.done ? '' : ' (full game)')) : '';
    var empAccent = (bench && m.done) ? (m.empties <= bench.empties ? '#3a9d54' : '#d08214') : 'var(--text)';
    var swAccent = (bench && m.done) ? (m.swings <= bench.swings[1] ? '#3a9d54' : '#d08214') : 'var(--text)';
    var grid = '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">'
      + tile('Swings' + (L.swingSrc === 'server' ? '' : ' (approx)'), '' + m.swings, swSub, swAccent)
      + tile('Empties broken', '' + m.empties, empSub, empAccent)
      + tile('Fossils', m.excavated + ' / ' + m.target, m.found + ' found · ' + m.toFinish + ' to finish', 'var(--text)')
      + tile('Cleared', m.pctCleared + '%', m.broken + ' / ' + m.total + ' tiles', 'var(--text)')
      + '</div>';
    host.innerHTML = grid + (m.done ? scorecardHTML(m, bench) : '') + historyHTML();
  }

  /* ---------------- poll the runtime ---------------- */
  function poll() {
    Promise.all([
      fetch(GAME_BOARD_URL, { cache: 'no-store' }).then(function (r) { return r.json(); }),
      fetch(GAME_FOSSILS_URL, { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return { fossils: [] }; })
    ]).then(function (res) {
      var j = res[0], fos = (res[1] && res[1].fossils) || [];
      if (!j || !j.board) { setStatus('Waiting for the game — open the Fossil Excavation minigame (played through the local runtime).'); renderMove(null); return; }
      updateSwings(j);
      try { tickFromGame(j.board, fos); setStatus('Exact read from the game' + (L.mineLevel ? ' · Mine Lv.' + L.mineLevel : '') + ' · updates as you play.'); }
      catch (e) { setStatus('Read error: ' + (e && e.message ? e.message : e)); }
    }).catch(function () { setStatus('Can’t reach the game runtime on http://localhost:8080 — is it running?'); renderMove(null); });
  }

  /* ---------------- init ---------------- */
  function init(container) {
    L.els = {};
    container.innerHTML = '';
    if (!document.getElementById('fxlive-style')) {
      var st = document.createElement('style'); st.id = 'fxlive-style';
      st.textContent = '@keyframes fxpulse{0%,100%{box-shadow:0 0 0 0 rgba(226,75,74,.6)}50%{box-shadow:0 0 0 7px rgba(226,75,74,0)}}';
      document.head.appendChild(st);
    }
    var card = el('div', { class: 'card' });
    var move = el('div'); move.style.cssText = 'padding:10px 12px;border-radius:10px;background:var(--surface-2);border:1px solid var(--border-strong);font-size:13px;color:var(--muted)';
    move.textContent = 'Waiting for the game…';
    card.appendChild(move); L.els.move = move;
    var board = el('div'); board.style.marginTop = '12px'; card.appendChild(board); L.els.board = board;
    card.appendChild(el('div', { class: 'hint' }, 'Hammer the glowing tile in your game — the board updates itself. Read-only: it never sends a move.'));
    card.appendChild(el('div', { style: 'margin-top:10px;font-weight:600;font-size:13px' }, 'Fossils'));
    var flist = el('div'); card.appendChild(flist); L.els.fossilList = flist;
    var status = el('div', { class: 'hint' }, 'Connecting to the game…'); status.style.marginTop = '10px'; card.appendChild(status); L.els.status = status;
    container.appendChild(card);

    var mcard = el('div', { class: 'card' }); mcard.style.marginTop = '12px';
    mcard.appendChild(el('div', { style: 'font-weight:700;font-size:13px;margin-bottom:8px' }, 'Field metrics vs benchmark'));
    var metrics = el('div'); metrics.innerHTML = '<div class="hint">Waiting for the game…</div>';
    mcard.appendChild(metrics); L.els.metrics = metrics;
    mcard.appendChild(el('div', { class: 'hint', style: 'margin-top:8px' },
      'Empties broken is the HP-independent efficiency metric; sim baselines are from BENCHMARKING.md. ' +
      'Swing count is poll-approximate until the runtime is restarted, then exact.'));
    container.appendChild(mcard);

    poll();
    L.timer = setInterval(poll, 1000);
  }

  root.FXLive = {
    init: init,
    _debug: {
      L: L,
      gameBoard: function (b, fossils) { return tickFromGame(b, fossils || []); },
      // Render a sample finished-mine scorecard (for previewing the done state).
      demoDone: function (m) {
        renderMetrics(m || { total: 80, covered: 36, broken: 44, empties: 23, fossilTiles: 20,
          found: 5, excavated: 5, target: 5, pctCleared: 55, swings: 38, toFinish: 0, done: true },
          FXMetrics.classify(10, 8, 5));
      }
    }
  };
})(typeof window !== 'undefined' ? window : this);
