const { app, BrowserWindow, session, powerSaveBlocker, ipcMain, dialog } = require('electron');
const path = require('path');
const RPC = require('discord-rpc');
const { autoUpdater } = require('electron-updater');

app.setPath('userData', path.join(app.getPath('appData'), 'PokeBonk'));

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.commandLine.appendSwitch('enable-features', 'WindowsGamingInput,GamepadButtonAxisEvents,EnableNintendoSwitchProController');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let launcherWindow = null;
let mainWindow = null;
let sleepBlockerId = null;
let updateQueued = false;

const DISCORD_CLIENT_ID = '123456789012345678';
const rpc = new RPC.Client({ transport: 'ipc' });
let rpcConnected = false;

function sendLauncherStatus(status, payload = {}) {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.webContents.send('launcher-status', { status, ...payload });
  }
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'JOWEND04',
  repo: 'unofficial_pokebonk',
  private: false,
  releaseType: 'release'
});

autoUpdater.on('checking-for-update', () => {
  sendLauncherStatus('checking', { message: 'Checking for updates…' });
});

autoUpdater.on('update-available', (info) => {
  sendLauncherStatus('update-available', {
    version: info && info.version ? info.version : 'Unknown',
    message: 'An update is available.'
  });
});

autoUpdater.on('update-not-available', () => {
  sendLauncherStatus('up-to-date', { message: 'You are on the latest version.' });
});

autoUpdater.on('download-progress', (progress) => {
  sendLauncherStatus('downloading', {
    percent: Math.round(progress.percent || 0),
    message: 'Downloading update…'
  });
});

autoUpdater.on('error', (error) => {
  sendLauncherStatus('error', {
    message: error && error.message ? error.message : 'Unable to check for updates right now.'
  });
});

autoUpdater.on('update-downloaded', () => {
  sendLauncherStatus('ready', { message: 'Update downloaded. Restart to install it.' });

  if (updateQueued) {
    dialog.showMessageBox(launcherWindow || mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: 'A new version of PokéBonk has been downloaded. Restart now to update?',
      buttons: ['Restart', 'Later']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    }).catch(() => {});
  }
});

function initDiscordRPC() {
  setTimeout(() => {
    rpc.on('ready', () => {
      rpcConnected = true;
      rpc.setActivity({
        details: 'In Menu / Title Screen',
        state: 'Choosing Pokémon',
        largeImageKey: 'pokebonk_icon',
        largeImageText: 'PokéBonk',
        instance: false
      }).catch(() => {});
    });
    rpc.login({ clientId: DISCORD_CLIENT_ID }).catch(() => { rpcConnected = false; });
  }, 2500);
}

ipcMain.on('update-rpc', (event, data) => {
  if (!rpcConnected) return;
  try {
    rpc.setActivity({
      details: data.details || 'Playing PokéBonk',
      state: data.state || 'In a Run',
      largeImageKey: 'pokebonk_icon',
      largeImageText: 'PokéBonk',
      startTimestamp: data.resetTimer ? Date.now() : undefined,
      instance: false
    }).catch(() => {});
  } catch (e) {
    rpcConnected = false;
  }
});

function launchGameWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      launcherWindow.close();
    }
    return;
  }

  sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');

  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    useContentSize: true,
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'PokéBonk',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
      zoomFactor: 1.0,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      launcherWindow.close();
    }
    setTimeout(() => {
      if (app.isPackaged) {
        autoUpdater.checkForUpdates().catch(() => {});
      }
    }, 5000);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const allowed = ['pokebonk', 'solais.cloud', 'google', 'discord'];
    if (allowed.some(domain => url.toLowerCase().includes(domain))) {
      return { action: 'allow' };
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
        const isFull = mainWindow.isFullScreen();
        mainWindow.setFullScreen(!isFull);
        event.preventDefault();
      } else if (input.key === 'F5') {
        mainWindow.reload();
        event.preventDefault();
      } else if (input.alt && input.key === 'F4') {
        app.exit(0);
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL('https://pokebonk.com');
  initDiscordRPC();
}

function createLauncherWindow() {
  launcherWindow = new BrowserWindow({
    width: 520,
    height: 360,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    title: 'PokéBonk Launcher',
    backgroundColor: '#09111b',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  launcherWindow.setMenuBarVisibility(false);

  launcherWindow.once('ready-to-show', () => {
    launcherWindow.show();

    if (app.isPackaged) {
      sendLauncherStatus('checking', { message: 'Checking for updates…' });
      autoUpdater.checkForUpdates().catch(() => {});
    } else {
      sendLauncherStatus('up-to-date', { message: 'Development build — updater disabled.' });
    }
  });

  launcherWindow.on('closed', () => {
    launcherWindow = null;
    if (!mainWindow) {
      app.quit();
    }
  });

  launcherWindow.loadFile(path.join(__dirname, 'launcher.html'));
}

ipcMain.on('launch-game', () => {
  launchGameWindow();
});

ipcMain.on('update-game', async () => {
  if (!app.isPackaged) {
    sendLauncherStatus('error', { message: 'Updater is disabled in development mode.' });
    return;
  }

  updateQueued = true;

  try {
    const result = await autoUpdater.checkForUpdates();
    if (result && result.updateInfo && result.updateInfo.version) {
      sendLauncherStatus('downloading', {
        version: result.updateInfo.version,
        message: 'Downloading update…'
      });
      await autoUpdater.downloadUpdate();
    } else {
      sendLauncherStatus('up-to-date', { message: 'You are already on the latest version.' });
    }
  } catch (error) {
    sendLauncherStatus('error', {
      message: error && error.message ? error.message : 'Unable to update right now.'
    });
  }
});

ipcMain.on('exit-launcher', () => {
  app.quit();
});

ipcMain.on('minimize-app', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('quit-app', () => {
  app.exit(0);
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(createLauncherWindow);

app.on('window-all-closed', () => {
  if (sleepBlockerId !== null && powerSaveBlocker.isStarted(sleepBlockerId)) {
    powerSaveBlocker.stop(sleepBlockerId);
  }
  if (rpcConnected) {
    rpc.destroy().catch(() => {});
  }
  session.defaultSession.cookies.flushStore().finally(() => {
    app.exit(0);
  });
});
