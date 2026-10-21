/**
 * PokéBonk Unified Client Core Engine (v2.5)
 * Shared runtime for Android, Windows, iOS native wrappers and Web.
 */
(function () {
  'use strict';

  if (window.__pokebonkCoreInitialized) return;
  window.__pokebonkCoreInitialized = true;

  // --- Constants & Storage Keys ---
  const STORAGE_LAYOUT_KEY = 'pb_swap_abxy';
  const STORAGE_SENSITIVITY_KEY = 'pb_stick_sensitivity';
  const STORAGE_POS_X = 'pb_hud_pos_x';
  const STORAGE_POS_Y = 'pb_hud_pos_y';
  let lastTogNavTime = 0;

  // --- Native Bridge Wrapper ---
  const NativeBridge = {
    platform: (function () {
      if (window.AndroidApp) return 'android';
      if (window.electronAPI) return 'windows';
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pokeBonkIOS) return 'ios';
      return 'web';
    })(),

    defaultVersions: {
      windows: '2.4.13',
      android: '1.10',
      ios: '1.0.2',
      web: '2.5'
    },

    setAppVersion: function (ver) {
      if (!ver) return;
      const cleanVer = 'v' + String(ver).replace(/^v/i, '').trim();
      const ids = ['pb-topleft-version-text', 'pb-version-display', 'pb-tb-version'];
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = cleanVer;
      });
    },

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

    openReleasePage: function () {
      if (window.AndroidApp && window.AndroidApp.openReleasePage) {
        window.AndroidApp.openReleasePage();
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
    },

    toggleFullscreen: function () {
      if (window.electronAPI && window.electronAPI.toggleFullscreen) {
        window.electronAPI.toggleFullscreen();
      } else if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    },

    getAppVersion: function (cb) {
      if (window.AndroidApp && window.AndroidApp.getAppVersion) {
        try {
          const v = window.AndroidApp.getAppVersion();
          if (v) {
            NativeBridge.setAppVersion(v);
            return cb(v);
          }
        } catch (_) {}
      } else if (window.electronAPI && window.electronAPI.getAppVersion) {
        window.electronAPI.getAppVersion().then(v => {
          if (v) {
            NativeBridge.setAppVersion(v);
            cb(v);
          }
        }).catch(() => {});
      } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pokeBonkIOS) {
        try {
          window.webkit.messageHandlers.pokeBonkIOS.postMessage({ action: 'getVersion' });
        } catch (_) {}
      }
      const def = NativeBridge.defaultVersions[NativeBridge.platform] || '2.5';
      NativeBridge.setAppVersion(def);
      cb(def);
    },

    showToast: function (msg) {
      showToast(msg);
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
  window.addEventListener('keydown', unlockAudioContext, { passive: true, once: true });
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
    return isNaN(raw) ? 1.0 : Math.max(0.3, Math.min(2.5, Math.round(raw * 20) / 20));
  }

  function setStickSensitivity(val) {
    const clamped = Math.max(0.3, Math.min(2.5, Math.round(val * 20) / 20));
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
    const curved = Math.pow(normalized, 1.1) * sensitivity;
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
    const min = 0.3;
    const max = 2.5;
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
            const next = Math.max(0.3, Math.round((cur - 0.1) * 20) / 20);
            setStickSensitivity(next);
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = Math.min(2.5, Math.round((cur + 0.1) * 20) / 20);
            setStickSensitivity(next);
          }
        });

        inp.addEventListener('input', () => {
          const v = Math.max(0.3, Math.min(2.5, parseFloat(inp.value) || 1.0));
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
    toast.innerHTML = `<span style="font-size:14px;">⚡</span><span>${message}</span>`;
    toast.classList.add('visible');
    clearTimeout(toast.__timer);
    toast.__timer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2400);
  }

  // --- Gamepad Detection Helper ---
  function getConnectedGamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (!pads) return null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) return pads[i];
    }
    return null;
  }

  // --- Floating HUD Menu Visuals ---
  function updateMenuVisuals() {
    const layoutPill = document.getElementById('pb-menu-pill-layout');
    if (layoutPill) {
      layoutPill.textContent = isLayoutSwapped() ? 'Switch (East = A)' : 'Xbox (South = A)';
    }

    const sensVal = document.getElementById('pb-sens-value');
    const sensSlider = document.getElementById('pb-sens-slider');
    const curSens = getStickSensitivity();
    if (sensVal) {
      sensVal.textContent = Math.round(curSens * 100) + '%';
    }
    if (sensSlider && Math.abs(parseFloat(sensSlider.value) - curSens) > 0.02) {
      sensSlider.value = curSens;
    }

    // Update preset chips active state
    document.querySelectorAll('.pb-preset-btn').forEach(btn => {
      const v = parseFloat(btn.dataset.val);
      if (Math.abs(v - curSens) < 0.04) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update Gamepad Status Bar
    const padBarText = document.getElementById('pb-pad-text');
    const padDot = document.getElementById('pb-pad-dot');
    const activePad = getConnectedGamepad();
    if (padBarText && padDot) {
      if (activePad) {
        padDot.classList.add('active');
        let name = activePad.id || 'Controller';
        if (name.length > 22) name = name.substring(0, 20) + '…';
        padBarText.textContent = 'Connected: ' + name;
      } else {
        padDot.classList.remove('active');
        padBarText.textContent = 'No Gamepad Detected';
      }
    }

    syncNativeSensitivityInputs();
  }

  function initHUD() {
    if (document.getElementById('pb-core-hud')) return;

    const hudContainer = document.createElement('div');
    hudContainer.id = 'pb-core-hud';

    // Restore saved position if available
    const savedX = localStorage.getItem(STORAGE_POS_X);
    const savedY = localStorage.getItem(STORAGE_POS_Y);
    if (savedX !== null && savedY !== null) {
      hudContainer.style.left = savedX + 'px';
      hudContainer.style.top = savedY + 'px';
    }

    // Trigger Row: contains floating toggle button + sleek discreet version pill
    const triggerRow = document.createElement('div');
    triggerRow.id = 'pb-hud-trigger-row';

    // Toggle Button
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'pb-hud-toggle';
    toggleBtn.title = 'PokéBonk Settings & Menu';
    toggleBtn.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
      </svg>
    `;

    // Discreet Top-Left Version Pill (Visible across Android, iOS, Windows, Web!)
    const verPill = document.createElement('div');
    verPill.id = 'pb-topleft-version';
    verPill.className = 'pb-topleft-version';
    verPill.title = 'PokéBonk Version (Click to check updates)';
    const initialVer = NativeBridge.defaultVersions[NativeBridge.platform] || '2.5';
    verPill.innerHTML = `
      <span class="pb-ver-dot"></span>
      <span id="pb-topleft-version-text">v${initialVer}</span>
    `;

    verPill.addEventListener('click', (e) => {
      e.stopPropagation();
      NativeBridge.checkForUpdates();
    });

    triggerRow.appendChild(toggleBtn);
    triggerRow.appendChild(verPill);

    // Draggable behavior
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let elemStartX = 0;
    let elemStartY = 0;
    let hasMoved = false;

    function onPointerDown(e) {
      if (menu.classList.contains('open')) return;
      isDragging = true;
      hasMoved = false;
      const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
      dragStartX = clientX;
      dragStartY = clientY;
      const rect = hudContainer.getBoundingClientRect();
      elemStartX = rect.left;
      elemStartY = rect.top;
      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    }

    function onPointerMove(e) {
      if (!isDragging) return;
      const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
      const dx = clientX - dragStartX;
      const dy = clientY - dragStartY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        hasMoved = true;
      }
      if (hasMoved) {
        e.preventDefault();
        const nextX = Math.max(8, Math.min(window.innerWidth - 50, elemStartX + dx));
        const nextY = Math.max(8, Math.min(window.innerHeight - 50, elemStartY + dy));
        hudContainer.style.left = nextX + 'px';
        hudContainer.style.top = nextY + 'px';
      }
    }

    function onPointerUp() {
      if (isDragging && hasMoved) {
        const rect = hudContainer.getBoundingClientRect();
        localStorage.setItem(STORAGE_POS_X, String(Math.round(rect.left)));
        localStorage.setItem(STORAGE_POS_Y, String(Math.round(rect.top)));
      }
      isDragging = false;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    }

    toggleBtn.addEventListener('pointerdown', onPointerDown);

    // Dropdown Menu Container
    const menu = document.createElement('div');
    menu.id = 'pb-hud-menu';

    // 1. Header with brand and badges
    const header = document.createElement('div');
    header.className = 'pb-menu-header';
    header.innerHTML = `
      <div class="pb-header-left">
        <span class="pb-pokeball-icon"></span>
        <span class="pb-title">POKÉBONK</span>
      </div>
      <div class="pb-header-badges">
        <span class="pb-platform-badge ${NativeBridge.platform}">${NativeBridge.platform}</span>
        <span id="pb-version-display" class="pb-version-tag"></span>
      </div>
    `;
    menu.appendChild(header);

    // Dynamic Version Display
    NativeBridge.getAppVersion((ver) => {
      const vDisp = document.getElementById('pb-version-display');
      if (vDisp && ver) {
        vDisp.textContent = 'v' + ver;
      }
    });

    // 2. Gamepad Live Status Bar
    const padBar = document.createElement('div');
    padBar.className = 'pb-gamepad-bar';
    padBar.innerHTML = `
      <span id="pb-pad-dot" class="pb-status-dot"></span>
      <span id="pb-pad-text">No Gamepad Detected</span>
    `;
    menu.appendChild(padBar);

    // 3. Controller Layout Toggle
    const layoutBtn = document.createElement('button');
    layoutBtn.className = 'pb-menu-btn';
    layoutBtn.innerHTML = `
      <div class="pb-btn-content">
        <span>🎮</span>
        <span>Controller Layout</span>
      </div>
      <span id="pb-menu-pill-layout" class="pb-btn-pill">Xbox</span>
    `;
    layoutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setLayoutSwapped(!isLayoutSwapped());
    });
    menu.appendChild(layoutBtn);

    // 4. Stick Sensitivity Slider Box
    const sensBox = document.createElement('div');
    sensBox.className = 'pb-section-box';
    sensBox.innerHTML = `
      <div class="pb-row-label">
        <span>🎯 Stick Sensitivity</span>
        <span id="pb-sens-value" class="pb-row-value">100%</span>
      </div>
      <input type="range" id="pb-sens-slider" class="pb-range-slider" min="0.5" max="2.0" step="0.05" value="1.0">
      <div class="pb-presets-row">
        <button class="pb-preset-btn" data-val="0.5">50%</button>
        <button class="pb-preset-btn" data-val="0.75">75%</button>
        <button class="pb-preset-btn active" data-val="1.0">100%</button>
        <button class="pb-preset-btn" data-val="1.5">150%</button>
        <button class="pb-preset-btn" data-val="2.0">200%</button>
      </div>
    `;

    const slider = sensBox.querySelector('#pb-sens-slider');
    slider.addEventListener('input', (e) => {
      e.stopPropagation();
      setStickSensitivity(parseFloat(slider.value));
    });

    sensBox.querySelectorAll('.pb-preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setStickSensitivity(parseFloat(btn.dataset.val));
      });
    });

    menu.appendChild(sensBox);

    // 5. Fullscreen Toggle (Windows / Web)
    if (NativeBridge.platform === 'windows' || NativeBridge.platform === 'web') {
      const fsBtn = document.createElement('button');
      fsBtn.className = 'pb-menu-btn';
      fsBtn.innerHTML = `
        <div class="pb-btn-content">
          <span>⛶</span>
          <span>Toggle Fullscreen</span>
        </div>
        <span style="font-size:10px;color:#94a3b8;">F11</span>
      `;
      fsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        NativeBridge.toggleFullscreen();
      });
      menu.appendChild(fsBtn);
    }

    // 6. Reload Game Button
    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'pb-menu-btn';
    reloadBtn.innerHTML = `
      <div class="pb-btn-content">
        <span>🔄</span>
        <span>Reload Game</span>
      </div>
    `;
    reloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu(false);
      NativeBridge.reloadGame();
    });
    menu.appendChild(reloadBtn);

    // 7. Check for Updates Button
    const updateBtn = document.createElement('button');
    updateBtn.className = 'pb-menu-btn';
    updateBtn.innerHTML = `
      <div class="pb-btn-content">
        <span>⬆</span>
        <span>Check for Updates</span>
      </div>
    `;
    updateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu(false);
      NativeBridge.checkForUpdates();
    });
    menu.appendChild(updateBtn);

    // 8. Close Button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'pb-menu-btn pb-menu-btn-close';
    closeBtn.textContent = '✕ Close Menu';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu(false);
    });
    menu.appendChild(closeBtn);

    // Menu toggle logic
    function toggleMenu(show) {
      const isVisible = menu.classList.contains('open');
      const next = typeof show === 'boolean' ? show : !isVisible;
      if (next) {
        menu.classList.add('open');
        toggleBtn.classList.add('active');
        const hudRect = hudContainer.getBoundingClientRect();
        if (hudRect.left + 310 > window.innerWidth) {
          hudContainer.style.alignItems = 'flex-end';
        } else {
          hudContainer.style.alignItems = 'flex-start';
        }
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
      if (hasMoved) return;
      e.stopPropagation();
      toggleMenu();
    });

    hudContainer.appendChild(triggerRow);
    hudContainer.appendChild(menu);
    document.body.appendChild(hudContainer);

    // Gamepad connection events for live status update
    window.addEventListener('gamepadconnected', () => {
      updateMenuVisuals();
      showToast('Gamepad Connected');
    });
    window.addEventListener('gamepaddisconnected', () => {
      updateMenuVisuals();
      showToast('Gamepad Disconnected');
    });

    updateMenuVisuals();
  }

  // --- Desktop Custom Title Bar (Windows) ---
  function initDesktopTitleBar() {
    if (NativeBridge.platform !== 'windows') return;
    if (document.getElementById('pb-desktop-titlebar')) return;
    if (!document.body) return;

    document.body.classList.add('pb-has-titlebar');

    const initialVer = NativeBridge.defaultVersions[NativeBridge.platform] || '2.4.13';
    const bar = document.createElement('div');
    bar.id = 'pb-desktop-titlebar';
    bar.innerHTML = `
      <div class="pb-tb-left">
        <span class="pb-pokeball-icon"></span>
        <span class="pb-tb-title">POKÉBONK</span>
        <span id="pb-tb-version" class="pb-tb-version" title="PokéBonk Desktop Version (Click to check updates)">v${initialVer}</span>
      </div>
      <div class="pb-tb-drag-area"></div>
      <div class="pb-tb-right">
        <button class="pb-tb-btn" id="pb-tb-hud-btn" title="Open Game Menu">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          <span>Menu</span>
        </button>
        <button class="pb-tb-btn" id="pb-tb-reload-btn" title="Reload Game">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
        </button>
        <button class="pb-tb-btn" id="pb-tb-fs-btn" title="Toggle Fullscreen (F11)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        </button>
      </div>
    `;

    document.body.prepend(bar);

    document.getElementById('pb-tb-version')?.addEventListener('click', (e) => {
      e.stopPropagation();
      NativeBridge.checkForUpdates();
    });

    NativeBridge.getAppVersion((ver) => {
      const vEl = document.getElementById('pb-tb-version');
      if (vEl && ver) {
        vEl.textContent = 'v' + ver;
      }
    });

    document.getElementById('pb-tb-hud-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const toggle = document.getElementById('pb-hud-toggle');
      if (toggle) toggle.click();
    });

    document.getElementById('pb-tb-reload-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      NativeBridge.reloadGame();
    });

    document.getElementById('pb-tb-fs-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      NativeBridge.toggleFullscreen();
    });

    window.addEventListener('pb-fullscreen-change', (e) => {
      const isFs = !!(e.detail && e.detail.isFullScreen);
      if (isFs) {
        bar.classList.add('pb-fs-hidden');
        document.body.classList.add('pb-in-fullscreen');
      } else {
        bar.classList.remove('pb-fs-hidden');
        document.body.classList.remove('pb-in-fullscreen');
      }
    });
  }

  // --- Startup Observers ---
  function initEngine() {
    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEngine, { once: true });
      } else {
        setTimeout(initEngine, 30);
      }
      return;
    }
    initDesktopTitleBar();
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
