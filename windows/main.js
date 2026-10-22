const { app, BrowserWindow, session, powerSaveBlocker, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
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

// Cleanup any leftover .old binary from a prior update on startup
try {
  const targetExe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const oldExe = targetExe + '.old';
  if (fs.existsSync(oldExe)) {
    fs.unlinkSync(oldExe);
  }
} catch (_) {}

// Semantic version comparison
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

// Redirect-following text fetcher
function fetchText(url) {
  return new Promise((resolve, reject) => {
    function getUrl(curUrl, redirects = 0) {
      if (redirects > 6) return reject(new Error('Too many redirects'));
      let parsed;
      try {
        parsed = new URL(curUrl);
      } catch (e) {
        return reject(e);
      }
      const client = parsed.protocol === 'http:' ? http : https;
      const req = client.get(curUrl, {
        headers: {
          'User-Agent': 'PokeBonk-Windows/' + app.getVersion(),
          'Accept': '*/*'
        },
        timeout: 8000
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, curUrl).href;
          res.resume();
          return getUrl(next, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Server returned HTTP ${res.statusCode}`));
        }
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(body));
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timed out'));
      });
    }
    getUrl(url, 0);
  });
}

// Redirect-following file downloader without opening write streams until 200 OK
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    function requestUrl(currentUrl, redirectCount = 0) {
      if (redirectCount > 8) {
        return reject(new Error('Too many redirects'));
      }
      let parsed;
      try {
        parsed = new URL(currentUrl);
      } catch (e) {
        return reject(e);
      }
      const client = parsed.protocol === 'http:' ? http : https;

      const req = client.get(currentUrl, {
        headers: {
          'User-Agent': 'PokeBonk-Windows/' + app.getVersion(),
          'Accept': '*/*'
        },
        timeout: 60000
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, currentUrl).href;
          res.resume();
          return requestUrl(nextUrl, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Server returned HTTP ${res.statusCode}`));
        }

        // Open destination file stream ONLY once final 200 OK is reached
        const file = fs.createWriteStream(destPath);

        res.pipe(file);

        res.on('error', (err) => {
          file.close(() => {
            try { fs.unlinkSync(destPath); } catch (_) {}
            reject(err);
          });
        });

        file.on('finish', () => {
          file.close((err) => {
            if (err) reject(err);
            else resolve(destPath);
          });
        });

        file.on('error', (err) => {
          file.close(() => {
            try { fs.unlinkSync(destPath); } catch (_) {}
            reject(err);
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Download timed out'));
      });
    }

    requestUrl(url, 0);
  });
}

// Robust Windows In-Place Portable Updater
async function checkWindowsUpdates(manual = false) {
  if (isUpdating) return;
  try {
    const currentVersion = app.getVersion();
    let remoteVersion = null;
    let downloadUrl = 'https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest/download/PokeBonk.exe';

    // 1. Check latest.yml directly (authoritative Windows manifest, NO API rate limits)
    try {
      const ymlText = await fetchText('https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest/download/latest.yml');
      const match = ymlText.match(/version:\s*['"v]?([0-9a-zA-Z.-]+)/i);
      if (match && match[1]) {
        remoteVersion = match[1].replace(/['"]/g, '').trim();
      }
    } catch (_) {}

    // 2. Check version.json ONLY if windows specific version is present (avoid Android version collision)
    if (!remoteVersion) {
      try {
        const vText = await fetchText('https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest/download/version.json');
        const vJson = JSON.parse(vText);
        if (vJson.windows) {
          remoteVersion = vJson.windows.version || vJson.windows.versionName || null;
        }
      } catch (_) {}
    }

    // 3. Fallback to GitHub Releases API
    if (!remoteVersion) {
      try {
        const rText = await fetchText('https://api.github.com/repos/JOWEND04/unofficial_pokebonk_app/releases/latest');
        const release = JSON.parse(rText);
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
      const launcherPath = findLauncher();
      const buttons = launcherPath
        ? ['Update via Launcher (Recommended)', 'Update Directly', 'View on GitHub', 'Later']
        : ['Get Launcher (Recommended)', 'Update Directly', 'View on GitHub', 'Later'];

      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'PokéBonk Update Available',
        message: `PokéBonk v${remoteVersion} is now available!\n\nInstalled: v${currentVersion}\nLatest: v${remoteVersion}`,
        detail: launcherPath
          ? 'Use the PokéBonk Launcher for an instant, seamless background update without file conflicts.'
          : 'The PokéBonk Launcher provides instant one-click updating with a download progress bar and zero lock errors.',
        buttons: buttons,
        defaultId: 0,
        cancelId: 3
      });

      if (response === 2) {
        shell.openExternal('https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest');
        return;
      }

      if (response === 0) {
        if (launcherPath) {
          try {
            const child = spawn(launcherPath, [], { detached: true, stdio: 'ignore' });
            child.unref();
            app.quit();
            return;
          } catch (_) {}
        }

        // Download launcher to %LOCALAPPDATA%\PokeBonk\PokeBonk-Launcher.exe
        const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('appData'), '..', 'Local');
        const launcherDir = path.join(localAppData, 'PokeBonk');
        try { if (!fs.existsSync(launcherDir)) fs.mkdirSync(launcherDir, { recursive: true }); } catch (_) {}
        const targetLauncher = path.join(launcherDir, 'PokeBonk-Launcher.exe');
        const launcherUrl = 'https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest/download/PokeBonk-Launcher.exe';

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript(`
            if (window.PokeBonkNative && window.PokeBonkNative.showToast) {
              window.PokeBonkNative.showToast('Opening PokéBonk Launcher…');
            }
          `).catch(() => {});
        }

        try {
          await downloadFile(launcherUrl, targetLauncher);
          const child = spawn(targetLauncher, [], { detached: true, stdio: 'ignore' });
          child.unref();
          app.quit();
          return;
        } catch (_) {
          // If downloading launcher failed, fall through to in-place updater
        }
      }

      // Direct in-place updater (either response === 1 or fallback from response === 0)
      if (response === 1 || response === 0) {
        isUpdating = true;
        const tempExe = path.join(app.getPath('temp'), `PokeBonk_Update_v${remoteVersion}.exe`);

        // Clean up any stale temp file first
        try { if (fs.existsSync(tempExe)) fs.unlinkSync(tempExe); } catch (_) {}

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

// In-place binary replacer using PowerShell runner to wait for PID and safely swap
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
  const ps1Path = path.join(app.getPath('temp'), `pokebonk_updater_${Date.now()}.ps1`);

  const psScript = `
param(
    [string]$TargetExe,
    [string]$NewExe,
    [int]$ParentPid
)

try {
    Wait-Process -Id $ParentPid -Timeout 15 -ErrorAction SilentlyContinue
} catch {}
Start-Sleep -Milliseconds 600

# Ensure lingering wrapper processes release lock
for ($p = 0; $p -lt 6; $p++) {
    $running = Get-Process -Name "PokeBonk" -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID }
    if ($running) {
        Start-Sleep -Milliseconds 500
    } else {
        break
    }
}

$applied = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        if (Test-Path -LiteralPath $TargetExe) {
            $oldBackup = "$TargetExe.old"
            if (Test-Path -LiteralPath $oldBackup) {
                Remove-Item -LiteralPath $oldBackup -Force -ErrorAction SilentlyContinue
            }
            try {
                Rename-Item -LiteralPath $TargetExe -NewName "$([System.IO.Path]::GetFileName($TargetExe)).old" -Force -ErrorAction SilentlyContinue
            } catch {}
        }

        Copy-Item -LiteralPath $NewExe -Destination $TargetExe -Force -ErrorAction Stop
        $applied = $true
        break
    } catch {
        Start-Sleep -Milliseconds 600
    }
}

try { Remove-Item -LiteralPath $NewExe -Force -ErrorAction SilentlyContinue } catch {}
try {
    $oldBackup = "$TargetExe.old"
    if (Test-Path -LiteralPath $oldBackup) {
        Remove-Item -LiteralPath $oldBackup -Force -ErrorAction SilentlyContinue
    }
} catch {}

if (Test-Path -LiteralPath $TargetExe) {
    $targetDir = [System.IO.Path]::GetDirectoryName($TargetExe)
    Start-Process -FilePath $TargetExe -WorkingDirectory $targetDir
}

try { Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue } catch {}
`;

  try {
    fs.writeFileSync(ps1Path, psScript, 'utf8');

    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-File', ps1Path,
      '-TargetExe', targetExe,
      '-NewExe', newExePath,
      '-ParentPid', String(process.pid)
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();

    app.exit(0);
  } catch (_) {
    app.exit(0);
  }
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

  // Trigger silent background update check after 4 seconds
  setTimeout(() => {
    checkWindowsUpdates(false);
  }, 4000);
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
