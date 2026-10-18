@echo off
cd /d "%~dp0.."
node maintenance\reset-taste.mjs
echo.
pause
