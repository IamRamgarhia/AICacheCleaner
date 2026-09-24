# 📋 Changelog — AICacheCleaner

All notable changes to **AICacheCleaner** — the free AI cache cleaner for Windows that clears Claude Desktop cache, Cursor cache, Antigravity storage and Ollama model weights — are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] - 2026-09-24

### 🖥️ A real desktop app, a safer delete, and 16× faster scans

#### 🛡️ Safety — nothing can be deleted by accident

- **Deletes that Windows would make permanent are refused.** Windows skips the Recycle Bin for anything bigger than the bin's limit (17 GB on a typical 300 GB C: drive), deletes permanently on drives without a bin (USB, network) and silently purges your oldest recycled files when the bin overflows. Every delete now re-measures the selection, checks it against each drive's bin limit and current contents, and refuses the whole batch if any of it would not land in the bin intact. Before this, a 16.5 GB folder would have been deleted permanently.
- **Protected items are enforced by the server**, not only greyed out in the interface.
- **Every destructive action asks first** in a native Windows dialog — deleting, stopping a process, and running a tool's own cleanup command (which bypasses the Recycle Bin).
- **Folders holding code, git repositories, databases, login files or program installs are locked** even when they belong to an AI tool (for example `~/.codex`, which holds your login).
- **Your project folders are report-only** — shown with their size, never deletable from the app. They were previously filed under "Antigravity" and marked deletable.
- **Stopping a process is limited to processes the app listed**, re-checked by name and start time so a reused process number can't stop a different program.
- The caution dialog shows what is actually **inside** the largest folders before you confirm.

#### ⚡ Speed

- **Full scan: 503 s → 30 s** on the development machine (147 locations). On Windows, sizes now come straight from the directory listing (`FindFirstFileEx`) instead of opening every file; the pnpm store measures in 2 s instead of 70 s. Results are byte-identical to the previous walk.
- **Disk explorer fills in live** — every entry appears at once and sizes arrive as they are measured.
- The status bar shows scan progress by phase.

#### 🔍 Coverage

- **Any Chromium/Electron app's caches** (Chrome, Edge, Brave, VS Code, Slack, Discord, WhatsApp, Claude…) are found by their profile layout rather than a hand-kept list — 78 caches / 2.6 GB on the development machine.
- **Chrome's on-device AI model (Gemini Nano, ~4 GB)**, with the official way to turn it off.
- **Individual models** in Hugging Face, Ollama (with the exact `ollama rm` command) and LM Studio.
- **All AI tool folders the software view discovered** now appear in the storage list too (Playwright browsers, `.antigravity-ide`, Codex, OpenAI…), so totals match everywhere.
- **Windows & system tips** with step-by-step instructions and copy-paste commands: hibernation file, Windows Update leftovers, NVIDIA driver downloads, downloads older than 90 days, Recycle Bin contents. The app never touches these itself.
- **Docker's trapped space**: the dashboard shows how much of the Docker disk file is empty (44.85 GB of 55.43 GB here) and how to give it back. The one-click "compact" was replaced — it targeted Docker's 0.1 GB system disk and freed nothing; the correct `diskpart` steps are now given to run as administrator.
- **Disk explorer**: browse any drive or folder, largest first (read-only).
- macOS and Linux paths for the main caches; sparse files (Docker.raw) are counted by the space they really use.

#### 🖥️ Desktop app

- Custom title bar with the native window buttons, a search box (**Ctrl+F**) and a status bar with free space per drive, Recycle Bin room and scan progress.
- Split view: select a location to see why it has its rating, what's inside it, and its actions.
- **Keyboard**: ↑/↓ move, Space select, Enter open folder, Delete asks to delete, Ctrl+R rescan, Ctrl+1…9 switch pages.
- **Right-click menus**: Open folder, Copy path, Show details, Delete….
- App icon, tray icon (Open / Rescan / Quit), window size and position remembered, native folder picker.
- First-run tour; opt-in reminder notification when a chosen amount is safe to reclaim (it only notifies — it never deletes).
- **Update download**: downloads the new release from GitHub, verifies its SHA-256 against GitHub's published checksum, and shows it in Explorer. It never runs it for you.

#### 🧪 Quality

- 51 unit/integration tests (including a real delete → Recycle Bin → restore round trip) and 10 UI tests against a mocked engine, plus an Electron shell test.
- CI now runs on Windows, macOS and Linux.
- Fixed: the dev server watched build output and locked files, which broke packaging with `EPERM`.

#### ⚠️ Known issue

- The build is not code-signed yet. Windows SmartScreen shows a warning on first run, and on some PCs the first screen takes up to ~10 seconds to fill in while Windows security checks the helper processes the app starts. Later screens are fast.

---

## [1.1.0] - 2026-08-01

### 🛠️ Critical Fix, Real Restore, and Per-Project AI Export

