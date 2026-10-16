@echo off
title Goonpilot: set up image analysis
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
echo Step 1/2: installing the two optional packages (onnxruntime-node, sharp)...
call npm install
echo.
echo Step 2/2: server restart, test tags, model download...
node scripts\vision-setup.mjs
echo.
pause
