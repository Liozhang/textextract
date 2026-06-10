import { app, BrowserWindow, dialog } from 'electron';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { type Server } from 'http';
import { tmpdir } from 'os';

let mainWindow: BrowserWindow | null = null;
let httpServer: Server | null = null;
let isQuitting = false;
const PORT = 3111;
const isDev = !app.isPackaged;

function getAppTmpDir(): string {
  if (app.isPackaged) {
    return join(app.getPath('userData'), 'tmp', 'ocr-extract');
  }
  return join(tmpdir(), 'ocr-extract');
}

function closeServer(): void {
  if (httpServer) {
    httpServer.closeAllConnections();
    httpServer.close();
    httpServer = null;
  }
}

async function startServer(): Promise<boolean> {
  const tmpDir = getAppTmpDir();
  await mkdir(tmpDir, { recursive: true });

  if (isDev) {
    return true;
  }

  // Production: start Next.js standalone server in-process
  process.env.NODE_ENV = 'production';
  process.env.PORT = String(PORT);
  process.env.HOSTNAME = '127.0.0.1';
  process.env.ELECTRON_TMPDIR = tmpDir;
  process.env.NODE_PATH = join(process.resourcesPath, 'standalone', 'node_modules');

  // Intercept http.createServer to capture the server instance for graceful shutdown
  const httpModule = require('http');
  const origCreateServer = httpModule.createServer.bind(httpModule);
  let captured = false;
  httpModule.createServer = (...args: unknown[]) => {
    if (!captured) {
      captured = true;
      httpServer = origCreateServer(...args);
      httpModule.createServer = origCreateServer;
      return httpServer;
    }
    return origCreateServer(...args);
  };

  try {
    const serverPath = join(process.resourcesPath, 'standalone', 'server.js');
    require(serverPath);
  } catch (err) {
    console.error('[server] Failed to start:', err);
    return false;
  }

  // Poll HTTP until server responds or timeout (15s)
  const baseUrl = `http://127.0.0.1:${PORT}`;
  const maxWait = 15000;
  const interval = 300;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(baseUrl, { signal: AbortSignal.timeout(500) });
      if (res.ok) {
        console.log('[server] Ready');
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  console.warn('[server] Timed out waiting for server');
  return false;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'TextExtract',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const url = isDev
    ? 'http://localhost:3000'
    : `http://127.0.0.1:${PORT}`;

  mainWindow.loadURL(url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle renderer crash
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] Crashed:', details);
    if (!isQuitting) {
      dialog.showMessageBox({
        type: 'error',
        title: 'TextExtract',
        message: 'The application encountered an error and needs to reload.',
        buttons: ['Reload', 'Close'],
      }).then(({ response }) => {
        if (response === 0) {
          mainWindow?.webContents.reload();
        } else {
          app.quit();
        }
      }).catch(() => {
        app.quit();
      });
    }
  });
}

// Global error handler
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  if (!isQuitting && mainWindow) {
    dialog.showErrorBox('Unexpected Error', `An unexpected error occurred:\n${err.message}`);
  }
  app.quit();
});

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const serverReady = await startServer();
    if (!serverReady) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'TextExtract',
        message: 'Failed to start the application server.',
        detail: 'The built-in server could not be started. Please try restarting the application.',
        buttons: ['OK'],
      });
      app.quit();
      return;
    }
    createWindow();
  });
}

app.on('window-all-closed', () => {
  closeServer();
  app.quit();
});

let forceExitTimer: ReturnType<typeof setTimeout> | null = null;
app.on('before-quit', () => {
  isQuitting = true;
  closeServer();
  // Force-exit as fallback since HTTP server keep-alive may block clean exit
  if (!forceExitTimer) {
    forceExitTimer = setTimeout(() => {
      process.exit(0);
    }, 1000);
  }
});
