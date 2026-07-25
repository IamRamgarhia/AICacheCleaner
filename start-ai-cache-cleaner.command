#!/bin/bash
cd "$(dirname "$0")"
clear
echo "==================================================="
echo "          AICACHECLEANER (macOS v1.0)"
echo "==================================================="
echo "[1/2] Starting AICacheCleaner Local Engine..."
npm run dev &
sleep 3
echo "[2/2] Opening AICacheCleaner App (http://localhost:5173)..."
open http://localhost:5173/
echo "==================================================="
echo "AICacheCleaner is active! Close terminal window to exit."
