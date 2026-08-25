@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start.ps1"
if errorlevel 1 (
    echo.
    echo Something went wrong starting the app - see the output above.
    pause
    exit /b 1
)

timeout /t 2 /nobreak >nul
start "" "http://localhost:8000"
