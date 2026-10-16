@echo off
title Goonpilot
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
set RESTARTABLE=1
start "" http://localhost:8787

:run
node server.mjs
if %errorlevel%==75 goto run
pause
