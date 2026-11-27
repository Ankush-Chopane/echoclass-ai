@echo off
setlocal
title EchoClass AI - Classroom Server

cd /d "%~dp0"

echo ===============================================================
echo   Starting EchoClass AI Classroom Assistant...
echo ===============================================================

REM Run preflight check
node backend/scripts/preflight.js
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Preflight validation failed. Please check the logs above.
    pause
    exit /b %ERRORLEVEL%
)

REM Open teacher browser after short delay
start "" http://localhost:3000

REM Start server (binds to 0.0.0.0 for LAN by default)
node backend/src/server.js

pause
