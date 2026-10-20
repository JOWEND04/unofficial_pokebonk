const { app, BrowserWindow, session, powerSaveBlocker, ipcMain } = require('electron');
const path = require('path');
const RPC = require('discord-rpc');

app.setPath('userData', path.join(app.getPath('appData'), 'PokeBonk'));

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}

app.commandLine.appendSwitch(
    'enable-features',
    'WindowsGamingInput,GamepadButtonAxisEvents,EnableNintendoSwitchProController'
);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('high-dpi-support', '1');

let mainWindow = null;
let sleepBlockerId = null;

// --- Discord Rich Presence Integration ---
const DISCORD_CLIENT_ID = '123456789012345678'; // Replace with your Discord Developer Portal App ID if desired
const rpc = new RPC.Client({ transport: 'ipc' });
let rpcConnected = false;

function setupDiscordRPC() {
    rpc.on('ready', () => {
        rpcConnected = true;
        updateDiscordPresence({ details: 'In Menu / Title Screen', state: 'Choosing Pokémon' });
    });

    rpc.login({ clientId: DISCORD_CLIENT_ID }).catch(() => {
        rpcConnected = false; // Gracefully fails if Discord desktop app isn't running
    });
}

function updateDiscordPresence(activityData) {
    if (!rpcConnected || !mainWindow) return;
    try {
        rpc.setActivity({
            details: activityData.details || 'Playing PokéBonk',
            state: activityData.state || 'In a Run',
            largeImageKey: 'pokebonk_icon', // Make sure to upload an asset with this key in your Discord App dashboard, or fallback will use app name
            largeImageText: 'PokéBonk',
            startTimestamp: activityData.resetTimer ? Date.now() : undefined,
            instance: false
        }).catch(() => {});
    } catch (e) {
        rpcConnected = false;
    }
}

ipcMain.on('update-rpc', (event, data) => {
    updateDiscordPresence(data);
});
// ----------------------------------------

function createWindow() {
    sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');

    mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        fullscreen: true,
        frame: false, // Frameless for immersive clean look, custom close button added in preload
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
                if (isFull) {
                    mainWindow.setSize(1280, 720);
                    mainWindow.center();
                }
                event.preventDefault();
            } else if (input.key === 'F5') {
                mainWindow.reload();
                event.preventDefault();
            } else if (input.alt && input.key === 'F4') {
                app.quit();
            }
        }
    });

    mainWindow.loadURL('https://pokebonk.com');
    setupDiscordRPC();
}

ipcMain.on('quit-app', () => {
    app.quit();
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
        app.quit();
    });
});
