"""
Load the in-game Fossil Excavation solver overlay onto the bootstrap page.

Kept separate from solver_hook.py (the read-only observer + endpoints): this just
adds the solver engine + the overlay UI as static <script>s, served from
web/bootstrap/runtime/fossil-solver/. The overlay reads the board the hook exposes
in-page (window.__EF2_SOLVER_DATA__), so no HTTP round-trip is involved.

Wired in from the handler's bootstrap-index response: solver_overlay.inject(html).
"""
from __future__ import annotations

from .config import APP_BASE_PATH

MARKER = "ef-solver-overlay-loader"
_BASE = "/bootstrap/runtime/fossil-solver"
_ASSETS = ("solver.js", "metrics.js", "overlay.js")  # order matters: overlay depends on the engine


def inject(html: str) -> str:
    """Add the overlay's <script>s before </head> (idempotent)."""
    if MARKER in html:
        return html
    tags = "<!-- %s -->" % MARKER
    for name in _ASSETS:
        tags += '<script src="%s%s/%s" defer></script>' % (APP_BASE_PATH, _BASE, name)
    tags += "\n"
    head_close = html.lower().find("</head>")
    if head_close != -1:
        return html[:head_close] + tags + html[head_close:]
    return html + tags
