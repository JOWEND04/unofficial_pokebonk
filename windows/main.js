const { app, BrowserWindow, session, powerSaveBlocker, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Single instance enforcement
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.setPath('userData', path.join(app.getPath('appData'), 'PokeBonk'));

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

function findLauncher() {
  const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('appData'), '..', 'Local');
  const candidates = [
    path.join(localAppData, 'PokeBonk', 'PokeBonk-Launcher.exe'),
    path.join(path.dirname(process.execPath), 'PokeBonk-Launcher.exe'),
    path.join(path.dirname(process.env.PORTABLE_EXECUTABLE_FILE || process.execPath), 'PokeBonk-Launcher.exe'),
    path.join(app.getPath('desktop'), 'PokeBonk-Launcher.exe'),
    path.join(app.getPath('downloads'), 'PokeBonk-Launcher.exe')
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (_) {}
  }
  return null;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    show: false,
    backgroundColor: '#1a1630',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1630',
      symbolColor: '#ffffff',
      height: 36
    },
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

  // Safety fallback: guarantee window is displayed even if network or dom-ready is delayed
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 1200);

  // Inject Core Styles and Script on dom-ready to guarantee 100% presence
  mainWindow.webContents.on('dom-ready', () => {
    try {
      const cssPath = path.join(__dirname, 'core', 'pokebonk-theme.css');
      if (fs.existsSync(cssPath)) {
        const css = fs.readFileSync(cssPath, 'utf8');
        mainWindow.webContents.insertCSS(css).catch(() => {});
      }
    } catch (_) {}

    try {
      const jsPath = path.join(__dirname, 'core', 'pokebonk-core.js');
      if (fs.existsSync(jsPath)) {
        const js = fs.readFileSync(jsPath, 'utf8');
        mainWindow.webContents.executeJavaScript(js).catch(() => {});
      }
    } catch (_) {}
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

  mainWindow.on('enter-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fullscreen-change', true);
    }
  });

  mainWindow.on('leave-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fullscreen-change', false);
    }
  });

  mainWindow.on('maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('maximize-change', true);
    }
  });

  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('maximize-change', false);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL('https://pokebonk.com');
}

// IPC Handlers
ipcMain.on('window-minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

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
  const launcherPath = findLauncher();
  if (launcherPath) {
    try {
      const child = spawn(launcherPath, [], { detached: true, stdio: 'ignore' });
      child.unref();
      app.quit();
      return;
    } catch (_) {}
  }
  shell.openExternal('https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest');
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
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
