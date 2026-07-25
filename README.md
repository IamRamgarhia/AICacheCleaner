# 🧹 AI Clutter Cleaner (v1.0)
### *100% Safe On-Demand AI Disk, Memory & Cache Optimizer for Windows & macOS*

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Platform: Windows & macOS](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue.svg)](https://github.com/IamRamgarhia/ai-clutter-cleaner)
[![Security: 100% On--Demand](https://img.shields.io/badge/Security-100%25%20On--Demand%20Offline-success.svg)](#-100-on-demand-security-guarantee)
[![Downloads](https://img.shields.io/badge/Downloads-v1.0%20Release-brightgreen.svg)](https://github.com/IamRamgarhia/ai-clutter-cleaner/releases)

---

## 💡 About AI Clutter Cleaner & Our Mission

**AI Clutter Cleaner** is an open-source, community-driven utility built by **[IamRamgarhia](https://github.com/IamRamgarhia)** to solve a modern developer problem: **AI tool bloat slowing down personal computers**. 

As developers use modern AI IDEs and agents (**Google Antigravity**, **Cursor AI**, **Claude Desktop**, **Ollama**, and **Clawbots**), background prompt caches, V8 bytecodes, and orphaned sidecar processes quietly consume tens of gigabytes of disk space and active RAM. 

Our mission is to provide a **100% free, offline, transparent, and safe utility** that cleans AI clutter with automated safety restore points — ensuring your PC runs fast without ever compromising your project code or privacy.

---

## ⚡ Why Does Your PC Feel Laggy When Using AI Tools?

If you use AI code editors (**Cursor**, **Google Antigravity**, **Claude Desktop**, **VS Code MCP Servers**, **Ollama**, **Jan.ai**, or **Clawbots**), your system drive is silently accumulating **tens of gigabytes of hidden AI clutter**:

- 🐘 **Gigabytes of Unseen Prompt Caches**: Local SQLite session databases and raw context logs duplicate across disk.
- 🧟 **Orphaned Zombie Processes**: Unclosed AI background sidecars, language servers, and Python clawbots remain running in RAM even after closing your editor.
- 💾 **Duplicated Model Checkpoints**: PyTorch checkpoints, GGUF weights, and HuggingFace models laying forgotten across drives.
- ⚠️ **System Sluggishness**: Overcrowded SSD storage and high idle RAM usage reduce your overall system performance.

**AI Clutter Cleaner** is a free, open-source, 100% offline desktop utility designed to detect, reclaim, and optimize your PC's storage and memory with **1-click automated safety restore points**.

---

## 📥 Download AI Clutter Cleaner (v1.0)

Choose your operating system below. **No installation required for Portable versions!**

| Operating System | File Type | Release Binary File | Download Link |
| :--- | :--- | :--- | :--- |
| 🪟 **Windows** | **Zero-Install Standalone (.exe)** | `AI-Clutter-Cleaner-Portable-1.0.0.exe` | [⚡ Download Windows Portable Executable](https://github.com/IamRamgarhia/ai-clutter-cleaner/releases/download/v1.0.0/AI-Clutter-Cleaner-Portable-1.0.0.exe) |
| 🍏 **Apple Ecosystem (macOS)** | **Standalone Mac Package (.zip)** | `AI-Clutter-Cleaner-macOS-1.0.0.zip` | [⚡ Download macOS Apple Package](https://github.com/IamRamgarhia/ai-clutter-cleaner/releases/download/v1.0.0/AI-Clutter-Cleaner-macOS-1.0.0.zip) |

---

## ✨ Key Features & Capabilities

### 1. 🔍 Non-Overlapping AI Storage Detector
- Scans all drives (`C:`, `D:`, external drives) for active AI project footprints, model weights, and prompt caches.
- Uses **ancestor-descendant path deduplication** so subfolder sizes are never double-counted.

### 2. 🛡️ Mandatory Automated Safety Restore Points
- Before any file or cache is modified, AI Clutter Cleaner **automatically creates a 100% reversible Safety Snapshot Restore Point**.
- One-click instant restore allows you to recover any cleaned file or project state at any time.

### 3. 🖥️ Windows Native Uninstaller Integration
- Triggers official Windows Add/Remove Programs (`appwiz.cpl` / `ms-settings:appsfeatures`) after creating a safety restore point, allowing clean software uninstallation.

### 4. 🤖 Autonomous Clawbots & Scraper Scanner
Detects installed and residual scraping bots:
- **OpenDevin Clawbot & Autonomous Agents**
- **Crawl4AI Web Crawler Engine**
- **Playwright & Puppeteer Headless Clawbot Binaries**
- **Jan.ai & AnythingLLM Offline Studios**

### 5. 🧟 RAM Zombie Process Inspector
- Scans active background processes for orphaned sidecars, MCP tools, and high-memory LLM processes.
- One-click safely terminates zombie processes to free up system memory immediately.

---

## 🛡️ 100% On-Demand Security Guarantee

> [!IMPORTANT]
> **AI Clutter Cleaner NEVER runs in the background.**
> - **Zero Background Services**: No background daemons, auto-starters, or scheduled telemetry tasks are ever installed on your computer.
> - **100% Offline & Private**: Zero cloud uploads. All disk scans, process checks, and restore point snapshots happen 100% locally on your device.
> - **Runs Only When You Open It**: Once you close the app, zero processes remain in memory.

---

## 🛠️ Quickstart Guide (Run from Source)

If you prefer building from source:

```bash
# 1. Clone the repository
git clone https://github.com/IamRamgarhia/ai-clutter-cleaner.git
cd ai-clutter-cleaner

# 2. Install dependencies
npm install

# 3. Launch live application
npm run dev
```

---

## ❓ Frequently Asked Questions (FAQ)

<details>
<summary><strong>Q: Will cleaning AI clutter delete my active coding projects?</strong></summary>
<br />
<strong>No.</strong> AI Clutter Cleaner categorizes items into 3 safety tiers:
<ul>
  <li>🟢 <strong>GREEN (Safe Reclaimable)</strong>: Temporary V8 bytecodes, build caches, and old transcript logs. Safe to delete.</li>
  <li>🟡 <strong>YELLOW (Project Footprints & Models)</strong>: Active project code and model weights. Prompts for confirmation before cleaning.</li>
  <li>🔴 <strong>RED (System Core)</strong>: Core configurations. Never deleted automatically.</li>
</ul>
Additionally, an automated <strong>Safety Snapshot Restore Point</strong> is created before every action.
</details>

<details>
<summary><strong>Q: Does this app run automatically when Windows starts up?</strong></summary>
<br />
<strong>No.</strong> AI Clutter Cleaner operates on a strict <strong>100% On-Demand Guarantee</strong>. It never creates autostart entries, background services, or scheduled tasks. It only runs when you explicitly open it.
</details>

<details>
<summary><strong>Q: How do I restore files from a Safety Restore Point?</strong></summary>
<br />
Navigate to the <strong>Restore Points & History</strong> tab in the app, select your snapshot, and click <strong>1-Click Instant Restore</strong> to revert all files back to their exact original locations.
</details>

---

## 📜 License & Credits

- **License**: Released under the open-source [MIT License](LICENSE).
- **Author**: Created & Maintained by [IamRamgarhia](https://github.com/IamRamgarhia).
- **Built With**: React 19, Vite, TypeScript, Express, Electron, and Lucide Icons.
