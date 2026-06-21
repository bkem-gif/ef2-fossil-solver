# Runtime integration — the in-game solver overlay

These files add a **read-only, in-game Fossil Excavation solver overlay** to the EF2 Browser Runtime:
a draggable panel that appears on the game page and shows the fewest-swing next move, reading the
game's own decrypted board. They're original code (MIT — see the repo `LICENSE`); you wire them in,
overwriting **none** of the runtime's own files.

It's two read-only pieces:

- **the hook** (`solver_hook.py`) — watches the game's decrypted mine responses and exposes the board
  in-page (and on read-only `/solver/*` endpoints);
- **the overlay** (`solver_overlay.py` + `overlay.js`, plus the engine `solver.js` + `metrics.js`) —
  the panel that reads that in-page data (no HTTP, no extra server) and draws the next move.

> **How involved is this?** Copy **five files** into your runtime and make **a few one-line additions**
> to one file (`handler.py`). You never change or delete an existing line, and you don't need to know
> Python — just paste each snippet where it's shown. About five minutes.

## Before you start

- You already have the **EF2 Browser Runtime** set up (you obtain it separately — link at the bottom).
- You'll edit one file, **`scripts/runtime_server/handler.py`** — open it in any text/code editor.
- Watch the **indentation**: Python is picky. Each pasted line should line up with the code already
  inside the method you paste into (usually 4 spaces in). Use spaces, not tabs.

## 1. Copy in the files

Copy these from this repo into your runtime (create the `fossil-solver` folder if it doesn't exist):

| From this repo | Into your runtime |
|---|---|
| `runtime/solver_hook.py` | `scripts/runtime_server/` |
| `runtime/solver_overlay.py` | `scripts/runtime_server/` |
| `solver.js` | `web/bootstrap/runtime/fossil-solver/` |
| `metrics.js` | `web/bootstrap/runtime/fossil-solver/` |
| `overlay.js` | `web/bootstrap/runtime/fossil-solver/` |

(The three `.js` files are the engine + the overlay UI; the overlay loads them in that order.)

## 2. Wire them into `handler.py`

Every edit is an **addition** at the top of an existing method — leave everything else exactly as it
is. The `# <- add` comments are just labels; you don't need to type them.

**a) Imports** — near the other `from . import …` lines:

```python
from . import solver_hook
from . import solver_overlay
```

**b) In `do_GET`** — make these the first lines:

```python
def do_GET(self):
    if solver_hook.handle_get(self):     # <- add
        return                           # <- add
    ...                                  #    your existing code, unchanged
```

**c) In `do_POST`** — make these the first lines:

```python
def do_POST(self):
    if solver_hook.handle_post(self):    # <- add
        return                           # <- add
    ...                                  #    your existing code, unchanged
```

**d) Where the bootstrap page is served** — find the spot that reads the page into a variable (usually
called `html`) just before sending it, and add two lines right after:

```python
html = index_path.read_text(...)         #    an existing line that loads index.html
html = solver_hook.inject(html)          # <- add: the read-only data hook
html = solver_overlay.inject(html)       # <- add: the on-screen overlay
```

Can't find it? Search `handler.py` for `index.html` or `read_text` — that's the method that builds
and serves the page.

## 3. Restart the runtime

Stop the runtime and start it again, then open the **Fossil Excavation** minigame.

## Did it work?

- **The overlay:** open a mine in-game — a draggable **🦴 Fossil Solver** panel appears over the page
  and highlights the next tile to hammer. (Drag it anywhere; `–` collapses it.)
- **The hook (optional check):** open <http://localhost:8080/endlessfrontier2/solver/board> (use your
  runtime's port if you changed `listenPort`) — you get `{"board":null}`, and once a mine is open it
  fills with the live board.
- **The hook test (no browser):** `node runtime/solver_hook.test.js` — drives the injected observer
  through synthetic mine responses; exits non-zero on failure. (The engine's own unit tests are in
  `tests.html`, opened in a browser.)

(In the browser console on the game page you'll also see
`[EF2 solver hook] active — read-only mine board observer`.)

## If something's off

- **`ModuleNotFoundError: ... solver_hook` / `solver_overlay`** — the `.py` file isn't sitting next to
  `handler.py`, or the import is wrong. It must read exactly `from . import solver_hook` /
  `from . import solver_overlay` (the leading dot matters).
- **`IndentationError` when the runtime starts** — a pasted line doesn't line up. Match the indentation
  of the code already inside that method (typically 4 spaces under `def …:`), using spaces, not tabs.
- **No 🦴 panel appears** — the overlay's three `.js` files aren't in
  `web/bootstrap/runtime/fossil-solver/`, or the `solver_overlay.inject(html)` line (2d) is missing.
  Open the browser console on the game page and look for a 404 on `overlay.js` / `solver.js` / `metrics.js`.
- **The panel appears but never updates** — the hook isn't feeding it. Make sure `solver_hook.inject(html)`
  (2d) is wired, so the page exposes `window.__EF2_SOLVER_DATA__`.
- **`/solver/board` returns 404** — the `do_GET` line (2b) is missing, or it isn't near the top so
  something else handles the request first.

## What the modules expect from the runtime

`solver_hook.py` and `solver_overlay.py` use a few things the EF2 Browser Runtime already provides:

- `config.APP_BASE_PATH` — the app's base path (e.g. `/endlessfrontier2`),
- `static_files.normalize_app_path` — strips that base path from a request path (hook only),
- the handler's `_write_response(status, payload, headers=...)` — used for the hook's JSON responses.

If a future runtime version renames these, point the modules' imports / calls at the equivalents.

## Read-only, by design

Everything here observes the game's own already-decrypted output and shows it locally. It does not
decrypt the protocol itself, change game behaviour, or send actions. It plugs into the **EF2 Browser
Runtime by Rokhan** (<https://github.com/Rokhanhh/EF2-Browser-Runtime>), which you obtain and run
separately.
