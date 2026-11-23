@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-server.ps1"
if not defined COWORK_NO_PAUSE timeout /t 2 >nul
