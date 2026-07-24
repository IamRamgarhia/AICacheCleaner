@echo off
title AI Clutter Cleaner — Safety Optimizer Launcher
echo =======================================================
echo           AI CLUTTER CLEANER (v1.0)
echo =======================================================
echo [1/2] Starting AI Clutter Cleaner Local Engine & Process Inspector...
cd /d "%~dp0"
start /b npm run dev

echo [2/2] Waiting for local server initialization...
timeout /t 3 /nobreak >nul

echo [3/3] Opening AI Clutter Cleaner Dashboard in Browser (http://localhost:5173)...
start http://localhost:5173

echo =======================================================
echo AI Clutter Cleaner is running live! Press Ctrl+C in this window to exit.
echo =======================================================
