const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
    // 1. Inject robust letterboxing & aspect-ratio enforcement styles
    const style = document.createElement('style');
    style.innerHTML = `
        * { user-select: none !important; -webkit-user-select: none !important; outline: none !important; touch-action: none; }
        html, body { 
            margin: 0 !important; padding: 0 !important; 
            width: 100vw !important; height: 100vh !important; 
            overflow: hidden !important; background: #000 !important; 
        }
        canvas#game { 
            width: 100vw !important; height: 100vh !important; 
            max-width: 100vw !important; max-height: 100vh !important;
            object-fit: contain !important; margin: auto !important; position: absolute !important;
        }
        body.controller-active, body.controller-active * { cursor: none !important; }
        
        #pb-desktop-header {
            position: fixed; top: 14px; right: 16px; z-index: 2147483647;
            display: flex; gap: 8px; align-items: center;
            opacity: 0; transition: opacity 0.3s ease;
            pointer-events: none;
        }
        body:not(.controller-active) #pb-desktop-header {
            opacity: 1;
            pointer-events: auto;
        }
        .pb-win-btn {
            background: #fffffff2; color: #2a2440; border: 2px solid #ffffff;
            width: 34px; height: 34px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center; cursor: pointer;
            box-shadow: 0 3px 0 #1a124630, 0 4px 12px #1a12462e;
            pointer-events: auto !important;
            transition: transform 0.12s ease, filter 0.12s ease, box-shadow 0.12s ease;
        }
        .pb-win-btn:hover {
            filter: brightness(1.06);
            transform: translateY(-1.5px);
        }
        .pb-win-btn:active {
            transform: translateY(1.5px);
            box-shadow: 0 1px 0 #1a124630;
        }
        #pb-close-btn {
            background: linear-gradient(135deg, #ff7a7f, #ff5a5f 60%, #e0454a);
            border: 2px solid #ffffff;
            box-shadow: 0 3px 0 #9c272c, 0 4px 12px rgba(255, 90, 95, 0.4);
            color: #ffffff;
        }
        #pb-close-btn:hover {
            filter: brightness(1.1);
            transform: translateY(-1.5px);
        }
        #pb-close-btn:active {
            transform: translateY(1.5px);
            box-shadow: 0 1px 0 #9c272c;
        }

        /* Remove browser fullscreen buttons that are useless in standalone desktop app */
        .fs-btn, .tc-fs,
        button[title*="completa" i],
        button[title*="Fullscreen" i],
        button[aria-label*="completa" i],
        button[aria-label*="Fullscreen" i] {
            display: none !important;
        }

        /* Clean up website legal footer clutter on title screen */
        .mm-foot .mm-legal {
            display: none !important;
        }

        #pb-controller-toast {
            position: fixed; top: 14px; right: 92px; z-index: 2147483647;
            background: rgba(26, 20, 56, 0.94); color: #ffcc33; border: 1px solid rgba(255, 204, 51, 0.45);
            padding: 8px 16px; border-radius: 999px; font-family: "Nunito", system-ui, -apple-system, sans-serif;
            font-size: 12.5px; font-weight: 800; letter-spacing: 0.02em;
            box-shadow: 0 4px 14px rgba(0,0,0,0.5), 0 0 10px rgba(255, 204, 51, 0.2);
            backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
            pointer-events: none; opacity: 0; transition: opacity 0.25s ease;
        }

        .st-row.tog {
            outline: none;
            cursor: pointer !important;
            border-radius: 12px;
            transition: background 0.15s ease, outline 0.15s ease;
        }
        .st-row.tog:focus, .st-row.tog.pad-focus {
            outline: 2.5px solid #ffcc33 !important;
            outline-offset: 2px !important;
            border-radius: 12px !important;
            background: rgba(255, 204, 51, 0.15) !important;
        }
        .st-row.tog:focus .switch, .st-row.tog.pad-focus .switch {
            filter: drop-shadow(0 0 6px rgba(255, 204, 51, 0.8)) !important;
        }
    `;
    document.head.appendChild(style);

    // Prevent zoom distortion
    window.addEventListener('wheel', (e) => {
        if (e.ctrlKey) e.preventDefault();
    }, { passive: false });

    // Dynamic Resize Observer to keep canvas container proportional without redundant loops
    let lastW = window.innerWidth;
    let lastH = window.innerHeight;
    const observer = new ResizeObserver(() => {
        if (window.innerWidth !== lastW || window.innerHeight !== lastH) {
            lastW = window.innerWidth;
            lastH = window.innerHeight;
            window.dispatchEvent(new Event('resize'));
        }
    });
    observer.observe(document.body);

    const header = document.createElement('div');
    header.id = 'pb-desktop-header';
    header.innerHTML = `
        <div class="pb-win-btn" id="pb-min-btn" title="Minimize">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </div>
        <div class="pb-win-btn" id="pb-close-btn" title="Close App">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="6" y1="18" x2="18" y2="6"></line></svg>
        </div>
    `;
    document.body.appendChild(header);

    document.getElementById('pb-close-btn').addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        ipcRenderer.send('quit-app');
    });

    document.getElementById('pb-min-btn').addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        ipcRenderer.send('minimize-app');
    });

    const toast = document.createElement('div');
    toast.id = 'pb-controller-toast';
    document.body.appendChild(toast);

    let toastTimer = null;
    function showToast(msg, duration = 3200) {
        toast.textContent = msg;
        toast.style.opacity = '1';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, duration);
    }

    window.addEventListener('mousemove', () => {
        document.body.classList.remove('controller-active');
    });

    // Controller input mapping & Stick Sensitivity (cached in-memory for 0ms frame lookups)
    const SENSITIVITY_KEY = 'pb_stick_sensitivity';
    let cachedSensitivity = 1.0;
    try {
        const parsed = parseFloat(localStorage.getItem(SENSITIVITY_KEY) || '1.0');
        if (!isNaN(parsed)) cachedSensitivity = Math.max(0.2, Math.min(3.0, Math.round(parsed * 20) / 20));
    } catch (_) {}

    function getStickSensitivity() {
        return cachedSensitivity;
    }

    function findNativeSensitivityInput() {
        return Array.from(document.querySelectorAll('input.st-range')).find(inp => {
            const row = inp.closest('.st-row');
            if (!row) return false;
            const text = (row.textContent || '').toLowerCase();
            return text.includes('sensib') || text.includes('sensit') || (parseFloat(inp.min) <= 0.3 && parseFloat(inp.max) >= 2.5);
        });
    }

    function syncSensitivityVisuals(sens) {
        const val = typeof sens === 'number' ? sens : getStickSensitivity();
        const min = 0.2;
        const max = 3.0;
        const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));

        const nativeInput = findNativeSensitivityInput();
        if (nativeInput) {
            if (Math.abs((parseFloat(nativeInput.value) || 1.0) - val) > 0.02) {
                nativeInput.value = val.toFixed(2);
            }
            nativeInput.style.setProperty('--p', pct + '%');

            const row = nativeInput.closest('.st-row');
            if (row) {
                const valDisplay = row.querySelector('.st-val');
                if (valDisplay) {
                    valDisplay.textContent = val.toFixed(2);
                }
            }
        }
    }

    function setStickSensitivity(val) {
        const clamped = Math.max(0.2, Math.min(3.0, Math.round(val * 20) / 20));
        cachedSensitivity = clamped;
        try { localStorage.setItem(SENSITIVITY_KEY, String(clamped)); } catch (_) {}

        const nativeInput = findNativeSensitivityInput();
        if (nativeInput) {
            nativeInput.value = String(clamped);
            nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
            nativeInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncSensitivityVisuals(clamped);
        return clamped;
    }

    let swapABXY = localStorage.getItem('pb_swap_abxy') === 'true';

    function isNintendoDevice(idString) {
        const id = (idString || '').toLowerCase();
        return id.includes('057e') || id.includes('nintendo') || id.includes('switch') ||
               id.includes('pro controller') || id.includes('joy-con');
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'F9') {
            swapABXY = !swapABXY;
            try { localStorage.setItem('pb_swap_abxy', swapABXY); } catch (_) {}
            showToast(
                swapABXY
                    ? 'Layout: Switch Mode (East = A, South = B)'
                    : 'Layout: Xbox Mode (South = A, East = B)'
            );
        } else if (e.key === 'F8') {
            const current = getStickSensitivity();
            const next = current >= 2.9 ? 0.5 : Math.round((current + 0.25) * 100) / 100;
            const updated = setStickSensitivity(next);
            showToast(`Stick Sensitivity: ${Math.round(updated * 100)}% (F8 cycles, or adjust in Settings)`);
        }
    });

    window.addEventListener('gamepadconnected', (e) => {
        const nintendo = isNintendoDevice(e.gamepad.id);
        const name = nintendo ? 'Nintendo / Switch Controller' : 'Xbox Controller';
        const modeText = swapABXY ? 'Switch Layout' : 'Xbox Layout';
        const sensText = `${Math.round(getStickSensitivity() * 100)}%`;
        showToast(`${name} Connected [${modeText} | Sens: ${sensText}] — F9: Swap | F8: Sens`, 5000);
    });

    function processAxis(val, sensitivity) {
        if (Math.abs(val) < 0.06) return 0;
        const abs = Math.abs(val);
        const norm = (abs - 0.06) * 1.063829787; // Optimized multiplication vs division (1.0 / 0.94)
        const sign = val < 0 ? -1 : 1;
        if (Math.abs(sensitivity - 1.0) < 0.02) {
            return sign * (norm > 1.0 ? 1.0 : norm);
        }
        const curved = Math.pow(norm, 1.0 / Math.max(0.3, sensitivity));
        return sign * (curved > 1.0 ? 1.0 : curved);
    }

    // Settings Gamepad Navigation & Native Sensitivity Sync
    function setupSettingsGamepadPatch() {
        function patchSettings() {
            // 1. Enable controller focus on all toggle switch rows safely without CSS :has() issues
            const allRows = document.querySelectorAll('.st-row');
            for (const row of allRows) {
                const isToggle = row.classList.contains('tog') || row.querySelector('.switch') || row.querySelector('button.switch');
                if (isToggle && !row.dataset.pbPatched) {
                    row.dataset.pbPatched = 'true';
                    row.setAttribute('tabindex', '0');
                    row.style.cursor = 'pointer';

                    row.addEventListener('keydown', (e) => {
                        if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                            e.preventDefault();
                            row.click();
                        }
                    });
                }
            }

            // 2. Enhance and bind the game's actual native Sensitivity slider for controllers
            const nativeInput = findNativeSensitivityInput();
            if (nativeInput) {
                const row = nativeInput.closest('.st-row');
                if (row && !row.dataset.pbPatched) {
                    row.dataset.pbPatched = 'true';
                    row.setAttribute('tabindex', '0');
                    row.style.cursor = 'pointer';

                    const span = row.querySelector('span');
                    if (span) {
                        const isEn = document.documentElement.lang === 'en' || document.documentElement.dataset.lang === 'en';
                        span.innerHTML = `${isEn ? 'Stick & Camera Sensitivity' : 'Sensibilidad de sticks y cámara'}<small>${isEn ? 'Analog stick responsiveness & camera rotation speed (0.2x – 3.0x)' : 'Velocidad de giro del stick analógico y cámara (0.2x – 3.0x)'}</small>`;
                    }

                    row.addEventListener('keydown', (e) => {
                        let cur = parseFloat(nativeInput.value) || 1.0;
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

                    nativeInput.addEventListener('input', () => {
                        const v = Math.max(0.2, Math.min(3.0, parseFloat(nativeInput.value) || 1.0));
                        cachedSensitivity = v;
                        try { localStorage.setItem(SENSITIVITY_KEY, String(v)); } catch (_) {}
                        syncSensitivityVisuals(v);
                    });
                }

                // Unconditionally keep input, track fill, and text display in sync whenever settings are shown
                const savedSens = getStickSensitivity();
                if (Math.abs((parseFloat(nativeInput.value) || 1.0) - savedSens) > 0.02) {
                    nativeInput.value = String(savedSens);
                    nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
                syncSensitivityVisuals(savedSens);
            }
        }

        document.addEventListener('click', (e) => {
            if (e.target && e.target.closest && e.target.closest('.st-tab, [role="tab"], .tab, .back-btn')) {
                setTimeout(patchSettings, 20);
                setTimeout(patchSettings, 120);
            }
        }, true);

        let patchDebounce = null;
        const observer = new MutationObserver((mutations) => {
            const hasSettings = mutations.some(m => {
                for (let i = 0; i < m.addedNodes.length; i++) {
                    const node = m.addedNodes[i];
                    if (node.nodeType === 1 && (node.classList?.contains('modal') || node.classList?.contains('st-row') || node.querySelector?.('.modal, .st-row'))) {
                        return true;
                    }
                }
                return false;
            });
            if (hasSettings) {
                clearTimeout(patchDebounce);
                patchDebounce = setTimeout(patchSettings, 60);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        patchSettings();
    }
    setupSettingsGamepadPatch();

    let quitHoldStart = 0;
    let lastTogNavTime = 0;
    const nativeGetGamepads = navigator.getGamepads.bind(navigator);

    // Pre-allocated reusable structures to eliminate garbage collection pauses during 60+ FPS gameplay
    const gamepadResult = [null, null, null, null];
    const cachedPadObjects = [{}, {}, {}, {}];
    const cachedButtons = [[], [], [], []];
    const cachedAxes = [[], [], [], []];

    navigator.getGamepads = function () {
        const rawPads = nativeGetGamepads();
        gamepadResult[0] = null;
        gamepadResult[1] = null;
        gamepadResult[2] = null;
        gamepadResult[3] = null;

        const sensitivity = cachedSensitivity;
        const rawLen = rawPads ? rawPads.length : 0;

        for (let i = 0; i < rawLen && i < 4; i++) {
            const pad = rawPads[i];
            if (!pad) continue;

            let hasStickInput = false;
            if (pad.axes) {
                for (let a = 0; a < pad.axes.length; a++) {
                    if (Math.abs(pad.axes[a]) > 0.22) {
                        hasStickInput = true;
                        break;
                    }
                }
            }

            let hasButtonInput = false;
            if (pad.buttons) {
                for (let b = 0; b < pad.buttons.length; b++) {
                    const btn = pad.buttons[b];
                    if (btn && btn.pressed) {
                        hasButtonInput = true;
                        break;
                    }
                }
            }

            if (hasStickInput || hasButtonInput) {
                document.body.classList.add('controller-active');
            }

            // D-Pad Left / Right toggling for active toggle switch row (only query when button is pressed)
            const isLeft = (pad.buttons && pad.buttons[14]?.pressed) || (pad.axes && pad.axes[0] < -0.65);
            const isRight = (pad.buttons && pad.buttons[15]?.pressed) || (pad.axes && pad.axes[0] > 0.65);
            if ((isLeft || isRight) && performance.now() - lastTogNavTime > 320) {
                const activeTog = document.querySelector('.st-row.pad-focus, .st-row.tog:focus');
                if (activeTog) {
                    lastTogNavTime = performance.now();
                    activeTog.click();
                }
            }

            if (pad.buttons && pad.buttons[8]?.pressed && pad.buttons[9]?.pressed) {
                if (quitHoldStart === 0) {
                    quitHoldStart = performance.now();
                    showToast('Hold Start + Select to Quit PokéBonk...', 1500);
                } else if (performance.now() - quitHoldStart > 1400) {
                    ipcRenderer.send('quit-app');
                }
            } else if (i === 0) {
                quitHoldStart = 0;
            }

            // Map and recycle button structures without array or closure allocations
            const btnLen = pad.buttons ? pad.buttons.length : 0;
            let padMappedButtons = cachedButtons[i];
            if (padMappedButtons.length !== btnLen) {
                padMappedButtons = cachedButtons[i] = new Array(btnLen);
                for (let b = 0; b < btnLen; b++) {
                    padMappedButtons[b] = { pressed: false, touched: false, value: 0 };
                }
            }
            for (let b = 0; b < btnLen; b++) {
                const btn = pad.buttons[b];
                const targetBtn = padMappedButtons[b];
                targetBtn.pressed = Boolean(btn && btn.pressed);
                targetBtn.touched = Boolean(btn && btn.touched);
                targetBtn.value = Number(btn ? btn.value : 0);
            }

            if (swapABXY && btnLen >= 4) {
                const p0 = padMappedButtons[0].pressed;
                const t0 = padMappedButtons[0].touched;
                const v0 = padMappedButtons[0].value;
                padMappedButtons[0].pressed = padMappedButtons[1].pressed;
                padMappedButtons[0].touched = padMappedButtons[1].touched;
                padMappedButtons[0].value = padMappedButtons[1].value;
                padMappedButtons[1].pressed = p0;
                padMappedButtons[1].touched = t0;
                padMappedButtons[1].value = v0;

                const p2 = padMappedButtons[2].pressed;
                const t2 = padMappedButtons[2].touched;
                const v2 = padMappedButtons[2].value;
                padMappedButtons[2].pressed = padMappedButtons[3].pressed;
                padMappedButtons[2].touched = padMappedButtons[3].touched;
                padMappedButtons[2].value = padMappedButtons[3].value;
                padMappedButtons[3].pressed = p2;
                padMappedButtons[3].touched = t2;
                padMappedButtons[3].value = v2;
            }

            // Map and recycle axes array
            const axesLen = pad.axes ? pad.axes.length : 0;
            let padMappedAxes = cachedAxes[i];
            if (padMappedAxes.length !== axesLen) {
                padMappedAxes = cachedAxes[i] = new Array(axesLen);
            }
            for (let a = 0; a < axesLen; a++) {
                padMappedAxes[a] = processAxis(pad.axes[a], sensitivity);
            }

            // Dynamically amplify camera rotation when right stick is tilted during gameplay
            if (i === 0 && (Math.abs(pad.axes[2] || 0) > 0.08 || Math.abs(pad.axes[3] || 0) > 0.08)) {
                if (document.pointerLockElement) {
                    const extra = sensitivity - 1.0;
                    if (Math.abs(extra) > 0.05) {
                        const target = document.pointerLockElement || document.getElementById('game') || document;
                        target.dispatchEvent(new MouseEvent('mousemove', {
                            movementX: (pad.axes[2] || 0) * extra * 16,
                            movementY: (pad.axes[3] || 0) * extra * 16,
                            bubbles: true
                        }));
                    }
                }
            }

            const padObj = cachedPadObjects[i];
            padObj.id = pad.id;
            padObj.index = pad.index;
            padObj.connected = pad.connected;
            padObj.timestamp = pad.timestamp;
            padObj.mapping = 'standard';
            padObj.axes = padMappedAxes;
            padObj.buttons = padMappedButtons;
            padObj.vibrationActuator = pad.vibrationActuator || null;
            padObj.hapticActuators = pad.hapticActuators || [];
            gamepadResult[i] = padObj;
        }

        return gamepadResult;
    };
});
