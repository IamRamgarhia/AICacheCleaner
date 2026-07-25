# AICacheCleaner — Clean Claude, Cursor & Ollama Cache to Free Up Disk Space

> **100% Safe On-Demand AI Disk, Memory & Cache Cleaner for Windows & macOS.**
> Free up disk space by safely clearing Claude Desktop cache, Cursor cache, Ollama model weights, and Antigravity / Gemini AI storage — with automatic safety restore points.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Platform: Windows & macOS](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue.svg)](https://github.com/IamRamgarhia/ai-cache-cleaner)
[![Security: 100% On-Demand Offline](https://img.shields.io/badge/Security-100%25%20On--Demand%20Offline-success.svg)](#-100-on-demand-security-guarantee)
[![Release: v1.0.0](https://img.shields.io/badge/Release-v1.0.0-brightgreen.svg)](https://github.com/IamRamgarhia/ai-cache-cleaner/releases)

---

## 💡 What is AICacheCleaner?

**AICacheCleaner** is a free, open-source desktop app that helps you **clean Claude Desktop cache, clear Cursor cache, free up Ollama disk space, and reclaim tens of gigabytes of hidden AI storage** — without touching your project code, chat history, or settings.

When you use modern AI tools — **Claude Desktop, Cursor AI, Google Antigravity, Ollama, Continue.dev, LM Studio, Jan.ai** — they silently build up prompt caches, V8 bytecodes, GPU shader caches, diagnostic logs, and downloaded model weights across your drives. Over weeks these consume tens of gigabytes and slow your PC.

AICacheCleaner scans every drive, classifies each cache by safety (🟢 100% Safe / 🟡 Review / 🔴 Protected), and lets you **free up disk space** in one click — with an automatic safety restore point created before anything is touched.

### 🎯 Built for these exact problems

| People search for | AICacheCleaner does it |
|---|---|
| "how to clean Claude Desktop cache" | Clears `%AppData%\Claude\Cache`, `Code Cache`, `GPUCache`, and `logs` (GREEN, 100% safe) |
| "clear Cursor cache windows" | Clears `%AppData%\Cursor\Cache\Cache_Data` and `CachedData` (rebuilds on launch) |
| "free up Ollama disk space" | Surfaces `~/.ollama/models` weights (4–20 GB each) for review |
| "Antigravity / Gemini storage too big" | Inspects `~/.gemini` brain state, transcripts, skills |
| "what is eating my disk space" | Non-overlapping multi-drive footprint with deduplication |

---

## 🧩 Supported AI Tools & Caches

AICacheCleaner detects and cleans caches for these tools. GREEN = 100% safe to delete (auto-rebuilds); YELLOW = contains user data, review before cleaning.

| Tool | Cache Location (Windows) | Safety Tier |
|---|---|---|
| **Claude Desktop** | `%AppData%\Claude\Cache`, `Code Cache`, `GPUCache`, `logs` | 🟢 GREEN |
| **Claude Desktop** (chat data) | `%AppData%\Claude` (session keys, MCP configs, chat DB) | 🟡 YELLOW |
| **Claude CLI** | `~/.claude` (session logs, transcripts) | 🟡 YELLOW |
| **Cursor AI** | `%AppData%\Cursor\Cache\Cache_Data`, `CachedData` | 🟢 GREEN |
| **Cursor AI** (user data) | `~/.cursor`, `%AppData%\Cursor\User` | 🟡 YELLOW |
| **Google Antigravity / Gemini** | `~/.gemini` (brain state, transcripts, plugins, skills) | 🟡 YELLOW |
| **Ollama** | `~/.ollama/models` (LLaMA, Qwen, DeepSeek weights) | 🟡 YELLOW |
| **HuggingFace** | `~/.cache/huggingface` (model weights, tokenizers) | 🟡 YELLOW |
| **PyTorch** | `~/.cache/torch` (model checkpoints) | 🟡 YELLOW |
| **Continue.dev** | `~/.continue` (vector index, SQLite session DB) | 🟡 YELLOW |
| **LM Studio** | `~/.cache/lm-studio` (GGUF models) | 🟡 YELLOW |
| **Jan.ai** | `%AppData%\Jan` (local model files) | 🟡 YELLOW |
| **AnythingLLM** | `%AppData%\AnythingLLM` (vector DB, embeddings) | 🟡 YELLOW |
| **pip** | `~/.cache/pip` (Python AI package wheels) | 🟡 YELLOW |

---

## 📥 Download AICacheCleaner (v1.0.0)

**No installation required for Portable versions — just download and double-click.**

| OS | File | Download |
| :--- | :--- | :--- |
| 🪟 **Windows** | `AICacheCleaner-Portable-1.0.0.exe` | [⚡ Download Windows Portable](https://github.com/IamRamgarhia/ai-cache-cleaner/releases/download/v1.0.0/AICacheCleaner-Portable-1.0.0.exe) |
| 🪟 **Windows** (installer) | `AICacheCleaner-Setup-1.0.0.exe` | [⚡ Download Windows Setup](https://github.com/IamRamgarhia/ai-cache-cleaner/releases/download/v1.0.0/AICacheCleaner-Setup-1.0.0.exe) |
| 🍏 **macOS** | `AICacheCleaner-macOS-1.0.0.zip` | [⚡ Download macOS Package](https://github.com/IamRamgarhia/ai-cache-cleaner/releases/download/v1.0.0/AICacheCleaner-macOS-1.0.0.zip) |

> All releases: [github.com/IamRamgarhia/ai-cache-cleaner/releases](https://github.com/IamRamgarhia/ai-cache-cleaner/releases)

---

## ✨ Key Features

### 1. 🔍 Non-Overlapping AI Storage Detector
Scans all drives (`C:`, `D:`, `E:`, `F:`, external) for active AI project footprints, model weights, and prompt caches. Uses **ancestor-descendant path deduplication** so nested subfolders are never double-counted.

### 2. 🛡️ Automatic Safety Restore Points
Before any cache is removed, AICacheCleaner records a lightweight safety snapshot of what will be cleaned. Items are then soft-deleted to the **OS Recycle Bin / Trash**, so recovery is always one click away.

### 3. 🖥️ Windows Native Uninstaller Integration
Triggers the official Windows Add/Remove Programs panel (`appwiz.cpl` / `ms-settings:appsfeatures`) after creating a safety snapshot, for clean software uninstallation.

### 4. 🤖 Autonomous Clawbots & Scraper Scanner
Detects installed and residual scraping engines including **OpenDevin, Crawl4AI, Playwright, and Puppeteer** headless browser binaries.

### 5. 🧟 RAM Zombie Process Inspector
Identifies background AI sidecars, MCP language servers, and orphaned processes using **real `pidusage` CPU/RAM stats** (not estimates), with 1-click safe termination.

---

## ❓ How do I clean … cache? (FAQ)

**How do I clean Claude Desktop cache?**
Open AICacheCleaner → the Claude Desktop entries under the GREEN tier (`Cache`, `Code Cache`, `GPUCache`, `logs`) are 100% safe — select them and click **Clean**. Your chat history and settings are never touched.

**How do I clear Cursor cache?**
The Cursor `Cache_Data` and `CachedData` (V8 bytecode) entries are GREEN — they rebuild automatically on the next launch. Select and clean; no settings or extensions are affected.

**How do I free up Ollama disk space?**
AICacheCleaner lists `~/.ollama/models` under YELLOW (each model is 4–20 GB). Review the list, keep the models you use, and clean the rest. Ollama will re-download a model on demand.

**Is AICacheCleaner safe to use on my development machine?**
Yes. It uses strict safety tiers: GREEN items (temporary webview graphics, V8 bytecodes, GPU shaders, logs) are 100% safe and auto-rebuild. YELLOW user data (chat databases, session keys) is never auto-deleted.

**Does AICacheCleaner run automatically in the background?**
**No.** It operates on a strict **100% On-Demand** guarantee — no autostart entries, no background services, no daemons. It runs only when you open it.

---

## 🔒 100% On-Demand Security Guarantee

> **AICacheCleaner NEVER runs in the background.**

- **0 Background Services** — no autostart daemons, agents, or Windows services.
- **100% Local Execution** — all scanning, size calculation, and process inspection happen on your computer. Zero data leaves your machine.
- **100% Open Source** — fully transparent, inspectable code under the MIT license.
- **Sandboxed Electron** — `contextIsolation: true`, `nodeIntegration: false`, with a dedicated preload bridge. CORS is locked to localhost only.

---

## 🛠️ Local Development & Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/IamRamgarhia/ai-cache-cleaner.git
cd ai-cache-cleaner

# 2. Install dependencies
npm install

# 3. Start development (frontend + backend)
npm run dev

# 4. Build desktop executables
npm run build:win-portable    # Windows portable .exe
npm run build:mac-dmg         # macOS .dmg
```

---

## 📜 License & Credits

Distributed under the **MIT License**. Created with ❤️ by **[Dice Codes](https://dicecodes.com/)** & **[IamRamgarhia](https://github.com/IamRamgarhia)**.

⭐ **If AICacheCleaner freed up space for you, please star the repo** — it helps other developers find it.
