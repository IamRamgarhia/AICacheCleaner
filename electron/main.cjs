const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

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

  // Launch bundled Express backend directly inside Electron Node engine (Zero external process spawning)
  try {
    const serverPath = path.join(__dirname, '..', 'dist', 'server.cjs');
    require(serverPath);
    console.log('[Backend] Express Local Engine API started successfully in Electron process.');
  } catch (err) {
    console.error('[Backend Load Error]:', err);
  }

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
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
