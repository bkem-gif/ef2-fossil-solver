"""
Read-only Fossil Excavation board observer (optional, self-contained feature).

A passive hook injected into the bootstrap page (NOT the game bundle, so the
bundle integrity check is untouched): it wraps the page's ``JSON.parse`` and,
whenever the game parses a decrypted response holding the mine grid (a ``blocks``
2-D number array) or revealed fossils (objects with a ``coordinates`` array),
mirrors a copy to two local endpoints. It never decrypts anything itself (the
game does that), never modifies the parsed result, and never sends a game action.

The HTTP handler wires this in with three one-line calls and owns no hook state:

    solver_hook.handle_get(self)   # first thing in do_GET
    solver_hook.handle_post(self)  # first thing in do_POST
    html = solver_hook.inject(html)  # when serving the bootstrap index
"""
from __future__ import annotations

import json
import time
import urllib.parse

from .config import APP_BASE_PATH
from .static_files import normalize_app_path

MARKER = "ef-solver-hook"
BOARD_PATH = "/solver/board"
FOSSILS_PATH = "/solver/fossils"

# --- observed state: a read-only mirror of the game's own decrypted output ---
# Latest mine board as raw JSON bytes, exactly as the game produced it.
_latest_board: bytes | None = None
_latest_board_ts: float = 0.0
# Revealed fossils (the game's own revealedChests geometry), keyed by a signature
# of the cells so repeat sends update the same entry; cleared on a new mine id.
_fossils: dict = {}
_last_mine_id: object = None
# Observed hammer swings this mine: the number of board sends whose total remaining
# HP dropped (one hammer always lowers it). Reset on a new mine id.
_mine_swings: int = 0
_last_board_hp: int | None = None

_HOOK_SCRIPT = """
<script id="ef-solver-hook">
(function () {
  if (window.__EF2_SOLVER_HOOK__) return;
  window.__EF2_SOLVER_HOOK__ = true;
  var BOARD_URL = "__SOLVER_BOARD_URL__", FOSSILS_URL = "__SOLVER_FOSSILS_URL__";
  var origParse = JSON.parse, origStringify = JSON.stringify, lastBoard = "", lastFos = "";
  function is2dNum(a) { return Array.isArray(a) && Array.isArray(a[0]) && typeof a[0][0] === "number"; }
  // recurse into any nested wrapper object (not arrays), so wrapper-key naming
  // (result/data/res/…) doesn't matter.
  function findBoard(o, depth) {
    if (!o || typeof o !== "object" || Array.isArray(o) || depth > 3) return null;
    if (is2dNum(o.blocks)) return o;
    for (var k in o) { var v = o[k]; if (v && typeof v === "object" && !Array.isArray(v)) { var r = findBoard(v, depth + 1); if (r) return r; } }
    return null;
  }
  // Collect every revealed fossil (any object carrying a `coordinates` array) —
  // forwarding only geometry: coordinates, shape, fullyExcavated.
  function collectChests(o, depth, acc) {
    if (!o || typeof o !== "object" || depth > 5) return acc;
    if (!Array.isArray(o) && Array.isArray(o.coordinates)) { acc.push({ coordinates: o.coordinates, shape: o.shape, fullyExcavated: !!o.fullyExcavated }); return acc; }
    for (var k in o) { var v = o[k]; if (v && typeof v === "object") collectChests(v, depth + 1, acc); }
    return acc;
  }
  function send(url, s) { try { if (navigator.sendBeacon) navigator.sendBeacon(url, s); else fetch(url, { method: "POST", body: s, keepalive: true }); } catch (e) {} }
  function pageData() { return window.__EF2_SOLVER_DATA__ || (window.__EF2_SOLVER_DATA__ = { board: null, fossils: [], ts: 0 }); }
  JSON.parse = function (text, reviver) {
    var r = origParse(text, reviver);
    try {
      // board (HP grid) and fossils (coordinates) are INDEPENDENT — a doDamage
      // carries both, and a getStatus refetch must not clobber the fossils.
      var changed = false;
      var b = findBoard(r, 0);
      if (b) { var s = origStringify(b); if (s !== lastBoard) { lastBoard = s; pageData().board = b; changed = true; send(BOARD_URL, s); try { console.log("[EF2 hook] board:", Object.keys(b).join(",")); } catch (e) {} } }
      var chests = collectChests(r, 0, []);
      if (chests.length) { var d = origStringify(chests); if (d !== lastFos) { lastFos = d; pageData().fossils = chests; changed = true; send(FOSSILS_URL, d); try { console.log("[EF2 hook] fossils:", chests.length); } catch (e) {} } }
      // Also expose the latest data in-page (window.__EF2_SOLVER_DATA__) + fire an event,
      // so a same-page overlay can read it with no HTTP round-trip. The endpoints above
      // still work unchanged for external consumers (e.g. the standalone solver page).
      if (changed) { pageData().ts = Date.now(); try { window.dispatchEvent(new CustomEvent("ef-solver-update")); } catch (e) {} }
    } catch (e) {}
    return r;
  };
  console.log("[EF2 solver hook] active \\u2014 read-only mine board observer");
})();
</script>
""".strip()


