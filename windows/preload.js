const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// Expose secure API bridge to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  reloadGame: () => ipcRenderer.send('reload-game'),
  checkForUpdates: () => ipcRenderer.send('check-for-updates-manual'),
  exitApp: () => ipcRenderer.send('exit-app'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  isDesktop: true
});

window.addEventListener('DOMContentLoaded', () => {
  // 1. Inject Core CSS
  try {
    const cssPath = path.join(__dirname, 'core', 'pokebonk-theme.css');
    if (fs.existsSync(cssPath)) {
      const cssContent = fs.readFileSync(cssPath, 'utf8');
      const style = document.createElement('style');
      style.id = 'pb-desktop-core-theme';
      style.textContent = cssContent;
      document.head.appendChild(style);
    }
  } catch (err) {
    console.error('Failed to inject core theme:', err);
  }

  // 2. Inject Core Engine Script
  try {
    const jsPath = path.join(__dirname, 'core', 'pokebonk-core.js');
    if (fs.existsSync(jsPath)) {
      const jsContent = fs.readFileSync(jsPath, 'utf8');
      const script = document.createElement('script');
      script.id = 'pb-desktop-core-engine';
      script.textContent = jsContent;
      document.head.appendChild(script);
    }
  } catch (err) {
    console.error('Failed to inject core engine:', err);
  }

  // 3. Desktop Hotkeys
  window.addEventListener('keydown', (e) => {
    // F11 or Alt+Enter: Toggle Fullscreen
    if (e.key === 'F11' || (e.altKey && e.key === 'Enter')) {
      e.preventDefault();
      ipcRenderer.send('toggle-fullscreen');
      return;
    }

    // F8: Cycle Sensitivity (50% – 200%)
    if (e.key === 'F8') {
      e.preventDefault();
      const current = parseFloat(localStorage.getItem('pb_stick_sensitivity') || '1.0');
      const next = current >= 2.0 ? 0.5 : Math.round((current + 0.25) * 100) / 100;
      localStorage.setItem('pb_stick_sensitivity', String(next));
      window.dispatchEvent(new Event('storage'));
      return;
    }

    // F9: Swap Layout (Xbox <-> Switch)
    if (e.key === 'F9') {
      e.preventDefault();
      const next = localStorage.getItem('pb_swap_abxy') !== 'true';
      localStorage.setItem('pb_swap_abxy', String(next));
      window.dispatchEvent(new Event('storage'));
      return;
    }
  });

  // 4. Controller Combo: Hold Start + Select for 1.5s to exit
  let comboStartTime = null;
  setInterval(() => {
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = pads[0];
      if (pad && pad.buttons) {
        // Standard mapping: 8 = Back/Select, 9 = Start
        const backPressed = pad.buttons[8] && pad.buttons[8].pressed;
        const startPressed = pad.buttons[9] && pad.buttons[9].pressed;

        if (backPressed && startPressed) {
          if (!comboStartTime) {
            comboStartTime = Date.now();
          } else if (Date.now() - comboStartTime > 1500) {
            ipcRenderer.send('exit-app');
          }
        } else {
          comboStartTime = null;
        }
      }
    } catch (_) {}
  }, 200);
});
