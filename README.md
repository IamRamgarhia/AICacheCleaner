# 🧹 AICacheCleaner (v1.0)
### *100% Safe On-Demand AI Disk, Memory & Cache Optimizer for Windows & macOS*

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Platform: Windows & macOS](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue.svg)](https://github.com/IamRamgarhia/ai-cache-cleaner)
[![Security: 100% On--Demand](https://img.shields.io/badge/Security-100%25%20On--Demand%20Offline-success.svg)](#-100-on-demand-security-guarantee)
[![Downloads](https://img.shields.io/badge/Downloads-v1.0%20Release-brightgreen.svg)](https://github.com/IamRamgarhia/ai-cache-cleaner/releases)

---

## 💡 About AICacheCleaner & Our Mission

**AICacheCleaner** is an open-source, community-driven utility built by **[IamRamgarhia](https://github.com/IamRamgarhia)** to solve a modern developer problem: **AI tool bloat slowing down personal computers**. 

As developers use modern AI IDEs and agents (**Google Antigravity**, **Cursor AI**, **Claude Desktop**, **Ollama**, and **Clawbots**), background prompt caches, V8 bytecodes, and orphaned sidecar processes quietly consume tens of gigabytes of disk space and active RAM. 

Our mission is to provide a **100% free, offline, transparent, and safe utility** that cleans AI clutter with automated safety restore points — ensuring your PC runs fast without ever compromising your project code or privacy.

---

## ⚡ Why Does Your PC Feel Laggy When Using AI Tools?

If you use AI code editors (**Cursor**, **Google Antigravity**, **Claude Desktop**, **VS Code MCP Servers**, **Ollama**, **Jan.ai**, or **Clawbots**), your system drive is silently accumulating **tens of gigabytes of hidden AI clutter**:

- 🐘 **Gigabytes of Unseen Prompt Caches**: Local SQLite session databases and raw context logs duplicate across disk.
- 🧟 **Orphaned Zombie Processes**: Unclosed AI background sidecars, language servers, and Python clawbots remain running in RAM even after closing your editor.
- 💾 **Duplicated Model Checkpoints**: PyTorch checkpoints, GGUF weights, and HuggingFace models laying forgotten across drives.
- ⚠️ **System Sluggishness**: Overcrowded SSD storage and high idle RAM usage reduce your overall system performance.

**AICacheCleaner** is a free, open-source, 100% offline desktop utility designed to detect, reclaim, and optimize your PC's storage and memory with **1-click automated safety restore points**.

---

## 📥 Download AICacheCleaner (v1.0)

Choose your operating system below. **No installation required for Portable versions!**

| Operating System | File Type | Release Binary File | Download Link |
| :--- | :--- | :--- | :--- |
| 🪟 **Windows** | **Zero-Install Standalone (.exe)** | `AICacheCleaner-Portable-1.0.0.exe` | [⚡ Download Windows Portable Executable](https://github.com/IamRamgarhia/ai-cache-cleaner/releases/download/v1.0.0/AICacheCleaner-Portable-1.0.0.exe) |
| 🍏 **Apple Ecosystem (macOS)** | **Standalone Mac Package (.zip)** | `AICacheCleaner-macOS-1.0.0.zip` | [⚡ Download macOS Apple Package](https://github.com/IamRamgarhia/ai-cache-cleaner/releases/download/v1.0.0/AICacheCleaner-macOS-1.0.0.zip) |

---

## ✨ Key Features & Capabilities

### 1. 🔍 Non-Overlapping AI Storage Detector
- Scans all drives (`C:`, `D:`, external drives) for active AI project footprints, model weights, and prompt caches.
- Uses **ancestor-descendant path deduplication** so subfolder sizes are never double-counted.

### 2. 🛡️ Mandatory Automated Safety Restore Points
- Before any file or cache is modified, AICacheCleaner **automatically creates a 100% reversible Safety Snapshot Restore Point**.
- One-click instant restore allows you to recover any cleaned file or project state at any time.

### 3. 🖥️ Windows Native Uninstaller Integration
- Triggers official Windows Add/Remove Programs (`appwiz.cpl` / `ms-settings:appsfeatures`) after creating a safety restore point, allowing clean software uninstallation.

### 4. 🤖 Autonomous Clawbots & Scraper Scanner
- Detects installed and residual scraping engines including OpenDevin Clawbot, Crawl4AI Engine, and Playwright/Puppeteer binaries.

### 5. 🧟 RAM Zombie Process Inspector
- Identifies background AI sidecars, MCP language servers, and orphaned processes using real `pidusage` CPU/RAM stats, allowing 1-click process termination.

---

## 🔒 100% On-Demand Security Guarantee

> **AICacheCleaner NEVER runs in the background.**

- **0 Background Services**: No autostart daemons, background agents, or Windows services.
- **100% Local Execution**: All scanning, size calculation, and process inspection happen 100% locally on your computer. Zero data is ever sent to external cloud servers.
- **100% Open Source**: Code is fully transparent and inspectable under the open MIT license.

---

## 🛠️ Local Development & Quick Start

To run AICacheCleaner locally from source:

```bash
# 1. Clone the repository
git clone https://github.com/IamRamgarhia/ai-cache-cleaner.git
cd ai-cache-cleaner

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev

# 4. Build desktop executables
npm run build:win-portable
```

---

## ❓ Frequently Asked Questions (FAQ)

### Is AICacheCleaner safe to use on my development machine?
**Yes.** AICacheCleaner uses strict safety classification tiers. 100% Safe (GREEN) items include temporary webview graphics and V8 bytecodes that automatically rebuild on launch. Protected (YELLOW) user data and chat history are never auto-deleted.

### Does AICacheCleaner run automatically in the background?
**No.** AICacheCleaner operates on a strict **100% On-Demand Guarantee**. It never creates autostart entries or background services. It only runs when you explicitly open it.

---

## 📜 License & Credits

Distributed under the **MIT License**. Created with ❤️ by **[Dice Codes](https://dicecodes.com/)** & **[IamRamgarhia](https://github.com/IamRamgarhia)**.
