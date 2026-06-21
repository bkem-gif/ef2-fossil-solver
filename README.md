# EF2 Fossil Solver

A read-only, in-game **overlay** for the EF2 Browser Runtime that solves the *Endless Frontier 2*
**Fossil Excavation** minigame — it shows the **fewest-swing** way to uncover every fossil **right on
the game page**, updating as you play. No build step, no second server, no AI or pixel-guessing: it
reads the game's own decrypted board in-page, so HP and fossil shapes are exact. It is **read-only** —
it never sends a move to the game.

> **Can't install it (no runtime, or you'd rather not touch code)?** [**SOLVE-BY-HAND.md**](SOLVE-BY-HAND.md)
> distills the same strategy into a by-eye method you can apply to your own board — illustrated, with
> worked example boards.

## Requirements

- A working **EF2 Browser Runtime** install — the separate, third-party project that runs the game in
  a desktop browser (see [Attribution](#attribution--legal)).
- **Python 3.10+** — the runtime's own language; you drop two small modules into it.

## Setup

The solver runs **inside** the runtime — there's no separate server to start. You wire it in once:

1. **Add the overlay to your runtime.** Copy this repo's two modules (`solver_hook.py`,
   `solver_overlay.py`) and three web assets (`solver.js`, `metrics.js`, `overlay.js`) into your
   runtime, and add a few one-line calls to `handler.py`. Full copy-paste steps are in
   [`runtime/README.md`](runtime/README.md) — no existing runtime files are overwritten.
2. **Restart the runtime**, then open the **Fossil Excavation** minigame.
3. The **🦴 Fossil Solver** panel appears right on the game page.

## Using it

A small **draggable panel** sits over the game. It draws a mini **board**, **highlights the next tile
to hammer** (`🔨 R# · C#`), and shows a **Fossils: X / Y uncovered** count. Hammer the highlighted tile
in the game; the panel re-reads the board and updates — repeat until **✓ All uncovered**. It also shows
an **Empties** line — non-fossil tiles you've broken vs the simulation benchmark (see
[`BENCHMARKING.md`](BENCHMARKING.md)). Drag the panel anywhere; `–` collapses it.

## How it works

You play EF2 through the runtime. Two small **read-only** pieces plug into it:

- The **hook** (`solver_hook.py`) injects a passive observer into the runtime's bootstrap page (never
  the game bundle, so its integrity check is untouched). It watches the game's own decrypted mine
  responses and exposes the board (HP grid) + fossil geometry (shapes + cell coordinates) **in-page**
  on `window.__EF2_SOLVER_DATA__` — and also mirrors them to read-only `/solver/board` and
  `/solver/fossils` routes on the runtime's **existing** server (no new server or port). It never
  decrypts anything itself — the game does — and never sends an action.
- The **overlay** (`solver_overlay.py` + `overlay.js`) is the draggable panel injected onto the game
  page. It reads that in-page data **directly — no network round-trip**, runs the solver engine, and
  renders the fewest-swing next move right over the board.

The mechanics it models:

- Hitting a covered tile deals **+2** to it and **+1** to each orthogonally adjacent covered tile;
  damage accumulates and a tile breaks at 0 HP.
- Fossils are rigid 4-cell shapes — **1×4**, **4×1**, **2×2** — and may touch. A fossil is uncovered
  when all four of its tiles are broken.
- With a fossil's footprint known, the completion planner finds the minimum swings to clear its
  remaining tiles; while fossils are still hidden it probes the most-likely tiles. See
  [`BENCHMARKING.md`](BENCHMARKING.md) for the heuristics and how they were tuned.

## Files

| File | Purpose |
|------|---------|
| `solver.js` | pure engine — damage model, placements, completion planner, recommender |
| `overlay.js` | the in-game overlay UI — reads the board in-page and draws the draggable next-swing panel |
| `metrics.js` | field metrics — turns each snapshot into swings / empties / fossils, scored vs the benchmark |
| `runtime/` | the two modules you wire into your runtime (`solver_hook.py` + `solver_overlay.py`) + how |
| `tests.html` | open in a browser to run the engine unit tests |
| `bench.js` | dev-only Monte-Carlo benchmark (`node bench.js`) |
| `gapfind.js` / `gapfind2.js` | dev-only gap-finders — confirm no exploitable move-choice slack remains (see `BENCHMARKING.md`) |
| `BENCHMARKING.md` | benchmarking & heuristics reference |
| `SOLVE-BY-HAND.md` | play it by eye — the solver's strategy as an illustrated human field guide |

`solver.js`, `metrics.js`, and `overlay.js` double as the three web assets you copy into the runtime
(see [`runtime/README.md`](runtime/README.md)) — one source of truth, no duplication.

## Attribution & legal

- **EF2 Browser Runtime** — this tool plugs into the third-party runtime by **Rokhan**
  (<https://github.com/Rokhanhh/EF2-Browser-Runtime>), which you obtain separately. The modules in
  `runtime/` (`solver_hook.py`, `solver_overlay.py`) are **original code** (written here, MIT-licensed)
  that you drop into that runtime and wire in — this repo ships **none of the runtime's own files**.
  Use the runtime itself under its author's terms.
- **Game content** — *Endless Frontier 2*, its data, assets, and trademarks belong to the publisher.
  This tool reads only the board already on your screen — it bundles no game assets and decrypts
  nothing itself. For personal play; don't use it to redistribute the publisher's content or in
  violation of the game's terms of service.

## License

[MIT](LICENSE) — covers everything in this repo, including the original modules in `runtime/`. It does
not include the EF2 Browser Runtime itself, which you obtain separately and use under its author's
terms (see above).
