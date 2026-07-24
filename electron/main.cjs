const { app, BrowserWindow } = require('electron');
const path = require('path');

// Launch bundled Express backend directly inside Electron Node engine (Zero external process spawning)
try {
  const serverPath = path.join(__dirname, '..', 'dist', 'server.cjs');
  require(serverPath);
  console.log('[Backend] Express Local Engine API started successfully in Electron process.');
} catch (err) {
  console.error('[Backend Load Error]:', err);
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1000,
    minHeight: 700,
    title: 'AI Clutter Cleaner — Safety Optimizer',
    backgroundColor: '#0b0f19',
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

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
