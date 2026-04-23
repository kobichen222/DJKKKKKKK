/* DJ TITAN — Electron wrapper with GitHub-backed auto-updates
   Loads public/studio.html (the DJ app itself) in a native BrowserWindow and
   checks the GitHub Releases feed for updates on launch + every 4 hours.
   public/index.html on the web is a marketing landing page — irrelevant to
   desktop users, who've already installed and just want the studio.
   Updates are downloaded silently and installed on quit. */
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (_) { /* optional in dev */ }

let mainWindow = null;

function findAssetPath(relPath) {
  // Resolve an asset to a real on-disk path that Chromium can load via file://.
  // Paths inside app.asar are rejected even though fs.existsSync reports them
  // present — Electron patches fs to read through the asar archive, but the
  // file:// protocol handler does not, so loadFile() on an asar-internal path
  // fails with ERR_FAILED (-2).  asarUnpack in package.json copies public/**
  // to resources/app.asar.unpacked/public/**, and that's the path we need.
  const base = typeof app.getAppPath === 'function' ? app.getAppPath() : path.join(__dirname, '..');
  const unpackedBase = base.replace(/app\.asar$/i, 'app.asar.unpacked');
  const resUnpacked = path.join(process.resourcesPath || '', 'app.asar.unpacked');
  const candidates = [
    path.join(unpackedBase, relPath),
    path.join(resUnpacked, relPath),
    path.join(__dirname, '..', relPath),
    path.join(base, relPath),
  ];
  const insideAsar = /[\\/]app\.asar[\\/]/i;
  for (const p of candidates) {
    if (!p || insideAsar.test(p)) continue;
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return candidates.find((p) => p && !insideAsar.test(p)) || candidates[0];
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 720,
    // show:true — always render the window immediately so the user sees at
    // minimum the chassis background while the UI finishes loading.  The
    // previous `show:false + ready-to-show` gate could leave the window
    // permanently hidden if any early paint failed, giving the false
    // appearance of a black screen.
    show: true,
    backgroundColor: '#0a0a0a',
    title: 'DJ TITAN — Professional DJ Studio',
    autoHideMenuBar: true,
    icon: findAssetPath(path.join('public', 'icon.svg')),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Preload bridges auto-update lifecycle events to window.djtitan in the
      // renderer.  Resolved via __dirname so it works inside app.asar too —
      // Electron reads preload scripts through its own asar-aware loader.
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Check for Updates',
          click: () => { if (autoUpdater) autoUpdater.checkForUpdatesAndNotify(); },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About DJ TITAN',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About DJ TITAN',
              message: 'DJ TITAN — Professional DJ Studio',
              detail: `DJ TITAN\nVersion: ${app.getVersion()}\nAuto-updates enabled from GitHub Releases.`,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  const htmlPath = findAssetPath(path.join('public', 'studio.html'));

  // Diagnostics: if the renderer fails to load for any reason (bad path,
  // missing asset, CSP) the user used to just see a black window forever.
  // Now we show a real error dialog + drop into DevTools so the next bug
  // report ships with an actual error message.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    // -3 = ERR_ABORTED (fires on normal in-page navigation) — ignore.
    if (code === -3) return;
    console.error('[DJ TITAN] Failed to load renderer:', code, desc, url);
    try { mainWindow.webContents.openDevTools({ mode: 'detach' }); } catch (_) {}
    dialog.showErrorBox('DJ TITAN — load failure',
      `Could not load the UI.\n\nCode: ${code}\n${desc}\n\nURL: ${url}\n\nTried: ${htmlPath}`);
  });
  mainWindow.loadFile(htmlPath).catch((err) => {
    console.error('[DJ TITAN] loadFile threw:', err && err.message);
    dialog.showErrorBox('DJ TITAN — cannot open UI file',
      `${err && err.message}\n\nTried: ${htmlPath}`);
  });
}

/* ------------- Auto-update lifecycle ------------- */
function initAutoUpdates() {
  if (!autoUpdater) return;

  // Silent download; user is prompted only when an update is ready to install
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('error', (err) => {
    console.warn('[updater] error:', err && err.message ? err.message : err);
  });

  const sendStatus = (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('djtitan:update-status', payload);
    }
  };

  ipcMain.on('djtitan:check-updates', () => {
    try { autoUpdater.checkForUpdatesAndNotify(); } catch (_) {}
  });

  autoUpdater.on('update-available', (info) => {
    sendStatus({ state: 'available', version: info && info.version });
  });

  autoUpdater.on('update-not-available', () => {
    sendStatus({ state: 'none' });
  });

  autoUpdater.on('download-progress', (p) => {
    sendStatus({ state: 'downloading', percent: p && p.percent });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({ state: 'downloaded', version: info && info.version });
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update ready',
      message: `DJ TITAN ${info && info.version} is ready to install.`,
      detail: 'Click "Restart now" to apply the update, or it will install automatically when you quit.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  // First check shortly after launch; then every 4 hours
  setTimeout(() => { try { autoUpdater.checkForUpdatesAndNotify(); } catch (_) {} }, 5 * 1000);
  setInterval(() => { try { autoUpdater.checkForUpdatesAndNotify(); } catch (_) {} }, 4 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  createWindow();
  initAutoUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
