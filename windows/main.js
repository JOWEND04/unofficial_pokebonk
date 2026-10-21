const { app, BrowserWindow, session, powerSaveBlocker, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
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
let isUpdating = false;

// Version comparison utility
function compareVersions(v1, v2) {
  const p1 = (v1 || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const p2 = (v2 || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const maxLen = Math.max(p1.length, p2.length);
  for (let i = 0; i < maxLen; i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

// HTTPS JSON Fetcher with redirect following
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'PokeBonk-Windows/' + app.getVersion(),
        'Accept': 'application/json'
      },
      timeout: 8000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Server returned HTTP ${res.statusCode}`));
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Connection timed out'));
    });
  });
}

// File Downloader with redirect following and progress
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const req = https.get(url, {
      headers: {
        'User-Agent': 'PokeBonk-Windows/' + app.getVersion()
      },
      timeout: 60000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(destPath); } catch (_) {}
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(destPath); } catch (_) {}
        return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
      }

      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(destPath));
      });
    });

    req.on('error', (err) => {
      file.close();
      try { fs.unlinkSync(destPath); } catch (_) {}
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      file.close();
      try { fs.unlinkSync(destPath); } catch (_) {}
      reject(new Error('Download timed out'));
    });
  });
}

// Robust Windows In-Place Portable Updater
async function checkWindowsUpdates(manual = false) {
  if (isUpdating) return;
  try {
    const currentVersion = app.getVersion();
    let remoteVersion = null;
    let downloadUrl = 'https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest/download/PokeBonk.exe';

    // 1. Try reading version.json directly first
    try {
      const vJson = await fetchJson('https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest/download/version.json');
      if (vJson.windows && vJson.windows.version) {
        remoteVersion = vJson.windows.version;
      } else if (vJson.versionName) {
        remoteVersion = vJson.versionName;
      }
    } catch (_) {}

    // 2. Fallback to GitHub Releases API
    if (!remoteVersion) {
      try {
        const release = await fetchJson('https://api.github.com/repos/JOWEND04/unofficial_pokebonk_app/releases/latest');
        const tag = (release.tag_name || '').replace(/^v/i, '').trim();
        if (tag && tag !== 'latest') {
          remoteVersion = tag;
        }
        if (Array.isArray(release.assets)) {
          const exeAsset = release.assets.find(a => (a.name || '').toLowerCase() === 'pokebonk.exe');
          if (exeAsset && exeAsset.browser_download_url) {
            downloadUrl = exeAsset.browser_download_url;
          }
        }
      } catch (_) {}
    }

    if (!remoteVersion) {
      if (manual && mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Update Check',
          message: 'Could not connect to update servers. Check your internet connection.',
          buttons: ['Open GitHub Releases', 'OK'],
          defaultId: 1
        }).then(({ response }) => {
          if (response === 0) {
            shell.openExternal('https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest');
          }
        });
      }
      return;
    }

    const hasUpdate = compareVersions(remoteVersion, currentVersion) > 0;

    if (!hasUpdate) {
      if (manual && mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'PokéBonk is Up to Date',
          message: `You are running the latest version of PokéBonk (v${currentVersion}).`
        });
      }
      return;
    }

    // Prompt user for update
    if (mainWindow && !mainWindow.isDestroyed()) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'PokéBonk Update Available',
        message: `PokéBonk v${remoteVersion} is now available!\n\nInstalled version: v${currentVersion}\nLatest version: v${remoteVersion}`,
        detail: 'Would you like to download and install this update now?',
        buttons: ['Download & Update', 'View on GitHub', 'Later'],
        defaultId: 0,
        cancelId: 2
      });

      if (response === 1) {
        shell.openExternal('https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest');
        return;
      }

      if (response === 0) {
        isUpdating = true;
        const tempExe = path.join(app.getPath('temp'), `PokeBonk_Update_v${remoteVersion}.exe`);
        
        // Show non-blocking download notification in UI
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript(`
            if (window.PokeBonkNative && window.PokeBonkNative.showToast) {
              window.PokeBonkNative.showToast('Downloading PokéBonk update (v${remoteVersion})…');
            }
          `).catch(() => {});
        }

        try {
          await downloadFile(downloadUrl, tempExe);
          isUpdating = false;

          if (mainWindow && !mainWindow.isDestroyed()) {
            const { response: applyChoice } = await dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Update Ready to Install',
              message: `PokéBonk v${remoteVersion} was downloaded successfully.`,
              detail: 'Restart PokéBonk now to finish installing?',
              buttons: ['Restart & Apply', 'Later'],
              defaultId: 0,
              cancelId: 1
            });

            if (applyChoice === 0) {
              applyUpdateAndRestart(tempExe);
            }
          }
        } catch (downloadErr) {
          isUpdating = false;
          if (mainWindow && !mainWindow.isDestroyed()) {
            dialog.showMessageBox(mainWindow, {
              type: 'error',
              title: 'Download Failed',
              message: `Failed to download update: ${downloadErr.message || 'Network error'}`,
              detail: 'Would you like to download the updated EXE directly from GitHub?',
              buttons: ['Open GitHub Releases', 'Cancel'],
              defaultId: 0
            }).then(({ response: errChoice }) => {
              if (errChoice === 0) {
                shell.openExternal('https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest');
              }
            });
          }
        }
      }
    }
  } catch (err) {
    isUpdating = false;
    if (manual && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Update Error',
        message: `An error occurred while checking for updates: ${err.message || 'Unknown error'}`
      });
    }
  }
}

// In-place binary replacer that works seamlessly for portable single-exe builds
function applyUpdateAndRestart(newExePath) {
  if (!app.isPackaged) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Development Mode',
        message: 'Running in development mode.',
        detail: `Updated binary downloaded to:\n${newExePath}\n\nBinary auto-swap is skipped in dev mode.`
      });
    }
    return;
  }

  const targetExe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const batPath = path.join(app.getPath('temp'), `pokebonk_updater_${Date.now()}.bat`);

  const batContent = [
    '@echo off',
    'chcp 65001 >nul',
    'timeout /t 1 /nobreak >nul',
    'set RETRIES=0',
    ':retry',
    `move /y "${newExePath}" "${targetExe}" >nul 2>&1`,
    'if errorlevel 1 (',
    '    set /a RETRIES+=1',
    '    if %RETRIES% geq 20 goto failed',
    '    timeout /t 1 /nobreak >nul',
    '    goto retry',
    ')',
    `start "" "${targetExe}"`,
    'del "%~f0"',
    'exit',
    ':failed',
    `start "" "${targetExe}"`,
    'del "%~f0"',
    'exit'
  ].join('\r\n');

  try {
    fs.writeFileSync(batPath, batContent, 'utf8');

    const child = spawn('cmd.exe', ['/c', batPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();

    app.quit();
  } catch (_) {
    app.quit();
  }
}

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

  // Trigger silent background update check after 4 seconds
  setTimeout(() => {
    checkWindowsUpdates(false);
  }, 4000);
}

// IPC Handlers
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
  checkWindowsUpdates(true);
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
