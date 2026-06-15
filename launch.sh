#!/bin/bash
# Run the EF2 Fossil Solver over http://localhost, which it needs in order to
# read the exact board from the game runtime. Keep this window open; Ctrl+C to stop.
cd "$(dirname "$0")" || exit 1
PORT=8770
URL="http://localhost:$PORT/index.html"
echo "EF2 Fossil Solver -> $URL"
echo "Keep this window open. Ctrl+C to stop."
( sleep 1; xdg-open "$URL" >/dev/null 2>&1 || open "$URL" >/dev/null 2>&1 ) &
exec python3 -m http.server "$PORT"
