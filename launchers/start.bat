@echo off
title Goonpilot
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
set RESTARTABLE=1
set SERVED=
where tailscale >nul 2>nul
if errorlevel 1 (
  echo Tailscale not found: running on this computer only. For phone access see "Phone access" in README.md.
) else (
  echo Tailscale found: turning on private phone access ^(only your own Tailscale devices can open it^)...
  tailscale serve --bg 8787
  if errorlevel 1 (
    echo Could not turn on phone access, running on this computer only.
  ) else (
    set SERVED=1
    set PHONE_MODE=1
    echo.
    echo ==== Open the https://....ts.net address shown above on your phone ^(Tailscale app must be ON^) ====
    echo.
    start "" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0keepawake.ps1"
  )
)
start "" http://localhost:8787

:run
node server.mjs
if %errorlevel%==75 goto run
if defined SERVED (
  echo Turning phone access off...
  tailscale serve reset
)
pause
