# EchoClass AI - Offline Classroom PowerShell Startup Script
$Host.UI.RawUI.WindowTitle = "EchoClass AI - Offline Classroom Server"
Set-Location -Path $PSScriptRoot

Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  Starting EchoClass AI Offline Classroom Assistant..." -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan

# 1. Preflight check
node apps/backend/scripts/preflight.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Preflight validation failed. Please check the logs above." -ForegroundColor Red
    Read-Host -Prompt "Press Enter to exit"
    exit $LASTEXITCODE
}

# 2. Open teacher browser
Start-Process "http://localhost:3000"

# 3. Start server
node apps/backend/src/server.js