> **If you are on v1.0.0, please update.** Cleaning did not work in that build.

#### 🐛 Fixed — cleaning was broken in v1.0.0

- **The released v1.0.0 executable could not delete anything.** The bundler rewrote `import.meta` inside the ESM-only `trash` package, so its helper binary resolved against `undefined` and every clean failed with `TypeError: Invalid URL`. The bug only appeared in the packaged `.exe` — it worked in development, which is why it shipped. Cleaning is now verified end-to-end in the packaged build, with a regression test that runs against the production bundle.
- **The app froze during a scan.** Directory walking was synchronous and blocked the event loop; a trivial API call made during a scan took **15,695 ms**. Scanning is now async with bounded concurrency and the same call takes **16 ms**. The backend also runs in its own process, so disk work can never stall the window.
- **`pip` cache was never found on Windows** — it looked in the Linux location (`~/.cache/pip`).
- **The update checker always failed**, pointing at a repository slug that does not exist.
- **Restore never restored** — it only checked whether a path happened to exist and reported success.
- **"Select all" selected everything deletable**, including chat databases and session keys, from a screen labelled 100% safe.
- Hardcoded developer paths and a hardcoded month (`2026-07`) that made activity filters wrong for every other user, on every other date.

#### ✨ Added

- **Export one project, not one tool.** Pick a project and get its source plus every AI conversation about it in a single archive. Claude records a working directory in every session and Cursor stores a workspace folder, so history is matched to the right project automatically. **30 projects** were discovered on the development machine.
- **Real one-click restore.** Restore points now move files back out of the Windows Recycle Bin to their original location, or to a folder you choose.
- **No export size limit.** Archives stream to disk instead of being assembled in memory. A 2.4 GB project with 604 MB of chat history exported to a valid 248 MB archive while the backend held **80 MB** of RAM.
- **Automatic AI tool discovery.** Instead of a fixed list, the scanner searches the real install locations and matches vendor signatures — Claude, Cursor, Antigravity, Gemini, GLM, Kimi, Codex, Cline, Windsurf, Trae, CodeGeeX, Ollama, LM Studio, Jan, AnythingLLM, Continue, OpenHands, Crawl4AI, Playwright and more.
- **Package manager caches**, all safe to delete and often the largest reclaimable thing on a developer's disk: **npm**, **Bun**, **uv**, **Yarn** and **pip**. Reclaimable space on the development machine went from **327 MB to 3.44 GB**.
- **Transcript export for Antigravity and Codex.** Each tool stores history in a different format; readers now match the real on-disk layout rather than assuming JSON.
- **Live export progress** — files archived, bytes read and elapsed time, instead of a static label.
- **Choose where archives are saved**, shown before you export rather than after.

#### 🔒 Security

- **Host header validation.** CORS does not stop DNS rebinding, and this server can delete files and terminate processes.
- Project launching restricted to folders a scan surfaced, closing an arbitrary-command path.
- Blanket `file://` CORS access removed; request bodies capped.
- **Fonts are now bundled.** The app previously fetched them from Google on every launch, which failed offline and contradicted the "nothing leaves your machine" guarantee.

#### 🎨 Changed

- Redesigned around one rule: **colour means something.** Green, amber and red indicate deletion safety, each with a word beside it so the meaning survives colour blindness. Each AI tool gets its own quiet identity colour.
- Every measurement uses tabular figures, so numbers line up instead of jittering.
- Keyboard focus is visible throughout (there were previously no focus styles at all).
- Plain-language naming: "Google Antigravity IDE & AGY Engine" → **Antigravity**, "Clawbots & Bots" → **Agents & crawlers**, "100% SAFE" → **Rebuilds itself**.
- Settings that did nothing were removed rather than left as decoration.

#### 🧪 Testing

- **0 → 17 tests**, covering the delete path in the production bundle, path de-duplication, safety-tier classification and command escaping. CI runs them on every push.

---

## [1.0.0] - 2026-07-24

### 🚀 Initial Public Release

- Non-overlapping AI storage scanner across local drives.
- Safety snapshot recorded before cleaning.
- Windows native uninstaller integration.
- Clawbot and scraper detection (OpenDevin, Crawl4AI, Playwright, Puppeteer).
- RAM process inspector for idle AI sidecars and MCP servers.
- Portable Windows executable, 100% offline with no background services.

> ⚠️ **Known issue:** cleaning does not work in this build. Use v1.1.0 or later.

---

### 🌐 Learn More

- **Repository**: [github.com/IamRamgarhia/AICacheCleaner](https://github.com/IamRamgarhia/AICacheCleaner)
- **Releases**: [github.com/IamRamgarhia/AICacheCleaner/releases](https://github.com/IamRamgarhia/AICacheCleaner/releases)
- **Author**: [IamRamgarhia](https://github.com/IamRamgarhia) · Built by [Dice Codes](https://dicecodes.com/)
