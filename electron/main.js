/* DJ MAX — Electron wrapper with GitHub-backed auto-updates
   Loads public/pioneer-dj-pro-max-v2.html in a native BrowserWindow and
   checks the GitHub Releases feed for updates on launch + every 4 hours.
   Updates are downloaded silently and installed on quit. */
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (_) { /* optional in dev */ }

let mainWindow = null;

function findAssetPath(relPath) {
  // Try every layout the public asset could live in — dev checkout, inside
  // app.asar, asar.unpacked sibling (electron-builder's asarUnpack output),
  // and an absolute process.resourcesPath fallback — and return the first
  // path that actually exists on disk.  This is what v1.0.5/1.0.6 was missing
  // and what caused the black screen on Windows.
  const base = typeof app.getAppPath === 'function' ? app.getAppPath() : path.join(__dirname, '..');
  const candidates = [
    path.join(__dirname, '..', relPath),
    path.join(base, relPath),
    path.join(base.replace(/app\.asar$/i, 'app.asar.unpacked'), relPath),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', relPath),
  ];
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch (_) {}
  }
  return candidates[0]; // concrete path for the error dialog if nothing exists
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

  const htmlPath = findAssetPath(path.join('public', 'pioneer-dj-pro-max-v2.html'));

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

  autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('djmax:update-status', {
        state: 'available',
        version: info && info.version,
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('djmax:update-status', { state: 'none' });
    }
  });

  autoUpdater.on('download-progress', (p) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('djmax:update-status', {
        state: 'downloading',
        percent: p && p.percent,
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update ready',
      message: `DJ MAX ${info && info.version} is ready to install.`,
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
