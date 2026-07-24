const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;

function startBackendServer() {
  const isWin = process.platform === 'win32';
  const serverPath = path.join(__dirname, '..', 'server', 'index.ts');

  if (isWin) {
    backendProcess = spawn('npx.cmd', ['tsx', serverPath], {
      cwd: path.join(__dirname, '..'),
      shell: true
    });
  } else {
    backendProcess = spawn('npx', ['tsx', serverPath], {
      cwd: path.join(__dirname, '..'),
      shell: true
    });
  }

  backendProcess.stdout.on('data', (data) => {
    console.log(`[Backend Log]: ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[Backend Error]: ${data}`);
  });
}

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

  // Load production build or local dev server
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
  startBackendServer();
  setTimeout(() => {
    createWindow();
  }, 1500);
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});
