/*
 * Fossil Solver — runtime plugin.
 *
 * Read-only Fossil Excavation helper. The solver engine (solver.js → global `FS`),
 * optional metrics (metrics.js → global `FXMetrics`), and the on-screen overlay
 * (overlay.js) are the existing, benchmark-tuned files, loaded here unchanged.
 *
 * The only new piece is the board OBSERVER. The old standalone runtime wrapped the
 * page's `JSON.parse` from a Python-injected <script> to mirror the decrypted mine
 * board/fossils into `window.__EF2_SOLVER_DATA__`. Under the plugin contract that is
 * done the sanctioned way — `runtime.hooks.onJsonParse` (the runtime owns the single
 * JSON.parse wrap) — feeding the same in-page data object + `ef-solver-update` event
 * the overlay already listens for. Purely observational: it never sends a game action.
 */

// --- board/fossil/box extraction (ported 1:1 from the old read-only hook) ---
function is2dNum(a) {
    return Array.isArray(a) && Array.isArray(a[0]) && typeof a[0][0] === "number";
}
function findBoard(o, depth) {
    if (!o || typeof o !== "object" || Array.isArray(o) || depth > 3) return null;
    if (is2dNum(o.blocks)) return o;
    for (const k in o) {
        const v = o[k];
        if (v && typeof v === "object" && !Array.isArray(v)) {
            const r = findBoard(v, depth + 1);
            if (r) return r;
        }
    }
    return null;
}
function collectChests(o, depth, acc) {
    if (!o || typeof o !== "object" || depth > 5) return acc;
    if (!Array.isArray(o) && Array.isArray(o.coordinates)) {
        acc.push({
            coordinates: o.coordinates, shape: o.shape, fullyExcavated: !!o.fullyExcavated,
            grade: o.grade, kindNum: o.kindNum, num: o.num
        });
        return acc;
    }
    for (const k in o) {
        const v = o[k];
        if (v && typeof v === "object") collectChests(v, depth + 1, acc);
    }
    return acc;
}
function collectBoxes(o, depth) {
    if (!o || typeof o !== "object" || depth > 5) return null;
    if (!Array.isArray(o) && Array.isArray(o.discoveredBoxes)) return o.discoveredBoxes;
    for (const bk in o) {
        const bv = o[bk];
        if (bv && typeof bv === "object" && !Array.isArray(bv)) {
            const br = collectBoxes(bv, depth + 1);
            if (br) return br;
        }
    }
    return null;
}

// load a sibling file as a classic script so its `root.FS` / `root.FXMetrics`
// globals land on window (the same way the old runtime served them).
function loadClassicScript(url) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url;
        script.async = false; // preserve order: solver + metrics before overlay
        script.dataset.efFossilSolver = "1";
        script.onload = () => resolve(script);
        script.onerror = () => reject(new Error(`failed to load ${url}`));
        (document.head || document.documentElement).appendChild(script);
    });
}

const SCRIPTS = ["solver.js", "metrics.js", "overlay.js"];

export default {
    id: "fossil-solver",
    handleKey: "__EF_FOSSIL_SOLVER_HANDLE__",

    setup(runtime) {
        const pageData = () =>
            window.__EF2_SOLVER_DATA__ ||
            (window.__EF2_SOLVER_DATA__ = { board: null, fossils: [], boxes: [], ts: 0 });

        let lastBoard = "", lastFossils = "", lastBoxes = "", lastMineId = null;

        const unobserve = runtime.hooks.onJsonParse((parsed) => {
            try {
                let changed = false;

                // board (HP grid) and fossils (coordinates) are independent; a new mine
                // (changed board id) drops the previous mine's revealed fossils/boxes.
                const board = findBoard(parsed, 0);
                if (board) {
                    const s = JSON.stringify(board);
                    if (s !== lastBoard) {
                        lastBoard = s;
                        if (board.id !== lastMineId) {
                            lastMineId = board.id;
                            pageData().fossils = [];
                            pageData().boxes = [];
                            lastFossils = "";
                            lastBoxes = "";
                        }
                        pageData().board = board;
                        changed = true;
                    }
                }

                const chests = collectChests(parsed, 0, []);
                if (chests.length) {
                    const d = JSON.stringify(chests);
                    if (d !== lastFossils) {
                        lastFossils = d;
                        pageData().fossils = chests;
                        changed = true;
                    }
                }

                const boxes = collectBoxes(parsed, 0);
                if (boxes && boxes.length) {
                    const b = JSON.stringify(boxes);
                    if (b !== lastBoxes) {
                        lastBoxes = b;
                        pageData().boxes = boxes;
                        changed = true;
                    }
                }

                if (changed) {
                    pageData().ts = Date.now();
                    window.dispatchEvent(new CustomEvent("ef-solver-update"));
                }
            } catch (error) {
                runtime.logger.warn("fossil-solver", "board observe failed", error);
            }
        });

        const loadedScripts = [];
        (async () => {
            for (const file of SCRIPTS) {
                try {
                    loadedScripts.push(await loadClassicScript(new URL(`./${file}`, import.meta.url).href));
                } catch (error) {
                    runtime.logger.error("fossil-solver", "script load failed", error);
                }
            }
        })();

        runtime.logger.info("fossil-solver", "installed (read-only board observer + overlay)");

        return {
            detach() {
                unobserve();
                for (const script of loadedScripts) {
                    try { script.remove(); } catch (error) { /* ignore */ }
                }
                const panel = document.getElementById("ef-solver-overlay");
                if (panel) panel.remove();
                const style = document.getElementById("ef-solver-overlay-style");
                if (style) style.remove();
                try { delete window.__EF2_SOLVER_OVERLAY__; } catch (error) { window.__EF2_SOLVER_OVERLAY__ = undefined; }
            }
        };
    }
};
