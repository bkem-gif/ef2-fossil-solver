# Runtime hook — read-only board observer

These two files are from the **EF2 Browser Runtime** (the third-party runtime that runs the
game in a browser), with a small **read-only** observer added so the EF2 Fossil Solver can read
the exact mine board. They are included **with the runtime author's permission** and remain
subject to that project's terms.

## What it does

- Injects a passive hook into the runtime's **bootstrap page** (never the game bundle, so the
  bundle integrity check is untouched). The hook wraps `JSON.parse` and, whenever the game parses
  a decrypted mine response, forwards a copy of the board (HP grid) and fossil geometry (shapes +
  cell coordinates) to two local endpoints. It never decrypts anything itself, never modifies the
  parsed result, and never sends a game action.
- Adds `GET /solver/board` and `GET /solver/fossils`, the internal POST sinks the hook writes to,
  and a read-only observed-swing counter (counts board progressions; no native counter exists).

## Install

Copy `handler.py` and `state.py` into your runtime's `scripts/runtime_server/`, replacing the
originals, then restart the runtime. The solver then reads `http://localhost:8080/endlessfrontier2/solver/board`.

## If your runtime version differs

If these files don't match your runtime's version, **don't overwrite** — port the additions
instead. They are grouped and commented:

- **`handler.py`** — the `SOLVER_*` constants and injected `SOLVER_HOOK_SCRIPT`; the
  `_inject_solver_hook`, `_solver_route`, `_fossil_sig`, `_handle_solver_post`, and
  `_handle_solver_get` methods; and the three call sites that dispatch them (in the GET handler,
  the POST handler, and where the bootstrap HTML is served).
- **`state.py`** — the `LATEST_BOARD` / `LATEST_BOARD_TS` / `FOSSILS` / `LAST_MINE_ID` /
  `MINE_SWINGS` / `LAST_BOARD_HP` block.

Everything the hook adds is read-only: it observes the game's own decrypted output and exposes it
locally. It does not change game behavior or send actions.
