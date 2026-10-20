const { app, BrowserWindow, session, powerSaveBlocker, ipcMain } = require('electron');
const path = require('path');
const RPC = require('discord-rpc');

app.setPath('userData', path.join(app.getPath('appData'), 'PokeBonk'));

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}

// Performance & GPU acceleration flags
app.commandLine.appendSwitch('enable-features', 'WindowsGamingInput,GamepadButtonAxisEvents,EnableNintendoSwitchProController');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('high-dpi-support', '1');

let mainWindow = null;
let sleepBlockerId = null;

// Discord RPC (Non-blocking lazy initialization)
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

        rpc.login({ clientId: DISCORD_CLIENT_ID }).catch(() => {
            rpcConnected = false;
        });
    }, 2500); // Wait 2.5s after launch so startup is instant
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
        show: false, // Hide until fully ready to eliminate visual map-scaling flash
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
            backgroundThrottling: false,
            spellcheck: false
        }
    });

    mainWindow.setMenuBarVisibility(false);

    // Show window smoothly only when content finishes painting its correct viewport size
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
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

ipcMain.on('quit-app', () => {
    app.exit(0); // Hard exit ensures zero lingering processes
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
