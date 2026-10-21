const { app, BrowserWindow, session, powerSaveBlocker, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// Ensure app-update.yml exists in portable resources
const updateConfigContent = [
  'owner: JOWEND04',
  'repo: unofficial_pokebonk_app',
  'provider: github',
  'updaterCacheDirName: pokebonk-updater'
].join('\n');

if (process.resourcesPath) {
  try {
    if (!fs.existsSync(process.resourcesPath)) {
      fs.mkdirSync(process.resourcesPath, { recursive: true });
    }
    const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
    if (!fs.existsSync(updateConfigPath)) {
      fs.writeFileSync(updateConfigPath, updateConfigContent, 'utf8');
    }
  } catch (_) {}
}

app.setPath('userData', path.join(app.getPath('appData'), 'PokeBonk'));

// Single instance enforcement
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// Hardware & GPU acceleration switches
app.commandLine.appendSwitch('enable-features', 'WindowsGamingInput,GamepadButtonAxisEvents,EnableNintendoSwitchProController,CanvasOopRasterization');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
app.commandLine.appendSwitch('use-angle', 'd3d11');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-highres-timer');

let mainWindow = null;
let sleepBlockerId = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    show: false,
    backgroundColor: '#0e0a20',
    autoHideMenuBar: true,
    title: 'PokéBonk',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (!sleepBlockerId) {
      sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.includes('pokebonk.com') && !url.includes('solais.cloud')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.includes('pokebonk.com') && !url.includes('solais.cloud')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL('https://pokebonk.com');

  // Trigger silent background update check
  setTimeout(() => {
    checkForUpdatesSilent();
  }, 4000);
}

// Background Auto-Updater
function checkForUpdatesSilent() {
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.checkForUpdates().catch(() => {});
  } catch (_) {}
}

autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `PokéBonk v${info.version} has been downloaded. Restart now to apply?`,
      buttons: ['Restart & Update', 'Later']
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  }
});

// IPC handlers
ipcMain.on('toggle-fullscreen', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

ipcMain.on('reload-game', () => {
  if (mainWindow) {
    mainWindow.webContents.reloadIgnoringCache();
  }
});

ipcMain.on('check-for-updates-manual', () => {
  autoUpdater.checkForUpdates().then((result) => {
    if (!result || !result.updateInfo) {
      if (mainWindow) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Up to Date',
          message: 'You are running the latest version of PokéBonk.'
        });
      }
    }
  }).catch((err) => {
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Update Check',
        message: 'Could not connect to update server: ' + (err.message || 'Unknown error')
      });
    }
  });
});

ipcMain.on('exit-app', () => {
  app.quit();
});

app.whenReady().then(() => {
  try {
    session.defaultSession.setSpellCheckerEnabled(false);
  } catch (_) {}
  createMainWindow();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (sleepBlockerId !== null && powerSaveBlocker.isStarted(sleepBlockerId)) {
    powerSaveBlocker.stop(sleepBlockerId);
  }
  session.defaultSession.cookies.flushStore().finally(() => {
    app.exit(0);
  });
});
