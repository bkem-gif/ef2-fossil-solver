@echo off
REM Double-click to run the EF2 Fossil Solver over http://localhost, which it
REM needs in order to read the exact board from the game runtime. Keep this
REM window open while you use it; close it to stop.
cd /d "%~dp0"
set PORT=8770
where python >nul 2>nul || (echo Python 3 is required - install it, then retry. & pause & exit /b 1)
echo EF2 Fossil Solver -^> http://localhost:%PORT%/index.html
echo Keep this window open. Close it to stop.
start "" "http://localhost:%PORT%/index.html"
python -m http.server %PORT%
pause
