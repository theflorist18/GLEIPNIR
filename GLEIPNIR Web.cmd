@echo off
:: Double-click to open the GLEIPNIR evidence library (starts Docker + the stack if needed).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0orchestration\open-web.ps1"
