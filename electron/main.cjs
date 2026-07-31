const { app, BrowserWindow, Menu, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');

// Enforce Windows Single-Instance Lock (Standard Windows software rule: focuses existing instance, prevents duplicate port errors)
const gotTheLock = app.requestSingleInstanceLock();

let mainWindow;

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

  function createWindow() {
    Menu.setApplicationMenu(null); // Clean frameless menu bar for modern UI

    mainWindow = new BrowserWindow({
      width: 1366,
      height: 900,
      minWidth: 1024,
      minHeight: 720,
      title: 'AICacheCleaner — Safety Optimizer',
      backgroundColor: '#0b0f19',
      autoHideMenuBar: true,
      show: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    mainWindow.maximize(); // Open maximized full screen for zero edge cut-offs

    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      mainWindow.loadURL('http://localhost:5173');
    } else {
      mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  app.on('ready', () => {
    // utilityProcess.fork is only valid once the app is ready.
    startBackend();
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
