@echo off
setlocal
title EchoClass AI - Offline Classroom Server

cd /d "%~dp0"

echo ===============================================================
echo   Starting EchoClass AI Offline Classroom Assistant...
echo ===============================================================

REM Run preflight check
node apps/backend/scripts/preflight.js
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Preflight validation failed. Please check the logs above.
    pause
    exit /b %ERRORLEVEL%
)

REM Open teacher browser after short delay
start "" http://localhost:3000

REM Start server (binds to 0.0.0.0 for LAN by default)
node apps/backend/src/server.js

pause
