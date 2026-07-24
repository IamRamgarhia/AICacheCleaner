#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"
echo "======================================================="
echo "          AI CLUTTER CLEANER (macOS v1.0)"
echo "======================================================="
echo "[1/2] Starting AI Clutter Cleaner Local Engine..."
npm run dev &
sleep 3
echo "[2/2] Opening AI Clutter Cleaner App (http://localhost:5173)..."
open http://localhost:5173
