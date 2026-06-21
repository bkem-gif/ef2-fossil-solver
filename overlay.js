/*
 * EF2 Fossil Excavation — in-game solver overlay.
 *
 * A compact panel injected onto the runtime's game page (same pattern as the
 * wave-tracker overlay). It reads the board the read-only hook already captured
 * in-page (window.__EF2_SOLVER_DATA__ + the "ef-solver-update" event) — no HTTP —
 * runs the solver engine (FS), and shows the fewest-swing next move right over the
 * game. Read-only: it never sends a move. Depends on solver.js (FS) and, optionally,
 * metrics.js (FXMetrics), loaded before it.
 */
(function () {
  if (window.__EF2_SOLVER_OVERLAY__ || typeof FS === "undefined") return;
  window.__EF2_SOLVER_OVERLAY__ = true;
  var ID = "ef-solver-overlay";
  var COLORS = { cov: ["#f4e3c4", "#6b4f1d"], emp: "#dcd6c8", fos: "#cfe6a8", tgt: "#e24b4a" };

  function el(tag, css, html) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }

  function ensureStyle() {
    if (document.getElementById(ID + "-style")) return;
    var s = document.createElement("style"); s.id = ID + "-style";
    s.textContent =
      "#" + ID + "{position:fixed;bottom:8px;left:8px;z-index:2147483646;box-sizing:border-box;width:188px;" +
      "padding:8px 9px;border-radius:9px;border:1px solid rgba(156,196,90,.4);background:rgba(20,18,14,.86);" +
      "color:#f4ecd8;font:12px/1.35 -apple-system,system-ui,sans-serif;-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);user-select:none}" +
      "#" + ID + " .hd{display:flex;align-items:center;gap:6px;font-weight:700;margin-bottom:6px}" +
      "#" + ID + " .x{cursor:pointer;opacity:.6;font-size:14px;line-height:1;padding:0 2px}#" + ID + " .x:hover{opacity:1}" +
      "#" + ID + " .next{font-size:15px;font-weight:800;margin:1px 0 6px}" +
      "#" + ID + " .grid{display:grid;gap:1px;margin:0 0 6px}" +
      "#" + ID + " .c{width:100%;aspect-ratio:1;border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;box-sizing:border-box}" +
      "#" + ID + " .sub{font-size:11px;color:#bdb39a;margin-top:2px}#" + ID + " .sub b{color:#f4ecd8}" +
      "#" + ID + ".min .body{display:none}" +
      "@keyframes efso{0%,100%{box-shadow:0 0 0 0 rgba(226,75,74,.7)}50%{box-shadow:0 0 0 4px rgba(226,75,74,0)}}";
    document.head.appendChild(s);
  }

  function makeDraggable(p, handle) {
    handle.style.cursor = "move";
    var on = false, sx, sy, ox, oy;
    handle.addEventListener("mousedown", function (e) {
      if (e.target.classList && e.target.classList.contains("x")) return; // leave the collapse button clickable
      var r = p.getBoundingClientRect();
      p.style.top = r.top + "px"; p.style.left = r.left + "px"; p.style.right = "auto"; p.style.bottom = "auto";
      on = true; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; e.preventDefault();
    });
    document.addEventListener("mousemove", function (e) {
      if (!on) return;
      p.style.left = Math.max(0, ox + e.clientX - sx) + "px";
      p.style.top = Math.max(0, oy + e.clientY - sy) + "px";
    });
    document.addEventListener("mouseup", function () {
      if (!on) return; on = false;
      try { localStorage.setItem("ef_solver_pos", JSON.stringify({ left: p.style.left, top: p.style.top })); } catch (e) {}
    });
  }

  var panel, body, minimized = false;
  function ensurePanel() {
    if (panel) return;
    ensureStyle();
    panel = el("div"); panel.id = ID;
    var hd = el("div"); hd.className = "hd";
    hd.appendChild(el("span", null, "🦴"));
    hd.appendChild(el("span", "flex:1", "Fossil Solver"));
    var tog = el("span", null, "–"); tog.className = "x"; tog.title = "collapse";
    tog.onclick = function () { minimized = !minimized; panel.classList.toggle("min", minimized); tog.textContent = minimized ? "+" : "–"; };
    hd.appendChild(tog);
    panel.appendChild(hd);
    body = el("div"); body.className = "body"; panel.appendChild(body);
    (document.body || document.documentElement).appendChild(panel);
    // restore a dragged position if the user moved it before
    try { var pos = JSON.parse(localStorage.getItem("ef_solver_pos") || "null"); if (pos && pos.left) { panel.style.left = pos.left; panel.style.top = pos.top; panel.style.right = "auto"; panel.style.bottom = "auto"; } } catch (e) {}
    makeDraggable(panel, hd);
  }

  function mapShapeId(shape) {
    var s = ("" + (shape || "")).toLowerCase();
    if (s.indexOf("square") >= 0) return "sq";
    if (s.indexOf("vline") >= 0) return "v4";
    if (s.indexOf("hline") >= 0) return "h4";
    return null;
  }
  function specFromGame(b, fossils) {
    var blocks = b.blocks || [];
    var rows = b.yNum || blocks.length, cols = b.xNum || (blocks[0] ? blocks[0].length : 0);
    var fset = {};
    (fossils || []).forEach(function (box) { (box.coordinates || []).forEach(function (p) { fset[p.y + "," + p.x] = 1; }); });
    var cells = [];
    for (var r = 0; r < rows; r++) { var row = []; for (var c = 0; c < cols; c++) {
      var hp = (blocks[r] && blocks[r][c]) || 0;
      if (hp > 0) row.push({ state: "covered", hp: hp });
      else if (fset[r + "," + c]) row.push({ state: "fossil" });
      else row.push({ state: "empty" });
    } cells.push(row); }
    return { rows: rows, cols: cols, cells: cells };
  }
  function tick(data) {
    var b = data.board, fossils = data.fossils || [];
    var spec = specFromGame(b, fossils);
    var target = b.chestCount || 5;
    var board = FS.makeBoard(spec.rows, spec.cols, 0);
    for (var r = 0; r < spec.rows; r++) for (var c = 0; c < spec.cols; c++) {
      var cell = spec.cells[r][c];
      if (cell.state === "covered") board.cells[r][c] = { state: "covered", hp: cell.hp || 1, dmg: 0, fossil: null };
      else if (cell.state === "fossil") board.cells[r][c] = { state: "fossil", hp: 0, dmg: 0, fossil: null };
      else board.cells[r][c] = { state: "empty", hp: 0, dmg: 0, fossil: null };
    }
    var fossilObjs = fossils.map(function (box, i) {
      var fc = (box.coordinates || []).map(function (p) { return [p.y, p.x]; });
      return { id: "g" + i, cells: fc, footprint: { shape: mapShapeId(box.shape), cells: fc }, complete: !!box.fullyExcavated };
    });
    var rec = FS.recommend(board, fossilObjs, target);
    var done = 0; fossilObjs.forEach(function (f) { if (f.complete) done++; });
    return { spec: spec, rec: rec, done: done, target: target, board: board, fossils: fossilObjs };
  }

  function render() {
    ensurePanel();
    var data = window.__EF2_SOLVER_DATA__;
    if (!data || !data.board || !data.board.blocks) { body.innerHTML = '<div class="sub">Open the Fossil Excavation minigame…</div>'; return; }
    var t; try { t = tick(data); } catch (e) { body.innerHTML = '<div class="sub">read error</div>'; return; }
    var rec = t.rec, hit = rec && rec.hit, spec = t.spec, html = "";
    if (rec && rec.mode === "done") html += '<div class="next" style="color:#9cc45a">✓ All ' + t.target + ' uncovered!</div>';
    else if (hit) html += '<div class="next">🔨 R' + (hit[0] + 1) + ' · C' + (hit[1] + 1) + '</div>';
    else html += '<div class="next" style="font-size:12px;color:#bdb39a">' + ((rec && rec.reason) || "…") + '</div>';
    html += '<div class="grid" style="grid-template-columns:repeat(' + spec.cols + ',1fr)">';
    for (var r = 0; r < spec.rows; r++) for (var c = 0; c < spec.cols; c++) {
      var cell = spec.cells[r][c], bg = COLORS.emp, fg = "transparent", txt = "", extra = "";
      if (cell.state === "covered") { bg = COLORS.cov[0]; fg = COLORS.cov[1]; txt = cell.hp; }
      else if (cell.state === "fossil") { bg = COLORS.fos; }
      if (hit && hit[0] === r && hit[1] === c) { bg = COLORS.tgt; fg = "#fff"; extra = "animation:efso 1.2s ease-out infinite;"; }
      html += '<div class="c" style="background:' + bg + ';color:' + fg + ';' + extra + '">' + txt + '</div>';
    }
    html += '</div>';
    html += '<div class="sub">Fossils: <b>' + t.done + ' / ' + t.target + '</b> uncovered</div>';
    try {
      if (window.FXMetrics) {
        var m = FXMetrics.compute(t.board, t.fossils, 0, t.target);
        var bench = FXMetrics.classify(spec.rows, spec.cols, t.target);
        html += '<div class="sub">Empties: <b>' + m.empties + '</b>' + (bench ? ' (sim ' + bench.empties.toFixed(0) + ')' : '') + ' · ' + m.pctCleared + '% cleared</div>';
      }
    } catch (e) {}
    body.innerHTML = html;
  }

  window.addEventListener("ef-solver-update", render);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
  console.log("[EF2 solver overlay] active — reads the in-page board, never sends a move");
})();
