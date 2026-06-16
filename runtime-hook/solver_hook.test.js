/*
 * Unit tests for the read-only board observer's in-page exposure — the data the
 * in-game overlay reads from `window.__EF2_SOLVER_DATA__`. Loads the REAL injected
 * JS out of solver_hook.py (next to this file) and drives it through synthetic
 * getStatus / doDamage responses.
 *
 * Includes the mine-boundary regression: a freshly-loaded mine must drop the
 * previous mine's fossils, or the overlay keeps thinking you're "done" and stops
 * suggesting moves. (The /solver/* endpoints clear server-side; this guards the
 * in-page path the overlay uses.)
 *
 *   node solver_hook.test.js     # exits non-zero on failure
 */
const fs = require('fs');
const path = require('path');

const js = fs.readFileSync(path.join(__dirname, 'solver_hook.py'), 'utf8')
  .match(/<script id="ef-solver-hook">([\s\S]*?)<\/script>/)[1]
  .replace(/__SOLVER_BOARD_URL__/g, 'http://local/board')
  .replace(/__SOLVER_FOSSILS_URL__/g, 'http://local/fossils');

// minimal browser mocks (node's built-in navigator has no sendBeacon, so send() falls to fetch)
const log = console.log;
console.log = function () {};            // silence the hook's own logging during the test
let events = 0;
global.window = {};
global.fetch = function () {};
global.CustomEvent = function (n) { this.type = n; };
global.window.dispatchEvent = function () { events++; };
eval(js);                                // installs the wrapped JSON.parse + the in-page exposure

const data = () => window.__EF2_SOLVER_DATA__ || { board: null, fossils: [] };
const fossil = (x, y, exc) => ({ coordinates: [{ x: x, y: y }], shape: 'square', fullyExcavated: !!exc });
function status(id, chests, blocks) {
  return JSON.stringify({ header: {}, body: { instance: { id: id, blocks: blocks || [[3, 3], [3, 3]], xNum: 2, yNum: 2, chestCount: 5 }, revealedChests: chests || [] } });
}

let pass = 0, fail = 0;
const check = (name, cond) => { (cond ? pass++ : fail++); log('  ' + (cond ? 'PASS' : 'FAIL') + ' ' + name); };

const e0 = events;
JSON.parse(status('M1', []));
check('board is exposed in-page', !!(data().board && data().board.id === 'M1'));
check('an update event fires on a new board', events > e0);

JSON.parse(status('M1', [fossil(0, 0), fossil(1, 0)]));
check('revealed fossils are exposed', data().fossils.length === 2);

JSON.parse(status('M1', [0, 1, 2, 3, 4].map(i => fossil(i, 0, true))));
check('completed mine exposes all 5 fossils', data().fossils.length === 5);

JSON.parse(status('M2', []));                                  // a fresh mine (new id, none revealed)
check("fresh mine clears the previous mine's fossils [mine-boundary]", data().fossils.length === 0);

JSON.parse(status('M3', [fossil(0, 0)]));                       // mine M3, one nicked
JSON.parse(status('M3', [fossil(0, 0)], [[1, 3], [3, 3]]));     // same mine, a hit changed the board
check('same-mine update keeps fossils (no clobber)', data().fossils.length === 1);

log(fail ? ('\n✗ ' + fail + ' failed, ' + pass + ' passed') : ('\n✓ all ' + pass + ' passed') + ' — solver_hook.py in-page exposure');
process.exit(fail ? 1 : 0);
