# AI Clutter Cleaner — Code Review & Audit Report

**Date:** 2026-07-25
**Scope:** Full codebase review — `server/`, `electron/`, `src/`, build config
**Verdict:** Working MVP with serious security, correctness, and honesty issues that should be resolved before wider distribution. Software that *deletes user files* has a higher bar than a typical app.

---

## Table of Contents

- [🔴 Critical Bugs & Security Issues](#-critical-bugs--security-issues-fix-these-first)
- [🟠 Functional Bugs (features that don't work as advertised)](#-functional-bugs-features-that-dont-work-as-advertised)
- [🟡 Unwired / Dead Code](#-unwired--dead-code)
- [🟢 Code-Quality Improvements](#-code-quality-improvements)
- [✨ Feature Suggestions](#-feature-suggestions)
- [TL;DR — Top 5 to Fix This Week](#tldr--top-5-to-fix-this-week)
- [Recommended Fix Waves](#recommended-fix-waves)

---

## 🔴 Critical Bugs & Security Issues (fix these first)

### 1. The "Safety Restore Point" often backs up nothing
`server/index.ts:287` calls `createSnapshot([], ...)` — an **empty array** — but the function signature is `createSnapshot(items: AICacheItem[])`. The second argument is silently dropped. So `/api/purge-software` tells the user *"Safety Restore Point created successfully!"* while backing up **zero files**. The whole "100% Safe / Zero Data Loss" marketing rests on a snapshot that contains nothing.

### 2. Open CORS on a server that deletes files & kills processes
`server/index.ts:18` — `app.use(cors())` allows **any origin**. Combined with no CSRF tokens, **any website you visit can silently call** `http://localhost:3333/api/clean` and delete your files, or `/api/processes/kill` to kill processes. This is a real remote attack surface on every machine running the app. Restrict to `http://localhost:5173` / the Electron origin, and add CSRF/origin checks.

### 3. Command injection via `exec` with user input
`server/index.ts:131, 173, 375, 379` — paths from the request body are interpolated into shell strings:

```js
launchCmd = `start cmd /k "cd /d "${folderPath}" && npx vite ..."`
```

A `folderPath` containing `"` or `&&` breaks out. Use `spawn` with arg arrays, never string-interpolate paths into a shell.

### 4. Dangerous Electron security config
`electron/main.cjs:46-47`:

```js
nodeIntegration: true,
contextIsolation: false
```

This is the single most-flagged Electron vulnerability. In dev it loads `http://localhost:5173` — any XSS or compromised dev server gets **full Node access = full machine compromise**. Flip both and use a preload script with `contextBridge`.

### 5. Broken update checker (string compare, not semver)
`server/index.ts:340`:

```js
const isNewer = cleanLatest !== cleanCurrent;
```

Any different tag reports "update available" — including **downgrades** and pre-releases. `v1.0.0` vs `v1.0.0-beta` → update offered. Use a real semver compare (e.g. `compare-versions` or manual numeric parse).

### 6. `getDirectorySize` called with wrong signature
`server/index.ts:47` — `getDirectorySize(target.path, 10)` — the function only takes one arg (`scanner.ts:40`). The `10` is ignored. Either the signature lost a depth-limit param or the call is wrong; either way the intent is broken.

---

## 🟠 Functional Bugs (features that don't work as advertised)

### 7. Settings are never saved
`SettingsTab.tsx:264` "Save Preferences" only flips a toast. `cacheThresholdGb`, `defaultDeleteMethod`, `restorePointPolicy`, `autoCleanGreenTier` live in React state and vanish on reload. The UI text claims *"stored 100% locally in `.ai-hygiene/config.json`"* — **that file is never written** (confirmed: no `writeFile` for it anywhere). The settings also have zero effect on `/api/clean`, which ignores them.

### 8. CPU % is randomly generated; `pidusage` is an unused dependency
`processInspector.ts:124`:

```js
cpuPercent: Math.round((Math.random() * 4 + 0.5) * 10) / 10
```

You ship `pidusage` (a real CPU/mem library) in `package.json` but **never import it** — fake numbers instead. On Windows `tasklist` gives no CPU; switch to `pidusage` or PowerShell `Get-Process`.

### 9. "Zombie process" detection is wrong
`processInspector.ts:127` — `isZombie: memMb > 250`. That's not what a zombie is (a zombie is a defunct, unreaped process). Every legit large process (Ollama with models, any Electron app) gets mislabeled as a zombie and counted against the "hygiene score" (`zombiePenalty`). Use `ppid` reap status or actual CPU-idle heuristics.

### 10. Fake fallback processes shown to the user
`processInspector.ts:182` — if no AI processes are found, it returns `defaultFallbackProcesses` with hardcoded fake PIDs (`60620`, `68472`…). The user sees phantom processes; clicking "Kill" runs `taskkill /PID 60620` which fails or hits an unrelated PID. Same fake data is duplicated in `App.tsx:55`.

### 11. `MemoryInspector` is entirely mock data
`MemoryInspector.tsx:7` — `mockMemories` is a hardcoded array. The "Privacy & AI Memory Inspector" doesn't actually read `.mcp/memory`, `.gemini`, or any real store. The search box filters mock text only.

### 12. Vault **import** is dead code
`migrationEngine.ts:124` exports `importProjectVault`, but there is **no `/api/import-vault` endpoint and no UI button**. Export works; import goes nowhere.

### 13. Error handlers lie about success
`App.tsx:176, 211, 226` — catch blocks print *"Soft-deleted N items to Recycle Bin safely"* / *"Restored snapshot!"* / *"Terminated process"* even though the API call **failed**. Users are told a destructive action succeeded when it didn't.

### 14. Snapshot restore doubles disk usage and mangles names
`snapshotManager.ts:34` — `fs.cpSync(item.path, dest, { recursive: true })` **copies the entire cache** (e.g. a 15 GB `.gemini`) into `~/.ai-hygiene/backups/` *before* soft-deleting. That doubles disk usage, defeats the purpose of cleaning, and can hang for minutes. Restore to a custom destination uses `item.name.replace(/[^a-zA-Z0-9_-]/g, '_')` — so names with spaces/colons become unreadable slugs.

### 15. Duplicate, conflicting electron-builder configs
`package.json` has a full `build` block **and** there's a separate `electron-builder.json`. They conflict:

- `appId`: `com.dicecodes.aicluttercleaner` vs `org.aihygiene.desktop`
- `productName`: `AI-Clutter-Cleaner` vs `AI-Hygiene`
- output dir: `dist-electron` vs `dist-desktop`
- The JSON bundles `server/**/*` (TS source) **and** `node_modules/**/*` on top of `dist/server.cjs` — installer bloat.

Pick one (preferably `electron-builder.json`) and delete the other.

### 16. Hardcoded developer machine paths in production code

- `server/index.ts:40-41` — `'d:\\calude\\ai memroy ext'`, `'d:\\calude'`
- `scanner.ts:131` — `fullPathLower.includes('calude\\ai memroy ext')` as a fingerprint
- `App.tsx:17-26, 19` — `defaultScanItems` with `C:\Users\iamra\...` paths and fake sizes, merged into real results at line 122-126 so they persist on every user's machine.
- `SettingsTab.tsx:19` — default restore path `C:\Users\iamra\Desktop\...`

These leak your personal username/path into every install.

### 17. `sortItemsByPriority` hardcodes "recent" as `2026-07`
`App.tsx:32` — `a.lastModified.startsWith('2026-07')`. This breaks every month; by August nothing is "recent." Compute relative to today's date.

---

## 🟡 Unwired / Dead Code

| Item | Location |
|---|---|
| `App.css` — **entire file** (185 lines). Verified 0 usages of `.hero`, `.framework`, `.vite`, `.next-steps`, `.docs`, `.ticks`, `.counter` — leftover Vite template. | `src/App.css` |
| `pidusage` dependency — 0 imports anywhere | `package.json:28` |
| `importProjectVault` — implemented, no endpoint/UI | `migrationEngine.ts:124` |
| Threshold alert, auto-clean-green, restore-point-policy — UI only, no logic | `SettingsTab.tsx` |
| `findFreePort` exists but main server hardcodes `PORT = 3333` and silently dies on `EADDRINUSE` (just logs) | `server/index.ts:16, 392` |
| `.oxlintrc.json` alongside ESLint — two linters doing the same job | root |
| Splash `loading` is a fixed 400 ms timer, unrelated to actual data load | `App.tsx:148` |

---

## 🟢 Code-Quality Improvements

1. **`formatBytes` is duplicated 3×** — `scanner.ts:6`, `PreDeleteModal.tsx:24`, `SafeDeleteSection.tsx:17`. Extract to a shared util. Also `Math.floor(Math.log(bytes)/Math.log(k))` produces NaN/overflow for `bytes ≤ 0` or extreme values — guard it.
2. **`sanitizePath` is weak** (`migrationEngine.ts:34`) — the `..` check is skipped for absolute paths (`!path.isAbsolute`), so `C:\Users\..\..\Windows` passes. Reject any path containing `..` after normalization.
3. **`totalAIProjectsBytes` is string-sniffed** (`index.ts:89`) — `path.startsWith('D:') || name.includes('Project')`. Fragile; then it falls back to total cache size, hiding the metric entirely.
4. **Hardcoded `http://localhost:3333`** repeated in `App.tsx`, `SettingsTab.tsx`, `SafeDeleteSection.tsx` — make a `API_BASE` constant.
5. **Inline styles everywhere** (~thousands of lines of `style={{}}`). No theming, no light mode, hard to maintain. Move to CSS modules / the existing `index.css`.
6. **PreDeleteModal has no keyboard support** — Escape doesn't close, no focus trap, no scroll lock.
7. **No tests at all** — for software that *deletes files*, this is dangerous. Even smoke tests for `formatBytes`, `calculateNonOverlappingSize`, and the snapshot round-trip would catch regressions.
8. **No CI** — `tsc --noEmit` and `eslint` aren't wired into any script or GitHub Action.
9. **Backend loaded via `require()` inside Electron main** (`electron/main.cjs:27`) with no retry/user feedback — if the port is busy, you get a blank window.

---

## ✨ Feature Suggestions

| Feature | Why it's worth it |
|---|---|
| **Dry-run / preview mode** | "Will delete X files, free Y GB" before any action — huge trust win |
| **Snapshot size cap + auto-pruning** | Backups currently grow unbounded; add max age/count + compression (`tar.gz`) instead of raw `cpSync` |
| **Real pidusage-based process metrics** | Already a dependency — wire it up for accurate CPU/mem |
| **Treemap disk visualizer** | D3 or `d3-flextree` — see what's eating space at a glance |
| **Protected-paths whitelist** | Let users mark folders that can never be cleaned (e.g. active project roots) |
| **Real memory search** | `ripgrep` through `.mcp/memory`, `.gemini`, `.continue` for secrets/PII — replaces mock data |
| **Scheduled auto-clean** | The settings UI promises this; implement via a tiny scheduler or Windows Task Scheduler integration |
| **Audit log** | Append-only JSON of every delete/restore — accountability for a destructive tool |
| **Configurable scan roots** | Let users add custom drives/folders instead of hardcoded `D:\ E:\ F:\` |
| **CLI mode** | `ai-clutter-cleaner --scan --json` for scripting/CI |
| **Proper preload + IPC** | Replace `fetch(http://localhost:3333)` with Electron IPC — no port conflicts, no CORS attack surface, no second process |
| **Light theme / accessibility** | High-contrast mode, keyboard nav, ARIA labels |

---

## TL;DR — Top 5 to Fix This Week

1. **CORS + CSRF + Electron `contextIsolation`** — the security trio is wide open (#2, #4, #3).
2. **Empty/lying snapshots** — `createSnapshot([])` and the success toast on failure (#1, #13).
3. **Fake data presented as real** — CPU%, fallback processes, MemoryInspector (#8, #10, #11).
4. **Settings don't persist + broken semver update check** (#7, #5).
5. **Dead config + dead CSS + leaked dev paths** — ship a clean installer (#15, dead code, #16).

---

## Recommended Fix Waves

### Wave 1 — Security
- Lock CORS to `localhost:5173` + Electron origin; add origin/CSRF checks on mutating routes
- Electron: `contextIsolation: true`, `nodeIntegration: false`, preload script with `contextBridge`
- Replace all `exec` string interpolation with `spawn(..., { args })`
- Real semver compare in `/api/check-update`

### Wave 2 — Honesty
- Remove fake fallback processes / fake CPU% / mock MemoryInspector (or clearly mark as demo data)
- Wire `pidusage` for real metrics
- Fix lying catch blocks → surface real errors
- Persist settings to `.ai-hygiene/config.json` and honor them in `/api/clean`
- Fix `createSnapshot([])` so purge actually backs up before deleting

### Wave 3 — Cleanup
- Delete `App.css`, one of the two builder configs, `.oxlintrc.json` (or standardize on it)
- Remove hardcoded `iamra` / `D:\calude` paths
- Extract `formatBytes`, `API_BASE` constants
- Add `tsc --noEmit` + `eslint` to a GitHub Action
- Snapshot compression + size cap + auto-prune
