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
            position: fixed; top: 0; right: 0; z-index: 2147483647;
            display: flex; gap: 8px; padding: 12px 16px;
            opacity: 0; transition: opacity 0.3s ease;
            pointer-events: none;
        }
        body:not(.controller-active) #pb-desktop-header {
            opacity: 1;
            pointer-events: auto;
        }
        .pb-win-btn {
            background: rgba(26, 22, 48, 0.95); color: #ffcb3a; border: 1.5px solid rgba(255, 203, 58, 0.5);
            width: 36px; height: 36px; border-radius: 10px; font-weight: 800; font-size: 15px;
            display: flex; align-items: center; justify-content: center; cursor: pointer;
            box-shadow: 0 4px 14px rgba(0,0,0,0.7);
            pointer-events: auto !important;
            transition: background 0.2s, border-color 0.2s, color 0.2s, transform 0.15s;
        }
        .pb-win-btn:hover { background: #ff5a5f; border-color: #ff5a5f; color: #ffffff; transform: translateY(-1px); }

        #pb-controller-toast {
            position: fixed; top: 18px; right: 95px; z-index: 2147483647;
            background: rgba(26, 22, 48, 0.95); color: #ffcb3a; border: 1.5px solid #ffcb3a;
            padding: 10px 18px; border-radius: 12px; font-family: "Nunito", "Segoe UI", system-ui, sans-serif;
            font-size: 13px; font-weight: 700; letter-spacing: 0.02em;
            box-shadow: 0 8px 24px rgba(0,0,0,0.7), 0 0 12px rgba(255, 203, 58, 0.2);
            backdrop-filter: blur(8px);
            pointer-events: none; opacity: 0; transition: opacity 0.25s ease;
        }

        .st-row.tog {
            outline: none;
            cursor: pointer !important;
            border-radius: 12px;
            transition: background 0.15s ease, outline 0.15s ease;
        }
        .st-row.tog:focus, .st-row.tog.pad-focus {
            outline: 3px solid #ffcb3a !important;
            outline-offset: 2px !important;
            border-radius: 12px !important;
            background: rgba(255, 203, 58, 0.15) !important;
        }
        .st-row.tog:focus .switch, .st-row.tog.pad-focus .switch {
            filter: drop-shadow(0 0 6px rgba(255, 203, 58, 0.8)) !important;
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
        <div class="pb-win-btn" id="pb-min-btn" title="Minimize">&mdash;</div>
        <div class="pb-win-btn" id="pb-close-btn" title="Close App">&times;</div>
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

    // --- Enhanced Discord RPC Game State Scraper ---
    let lastSentState = '';
    let runActive = false;

    setInterval(() => {
        try {
            const biomeElem = document.querySelector('.ht-biome');
            const zoneElem = document.querySelector('.ht-zone');
            const pkmnElem = document.querySelector('.slot:not(.empty) .nm, .hud-party .nm, [class*="hud-party"] [class*="nm"]');
            const lvlElem = document.querySelector('.slot:not(.empty) .lvl, .hud-party .lvl, [class*="hud-party"] [class*="lvl"]');
            const streakElem = document.querySelector('.streak, [class*="streak"]');

            if (biomeElem && biomeElem.textContent && biomeElem.textContent.trim()) {
                const biome = biomeElem.textContent.trim();
                const zone = zoneElem && zoneElem.textContent ? zoneElem.textContent.trim() : '';
                const details = zone ? `${biome} (${zone})` : biome;

                let state = 'Surviving in Wilds';
                if (pkmnElem && pkmnElem.textContent && pkmnElem.textContent.trim()) {
                    const pkmn = pkmnElem.textContent.trim();
                    const lvl = lvlElem && lvlElem.textContent ? ` Lv.${lvlElem.textContent.trim()}` : '';
                    state = `Partner: ${pkmn}${lvl}`;
                } else if (streakElem && streakElem.textContent && streakElem.textContent.trim()) {
                    state = `Streak: ${streakElem.textContent.trim()}`;
                }

                const stateKey = `${details}|${state}`;
                const justStartedRun = !runActive;
                runActive = true;

                if (stateKey !== lastSentState || justStartedRun) {
                    lastSentState = stateKey;
                    ipcRenderer.send('update-rpc', {
                        details,
                        state,
                        inRun: true,
                        resetTimer: justStartedRun
                    });
                }
            } else {
                runActive = false;
                const menuKey = 'MENU';
                if (lastSentState !== menuKey) {
                    lastSentState = menuKey;
                    ipcRenderer.send('update-rpc', {
                        details: 'Title Screen / Main Menu',
                        state: 'Choosing Pokémon & Settings',
                        inRun: false
                    });
                }
            }
        } catch (_) {}
    }, 4000);

    // Controller input mapping & Stick Sensitivity
    const SENSITIVITY_KEY = 'pb_stick_sensitivity';
    function getStickSensitivity() {
        const val = parseFloat(localStorage.getItem(SENSITIVITY_KEY) || '1.0');
        return isNaN(val) ? 1.0 : Math.max(0.2, Math.min(3.0, Math.round(val * 20) / 20));
    }

    function findNativeSensitivityInput() {
        return Array.from(document.querySelectorAll('input.st-range')).find(inp => {
            const row = inp.closest('.st-row');
            if (!row) return false;
            const text = (row.textContent || '').toLowerCase();
            return text.includes('sensib') || text.includes('sensit') || (parseFloat(inp.min) <= 0.3 && parseFloat(inp.max) >= 2.5);
        });
    }

    function setStickSensitivity(val) {
        const clamped = Math.max(0.2, Math.min(3.0, Math.round(val * 20) / 20));
        localStorage.setItem(SENSITIVITY_KEY, String(clamped));

        const nativeInput = findNativeSensitivityInput();
        if (nativeInput) {
            nativeInput.value = String(clamped);
            nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
            nativeInput.dispatchEvent(new Event('change', { bubbles: true }));
            const valDisplay = nativeInput.closest('.st-row')?.querySelector('.st-val');
            if (valDisplay) valDisplay.textContent = clamped.toFixed(2);
        }
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
            localStorage.setItem('pb_swap_abxy', swapABXY);
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
        const sign = Math.sign(val);
        const abs = Math.abs(val);
        const curved = Math.pow((abs - 0.06) / (1 - 0.06), 1.0 / Math.max(0.3, sensitivity));
        return sign * Math.min(1.0, Math.max(0.0, curved));
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

                    const savedSens = getStickSensitivity();
                    if (Math.abs(parseFloat(nativeInput.value) - savedSens) > 0.04) {
                        nativeInput.value = String(savedSens);
                        nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
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
                        const v = parseFloat(nativeInput.value) || 1.0;
                        localStorage.setItem(SENSITIVITY_KEY, String(v));
                    });
                }
            }
        }

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

    navigator.getGamepads = function () {
        const rawPads = nativeGetGamepads();
        const result = [null, null, null, null];
        const sensitivity = getStickSensitivity();

        for (let i = 0; i < rawPads.length; i++) {
            const pad = rawPads[i];
            if (!pad) continue;

            const hasStickInput = pad.axes && pad.axes.some(a => Math.abs(a) > 0.22);
            const hasButtonInput = pad.buttons && pad.buttons.some(b => b && b.pressed);
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

            const mappedButtons = pad.buttons.map(b => ({
                pressed: Boolean(b?.pressed),
                touched: Boolean(b?.touched),
                value: Number(b?.value || 0)
            }));

            if (swapABXY && mappedButtons.length >= 4) {
                const b0 = mappedButtons[0];
                mappedButtons[0] = mappedButtons[1];
                mappedButtons[1] = b0;

                const b2 = mappedButtons[2];
                mappedButtons[2] = mappedButtons[3];
                mappedButtons[3] = b2;
            }

            const mappedAxes = pad.axes ? pad.axes.map(v => processAxis(v, sensitivity)) : [];

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

            result[i] = {
                id: pad.id,
                index: pad.index,
                connected: pad.connected,
                timestamp: pad.timestamp,
                mapping: 'standard',
                axes: mappedAxes,
                buttons: mappedButtons,
                vibrationActuator: pad.vibrationActuator || null,
                hapticActuators: pad.hapticActuators || []
            };
        }

        return result;
    };
});
