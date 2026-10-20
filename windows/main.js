const { app, BrowserWindow, session, powerSaveBlocker, ipcMain } = require('electron');
const path = require('path');

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

function createWindow() {
    sleepBlockerId = powerSaveBlocker.start('prevent-display-sleep');

    mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
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
    session.defaultSession.cookies.flushStore().finally(() => {
        app.quit();
    });
});
