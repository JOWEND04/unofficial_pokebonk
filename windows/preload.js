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
            display: flex !important; align-items: center !important; justify-content: center !important;
        }
        canvas { 
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

    // Discord RPC updater loop
    let lastSentDetails = '';
    setInterval(() => {
        try {
            const scoreElem = document.querySelector('.score, [class*="score"], [class*="run-stats"]');
            const bossElem = document.querySelector('.boss-name, [class*="boss"]');
            
            let details = 'Exploring Map';
            let state = 'In Active Run';

            if (bossElem && bossElem.textContent) {
                details = `Fighting Boss: ${bossElem.textContent.trim()}`;
            } else if (scoreElem && scoreElem.textContent) {
                details = `Run Score: ${scoreElem.textContent.trim()}`;
            }

            if (details !== lastSentDetails) {
                lastSentDetails = details;
                ipcRenderer.send('update-rpc', { details, state, resetTimer: true });
            }
        } catch (e) {}
    }, 6000);

    // Controller input mapping
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
                    ? '🎮 Layout: AB/XY Swapped (Nintendo Labels: East = A)'
                    : '🎮 Layout: Standard Positional (South Button = Jump)'
            );
        }
    });

    window.addEventListener('gamepadconnected', (e) => {
        const nintendo = isNintendoDevice(e.gamepad.id);
        const name = nintendo ? 'Nintendo / Switch Mode Controller' : 'Xbox / XInput Controller';
        const modeText = swapABXY ? 'Swapped AB/XY' : 'Standard Positional';
        showToast(`🎮 ${name} Connected [${modeText}] — Press F9 to swap A/B, Hold Start+Select to Quit`, 4500);
    });

    const DEADZONE = 0.08;
    function cleanAxis(val) {
        return Math.abs(val) < DEADZONE ? 0 : val;
    }

    let quitHoldStart = 0;
    const nativeGetGamepads = navigator.getGamepads.bind(navigator);

    navigator.getGamepads = function () {
        const rawPads = nativeGetGamepads();
        const result = [null, null, null, null];

        for (let i = 0; i < rawPads.length; i++) {
            const pad = rawPads[i];
            if (!pad) continue;

            const hasStickInput = pad.axes && pad.axes.some(a => Math.abs(a) > 0.22);
            const hasButtonInput = pad.buttons && pad.buttons.some(b => b && b.pressed);
            if (hasStickInput || hasButtonInput) {
                document.body.classList.add('controller-active');
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

            const mappedAxes = pad.axes ? pad.axes.map(cleanAxis) : [];

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
