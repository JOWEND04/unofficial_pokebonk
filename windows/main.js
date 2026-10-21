const { app, BrowserWindow, session, powerSaveBlocker, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const RPC = require('discord-rpc');
const { autoUpdater } = require('electron-updater');

// Ensure app-update.yml exists in resources so electron-updater never throws ENOENT in portable builds
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
  } catch (err) {
    console.warn('Unable to write fallback app-update.yml to resources:', err.message);
  }
}

try {
  const appPathConfig = path.join(app.getAppPath(), 'app-update.yml');
  if (!fs.existsSync(appPathConfig)) {
    fs.writeFileSync(appPathConfig, updateConfigContent, 'utf8');
  }
} catch (_) {}

app.setPath('userData', path.join(app.getPath('appData'), 'PokeBonk'));

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

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
app.commandLine.appendSwitch('enable-quic');
app.commandLine.appendSwitch('enable-tcp-fast-open');

let launcherWindow = null;
let mainWindow = null;
let sleepBlockerId = null;
let updateQueued = false;

// --- Discord Rich Presence Subsystem ---
let rpcClient = null;
let rpcConnected = false;
let rpcReconnectTimer = null;
let currentActivity = null;
let runStartTime = null;

const DEFAULT_DISCORD_CLIENT_ID = '1232165629046292551';
const rpcConfigFile = path.join(app.getPath('userData'), 'discord-rpc.json');

function getDiscordClientId() {
  if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_ID.trim()) {
    return process.env.DISCORD_CLIENT_ID.trim();
  }
  try {
    if (fs.existsSync(rpcConfigFile)) {
      const data = JSON.parse(fs.readFileSync(rpcConfigFile, 'utf8'));
      if (data.clientId && data.clientId.trim()) {
        return data.clientId.trim();
      }
    }
  } catch (_) {}
  return DEFAULT_DISCORD_CLIENT_ID;
}

function setDiscordClientId(id) {
  try {
    fs.writeFileSync(rpcConfigFile, JSON.stringify({ clientId: (id || '').trim() }, null, 2), 'utf8');
    restartDiscordRPC();
    return true;
  } catch (e) {
    console.error('Failed to save Discord Client ID:', e);
    return false;
  }
}

function restartDiscordRPC() {
  if (rpcClient) {
    try { rpcClient.destroy(); } catch (_) {}
    rpcClient = null;
  }
  rpcConnected = false;
  initDiscordRPC();
}

function applyDiscordActivity(data) {
  currentActivity = data;
  if (!rpcConnected || !rpcClient) return;

  const activity = {
    details: data.details || 'Playing PokéBonk',
    state: data.state || 'In a Run',
    instance: true
  };

  if (data.inRun && data.startTimestamp) {
    activity.startTimestamp = data.startTimestamp;
  }

  activity.largeImageKey = 'logo2';
  activity.largeImageText = 'PokéBonk';

  rpcClient.setActivity(activity).catch(() => {
    delete activity.largeImageKey;
    delete activity.largeImageText;
    rpcClient.setActivity(activity).catch(() => {});
  });
}

function initDiscordRPC() {
  clearTimeout(rpcReconnectTimer);
  const clientId = getDiscordClientId();

  if (rpcConnected && rpcClient) return;

  try {
    try {
      RPC.register(clientId);
    } catch (_) {}

    if (rpcClient) {
      try { rpcClient.destroy(); } catch (_) {}
      rpcClient = null;
    }

    rpcClient = new RPC.Client({ transport: 'ipc' });

    rpcClient.on('ready', () => {
      rpcConnected = true;
      if (currentActivity) {
        applyDiscordActivity(currentActivity);
      } else {
        applyDiscordActivity({
          details: 'Title Screen / Main Menu',
          state: 'Choosing Pokémon & Settings',
          inRun: false
        });
      }
    });

    rpcClient.on('error', () => {
      rpcConnected = false;
    });

    if (rpcClient.transport) {
      rpcClient.transport.on('close', () => {
        rpcConnected = false;
        clearTimeout(rpcReconnectTimer);
        rpcReconnectTimer = setTimeout(() => {
          initDiscordRPC();
        }, 15000);
      });
    }

    rpcClient.login({ clientId }).catch(() => {
      rpcConnected = false;
      clearTimeout(rpcReconnectTimer);
      rpcReconnectTimer = setTimeout(() => {
        initDiscordRPC();
      }, 15000);
    });

  } catch (_) {
    rpcConnected = false;
    rpcReconnectTimer = setTimeout(() => {
      initDiscordRPC();
    }, 15000);
  }
}

ipcMain.on('update-rpc', (event, data) => {
  if (data.inRun) {
    if (!runStartTime || data.resetTimer) {
      runStartTime = Date.now();
    }
  } else {
    runStartTime = null;
  }

  applyDiscordActivity({
    details: data.details,
    state: data.state,
    inRun: Boolean(data.inRun),
    startTimestamp: runStartTime
  });
});

ipcMain.handle('get-discord-client-id', () => {
  return getDiscordClientId();
});

ipcMain.handle('set-discord-client-id', (event, id) => {
  return setDiscordClientId(id);
});

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
  repo: 'unofficial_pokebonk_app',
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
  const msg = error && error.message ? error.message : '';
  if (msg.includes('latest.yml') || msg.includes('404') || msg.includes('app-update.yml') || msg.includes('ENOENT')) {
    sendLauncherStatus('up-to-date', { message: 'You are on the latest version.' });
  } else {
    sendLauncherStatus('error', {
      message: 'Unable to check for updates right now.'
    });
  }
});

let downloadedUpdateFile = null;

