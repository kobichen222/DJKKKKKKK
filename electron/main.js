/* DJ MAX — Electron wrapper with GitHub-backed auto-updates
   Loads public/pioneer-dj-pro-max-v2.html in a native BrowserWindow and
   checks the GitHub Releases feed for updates on launch + every 4 hours.
   Updates are downloaded silently and installed on quit. */
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');

let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (_) { /* optional in dev */ }

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0a0a0a',
    title: 'DJ MAX — Ultimate AI DJ Console',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'public', 'icon.svg'),
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
          label: 'About DJ MAX',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About DJ MAX',
              message: 'DJ MAX — Ultimate AI DJ Console',
              detail: `Version: ${app.getVersion()}\nAuto-updates enabled from GitHub Releases.`,
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

  const htmlPath = path.join(__dirname, '..', 'public', 'pioneer-dj-pro-max-v2.html');
  mainWindow.loadFile(htmlPath);
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
