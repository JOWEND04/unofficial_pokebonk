/**
 * PokéBonk Unified Client Core Engine
 * Shared runtime for Android, Windows, and iOS native wrappers.
 */
(function () {
  'use strict';

  if (window.__pokebonkCoreInitialized) return;
  window.__pokebonkCoreInitialized = true;

  // --- Constants & Storage Keys ---
  const STORAGE_LAYOUT_KEY = 'pb_swap_abxy';
  const STORAGE_SENSITIVITY_KEY = 'pb_stick_sensitivity';
  let lastTogNavTime = 0;

  // --- Native Bridge Wrapper ---
  const NativeBridge = {
    platform: (function () {
      if (window.AndroidApp) return 'android';
      if (window.electronAPI) return 'windows';
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pokeBonkIOS) return 'ios';
      return 'web';
    })(),

    checkForUpdates: function () {
      if (window.AndroidApp && window.AndroidApp.checkForUpdatesManual) {
        window.AndroidApp.checkForUpdatesManual();
      } else if (window.electronAPI && window.electronAPI.checkForUpdates) {
        window.electronAPI.checkForUpdates();
      } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pokeBonkIOS) {
        window.webkit.messageHandlers.pokeBonkIOS.postMessage({ action: 'checkUpdate' });
      } else {
        window.open('https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest', '_blank');
      }
    },

    reloadGame: function () {
      if (window.AndroidApp && window.AndroidApp.reloadGame) {
        window.AndroidApp.reloadGame();
      } else if (window.electronAPI && window.electronAPI.reloadGame) {
        window.electronAPI.reloadGame();
      } else {
        location.reload();
      }
    }
  };

  window.PokeBonkNative = NativeBridge;

  // --- Audio Auto-Unlocker ---
  function unlockAudioContext() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!window.__pbAudioCtx) {
        window.__pbAudioCtx = new AudioCtx();
      }
      if (window.__pbAudioCtx.state === 'suspended') {
        window.__pbAudioCtx.resume();
      }
    } catch (_) {}
  }

  window.addEventListener('touchstart', unlockAudioContext, { passive: true, once: true });
  window.addEventListener('pointerdown', unlockAudioContext, { passive: true, once: true });
  window.addEventListener('gamepadconnected', unlockAudioContext, { passive: true, once: true });

  // --- Viewport & Touch Setup ---
  function lockViewport() {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.appendChild(meta);
    }
    meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', lockViewport);
  } else {
    lockViewport();
  }

  // --- Sensitivity & Layout Configuration ---
  function isLayoutSwapped() {
    return localStorage.getItem(STORAGE_LAYOUT_KEY) === 'true';
  }

  function setLayoutSwapped(val) {
    localStorage.setItem(STORAGE_LAYOUT_KEY, String(Boolean(val)));
    updateMenuVisuals();
    showToast(val ? 'Switch Layout: East = A, South = B' : 'Xbox Layout: South = A, East = B');
  }

  function getStickSensitivity() {
    const raw = parseFloat(localStorage.getItem(STORAGE_SENSITIVITY_KEY) || '1.0');
    return isNaN(raw) ? 1.0 : Math.max(0.2, Math.min(3.0, Math.round(raw * 20) / 20));
  }

  function setStickSensitivity(val) {
    const clamped = Math.max(0.2, Math.min(3.0, Math.round(val * 20) / 20));
    localStorage.setItem(STORAGE_SENSITIVITY_KEY, String(clamped));
    syncNativeSensitivityInputs(clamped);
    updateMenuVisuals();
    return clamped;
  }

  // --- Gamepad Processing ---
  function processAxis(val, sensitivity) {
    const deadzone = 0.08;
    if (Math.abs(val) < deadzone) return 0;
    const sign = Math.sign(val);
    const normalized = (Math.abs(val) - deadzone) / (1 - deadzone);
    const curved = Math.pow(normalized, 1.0 / Math.max(0.3, sensitivity));
    return sign * Math.min(1.0, Math.max(0.0, curved));
  }

  // Intercept navigator.getGamepads
  if (navigator.getGamepads) {
    const originalGetGamepads = navigator.getGamepads.bind(navigator);
    navigator.getGamepads = function () {
      const pads = originalGetGamepads();
      if (!pads) return pads;

      const sensitivity = getStickSensitivity();
      const swapped = isLayoutSwapped();
      const result = [];

      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (!pad) {
          result.push(null);
          continue;
        }

        // D-Pad Left / Right toggle support for active toggle switch row
        const isLeft = (pad.buttons && pad.buttons[14]?.pressed) || (pad.axes && pad.axes[0] < -0.65);
        const isRight = (pad.buttons && pad.buttons[15]?.pressed) || (pad.axes && pad.axes[0] > 0.65);
        if ((isLeft || isRight) && performance.now() - lastTogNavTime > 320) {
          const activeTog = document.querySelector('.st-row.pad-focus, .st-row.tog:focus');
          if (activeTog) {
            lastTogNavTime = performance.now();
            activeTog.click();
          }
        }

        const buttons = pad.buttons.map(b => ({
          pressed: !!(b && b.pressed),
          touched: !!(b && b.touched),
          value: Number((b && b.value) || 0)
        }));

        // Button Swap: Xbox vs Switch
        if (swapped && buttons.length >= 4) {
          const b0 = buttons[0];
          buttons[0] = buttons[1];
          buttons[1] = b0;

          const b2 = buttons[2];
          buttons[2] = buttons[3];
          buttons[3] = b2;
        }

        // Axes Sensitivity Curve
        const axes = pad.axes ? pad.axes.map(v => processAxis(v, sensitivity)) : [];

        // Smooth camera tilt amplifier for right stick
        if (i === 0 && axes.length >= 4 && (Math.abs(pad.axes[2] || 0) > 0.09 || Math.abs(pad.axes[3] || 0) > 0.09)) {
          const canvas = document.getElementById('game');
          if (canvas && Math.abs(sensitivity - 1.0) > 0.05) {
            const factor = (sensitivity - 1.0) * 14;
            canvas.dispatchEvent(new MouseEvent('mousemove', {
              movementX: (pad.axes[2] || 0) * factor,
              movementY: (pad.axes[3] || 0) * factor,
              bubbles: true
            }));
          }
        }

        result.push({
          id: pad.id,
          index: pad.index,
          connected: pad.connected,
          timestamp: pad.timestamp,
          mapping: 'standard',
          axes: axes,
          buttons: buttons,
          vibrationActuator: pad.vibrationActuator || null,
          hapticActuators: pad.hapticActuators || []
        });
      }

      return result;
    };
  }

  // --- In-Game Settings Sync ---
  function findNativeSensitivityInputs() {
    return Array.from(document.querySelectorAll('input.st-range')).filter(inp => {
      const row = inp.closest('.st-row');
      if (!row) return false;
      const text = (row.textContent || '').toLowerCase();
      return text.includes('sensib') || text.includes('sensit') || (parseFloat(inp.min) <= 0.3 && parseFloat(inp.max) >= 2.5);
    });
  }

  function syncNativeSensitivityInputs(sens) {
    const val = typeof sens === 'number' ? sens : getStickSensitivity();
    const min = 0.2;
    const max = 3.0;
    const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));

    findNativeSensitivityInputs().forEach(inp => {
      if (Math.abs((parseFloat(inp.value) || 1.0) - val) > 0.02) {
        inp.value = val.toFixed(2);
      }
      inp.style.setProperty('--p', pct + '%');
      const row = inp.closest('.st-row');
      if (row) {
        const valDisplay = row.querySelector('.st-val');
        if (valDisplay) valDisplay.textContent = val.toFixed(2);
      }
    });
  }

  function patchSettingsMenu() {
    const stPanel = document.querySelector('.panel.pz-st') || (document.querySelector('.st-row') && document.querySelector('.st-row').parentElement);
    if (!stPanel) return;

    // 1. Enable controller focus and keyboard toggle on all toggle switch rows
    const allRows = document.querySelectorAll('.st-row');
    for (const r of allRows) {
      const isToggle = r.classList.contains('tog') || r.querySelector('.switch') || r.querySelector('button.switch');
      if (isToggle && !r.dataset.pbPatched) {
        r.dataset.pbPatched = 'true';
        r.setAttribute('tabindex', '0');
        r.style.cursor = 'pointer';
        r.addEventListener('keydown', (e) => {
          if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            r.click();
          }
        });
      }
    }

    // 2. Enhance native sensitivity slider
    findNativeSensitivityInputs().forEach(inp => {
      const row = inp.closest('.st-row');
      if (row && !row.dataset.pbSliderPatched) {
        row.dataset.pbSliderPatched = 'true';
        row.setAttribute('tabindex', '0');
        row.style.cursor = 'pointer';

        row.addEventListener('keydown', (e) => {
          let cur = parseFloat(inp.value) || 1.0;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            const next = Math.max(0.2, Math.round((cur - 0.1) * 20) / 20);
            setStickSensitivity(next);
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = Math.min(3.0, Math.round((cur + 0.1) * 20) / 20);
            setStickSensitivity(next);
          }
        });

        inp.addEventListener('input', () => {
          const v = Math.max(0.2, Math.min(3.0, parseFloat(inp.value) || 1.0));
          setStickSensitivity(v);
        });
      }
    });

    // 3. Inject Controller Button Layout Toggle Row
    if (!document.getElementById('pb-native-layout-row')) {
      const row = document.createElement('div');
      row.id = 'pb-native-layout-row';
      row.className = 'st-row tog';
      row.setAttribute('tabindex', '0');
      row.style.cursor = 'pointer';

      const span = document.createElement('span');
      span.innerHTML = 'Controller Button Layout<small>Xbox: South = A (Default) / Switch: East = A</small>';
      row.appendChild(span);

      const pill = document.createElement('button');
      pill.className = 'pill on';
      pill.style.cssText = 'font-size:11px;padding:4px 12px;border-radius:999px;pointer-events:none;';
      pill.textContent = isLayoutSwapped() ? 'Switch' : 'Xbox';
      row.appendChild(pill);

      row.addEventListener('click', (e) => {
        e.preventDefault();
        setLayoutSwapped(!isLayoutSwapped());
        pill.textContent = isLayoutSwapped() ? 'Switch' : 'Xbox';
      });

      row.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          row.click();
        }
      });

      stPanel.appendChild(row);
    }
  }

  // --- Toast Notifications ---
  function showToast(message) {
    let toast = document.getElementById('pb-core-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pb-core-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast.__timer);
    toast.__timer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2200);
  }

  // --- Floating HUD Menu ---
  function updateMenuVisuals() {
    const layoutBtn = document.getElementById('pb-menu-item-layout');
    if (layoutBtn) {
      layoutBtn.textContent = isLayoutSwapped() ? '🎮 Layout: Switch (East = A)' : '🎮 Layout: Xbox (South = A)';
    }

    const sensBtn = document.getElementById('pb-menu-item-sens');
    if (sensBtn) {
      sensBtn.textContent = '🎯 Stick Sensitivity: ' + Math.round(getStickSensitivity() * 100) + '%';
    }

    syncNativeSensitivityInputs();
  }

  function initHUD() {
    if (document.getElementById('pb-core-hud')) return;

    const hudContainer = document.createElement('div');
    hudContainer.id = 'pb-core-hud';

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'pb-hud-toggle';
    toggleBtn.title = 'PokéBonk Menu';
    toggleBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';

    const menu = document.createElement('div');
    menu.id = 'pb-hud-menu';

    const header = document.createElement('div');
    header.className = 'pb-menu-header';
    header.innerHTML = '<span class="pb-title">PokéBonk</span><span class="pb-badge">NATIVE</span>';
    menu.appendChild(header);

    function createMenuItem(id, label, action) {
      const btn = document.createElement('button');
      btn.id = id;
      btn.className = 'pb-menu-btn';
      btn.textContent = label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        action();
      });
      return btn;
    }

    function toggleMenu(show) {
      const isVisible = menu.classList.contains('open');
      const next = typeof show === 'boolean' ? show : !isVisible;
      if (next) {
        menu.classList.add('open');
        toggleBtn.classList.add('active');
        updateMenuVisuals();
        setTimeout(() => document.addEventListener('click', onOutsideClick), 10);
      } else {
        menu.classList.remove('open');
        toggleBtn.classList.remove('active');
        document.removeEventListener('click', onOutsideClick);
      }
    }

    function onOutsideClick(e) {
      if (!hudContainer.contains(e.target)) {
        toggleMenu(false);
      }
    }

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    const layoutBtn = createMenuItem('pb-menu-item-layout', '🎮 Layout: Xbox', () => {
      setLayoutSwapped(!isLayoutSwapped());
      toggleMenu(false);
    });

    const sensBtn = createMenuItem('pb-menu-item-sens', '🎯 Stick Sensitivity: 100%', () => {
      const cur = getStickSensitivity();
      const next = cur >= 2.9 ? 0.5 : Math.round((cur + 0.25) * 100) / 100;
      const updated = setStickSensitivity(next);
      showToast('Stick Sensitivity: ' + Math.round(updated * 100) + '%');
    });

    const reloadBtn = createMenuItem('pb-menu-item-reload', '🔄 Reload Game', () => {
      toggleMenu(false);
      NativeBridge.reloadGame();
    });

    const updateBtn = createMenuItem('pb-menu-item-update', '⬆ Check for Updates', () => {
      toggleMenu(false);
      NativeBridge.checkForUpdates();
    });

    const closeBtn = createMenuItem('pb-menu-item-close', '✕ Close Menu', () => {
      toggleMenu(false);
    });
    closeBtn.classList.add('pb-menu-btn-close');

    menu.appendChild(layoutBtn);
    menu.appendChild(sensBtn);
    menu.appendChild(reloadBtn);
    menu.appendChild(updateBtn);
    menu.appendChild(closeBtn);

    hudContainer.appendChild(toggleBtn);
    hudContainer.appendChild(menu);
    document.body.appendChild(hudContainer);

    updateMenuVisuals();
  }

  // --- Startup Observers ---
  function initEngine() {
    initHUD();
    patchSettingsMenu();

    const observer = new MutationObserver(() => {
      patchSettingsMenu();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEngine);
  } else {
    initEngine();
  }
})();