function applyUpdateAndRestart(relaunch = true) {
  const targetExe = process.env.PORTABLE_EXECUTABLE_FILE || (app.isPackaged ? process.execPath : null);

  // If downloadedUpdateFile is not cached yet, look in pending directory
  if (!downloadedUpdateFile || !fs.existsSync(downloadedUpdateFile)) {
    try {
      const pendingDir = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'pokebonk-updater', 'pending');
      if (fs.existsSync(pendingDir)) {
        const files = fs.readdirSync(pendingDir)
          .filter(f => f.toLowerCase().endsWith('.exe'))
          .map(f => path.join(pendingDir, f));
        if (files.length > 0) {
          files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
          downloadedUpdateFile = files[0];
        }
      }
    } catch (_) {}
  }

  // If running portable or installed on Windows, overwrite the target executable in-place
  if (targetExe && downloadedUpdateFile && fs.existsSync(downloadedUpdateFile)) {
    const tempBat = path.join(app.getPath('temp'), `pokebonk_updater_${Date.now()}.bat`);
    const launchCommand = relaunch ? `start "" "${targetExe}"` : '';

    const batContent = [
      '@echo off',
      'setlocal',
      `set "NEW_EXE=${downloadedUpdateFile}"`,
      `set "TARGET_EXE=${targetExe}"`,
      `set "PID=${process.pid}"`,
      '',
      ':wait_loop',
      'timeout /t 1 /nobreak >nul',
      'tasklist /fi "PID eq %PID%" 2>nul | find "%PID%" >nul',
      'if not errorlevel 1 goto wait_loop',
      '',
      'set RETRIES=0',
      ':copy_loop',
      'copy /Y "%NEW_EXE%" "%TARGET_EXE%" >nul 2>&1',
      'if not errorlevel 1 goto success',
      'set /a RETRIES+=1',
      'if %RETRIES% geq 10 goto finish',
      'timeout /t 1 /nobreak >nul',
      'goto copy_loop',
      '',
      ':success',
      launchCommand,
      '',
      ':finish',
      '(goto) 2>nul & del "%~f0"'
    ].join('\r\n');

    try {
      fs.writeFileSync(tempBat, batContent, 'ascii');
      const child = spawn('cmd.exe', ['/c', tempBat], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();
      app.exit(0);
      return;
    } catch (e) {
      console.error('Failed to spawn portable replacement batch script:', e);
    }
  }

  // Fallback to electron-updater default
  try {
    autoUpdater.quitAndInstall(false, true);
  } catch (e) {
    app.relaunch();
    app.exit(0);
  }
}

autoUpdater.on('update-downloaded', (info) => {
  if (info && info.downloadedFile) {
    downloadedUpdateFile = info.downloadedFile;
  } else if (autoUpdater.downloadedUpdateHelper && autoUpdater.downloadedUpdateHelper.file) {
    downloadedUpdateFile = autoUpdater.downloadedUpdateHelper.file;
  }

  sendLauncherStatus('ready', { message: 'Update downloaded. Restart to install it.' });

  if (updateQueued) {
    dialog.showMessageBox(launcherWindow || mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: 'A new version of PokéBonk has been downloaded. Restart now to update?',
      buttons: ['Restart', 'Later']
    }).then((result) => {
      if (result.response === 0) {
        applyUpdateAndRestart(true);
      }
    }).catch(() => {});
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
      spellcheck: false,
      devTools: false,
      enableWebSQL: false,
      v8CacheOptions: 'bypassHeatCheckAndEagerCompile'
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
    const isInternal = ['pokebonk.com', 'solais.cloud'].some(domain => url.toLowerCase().includes(domain));
    if (isInternal) {
      return { action: 'allow' };
    }
    // Open external links (Discord, Twitter, Google, etc.) in user's default browser
    shell.openExternal(url).catch(() => {});
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
    backgroundColor: '#0e0a20',
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
    sendLauncherStatus('checking', { message: 'Checking for updates…' });
    const result = await autoUpdater.checkForUpdates();
    if (!result || !result.updateInfo || result.updateInfo.version === app.getVersion()) {
      sendLauncherStatus('up-to-date', { message: 'You are on the latest version.' });
    }
  } catch (error) {
    const msg = error && error.message ? error.message : '';
    if (msg.includes('already started') || msg.includes('downloading')) {
      return;
    }
    if (msg.includes('latest.yml') || msg.includes('404') || msg.includes('app-update.yml') || msg.includes('ENOENT')) {
      sendLauncherStatus('up-to-date', { message: 'You are on the latest version.' });
    } else {
      sendLauncherStatus('error', {
        message: 'Unable to check for updates right now.'
      });
    }
  }
});

ipcMain.on('install-update', () => {
  applyUpdateAndRestart(true);
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
  } else if (launcherWindow) {
    if (launcherWindow.isMinimized()) launcherWindow.restore();
    launcherWindow.focus();
  }
});

app.whenReady().then(() => {
  try {
    session.defaultSession.setSpellCheckerEnabled(false);
  } catch (_) {}
  createLauncherWindow();
});

app.on('window-all-closed', () => {
  if (sleepBlockerId !== null && powerSaveBlocker.isStarted(sleepBlockerId)) {
    powerSaveBlocker.stop(sleepBlockerId);
  }
  if (rpcClient) {
    try { rpcClient.destroy(); } catch (_) {}
    rpcClient = null;
  }

  // If a new update was downloaded while the app was running and the user closed it,
  // overwrite the portable executable in-place so the next launch uses the new build!
  if (downloadedUpdateFile && (process.env.PORTABLE_EXECUTABLE_FILE || app.isPackaged)) {
    applyUpdateAndRestart(false);
    return;
  }

  session.defaultSession.cookies.flushStore().finally(() => {
    app.exit(0);
  });
});
