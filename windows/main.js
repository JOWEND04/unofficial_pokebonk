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

let mainWindow = null;
let sleepBlockerId = null;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: 'A new version of PokéBonk has been downloaded. Restart now to update?',
        buttons: ['Restart', 'Later']
    }).result.then((result) => {
        if (result.response === 0) {
            autoUpdater.quitAndInstall();
        }
    });
});

const DISCORD_CLIENT_ID = '123456789012345678';
const rpc = new RPC.Client({ transport: 'ipc' });
let rpcConnected = false;

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

function createWindow() {
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
        setTimeout(() => {
            autoUpdater.checkForUpdatesAndNotify().catch(() => {});
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

    mainWindow.loadURL('https://pokebonk.com');
    initDiscordRPC();
}

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

app.whenReady().then(createWindow);

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
