# EF2 Fossil Solver

An offline helper that reads the **exact** board from a running *Endless Frontier 2*
**Fossil Excavation** minigame and shows the **fewest-swing** way to uncover every fossil.
No build step, no AI, no pixel-guessing — it reads the game's own decrypted state through the
runtime, so HP and fossil shapes are exact. It is **read-only**: it never sends a move to the game.

## Requirements

- A working **EF2 Browser Runtime** install — the separate, third-party project that runs the
  game in a desktop browser (see [Attribution](#attribution--legal)).
- **Python 3.10+** — serves this folder, and is what the runtime uses.

## Setup

1. **Add the read-only hook to your runtime.** Drop [`runtime-hook/solver_hook.py`](runtime-hook/solver_hook.py)
   into your runtime's `scripts/runtime_server/` and wire it into `handler.py` with three one-line calls
   (no existing files are overwritten), then restart the runtime. That exposes the read-only
   `/solver/board` and `/solver/fossils` endpoints this tool reads — exact steps are in
   [`runtime-hook/README.md`](runtime-hook/README.md).
2. **Start the runtime** and open the **Fossil Excavation** minigame.
3. **Launch the solver.** It serves over `http://localhost:8770` so it can read the runtime:

   | Platform | Launcher |
   |----------|----------|
   | Windows  | double-click `launch.bat` |
   | macOS    | double-click `launch.command` |
   | Linux    | run `./launch.sh` |

   …or just run `python -m http.server 8770` here (`python3` on macOS/Linux) and open
   `http://localhost:8770/`.

## Using it

1. **Hammer the glowing tile** the solver points to, in the game.
2. The board re-reads itself; repeat until *All fossils uncovered*.

Alongside the board and the next swing, it shows a **Fossils** list and a **Field metrics**
panel — your swings and empty tiles broken vs the simulation benchmark (see
[`BENCHMARKING.md`](BENCHMARKING.md)), with a scorecard when you finish a mine.

## How it works

You play EF2 through the runtime. The hook injects a small **read-only observer** into the
runtime's bootstrap page (never the game bundle, so its integrity check is untouched) that
watches the game's own decrypted mine responses and forwards just the board (HP grid) and fossil
geometry (shapes + cell coordinates) to a local endpoint. The solver polls that endpoint and
renders the next best swing. It never decrypts anything itself — the game does — and never sends
an action.

The mechanics it models:

- Hitting a covered tile deals **+2** to it and **+1** to each orthogonally adjacent covered tile;
  damage accumulates and a tile breaks at 0 HP.
- Fossils are rigid 4-cell shapes — **1×4**, **4×1**, **2×2** — and may touch. A fossil is
  uncovered when all four of its tiles are broken.
- With a fossil's footprint known, the completion planner finds the minimum swings to clear its
  remaining tiles; while fossils are still hidden it probes the most-likely tiles. See
  [`BENCHMARKING.md`](BENCHMARKING.md) for the heuristics and how they were tuned.

## Files

| File | Purpose |
|------|---------|
| `index.html` | markup (mounts the reader) |
| `styles.css` | styling |
| `solver.js` | pure engine — damage model, placements, completion planner, recommender |
| `live.js` | exact game-read view — polls the runtime endpoint, renders board + next swing |
| `metrics.js` | field metrics — turns each snapshot into swings / empties / fossils, scored vs the benchmark |
| `app.js` | boot — theme + mount |
| `launch.bat` / `launch.command` / `launch.sh` | serve the solver on Windows / macOS / Linux |
| `tests.html` | open in a browser to run the engine unit tests |
| `bench.js` | dev-only Monte-Carlo benchmark (`node bench.js`) |
| `BENCHMARKING.md` | benchmarking & heuristics reference |
| `gapfind.js` / `gapfind2.js` | dev-only gap-finders — confirm no exploitable move-choice slack remains (see `BENCHMARKING.md`) |
| `runtime-hook/` | `solver_hook.py` (the read-only observer module) + how to wire it into your runtime |

## Attribution & legal

- **EF2 Browser Runtime** — this tool plugs into the third-party runtime by **Rokhan**
  (<https://github.com/Rokhanhh/EF2-Browser-Runtime>), which you obtain separately.
  `runtime-hook/solver_hook.py` is an **original module** (written here, MIT-licensed) that you drop
  into that runtime and wire in — this repo ships **none of the runtime's own files**. Use the
  runtime itself under its author's terms.
- **Game content** — *Endless Frontier 2*, its data, assets, and trademarks belong to the publisher.
  This tool reads only the board already on your screen — it bundles no game assets and decrypts
  nothing itself. For personal play; don't use it to redistribute the publisher's content or in
  violation of the game's terms of service.

## License

[MIT](LICENSE) — covers everything in this repo, including `runtime-hook/solver_hook.py` (an original
module). It does not include the EF2 Browser Runtime itself, which you obtain separately and use under
its author's terms (see above).
