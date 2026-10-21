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
            background: rgba(20, 22, 34, 0.95); color: #FFF; border: 1.5px solid rgba(255,215,0,0.6);
            width: 38px; height: 38px; border-radius: 8px; font-weight: bold; font-size: 16px;
            display: flex; align-items: center; justify-content: center; cursor: pointer;
            box-shadow: 0 4px 14px rgba(0,0,0,0.8);
            pointer-events: auto !important;
            transition: background 0.2s, border-color 0.2s;
        }
        .pb-win-btn:hover { background: rgba(230, 21, 21, 0.95); border-color: #FFD700; }

        #pb-controller-toast {
            position: fixed; top: 18px; right: 95px; z-index: 2147483647;
            background: rgba(18, 20, 32, 0.95); color: #FFD700; border: 1.5px solid #FFD700;
            padding: 10px 16px; border-radius: 8px; font-family: system-ui, sans-serif;
            font-size: 13px; font-weight: 600; box-shadow: 0 4px 16px rgba(0,0,0,0.7);
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

    // Dynamic Resize Observer to keep canvas container proportional
    const observer = new ResizeObserver(() => {
        window.dispatchEvent(new Event('resize'));
    });
    observer.observe(document.body);

    const header = document.createElement('div');
    header.id = 'pb-desktop-header';
    header.innerHTML = `
        <div class="pb-win-btn" id="pb-min-btn" title="Minimize">🗕</div>
        <div class="pb-win-btn" id="pb-close-btn" title="Close App">✕</div>
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
        return isNaN(val) ? 1.0 : Math.max(0.2, Math.min(3.0, val));
    }
    function setStickSensitivity(val) {
        const clamped = Math.max(0.5, Math.min(2.0, Math.round(val * 20) / 20));
        localStorage.setItem(SENSITIVITY_KEY, String(clamped));
        const existingInput = document.querySelector('#pb-stick-sensitivity-input');
        if (existingInput) {
            existingInput.value = String(clamped);
            existingInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return clamped;
    }

    let swapABXY = localStorage.getItem('pb_swap_abxy') === 'true';

    function isNintendoDevice(idString) {
        const id = (idString || '').toLowerCase();
        return id.includes('057e') || id.includes('nintendo') || id.includes('switch') ||
               id.includes('pro controller') || id.includes('joy-con');
    }

    async function promptDiscordClientId() {
        const currentId = await ipcRenderer.invoke('get-discord-client-id');
        const displayVal = (currentId && currentId !== '123456789012345678') ? currentId : '';
        const input = window.prompt(
            'Enter your Discord Application ID (from discord.com/developers/applications):\nLeave empty to reset to default.',
            displayVal
        );
        if (input !== null) {
            await ipcRenderer.invoke('set-discord-client-id', input.trim());
            showToast('Discord Rich Presence ID updated and reloaded!', 3500);
        }
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'F9') {
            swapABXY = !swapABXY;
            localStorage.setItem('pb_swap_abxy', swapABXY);
            showToast(
                swapABXY
                    ? '🎮 Layout: AB/XY Swapped (Nintendo Labels: East = A)'
                    : '🎮 Layout: Standard Positional (South Button = Jump)'
            );
        } else if (e.key === 'F8') {
            const current = getStickSensitivity();
            const next = current >= 1.95 ? 0.75 : Math.round((current + 0.25) * 100) / 100;
            const updated = setStickSensitivity(next);
            showToast(`🎯 Stick Sensitivity: ${Math.round(updated * 100)}% (Press F8 to cycle, or adjust in Settings)`);
        } else if (e.key === 'F7') {
            promptDiscordClientId();
        }
    });

    window.addEventListener('gamepadconnected', (e) => {
        const nintendo = isNintendoDevice(e.gamepad.id);
        const name = nintendo ? 'Nintendo / Switch Mode Controller' : 'Xbox / XInput Controller';
        const modeText = swapABXY ? 'Swapped AB/XY' : 'Standard Positional';
        const sensText = `${Math.round(getStickSensitivity() * 100)}%`;
        showToast(`🎮 ${name} Connected [${modeText} | Sens: ${sensText}] — F9: Swap layout | F8: Sensitivity | F7: Discord ID`, 5500);
    });

    const DEADZONE = 0.08;
    function processAxis(val, sensitivity) {
        if (Math.abs(val) < DEADZONE) return 0;
        const sign = Math.sign(val);
        const normalized = (Math.abs(val) - DEADZONE) / (1 - DEADZONE);
        const scaled = normalized * sensitivity;
        return sign * Math.min(1.0, Math.max(0.0, scaled));
    }

    // Settings Gamepad Navigation & Custom Slider Injection
    function setupSettingsGamepadPatch() {
        function patchSettings() {
            // 1. Enable controller focus on all toggle switch rows so controllers don't skip them
            const toggleRows = document.querySelectorAll('.st-row.tog, .st-row:has(.switch), .modal .st-row:has(button.switch)');
            for (const row of toggleRows) {
                if (!row.dataset.pbPatched) {
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

            // 2. Inject Stick Sensitivity & Discord RPC buttons into Settings
            const stBody = document.querySelector('.st-pane .st-body, .st-body');
            if (stBody && !stBody.querySelector('#pb-stick-sensitivity-row')) {
                const isEn = document.documentElement.lang === 'en' || document.documentElement.dataset.lang === 'en';
                const title = isEn ? 'Controller Stick Sensitivity' : 'Sensibilidad de los sticks';
                const sub = isEn ? 'Analog stick responsiveness (50% - 200%)' : 'Respuesta de los sticks del mando (50% - 200%)';

                const currentVal = getStickSensitivity();

                const row = document.createElement('div');
                row.id = 'pb-stick-sensitivity-row';
                row.className = 'st-row range';
                row.setAttribute('tabindex', '0');

                const span = document.createElement('span');
                span.textContent = title;
                const small = document.createElement('small');
                small.textContent = sub;
                span.appendChild(small);

                const input = document.createElement('input');
                input.id = 'pb-stick-sensitivity-input';
                input.className = 'st-range';
                input.type = 'range';
                input.min = '0.5';
                input.max = '2.0';
                input.step = '0.05';
                input.value = String(currentVal);

                const valDisplay = document.createElement('b');
                valDisplay.className = 'st-val';
                valDisplay.textContent = Math.round(currentVal * 100) + '%';

                const updateFill = () => {
                    const p = ((Number(input.value) - 0.5) / (2.0 - 0.5)) * 100;
                    input.style.setProperty('--p', p + '%');
                };
                updateFill();

                input.addEventListener('input', () => {
                    const v = Number(input.value);
                    valDisplay.textContent = Math.round(v * 100) + '%';
                    updateFill();
                    localStorage.setItem(SENSITIVITY_KEY, String(v));
                });

                row.appendChild(span);
                row.appendChild(input);
                row.appendChild(valDisplay);

                // Insert near sensitivity / deadzone rows if present, or append
                const refRow = Array.from(stBody.querySelectorAll('.st-row')).find(r =>
                    r.textContent.includes('Sensibilidad') ||
                    r.textContent.includes('Sensitivity') ||
                    r.textContent.includes('Zona muerta') ||
                    r.textContent.includes('Deadzone') ||
                    r.textContent.includes('Mando') ||
                    r.textContent.includes('Gamepad')
                );

                if (refRow && refRow.nextSibling) {
                    stBody.insertBefore(row, refRow.nextSibling);
                } else {
                    stBody.appendChild(row);
                }
            }

            // 3. Inject Discord RPC button row into Settings
            if (stBody && !stBody.querySelector('#pb-discord-rpc-row')) {
                const discordRow = document.createElement('div');
                discordRow.id = 'pb-discord-rpc-row';
                discordRow.className = 'st-row';
                discordRow.setAttribute('tabindex', '0');
                discordRow.style.cursor = 'pointer';

                const dSpan = document.createElement('span');
                dSpan.textContent = 'Discord Rich Presence (F7)';
                const dSmall = document.createElement('small');
                dSmall.textContent = 'Configure Discord Application ID to display active run status';
                dSpan.appendChild(dSmall);

                const dBtn = document.createElement('button');
                dBtn.className = 'btn ghost small';
                dBtn.textContent = 'Configure ID';
                dBtn.style.padding = '6px 12px';
                dBtn.style.borderRadius = '8px';
                dBtn.style.cursor = 'pointer';

                const clickHandler = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    promptDiscordClientId();
                };
                discordRow.addEventListener('click', clickHandler);
                discordRow.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        clickHandler(e);
                    }
                });

                discordRow.appendChild(dSpan);
                discordRow.appendChild(dBtn);
                stBody.appendChild(discordRow);
            }
        }

        const observer = new MutationObserver(() => {
            patchSettings();
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

            // D-Pad Left / Right toggling for active toggle switch row
            const activeTog = document.querySelector('.st-row.tog.pad-focus, .st-row.pad-focus:has(.switch)');
            if (activeTog) {
                const isLeft = (pad.buttons && pad.buttons[14]?.pressed) || (pad.axes && pad.axes[0] < -0.65);
                const isRight = (pad.buttons && pad.buttons[15]?.pressed) || (pad.axes && pad.axes[0] > 0.65);
                if ((isLeft || isRight) && performance.now() - lastTogNavTime > 320) {
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
