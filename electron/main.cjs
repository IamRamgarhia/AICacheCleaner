const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell, utilityProcess, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// Enforce Windows Single-Instance Lock (Standard Windows software rule: focuses existing instance, prevents duplicate port errors)
const gotTheLock = app.requestSingleInstanceLock();

let mainWindow;
let tray = null;

// Colours of the custom title bar, kept in step with --ins-graphite-850 /
// --ins-mist-300 in src/lib/tokens.css so the native window buttons blend in.
const TITLEBAR_BG = '#12161d';
const TITLEBAR_FG = '#a8b0bc';
const TITLEBAR_HEIGHT = 36;

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Catch any background exceptions globally to prevent red dialog error popups
  process.on('uncaughtException', (err) => {
    console.log('[Main Process Background Notice]:', err.message);
  });

  const serverPath = path.join(__dirname, '..', 'dist', 'server.cjs');
  let backendProcess = null;

  // Run the Express backend in a utilityProcess rather than inside the main
  // process. Scanning touches tens of GB of disk; even now that the walk is
  // async, keeping it off the main process guarantees window painting, resizing
  // and closing can never be delayed by backend work.
  function startBackend() {
    if (!fs.existsSync(serverPath)) {
      console.error('[Backend] Bundled server not found at', serverPath);
      return;
    }

    try {
      backendProcess = utilityProcess.fork(serverPath, [], {
        serviceName: 'AICacheCleanerBackend',
        stdio: 'pipe'
      });

      backendProcess.stdout?.on('data', (d) => process.stdout.write(`[Backend] ${d}`));
      backendProcess.stderr?.on('data', (d) => process.stderr.write(`[Backend] ${d}`));

      backendProcess.on('exit', (code) => {
        console.log(`[Backend] Local Engine API exited with code ${code}.`);
        backendProcess = null;
      });

      console.log('[Backend] Express Local Engine API started in a utility process.');
    } catch (err) {
      // Falling back in-process keeps the app usable if utilityProcess is
      // unavailable; the async scanner means this no longer freezes the UI.
      console.error('[Backend] utilityProcess failed, falling back in-process:', err);
      try {
        require(serverPath);
      } catch (fallbackErr) {
        console.error('[Backend Load Error]:', fallbackErr);
      }
    }
  }

  function stopBackend() {
    if (backendProcess) {
      try { backendProcess.kill(); } catch (e) { /* already gone */ }
      backendProcess = null;
    }
  }

  app.on('before-quit', stopBackend);
  app.on('will-quit', stopBackend);

  // ---- Window size & position survive restarts, like any desktop app -------
  const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

  function loadWindowState() {
    try {
      const s = JSON.parse(fs.readFileSync(stateFile(), 'utf-8'));
      // Only reuse bounds that are still on a connected display.
      const visible = screen.getAllDisplays().some(d => {
        const a = d.workArea;
        return s.x >= a.x - 50 && s.y >= a.y - 50 && s.x < a.x + a.width && s.y < a.y + a.height;
      });
      return visible ? s : null;
    } catch {
      return null;
    }
  }

  function saveWindowState() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const b = mainWindow.getNormalBounds();
      fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: mainWindow.isMaximized() }), 'utf-8');
    } catch (e) {
      console.warn('[Window] could not save state:', e.message);
    }
  }

  function appIcon() {
    const p = path.join(__dirname, 'tray.png');
    return fs.existsSync(p) ? nativeImage.createFromPath(p) : undefined;
  }

  function createWindow() {
    Menu.setApplicationMenu(null);
    const saved = loadWindowState();

    mainWindow = new BrowserWindow({
      width: saved?.width ?? 1366,
      height: saved?.height ?? 900,
      x: saved?.x,
      y: saved?.y,
      minWidth: 960,
      minHeight: 640,
      title: 'AICacheCleaner',
      icon: appIcon(),
      backgroundColor: '#0e1116',
      // Native window controls drawn over our own title bar, so the window
      // reads as one piece of software instead of a web page inside a frame.
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: TITLEBAR_BG, symbolColor: TITLEBAR_FG, height: TITLEBAR_HEIGHT },
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        spellcheck: false
      }
    });

    if (!saved || saved.maximized) mainWindow.maximize();
    mainWindow.once('ready-to-show', () => mainWindow.show());

    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      mainWindow.loadURL('http://localhost:5173');
    } else {
      mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }

    // Links open in the user's browser, never inside the app window.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    mainWindow.on('close', saveWindowState);
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  // ---- Tray: quick access while the app is open ----------------------------
  function createTray() {
    const icon = appIcon();
    if (!icon) return;
    tray = new Tray(icon);
    tray.setToolTip('AICacheCleaner');
    const show = () => {
      if (!mainWindow) return createWindow();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    };
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open AICacheCleaner', click: show },
      { label: 'Rescan now', click: () => { show(); mainWindow?.webContents.send('app:command', 'rescan'); } },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ]));
    tray.on('click', show);
  }

  // ---- Native dialogs & menus for the renderer -------------------------------
  // The renderer has no Node access (contextIsolation); these are the only
  // native capabilities it gets, each with a fixed, narrow shape.
  ipcMain.handle('dialog:confirm', async (_e, opts) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: opts?.danger ? 'warning' : 'question',
      title: String(opts?.title ?? 'AICacheCleaner'),
      message: String(opts?.message ?? ''),
      detail: opts?.detail ? String(opts.detail) : undefined,
      buttons: [String(opts?.confirmLabel ?? 'OK'), 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    return response === 0;
  });

  ipcMain.handle('dialog:alert', async (_e, opts) => {
    await dialog.showMessageBox(mainWindow, {
      type: opts?.kind === 'error' ? 'error' : 'info',
      title: String(opts?.title ?? 'AICacheCleaner'),
      message: String(opts?.message ?? ''),
      detail: opts?.detail ? String(opts.detail) : undefined,
      buttons: ['OK'],
      noLink: true
    });
  });

  ipcMain.handle('dialog:pickFolder', async (_e, opts) => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: String(opts?.title ?? 'Choose a folder'),
      defaultPath: opts?.defaultPath ? String(opts.defaultPath) : undefined,
      properties: ['openDirectory', 'createDirectory']
    });
    return res.canceled ? null : res.filePaths[0] ?? null;
  });

  // Resolves with the chosen item id, or null when the menu is dismissed.
  ipcMain.handle('menu:context', (_e, items) => new Promise(resolve => {
    let chosen = null;
    const template = (Array.isArray(items) ? items : []).map(it => it?.separator
      ? { type: 'separator' }
      : { label: String(it.label), enabled: it.enabled !== false, click: () => { chosen = String(it.id); } });
    Menu.buildFromTemplate(template).popup({ window: mainWindow, callback: () => resolve(chosen) });
  }));

  // ---- Update download --------------------------------------------------------
  // Downloads a release asset of THIS repo to the Downloads folder, verifies its
  // SHA-256 against GitHub's published digest when available, and reveals it.
  // It never runs the file: the user starts the new version themselves.
  // Checked on the PARSED URL, so "…/download/../../evil/…" can't slip past.
  const RELEASE_PATH = /^\/IamRamgarhia\/AICacheCleaner\/releases\/download\/[^/]+\/[^/]+$/;
  const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

  ipcMain.handle('update:download', async (event, opts) => {
    let parsed;
    try { parsed = new URL(String(opts?.url ?? '')); } catch { parsed = null; }
    const name = path.basename(String(opts?.name ?? ''));
    const digest = typeof opts?.digest === 'string' ? opts.digest : '';
    if (!parsed || parsed.origin !== 'https://github.com' || !RELEASE_PATH.test(parsed.pathname) || parsed.search ||
        !/^[\w.\- ]+\.(exe|zip|dmg)$/i.test(name)) {
      return { ok: false, error: 'Refused: not a release asset of AICacheCleaner.' };
    }
    const url = parsed.href;
    const target = path.join(app.getPath('downloads'), name);
    // Never overwrite something the user already has under that name.
    if (fs.existsSync(target)) {
      return { ok: false, error: `${name} is already in your Downloads folder — open it from there, or move it first.` };
    }
    const sender = event.sender;
    const session = mainWindow.webContents.session;

    const saved = await new Promise(resolve => {
      let item = null;
      const timer = setTimeout(() => { session.removeListener('will-download', onWill); item?.cancel(); resolve(null); }, DOWNLOAD_TIMEOUT_MS);
      const onWill = (_e, candidate) => {
        const chain = [candidate.getURL(), ...candidate.getURLChain()];
        if (!chain.includes(url)) return;
        item = candidate;
        session.removeListener('will-download', onWill);
        candidate.setSavePath(target);
        candidate.on('updated', () => {
          sender.send('update:progress', { received: candidate.getReceivedBytes(), total: candidate.getTotalBytes() });
        });
        candidate.once('done', (_ev, state) => { clearTimeout(timer); resolve(state === 'completed' ? target : null); });
      };
      session.on('will-download', onWill);
      mainWindow.webContents.downloadURL(url);
    });
    if (!saved) return { ok: false, error: 'The download did not complete.' };

    if (digest.startsWith('sha256:')) {
      const hash = require('crypto').createHash('sha256').update(fs.readFileSync(saved)).digest('hex');
      if (hash !== digest.slice(7).toLowerCase()) {
        fs.rmSync(saved, { force: true });
        return { ok: false, error: 'Checksum did not match GitHub\'s — the file was discarded.' };
      }
    }
    shell.showItemInFolder(saved);
    return { ok: true, path: saved, verified: digest.startsWith('sha256:') };
  });

  app.on('ready', () => {
    // utilityProcess.fork is only valid once the app is ready.
    startBackend();
    createWindow();
    createTray();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
