# EF2 Fossil Solver — runtime plugin

A read-only, in-game **overlay** for the EF2 Browser Runtime that solves the *Endless Frontier 2*
**Fossil Excavation** minigame — it shows the **fewest-swing** way to uncover every fossil **right on
the game page**, updating as you play. No build step, no second server, no AI or pixel-guessing: it
reads the game's own decrypted board in-page, so HP and fossil shapes are exact. It is **read-only** —
it never sends a move to the game.

> This is the **plugin** form for the current EF2 Browser Runtime (its browser-plugin architecture). The
> older standalone form — Python modules (`solver_hook.py`/`solver_overlay.py`) you wired into the
> runtime's server by hand — is on the **`main`** branch.

> **Can't install it (no runtime, or you'd rather not touch code)?** [**SOLVE-BY-HAND.md**](SOLVE-BY-HAND.md)
> distills the same strategy into a by-eye method you can apply to your own board — illustrated, with
> worked example boards.

## Install

You need the plugin-capable **EF2 Browser Runtime** (Rokhan's project, obtained separately — see
[Attribution](#attribution--legal)). Below, **`<runtime>`** is the folder where it lives.

**1. Drop this folder into the runtime's `plugins/`, named `fossil-solver/`:**

```sh
cp -R <this-repo> <runtime>/plugins/fossil-solver
```

The runtime discovers it from `plugin.json`. (Only `plugin.json`, `plugin.js`, `solver.js`, `metrics.js`,
and `overlay.js` are used at runtime; the docs/benchmarks alongside are harmless.)

**2. Restart the runtime's local server** (it logs active plugin ids at startup).

**3. Open the Fossil Excavation minigame** — the **🦴 Fossil Solver** panel appears bottom-left and shows
the next move.

Enable/disable anytime via `plugin.json`'s `"enabled"`. No Python, no second server, no server-side hook.

## Using it

A small **draggable panel** sits over the game. It draws a mini **board**, **highlights the next tile to
hammer** (`🔨 R# · C#`), and shows a **Fossils: X / Y uncovered** count. Hammer the highlighted tile in
the game; the panel re-reads the board and updates — repeat until **✓ All uncovered**. It also shows an
**Empties** line — non-fossil tiles you've broken vs the simulation benchmark (see
[`BENCHMARKING.md`](BENCHMARKING.md)). Drag the panel anywhere; `–` collapses it.

## How it works

You play EF2 through the runtime, and this plugin runs **entirely in the browser**, read-only:

- **`plugin.js`** (`setup(runtime)`) installs a passive board observer through the runtime's sanctioned
  **`runtime.hooks.onJsonParse`** (the runtime owns the single `JSON.parse` wrap). It watches the game's
  own decrypted mine responses and exposes the board (HP grid) + fossil geometry (shapes + cell
  coordinates) **in-page** on `window.__EF2_SOLVER_DATA__`, firing an `ef-solver-update` event. It never
  decrypts anything itself — the game does — and never sends an action.
- **`overlay.js`** is the draggable panel; it reads that in-page data **directly — no network round-trip**,
  runs the solver, and draws the fewest-swing next move right over the board. **`solver.js`** (`FS`) is the
  benchmark-tuned engine; **`metrics.js`** (`FXMetrics`) adds the optional Empties line.

The mechanics it models:

- Hitting a covered tile deals **+2** to it and **+1** to each orthogonally adjacent covered tile; damage
  accumulates and a tile breaks at 0 HP.
- Fossils are rigid 4-cell shapes — **1×4**, **4×1**, **2×2** — and may touch. A fossil is uncovered when
  all four of its tiles are broken.
- With a fossil's footprint known, the completion planner finds the minimum swings to clear its remaining
  tiles; while fossils are still hidden it probes the most-likely tiles. See
  [`BENCHMARKING.md`](BENCHMARKING.md) for the heuristics and how they were tuned.

## Files

| File | Purpose |
|------|---------|
| `plugin.json` | plugin manifest (id, entry, handle) |
| `plugin.js` | plugin entry — installs the read-only board observer, then loads the three scripts below |
| `solver.js` | pure engine — damage model, placements, completion planner, recommender (global `FS`) |
| `overlay.js` | the in-game overlay UI — reads the board in-page and draws the draggable next-swing panel |
| `metrics.js` | field metrics — swings / empties / fossils, scored vs the benchmark (global `FXMetrics`) |
| `tests.html` | open in a browser to run the engine unit tests |
| `bench.js` | dev-only Monte-Carlo benchmark (`node bench.js`) |
| `gapfind.js` / `gapfind2.js` | dev-only gap-finders — confirm no exploitable move-choice slack remains |
| `BENCHMARKING.md` | benchmarking & heuristics reference |
| `SOLVE-BY-HAND.md` | play it by eye — the solver's strategy as an illustrated human field guide |
| `runtime/` | the **legacy** Python-hook form for the pre-plugin runtime (superseded by `plugin.js`; see `main`) |

## Attribution & legal

- **EF2 Browser Runtime** — this plugin plugs into the third-party runtime by **Rokhan**
  (<https://github.com/Rokhanhh/EF2-Browser-Runtime>), which you obtain separately. `plugin.js` and the
  engine/overlay are **original code** (written here, MIT-licensed) that you drop into the runtime's
  `plugins/` folder — this repo ships **none of the runtime's own files**. Use the runtime under its
  author's terms.
- **Game content** — *Endless Frontier 2*, its data, assets, and trademarks belong to the publisher. This
  tool reads only the board already on your screen — it bundles no game assets and decrypts nothing itself.
  For personal play; don't use it to redistribute the publisher's content or in violation of the game's
  terms of service.

## License

[MIT](LICENSE) — covers everything in this repo. It does not include the EF2 Browser Runtime itself, which
you obtain separately and use under its author's terms (see above).
