@echo off
rem CPAP FULL_v2 launcher - Moamoa portal (KMM PMask).
rem Lives inside its own project folder; runs from here via %~dp0.
cd /d "%~dp0"

rem Already running? Just open the browser tab instead of failing.
netstat -ano | findstr ":5172" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo CPAP FULL_v2 is already running - opening browser tab.
  start "" http://localhost:5172
  timeout /t 2 /nobreak >nul
  exit /b
)

echo Starting CPAP FULL_v2 (localhost:5172)... browser will open.
npm run dev -- --port 5172 --strictPort --open

echo.
echo Server stopped or failed to start. Read any message above.
pause