def _script_tag() -> str:
    return (
        _HOOK_SCRIPT
        .replace("__SOLVER_BOARD_URL__", f"{APP_BASE_PATH}{BOARD_PATH}")
        .replace("__SOLVER_FOSSILS_URL__", f"{APP_BASE_PATH}{FOSSILS_PATH}")
    )


def inject(html: str) -> str:
    """Insert the observer <script> into the bootstrap HTML (idempotent)."""
    if f'id="{MARKER}"' in html:
        return html
    script_tag = _script_tag() + "\n"
    head_index = html.lower().find("<head>")
    if head_index != -1:
        insert_at = head_index + len("<head>")
        return html[:insert_at] + "\n" + script_tag + html[insert_at:]
    return script_tag + html


def _route(handler) -> str | None:
    path = normalize_app_path(urllib.parse.urlsplit(handler.path).path)
    if path == BOARD_PATH:
        return "board"
    if path == FOSSILS_PATH:
        return "fossils"
    return None


def _fossil_sig(fossil: dict) -> str:
    coords = fossil.get("coordinates") or []
    return ";".join(sorted("%s,%s" % (c.get("x"), c.get("y")) for c in coords if isinstance(c, dict)))


def handle_post(handler) -> bool:
    """Sink for the in-page hook's board / fossils POSTs. True if it handled the request."""
    global _latest_board, _latest_board_ts, _last_mine_id, _mine_swings, _last_board_hp
    route = _route(handler)
    if route is None:
        return False
    try:
        length = int(handler.headers.get("Content-Length") or 0)
    except (TypeError, ValueError):
        length = 0
    body = handler.rfile.read(length) if length > 0 else b""
    if body:
        if route == "board":
            _latest_board = body
            _latest_board_ts = time.time()
            try:
                parsed = json.loads(body)
                mine_id = parsed.get("id")
                if mine_id is not None and mine_id != _last_mine_id:
                    # a new mine (different id) resets fossils + swing count
                    _last_mine_id = mine_id
                    _fossils.clear()
                    _mine_swings = 0
                    _last_board_hp = None
                # Count a swing whenever total remaining HP drops (one hammer
                # always lowers it); the hook only sends on a changed board.
                blocks = parsed.get("blocks")
                if isinstance(blocks, list):
                    total_hp = sum(
                        v for row in blocks if isinstance(row, list)
                        for v in row if isinstance(v, (int, float))
                    )
                    if _last_board_hp is not None and total_hp < _last_board_hp:
                        _mine_swings += 1
                    _last_board_hp = total_hp
            except Exception:
                pass
        else:
            try:
                for fossil in json.loads(body):
                    sig = _fossil_sig(fossil)
                    if sig:
                        _fossils[sig] = fossil
            except Exception:
                pass
    handler._write_response(200, b'{"ok":true}', headers={"Content-Type": "application/json"})
    return True


def handle_get(handler) -> bool:
    """Serve GET /solver/board and /solver/fossils. True if it handled the request."""
    route = _route(handler)
    if route is None:
        return False
    if route == "board":
        board = _latest_board if isinstance(_latest_board, (bytes, bytearray)) else None
        payload = b'{"board":null}' if board is None else (
            b'{"ts":%d,"swings":%d,"board":%s}' % (int(_latest_board_ts), int(_mine_swings), bytes(board))
        )
    else:
        payload = json.dumps({"fossils": list(_fossils.values())}).encode("utf-8")
    handler._write_response(200, payload, headers={"Content-Type": "application/json; charset=utf-8"})
    return True
