import { app, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { tmpdir } from 'os';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
const PORT = 3111;
const isDev = !app.isPackaged;

function getAppTmpDir(): string {
  if (app.isPackaged) {
    return join(app.getPath('userData'), 'tmp', 'ocr-extract');
  }
  return join(tmpdir(), 'ocr-extract');
}

async function startServer(): Promise<void> {
  const tmpDir = getAppTmpDir();
  await mkdir(tmpDir, { recursive: true });

  let serverPath: string;
  let execPath: string;

  if (isDev) {
    // Dev: just connect to the already-running next dev server
    return;
  }

  // Production: use Electron's bundled Node to run standalone server
  execPath = process.execPath;
  serverPath = join(process.resourcesPath, 'standalone', 'server.js');

  return new Promise((resolve) => {
    serverProcess = spawn(execPath, [serverPath], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(PORT),
        HOSTNAME: '127.0.0.1',
        ELECTRON_TMPDIR: tmpDir,
        NODE_PATH: join(process.resourcesPath, 'standalone', 'node_modules'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      if (output.includes('Ready') || output.includes('started')) {
        resolve();
      }
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[server]', data.toString());
    });

    serverProcess.on('error', (err) => {
      console.error('[server] Failed to start:', err);
      resolve();
    });

    // Fallback: resolve after 8s
    setTimeout(() => resolve(), 8000);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Message Extract',
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
}

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
    try {
      await startServer();
      createWindow();
    } catch (err) {
      console.error('Failed to start:', err);
      app.quit();
    }
  });
}

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});
