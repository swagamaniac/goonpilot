@echo off
title Goonpilot (phone access)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
where tailscale >nul 2>nul
if errorlevel 1 (
  echo Phone access needs Tailscale, which was not found. See "Phone access" in README.md for setup.
  pause
  exit /b 1
)
echo Turning on private phone access (only your own Tailscale devices can open it)...
tailscale serve --bg 8787
echo.
echo ==== Open the https://....ts.net address shown above on your phone (Tailscale app must be ON) ====
echo.
set PHONE_MODE=1
start "" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0keepawake.ps1"
start "" http://localhost:8787

:run
node server.mjs
if %errorlevel%==75 goto run
echo Turning phone access off...
tailscale serve reset
pause
