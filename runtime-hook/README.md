# Runtime hook — read-only board observer

`solver_hook.py` is a small, self-contained module that adds a **read-only** observer to the
EF2 Browser Runtime so the solver can read the exact mine board. It's original code (MIT — see
the repo `LICENSE`) that plugs into the runtime; this folder ships **none of the runtime's own
files**, so you wire it in (a few copy-paste additions) rather than overwriting anything.

> **How involved is this?** You copy in **one file** and make **four small additions** to one
> existing file (`handler.py`). You never change or delete an existing line, and you don't need to
> know Python — just paste each snippet where it's shown. About five minutes.

## What it does

- Injects a passive hook into the runtime's **bootstrap page** (never the game bundle, so the
  bundle integrity check is untouched). The hook wraps `JSON.parse` and, whenever the game parses
  a decrypted mine response, mirrors the board (HP grid) + fossil geometry (shapes + cell
  coordinates) to two local endpoints — and exposes them in-page on `window.__EF2_SOLVER_DATA__`.
  It never decrypts anything itself, never modifies the parsed result, and never sends a game action.
- Adds `GET /solver/board` and `GET /solver/fossils`, the POST sinks the hook writes to, and a
  read-only observed-swing counter. All of that state lives inside the module.

## Before you start

- You already have the **EF2 Browser Runtime** set up (you obtain it separately — link at the
  bottom). Its server files live in the `scripts/runtime_server/` folder.
- You'll edit one file there, **`handler.py`** — open it in any text/code editor.
- Watch the **indentation**: Python is picky about it. Every line you paste should line up with the
  code already inside the method you're pasting into (usually 4 spaces in). Use spaces, not tabs, to
  match the surrounding code.

## Install — four small additions

### 1. Copy in the module

Put `solver_hook.py` into the runtime's `scripts/runtime_server/` folder — right next to `handler.py`.

### 2. Add the import

Open `scripts/runtime_server/handler.py`. Near the top, where you see other lines like
`from . import state`, add one line:

```python
from . import solver_hook
```

### 3. Add three dispatch lines

Each snippet goes at the **top of an existing method**, before that method's other code. You're only
*adding* lines — leave everything else exactly as it is. The `# <- add` comments are just labels;
you don't need to type them.

**a) In `do_GET`** — make these the first two lines:

```python
def do_GET(self):
    if solver_hook.handle_get(self):     # <- add
        return                           # <- add
    ...                                  #    your existing code stays here, unchanged
```

**b) In `do_POST`** — make these the first two lines:

```python
def do_POST(self):
    if solver_hook.handle_post(self):    # <- add
        return                           # <- add
    ...                                  #    your existing code, unchanged
```

**c) Where the bootstrap page is served** — find the spot that reads the page into a variable
(usually called `html`) just before sending it, and add one line right after:

```python
html = index_path.read_text(...)         #    an existing line that loads index.html
html = solver_hook.inject(html)          # <- add this right after it
# ... existing code that sends `html`, unchanged ...
```

Can't find it? Search `handler.py` for `index.html` or `read_text` — that's the method that builds
and serves the page.

### 4. Restart the runtime

Stop the runtime and start it again so it loads the changes.

## Did it work?

Any **one** of these confirms it:

1. **Endpoint (easiest):** with the runtime running, open
   <http://localhost:8080/endlessfrontier2/solver/board> in your browser. You should get
   `{"board":null}` — and once you open a Fossil Excavation mine in-game, it fills with the live board.
2. **Bundled test (no browser needed):**

   ```sh
   node solver_hook.test.js     # exits non-zero on failure
   ```

(If you open your browser's developer console on the game page, you'll also see
`[EF2 solver hook] active — read-only mine board observer`.)

## If something's off

- **`ModuleNotFoundError: ... solver_hook`** — `solver_hook.py` isn't sitting next to `handler.py`,
  or the import is wrong. It must read exactly `from . import solver_hook` (the leading dot matters).
- **`IndentationError` when the runtime starts** — a pasted line doesn't line up. The added lines
  must be indented to match the code already inside that method (typically 4 spaces under `def ...:`),
  using spaces, not tabs.
- **`/solver/board` returns 404** — the `do_GET` line (3a) is missing, or it isn't near the top so
  something else handles the request first. Make it the first thing `do_GET` does.
- **`/solver/board` stays `{"board":null}` even after you open a mine** — the `inject(html)` line
  (3c) or the `do_POST` line (3b) is missing, so the page never sends the board out. Re-check both.

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
