@echo off
title Goonpilot: analyse offline library
cd /d "%~dp0.."
node maintenanceision-setup.mjs backfill
echo.
pause
