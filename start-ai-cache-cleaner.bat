@echo off
title AICacheCleaner — Safety Optimizer Launcher
cls
echo           AICACHECLEANER (v1.0)
echo ===================================================
echo [1/2] Starting AICacheCleaner Local Engine & Process Inspector...
cd /d "%~dp0"

start /b npm run dev

echo [2/2] Waiting for local engine initialization...
timeout /t 3 /nobreak >nul

echo [3/3] Opening AICacheCleaner Dashboard in Browser (http://localhost:5173)...
start http://localhost:5173/

echo.
echo AICacheCleaner is running live! Press Ctrl+C in this window to exit.
echo ===================================================
pause
