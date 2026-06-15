# Runtime hook — read-only board observer

`solver_hook.py` is a small, self-contained module that adds a **read-only** observer to the
EF2 Browser Runtime so the solver can read the exact mine board. It's original code (MIT — see
the repo `LICENSE`) that plugs into the runtime; this folder ships **none of the runtime's own
files**, so you wire it in rather than overwriting anything.

## What it does

- Injects a passive hook into the runtime's **bootstrap page** (never the game bundle, so the
  bundle integrity check is untouched). The hook wraps `JSON.parse` and, whenever the game parses
  a decrypted mine response, mirrors the board (HP grid) + fossil geometry (shapes + cell
  coordinates) to two local endpoints — and exposes them in-page on `window.__EF2_SOLVER_DATA__`.
  It never decrypts anything itself, never modifies the parsed result, and never sends a game action.
- Adds `GET /solver/board` and `GET /solver/fossils`, the POST sinks the hook writes to, and a
  read-only observed-swing counter. All of that state lives inside the module.

## Install

1. **Drop in the module.** Copy `solver_hook.py` into your runtime's `scripts/runtime_server/`.

2. **Wire it into `scripts/runtime_server/handler.py`** with an import + three one-line dispatch
   calls (the module owns all its own state, so nothing else changes):

   ```python
   # with the other "from . import ..." relative imports:
   from . import solver_hook
   ```
   ```python
   # as the FIRST statement inside do_GET(self):
   if solver_hook.handle_get(self):
       return
   ```
   ```python
   # as the FIRST statement inside do_POST(self):
   if solver_hook.handle_post(self):
       return
   ```
   ```python
   # in the method that serves the bootstrap index — where it does
   #   html = (WEB_ROOT / "index.html").read_text(...)
   # and returns it — add one line before the HTML is encoded/sent:
   html = solver_hook.inject(html)
   ```

3. **Restart the runtime.** The solver then reads `http://localhost:8080/endlessfrontier2/solver/board`.

## What the module expects from the runtime

`solver_hook.py` uses three things the EF2 Browser Runtime already provides:

- `config.APP_BASE_PATH` — the app's base path (e.g. `/endlessfrontier2`),
- `static_files.normalize_app_path` — strips that base path from a request path,
- the handler's `_write_response(status, payload, headers=...)` — used to send the JSON responses.

If a future runtime version renames these, point the module's imports / its `_write_response`
calls at the equivalents.

## Read-only, by design

Everything the hook adds observes the game's own already-decrypted output and exposes it locally.
It does not decrypt the protocol itself, change game behaviour, or send actions. It plugs into the
**EF2 Browser Runtime by Rokhan** (<https://github.com/Rokhanhh/EF2-Browser-Runtime>), which you
obtain and run separately.
