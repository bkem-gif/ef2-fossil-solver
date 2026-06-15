#!/bin/bash
# Double-click this to run the EF2 Fossil Solver over http://localhost, which it
# needs in order to read the exact board from the game runtime. Keep the window
# open while you use it; press Ctrl+C (or close it) to stop.
cd "$(dirname "$0")" || exit 1
PORT=8770
URL="http://localhost:$PORT/index.html"
echo "EF2 Fossil Solver -> $URL"
echo "Keep this window open. Ctrl+C to stop."
( sleep 1; open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null ) &
exec python3 -m http.server "$PORT"
