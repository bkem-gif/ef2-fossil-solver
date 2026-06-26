# EF2 Fossil Solver

A read-only, in-game helper for **Endless Frontier 2's Fossil Excavation** minigame. It shows the
**fewest-swing** way to uncover every fossil — **right on the game screen** — and updates as you play.
It reads the game's own board, so the hidden HP and fossil shapes are exact. It is **read-only**: it
never makes a move for you.

> **Don't have the runtime, or don't want to install anything?** [**SOLVE-BY-HAND.md**](SOLVE-BY-HAND.md)
> turns the same strategy into a simple by-eye method you can use yourself, with illustrated examples.

---

## Installing / updating to the new plugin version

The EF2 Browser Runtime now loads add-ons from a **`plugins`** folder. This makes the Fossil Solver **much
easier** to set up than the old version — **no Python files to copy, and no code to paste into the runtime.**

> **Did you use the old version?** (Back then you copied `solver_hook.py` and `solver_overlay.py` into the
> runtime and pasted a few lines into one of its files.) **You don't need any of that anymore.** Just update
> your runtime to the latest version and follow the three steps below. The old files won't break anything —
> they're simply no longer used.

### Just three steps

1. **Download this add-on.** Near the top of this page, make sure the branch button says **`plugin`**, then
   click the green **`< > Code`** button → **Download ZIP**. Unzip the file — inside is a folder of files,
   including one named `plugin.json`.

2. **Put the folder into your runtime.** Find your **EF2 Browser Runtime** folder, open the **`plugins`**
   folder inside it, and drop the unzipped folder in there — **renamed to `fossil-solver`**. When you're
   done it should look like this:

   ```
   …/EF2-Browser-Runtime/plugins/fossil-solver/plugin.json
   …/EF2-Browser-Runtime/plugins/fossil-solver/  (and the rest)
   ```

3. **Restart the runtime** — close it and start it again. Then open the **Fossil Excavation** minigame and
   the **🦴 Fossil Solver** panel appears on the screen.

---

## Using it

A small **draggable panel** sits over the game. It draws a mini **board**, **highlights the next tile to
hammer** (`🔨 R# · C#`), and shows a **Fossils: X / Y uncovered** count. Hammer the highlighted tile in the
game; the panel re-reads the board and updates — repeat until **✓ All uncovered**. Drag the panel anywhere;
the `–` button collapses it.

## How it works

You play EF2 through the runtime, and this add-on runs **entirely in your browser**, read-only. It watches
the game's own decrypted mine board through the runtime's official plugin tools, runs the solver, and draws
the fewest-swing next move right over the board. It never decrypts anything itself and never sends a move.

The rules it models: hitting a covered tile deals **+2** to it and **+1** to each touching covered tile, and
a tile breaks at 0 HP; fossils are rigid 4-cell shapes (**1×4, 4×1, 2×2**) and a fossil is uncovered when all
four of its tiles break. With a fossil's shape known it plans the minimum swings to finish it; while fossils
are hidden it probes the most-likely tiles. See [**BENCHMARKING.md**](BENCHMARKING.md) for the strategy and
how it was tuned.

## What's in this folder

| File | What it's for |
|------|---------------|
| `plugin.json`, `plugin.js` | what makes it a runtime plugin (the parts the runtime needs) |
| `solver.js` | the solver engine |
| `overlay.js` | the on-screen panel |
| `metrics.js` | the optional stats line |
| `BENCHMARKING.md` | how the solver decides + benchmark results |
| `SOLVE-BY-HAND.md` | the same strategy as a by-eye human guide |
| `bench.js`, `gapfind.js`, `gapfind2.js`, `tests.html` | developer-only tools (you don't need these) |
| `runtime/` | the **old** install files for the pre-plugin runtime (no longer needed; see the `main` branch) |

## Attribution & license

- The **EF2 Browser Runtime** is a separate project by **Rokhan**
  (<https://github.com/Rokhanhh/EF2-Browser-Runtime>) — get it separately and use it under its author's
  terms. This add-on (the plugin + engine) is **original code**; this repo ships none of the runtime's files.
- **Game content** — *Endless Frontier 2* and its assets belong to the publisher. This tool reads only the
  board already on your screen and bundles no game assets. For personal play; don't use it against the
  game's terms of service.
- This project's code is [MIT](LICENSE).
