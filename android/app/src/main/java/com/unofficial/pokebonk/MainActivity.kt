package com.unofficial.pokebonk

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

class MainActivity : ComponentActivity() {

    private lateinit var rootLayout: FrameLayout
    private lateinit var webView: WebView
    private val mainHandler = Handler(Looper.getMainLooper())

    private val gameUrl = "https://pokebonk.com"
    private val releaseApiUrl = "https://api.github.com/repos/JOWEND04/unofficial_pokebonk_app/releases/latest"

    private val prefsName = "pokebonk_app_prefs"
    private val prefLastInstalledAssetId = "last_installed_apk_asset_id"
    private val prefDismissedReleaseId = "dismissed_release_id"

    private var pendingInstallFile: File? = null
    private var updateBannerView: View? = null
    private var isDownloading = false

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep screen awake while playing on a Bluetooth controller
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Render edge-to-edge across the camera cutout in landscape
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        enableImmersiveFullscreen()

        rootLayout = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.BLACK)
        }

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.BLACK)

            isFocusable = true
            isFocusableInTouchMode = true
            defaultFocusHighlightEnabled = false

            setLayerType(View.LAYER_TYPE_HARDWARE, null)

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_DEFAULT
                useWideViewPort = true
                loadWithOverviewMode = false
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false

                // Use the device's native mobile Chrome User-Agent (stripping WebView-specific '; wv' and 'Version/4.0 ')
                // so pokebonk.com renders its true mobile/touch layout and viewport without squishing or overlapping
                val defaultUa = settings.userAgentString
                val mobileChromeUa = if (defaultUa.contains("Chrome", ignoreCase = true)) {
                    defaultUa.replace("; wv", "").replace("Version/4.0 ", "")
                } else {
                    "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
                }
                userAgentString = mobileChromeUa
            }

            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    val url = request?.url ?: return false
                    val host = url.host ?: return false
                    val internalHosts = listOf("pokebonk.com", "solais.cloud")
                    if (internalHosts.any { host.contains(it, ignoreCase = true) }) {
                        return false
                    }
                    // Open external links (Discord, GitHub, external auth) in browser/external app
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, url)
                        startActivity(intent)
                    } catch (_: Exception) {}
                    return true
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    injectControllerLayoutPatch(view)
                    view?.requestFocus()
                }
            }

            addJavascriptInterface(AndroidBridge(), "AndroidApp")
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        rootLayout.addView(webView)
        setContentView(rootLayout)

        webView.loadUrl(gameUrl)
        webView.requestFocus()

        var lastBackPressTime = 0L
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val now = System.currentTimeMillis()
                if (now - lastBackPressTime < 2000L) {
                    finish()
                } else {
                    lastBackPressTime = now
                    sendEscapeKeyToGame()
                    Toast.makeText(this@MainActivity, "Press back again to exit PokéBonk", Toast.LENGTH_SHORT).show()
                }
            }
        })
    }

    inner class AndroidBridge {
        @JavascriptInterface
        fun reloadGame() {
            mainHandler.post {
                webView.clearCache(true)
                CookieManager.getInstance().flush()
                webView.reload()
                Toast.makeText(this@MainActivity, "Game reloaded with latest live build", Toast.LENGTH_SHORT).show()
            }
        }

        @JavascriptInterface
        fun checkForUpdatesManual() {
            mainHandler.post {
                Toast.makeText(this@MainActivity, "Checking for app updates…", Toast.LENGTH_SHORT).show()
                checkForLatestAndroidRelease(isUserInitiated = true)
            }
        }
    }

    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
        val isGamepad = (event.source and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK ||
            (event.source and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD

        if (isGamepad) {
            if (!webView.hasFocus()) webView.requestFocus()
            if (webView.onGenericMotionEvent(event)) return true
        }

        return super.dispatchGenericMotionEvent(event)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val isGamepad = (event.source and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD ||
            (event.source and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK ||
            (event.source and InputDevice.SOURCE_DPAD) == InputDevice.SOURCE_DPAD

        if (isGamepad) {
            if (!webView.hasFocus()) webView.requestFocus()

            if (event.keyCode == KeyEvent.KEYCODE_BACK || event.keyCode == KeyEvent.KEYCODE_BUTTON_B) {
                if (event.keyCode == KeyEvent.KEYCODE_BACK) {
                    val bEvent = KeyEvent(
                        event.downTime,
                        event.eventTime,
                        event.action,
                        KeyEvent.KEYCODE_BUTTON_B,
                        event.repeatCount,
                        event.metaState,
                        event.deviceId,
                        event.scanCode,
                        event.flags,
                        InputDevice.SOURCE_GAMEPAD
                    )
                    return webView.dispatchKeyEvent(bEvent)
                }
                return webView.dispatchKeyEvent(event)
            }

            if (event.keyCode == KeyEvent.KEYCODE_MENU && event.action == KeyEvent.ACTION_DOWN) {
                webView.evaluateJavascript(
                    """
                    (function() {
                        const next = localStorage.getItem('pb_swap_abxy') !== 'true';
                        localStorage.setItem('pb_swap_abxy', String(next));
                        const toast = document.getElementById('pb-android-layout-toast') || (() => {
                            const el = document.createElement('div');
                            el.id = 'pb-android-layout-toast';
                            Object.assign(el.style, {
                                position: 'fixed',
                                right: '18px',
                                bottom: '18px',
                                zIndex: '2147483647',
                                background: 'rgba(0,0,0,0.75)',
                                color: '#fff',
                                border: '1px solid #ffd76d',
                                borderRadius: '10px',
                                padding: '10px 12px',
                                font: '600 12px/1.2 sans-serif',
                                opacity: '0',
                                transition: 'opacity 0.2s ease',
                                pointerEvents: 'none'
                            });
                            document.body.appendChild(el);
                            return el;
                        })();

                        toast.textContent = next ? 'Switch layout enabled' : 'Xbox layout enabled';
                        toast.style.opacity = '1';
                        clearTimeout(toast.__timer);
                        toast.__timer = setTimeout(() => toast.style.opacity = '0', 1800);
                    })();
                    """.trimIndent(),
                    null
                )
                return true
            }

            if (webView.dispatchKeyEvent(event)) return true
        }

        return super.dispatchKeyEvent(event)
    }

    private fun sendEscapeKeyToGame() {
        webView.evaluateJavascript(
            """
            window.dispatchEvent(new KeyboardEvent('keydown', {'key': 'Escape', 'code': 'Escape', 'keyCode': 27, 'bubbles': true}));
            setTimeout(() => {
                window.dispatchEvent(new KeyboardEvent('keyup', {'key': 'Escape', 'code': 'Escape', 'keyCode': 27, 'bubbles': true}));
            }, 50);
            """.trimIndent(),
            null
        )
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.resumeTimers()
        enableImmersiveFullscreen()
        webView.requestFocus()

        // If returned from unknown sources permission setting, continue installation
        if (pendingInstallFile != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (packageManager.canRequestPackageInstalls()) {
                val file = pendingInstallFile
                pendingInstallFile = null
                if (file != null && file.exists()) {
                    launchPackageInstaller(file)
                }
            }
        }
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        webView.pauseTimers()
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        dismissUpdateBanner()
        webView.destroy()
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            enableImmersiveFullscreen()
            webView.requestFocus()
        }
    }

    private fun enableImmersiveFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).let { controller ->
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun injectControllerLayoutPatch(view: WebView?) {
        view?.evaluateJavascript(
            """
            (function() {
                const STORAGE_KEY = 'pb_swap_abxy';
                const SENSITIVITY_KEY = 'pb_stick_sensitivity';

                function isSwapped() {
                    return localStorage.getItem(STORAGE_KEY) === 'true';
                }

                function getStickSensitivity() {
                    const raw = parseFloat(localStorage.getItem(SENSITIVITY_KEY) || '1.0');
                    return isNaN(raw) ? 1.0 : Math.max(0.2, Math.min(3.0, raw));
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

                    const sensItem = document.getElementById('pb-menu-item-sens');
                    if (sensItem) {
                        sensItem.textContent = 'Stick Sensitivity: ' + Math.round(clamped * 100) + '%';
                    }
                    return clamped;
                }

                function showToast(msg) {
                    const toast = document.getElementById('pb-android-layout-toast') || (() => {
                        const el = document.createElement('div');
                        el.id = 'pb-android-layout-toast';
                        Object.assign(el.style, {
                            position: 'fixed',
                            right: '18px',
                            bottom: '18px',
                            zIndex: '2147483647',
                            background: 'rgba(26, 22, 48, 0.95)',
                            color: '#ffcb3a',
                            border: '1.5px solid #ffcb3a',
                            borderRadius: '12px',
                            padding: '10px 18px',
                            font: '700 13px/1.2 "Nunito", system-ui, sans-serif',
                            opacity: '0',
                            transition: 'opacity 0.25s ease',
                            pointerEvents: 'none',
                            userSelect: 'none',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.7), 0 0 12px rgba(255, 203, 58, 0.2)'
                        });
                        document.body.appendChild(el);
                        return el;
                    })();

                    toast.textContent = msg;
                    toast.style.opacity = '1';
                    clearTimeout(toast.__timer);
                    toast.__timer = setTimeout(() => {
                        toast.style.opacity = '0';
                    }, 1800);
                }

                function processAxis(val, sensitivity) {
                    if (Math.abs(val) < 0.06) return 0;
                    const sign = Math.sign(val);
                    const abs = Math.abs(val);
                    const curved = Math.pow((abs - 0.06) / (1 - 0.06), 1.0 / Math.max(0.3, sensitivity));
                    return sign * Math.min(1.0, Math.max(0.0, curved));
                }

                let lastTogNavTime = 0;

                function applyLayoutPatch() {
                    try {
                        const nativeGetGamepads = navigator.getGamepads.bind(navigator);

                        navigator.getGamepads = function () {
                            const rawPads = nativeGetGamepads();
                            const result = [null, null, null, null];
                            const sensitivity = getStickSensitivity();

                            for (let i = 0; i < rawPads.length; i++) {
                                const pad = rawPads[i];
                                if (!pad) continue;

                                // D-Pad Left / Right toggle support for active toggle switch row
                                const activeTog = document.querySelector('.st-row.tog.pad-focus, .st-row.pad-focus:has(.switch)');
                                if (activeTog) {
                                    const isLeft = (pad.buttons && pad.buttons[14]?.pressed) || (pad.axes && pad.axes[0] < -0.65);
                                    const isRight = (pad.buttons && pad.buttons[15]?.pressed) || (pad.axes && pad.axes[0] > 0.65);
                                    if ((isLeft || isRight) && performance.now() - lastTogNavTime > 320) {
                                        lastTogNavTime = performance.now();
                                        activeTog.click();
                                    }
                                }

                                const mappedButtons = pad.buttons.map((b) => ({
                                    pressed: !!(b && b.pressed),
                                    touched: !!(b && b.touched),
                                    value: Number((b && b.value) || 0)
                                }));

                                if (isSwapped() && mappedButtons.length >= 4) {
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
                                    const canvas = document.getElementById('game');
                                    if (canvas && Math.abs(sensitivity - 1.0) > 0.05) {
                                        const extra = sensitivity - 1.0;
                                        window.dispatchEvent(new MouseEvent('mousemove', {
                                            movementX: (pad.axes[2] || 0) * extra * 16,
                                            movementY: (pad.axes[3] || 0) * extra * 16,
                                            bubbles: true
                                        }));
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
                    } catch (e) {}
                }

                function toggleLayout() {
                    const next = !isSwapped();
                    localStorage.setItem(STORAGE_KEY, String(next));
                    applyLayoutPatch();
                    updateMenuButtonText();
                    showToast(next ? 'Switch Layout: East = A, South = B' : 'Xbox Layout: South = A, East = B');
                }

                function updateMenuButtonText() {
                    const layoutItem = document.getElementById('pb-menu-item-layout');
                    if (layoutItem) {
                        layoutItem.textContent = isSwapped() ? 'Layout: Switch (East = A)' : 'Layout: Xbox (South = A)';
                    }
                    const sensItem = document.getElementById('pb-menu-item-sens');
                    if (sensItem) {
                        sensItem.textContent = 'Stick Sensitivity: ' + Math.round(getStickSensitivity() * 100) + '%';
                    }
                }

                // Inject CSS for controller focus on toggle switches
                if (!document.getElementById('pb-settings-gamepad-style')) {
                    const style = document.createElement('style');
                    style.id = 'pb-settings-gamepad-style';
                    style.innerHTML = `
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
                        @media (max-height: 560px) {
                            .mm-top {
                                max-width: 52vw !important;
                                right: calc(14px + var(--sr, 0px)) !important;
                                left: auto !important;
                            }
                            .banner {
                                top: calc(var(--hb, 64px) + 52px) !important;
                            }
                        }
                    `;
                    document.head.appendChild(style);
                }

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

                        // 2. Enhance and bind the game's native Sensitivity slider for controllers
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
                                    const sensItem = document.getElementById('pb-menu-item-sens');
                                    if (sensItem) {
                                        sensItem.textContent = 'Stick Sensitivity: ' + Math.round(v * 100) + '%';
                                    }
                                });
                            }
                        }
                    }

                    const observer = new MutationObserver(() => {
                        patchSettings();
                    });
                    observer.observe(document.body, { childList: true, subtree: true });
                    patchSettings();
                }
                setupSettingsGamepadPatch();

                if (!window.__pbAndroidLayoutReady) {
                    window.__pbAndroidLayoutReady = true;
                    applyLayoutPatch();

                    const oldBar = document.getElementById('pb-android-toolbar');
                    if (oldBar) oldBar.remove();

                    const overlayContainer = document.getElementById('pb-android-overlay-container') || (() => {
                        const container = document.createElement('div');
                        container.id = 'pb-android-overlay-container';
                        Object.assign(container.style, {
                            position: 'fixed',
                            right: '16px',
                            top: '16px',
                            zIndex: '2147483647',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-end',
                            userSelect: 'none'
                        });

                        const menuToggleBtn = document.createElement('button');
                        menuToggleBtn.id = 'pb-android-menu-toggle';
                        menuToggleBtn.textContent = 'MENU';
                        Object.assign(menuToggleBtn.style, {
                            padding: '8px 16px',
                            borderRadius: '10px',
                            border: '1.5px solid #ffcb3a',
                            background: 'rgba(26, 22, 48, 0.94)',
                            color: '#ffcb3a',
                            font: '800 12px/1.2 "Nunito", system-ui, sans-serif',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            cursor: 'pointer',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                            backdropFilter: 'blur(8px)'
                        });

                        const menuPanel = document.createElement('div');
                        menuPanel.id = 'pb-android-menu-panel';
                        Object.assign(menuPanel.style, {
                            display: 'none',
                            flexDirection: 'column',
                            gap: '8px',
                            marginTop: '8px',
                            padding: '12px',
                            width: '250px',
                            borderRadius: '14px',
                            border: '1.5px solid #ffcb3a',
                            background: 'rgba(26, 22, 48, 0.98)',
                            boxShadow: '0 12px 36px rgba(0,0,0,0.85), 0 0 16px rgba(255, 203, 58, 0.15)',
                            backdropFilter: 'blur(10px)'
                        });

                        function createMenuItem(id, text, onClick) {
                            const item = document.createElement('button');
                            item.id = id;
                            item.textContent = text;
                            Object.assign(item.style, {
                                padding: '11px 14px',
                                borderRadius: '10px',
                                border: '1px solid rgba(255, 203, 58, 0.25)',
                                background: 'rgba(255, 255, 255, 0.05)',
                                color: '#ffffff',
                                font: '700 12px/1.2 "Nunito", system-ui, sans-serif',
                                letterSpacing: '0.02em',
                                textAlign: 'left',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                            });
                            item.addEventListener('click', (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                onClick();
                            });
                            item.addEventListener('touchstart', (e) => {
                                e.stopPropagation();
                            }, { passive: true });
                            return item;
                        }

                        function onOutsideClick(e) {
                            if (!container.contains(e.target)) {
                                toggleMenu(false);
                            }
                        }

                        function toggleMenu(show) {
                            const isVisible = menuPanel.style.display === 'flex';
                            const next = typeof show === 'boolean' ? show : !isVisible;
                            menuPanel.style.display = next ? 'flex' : 'none';
                            menuToggleBtn.style.background = next ? '#ffcb3a' : 'rgba(26, 22, 48, 0.94)';
                            menuToggleBtn.style.color = next ? '#120e24' : '#ffcb3a';
                            if (next) {
                                updateMenuButtonText();
                                setTimeout(() => document.addEventListener('click', onOutsideClick), 10);
                            } else {
                                document.removeEventListener('click', onOutsideClick);
                            }
                        }

                        menuToggleBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            toggleMenu();
                        });
                        menuToggleBtn.addEventListener('touchstart', (e) => {
                            e.stopPropagation();
                        }, { passive: true });

                        const layoutItem = createMenuItem(
                            'pb-menu-item-layout',
                            isSwapped() ? 'Layout: Switch (East = A)' : 'Layout: Xbox (South = A)',
                            () => {
                                toggleLayout();
                                toggleMenu(false);
                            }
                        );

                        const sensItem = createMenuItem(
                            'pb-menu-item-sens',
                            'Stick Sensitivity: ' + Math.round(getStickSensitivity() * 100) + '%',
                            () => {
                                const cur = getStickSensitivity();
                                const next = cur >= 2.9 ? 0.5 : Math.round((cur + 0.25) * 100) / 100;
                                const updated = setStickSensitivity(next);
                                showToast('Stick Sensitivity: ' + Math.round(updated * 100) + '%');
                            }
                        );

                        const reloadItem = createMenuItem(
                            'pb-menu-item-reload',
                            'Reload Game',
                            () => {
                                toggleMenu(false);
                                if (window.AndroidApp && window.AndroidApp.reloadGame) {
                                    window.AndroidApp.reloadGame();
                                } else {
                                    location.reload(true);
                                }
                            }
                        );

                        const updateItem = createMenuItem(
                            'pb-menu-item-update',
                            'Check for Updates',
                            () => {
                                toggleMenu(false);
                                if (window.AndroidApp && window.AndroidApp.checkForUpdatesManual) {
                                    window.AndroidApp.checkForUpdatesManual();
                                }
                            }
                        );

                        const closeItem = createMenuItem(
                            'pb-menu-item-close',
                            'Close Menu',
                            () => {
                                toggleMenu(false);
                            }
                        );
                        closeItem.style.color = '#9e95c2';
                        closeItem.style.border = '1px solid rgba(255, 255, 255, 0.1)';

                        menuPanel.appendChild(layoutItem);
                        menuPanel.appendChild(sensItem);
                        menuPanel.appendChild(reloadItem);
                        menuPanel.appendChild(updateItem);
                        menuPanel.appendChild(closeItem);

                        container.appendChild(menuToggleBtn);
                        container.appendChild(menuPanel);
                        document.body.appendChild(container);

                        return container;
                    })();
                }
            })();
            """.trimIndent(),
            null
        )
    }

    /**
     * Checks GitHub releases for a genuine new version.
     * Prevents infinite update cycles caused by comparing version string "1.1" >= "latest".
     */
    private fun checkForLatestAndroidRelease(isUserInitiated: Boolean) {
        Thread {
            var connection: HttpURLConnection? = null
            try {
                val url = URL(releaseApiUrl)
                connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    setRequestProperty("User-Agent", "PokeBonk-Android-Client")
                    setRequestProperty("Accept", "application/vnd.github.v3+json")
                    connectTimeout = 10000
                    readTimeout = 10000
                    instanceFollowRedirects = true
                }

                if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                    if (isUserInitiated) {
                        mainHandler.post {
                            Toast.makeText(this, "Could not reach update server (${connection.responseCode})", Toast.LENGTH_SHORT).show()
                        }
                    }
                    return@Thread
                }

                val json = connection.inputStream.bufferedReader().use { it.readText() }
                val release = JSONObject(json)
                val releaseId = release.optLong("id", 0L)
                val tagName = release.optString("tag_name", "").trim()
                val releaseBody = release.optString("body", "")
                val assets = release.optJSONArray("assets") ?: return@Thread

                var apkAsset: JSONObject? = null
                var versionJsonAsset: JSONObject? = null

                for (i in 0 until assets.length()) {
                    val asset = assets.getJSONObject(i)
                    val name = asset.optString("name")
                    if (name.equals("PokeBonk.apk", ignoreCase = true)) {
                        apkAsset = asset
                    } else if (name.equals("version.json", ignoreCase = true)) {
                        versionJsonAsset = asset
                    }
                }

                if (apkAsset == null) {
                    if (isUserInitiated) {
                        mainHandler.post {
                            Toast.makeText(this, "No APK asset found in latest release.", Toast.LENGTH_SHORT).show()
                        }
                    }
                    return@Thread
                }

                val apkAssetId = apkAsset.optLong("id", 0L)
                val apkDownloadUrl = apkAsset.optString("browser_download_url")
                if (apkDownloadUrl.isBlank()) return@Thread

                val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    packageManager.getPackageInfo(packageName, android.content.pm.PackageManager.PackageInfoFlags.of(0))
                } else {
                    @Suppress("DEPRECATION")
                    packageManager.getPackageInfo(packageName, 0)
                }

                val currentVersionName = packageInfo.versionName ?: "1.0"
                val currentVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    packageInfo.longVersionCode
                } else {
                    @Suppress("DEPRECATION")
                    packageInfo.versionCode.toLong()
                }

                val prefs = getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                val lastInstalledAssetId = prefs.getLong(prefLastInstalledAssetId, 0L)
                val dismissedReleaseId = prefs.getLong(prefDismissedReleaseId, 0L)

                // 1. If user already installed this exact asset, skip
                if (apkAssetId != 0L && apkAssetId == lastInstalledAssetId) {
                    if (isUserInitiated) {
                        mainHandler.post {
                            Toast.makeText(this, "PokéBonk is up to date (Build #$currentVersionCode)!", Toast.LENGTH_SHORT).show()
                        }
                    }
                    return@Thread
                }

                // 2. If non-user-initiated and user dismissed this release, skip
                if (!isUserInitiated && releaseId != 0L && releaseId == dismissedReleaseId) {
                    return@Thread
                }

                var isUpdateAvailable = false
                var displayVersion = tagName

                // Check version.json asset if present
                if (versionJsonAsset != null) {
                    val vUrl = versionJsonAsset.optString("browser_download_url")
                    if (vUrl.isNotBlank()) {
                        try {
                            val vConn = (URL(vUrl).openConnection() as HttpURLConnection).apply {
                                setRequestProperty("User-Agent", "PokeBonk-Android-Client")
                                connectTimeout = 8000
                                readTimeout = 8000
                                instanceFollowRedirects = true
                            }
                            if (vConn.responseCode == HttpURLConnection.HTTP_OK) {
                                val vText = vConn.inputStream.bufferedReader().use { it.readText() }
                                val vObj = JSONObject(vText)
                                val remoteVersionCode = vObj.optLong("versionCode", -1L)
                                val remoteVersionName = vObj.optString("versionName", "")

                                if (remoteVersionCode > 0) {
                                    if (remoteVersionCode > currentVersionCode) {
                                        isUpdateAvailable = true
                                        displayVersion = if (remoteVersionName.isNotBlank()) "v$remoteVersionName" else "Build #$remoteVersionCode"
                                    } else {
                                        // Remote versionCode is less than or equal to current build
                                        isUpdateAvailable = false
                                    }
                                } else if (remoteVersionName.isNotBlank()) {
                                    isUpdateAvailable = isNewerVersion(currentVersionName, remoteVersionName)
                                    displayVersion = "v$remoteVersionName"
                                }
                            }
                        } catch (_: Exception) {}
                    }
                }

                // If not determined via version.json, check release body for version metadata
                if (!isUpdateAvailable && versionJsonAsset == null) {
                    val codeRegex = Regex("""(?:Build|VersionCode|Code):\s*([0-9]+)""", RegexOption.IGNORE_CASE)
                    val codeMatch = codeRegex.find(releaseBody)
                    if (codeMatch != null) {
                        val bodyCode = codeMatch.groupValues[1].toLongOrNull() ?: -1L
                        if (bodyCode > 0) {
                            if (bodyCode > currentVersionCode) {
                                isUpdateAvailable = true
                                displayVersion = "Build #$bodyCode"
                            }
                        }
                    }

                    if (!isUpdateAvailable) {
                        val verRegex = Regex("""(?:Version):\s*v?([0-9.]+)""", RegexOption.IGNORE_CASE)
                        val verMatch = verRegex.find(releaseBody)
                        if (verMatch != null) {
                            val bodyVer = verMatch.groupValues[1]
                            if (isNewerVersion(currentVersionName, bodyVer)) {
                                isUpdateAvailable = true
                                displayVersion = "v$bodyVer"
                            }
                        }
                    }
                }

                // If tag is a semver tag (e.g. v1.2, 2.0.0) and not "latest"
                if (!isUpdateAvailable && !tagName.equals("latest", ignoreCase = true) && tagName.isNotBlank()) {
                    isUpdateAvailable = isNewerVersion(currentVersionName, tagName)
                    if (isUpdateAvailable) {
                        displayVersion = tagName
                    }
                }

                // Special handling for rolling "latest" tag:
                // If tag is "latest" and no higher version is explicitly stated:
                // If the app was just installed (lastInstalledAssetId == 0), record this asset as current so it never loops.
                if (tagName.equals("latest", ignoreCase = true) && !isUpdateAvailable) {
                    if (lastInstalledAssetId == 0L) {
                        // First run after clean install: mark current asset as installed
                        prefs.edit().putLong(prefLastInstalledAssetId, apkAssetId).apply()
                    }

                    if (isUserInitiated) {
                        mainHandler.post {
                            Toast.makeText(this, "PokéBonk is up to date (v$currentVersionName)!", Toast.LENGTH_SHORT).show()
                        }
                    }
                    return@Thread
                }

                if (!isUpdateAvailable) {
                    if (isUserInitiated) {
                        mainHandler.post {
                            Toast.makeText(this, "You are on the latest version (v$currentVersionName)!", Toast.LENGTH_SHORT).show()
                        }
                    }
                    return@Thread
                }

                // Present in-app update banner
                mainHandler.post {
                    showInAppUpdateBanner(displayVersion, apkDownloadUrl, apkAssetId, releaseId)
                }

            } catch (_: Exception) {
                if (isUserInitiated) {
                    mainHandler.post {
                        Toast.makeText(this, "Unable to check for updates right now.", Toast.LENGTH_SHORT).show()
                    }
                }
            } finally {
                connection?.disconnect()
            }
        }.start()
    }

    /**
     * Displays a clean, non-intrusive in-app update card instead of immediately
     * hijacking the device with an external package installer.
     */
    private fun showInAppUpdateBanner(
        newVersionName: String,
        downloadUrl: String,
        apkAssetId: Long,
        releaseId: Long
    ) {
        if (isFinishing || isDestroyed || isDownloading) return

        dismissUpdateBanner()

        val dp = { value: Int ->
            TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value.toFloat(),
                resources.displayMetrics
            ).toInt()
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val padH = dp(16)
            val padV = dp(12)
            setPadding(padH, padV, padH, padV)

            val bg = GradientDrawable().apply {
                setColor(Color.parseColor("#F01A1630"))
                setStroke(dp(2), Color.parseColor("#FFCB3A"))
                cornerRadius = dp(14).toFloat()
            }
            background = bg

            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                topMargin = dp(20)
            }
            elevation = dp(12).toFloat()
        }

        val titleView = TextView(this).apply {
            text = "PokéBonk Update Available"
            setTextColor(Color.parseColor("#FFCB3A"))
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
        }
        card.addView(titleView)

        val descView = TextView(this).apply {
            text = "New native wrapper update ($newVersionName) is ready."
            setTextColor(Color.parseColor("#EDF4FF"))
            textSize = 12f
            setPadding(0, dp(4), 0, dp(10))
        }
        card.addView(descView)

        val actionsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
        }

        val laterBtn = Button(this).apply {
            text = "Later"
            setTextColor(Color.parseColor("#9E95C2"))
            textSize = 12f
            setBackgroundColor(Color.TRANSPARENT)
            setPadding(dp(12), dp(6), dp(12), dp(6))
            setOnClickListener {
                val prefs = getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                prefs.edit().putLong(prefDismissedReleaseId, releaseId).apply()
                dismissUpdateBanner()
            }
        }
        actionsRow.addView(laterBtn)

        val updateBtn = Button(this).apply {
            text = "Update Now"
            setTextColor(Color.parseColor("#120E24"))
            textSize = 12f
            setTypeface(null, Typeface.BOLD)
            val btnBg = GradientDrawable().apply {
                setColor(Color.parseColor("#FFCB3A"))
                cornerRadius = dp(8).toFloat()
            }
            background = btnBg
            setPadding(dp(14), dp(6), dp(14), dp(6))
            setOnClickListener {
                startInAppDownload(card, downloadUrl, apkAssetId)
            }
        }
        actionsRow.addView(updateBtn)

        card.addView(actionsRow)

        updateBannerView = card
        rootLayout.addView(card)
    }

    private fun dismissUpdateBanner() {
        updateBannerView?.let {
            rootLayout.removeView(it)
            updateBannerView = null
        }
    }

    /**
     * Handles downloading entirely in-app with streaming HTTP and progress indication,
     * without cluttering system notifications or downloading multiple times.
     */
    private fun startInAppDownload(container: LinearLayout, downloadUrl: String, apkAssetId: Long) {
        if (isDownloading) return
        isDownloading = true

        val dp = { value: Int ->
            TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value.toFloat(),
                resources.displayMetrics
            ).toInt()
        }

        container.removeAllViews()

        val progressTitle = TextView(this).apply {
            text = "Downloading PokéBonk Update…"
            setTextColor(Color.parseColor("#FFD76D"))
            textSize = 13f
            setTypeface(null, Typeface.BOLD)
        }
        container.addView(progressTitle)

        val progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = false
            max = 100
            progress = 0
            layoutParams = LinearLayout.LayoutParams(
                dp(280),
                dp(16)
            ).apply {
                topMargin = dp(8)
                bottomMargin = dp(6)
            }
        }
        container.addView(progressBar)

        val statusText = TextView(this).apply {
            text = "Connecting…"
            setTextColor(Color.parseColor("#EDF4FF"))
            textSize = 11f
        }
        container.addView(statusText)

        Thread {
            var connection: HttpURLConnection? = null
            try {
                // Ensure update cache folder exists
                val updatesDir = File(cacheDir, "updates")
                if (!updatesDir.exists()) updatesDir.mkdirs()

                val apkFile = File(updatesDir, "pokebonk-update.apk")
                if (apkFile.exists()) apkFile.delete()

                // Robust redirect following for GitHub Releases (github.com -> objects.githubusercontent.com)
                var currentUrl = downloadUrl
                var redirects = 0
                val maxRedirects = 8

                while (redirects < maxRedirects) {
                    val u = URL(currentUrl)
                    connection = (u.openConnection() as HttpURLConnection).apply {
                        instanceFollowRedirects = true
                        setRequestProperty("User-Agent", "PokeBonk-Android-Client")
                        connectTimeout = 15000
                        readTimeout = 20000
                    }

                    val code = connection.responseCode
                    if (code == HttpURLConnection.HTTP_MOVED_PERM ||
                        code == HttpURLConnection.HTTP_MOVED_TEMP ||
                        code == HttpURLConnection.HTTP_SEE_OTHER ||
                        code == 307 || code == 308
                    ) {
                        val newUrl = connection.getHeaderField("Location")
                        connection.disconnect()
                        if (newUrl != null) {
                            currentUrl = newUrl
                            redirects++
                            continue
                        }
                    }
                    break
                }

                if (connection == null || connection.responseCode != HttpURLConnection.HTTP_OK) {
                    throw Exception("Server returned HTTP ${connection?.responseCode ?: -1}")
                }

                val totalLength = connection.contentLength.toLong()
                var downloadedBytes = 0L

                connection.inputStream.use { input ->
                    FileOutputStream(apkFile).use { output ->
                        val buffer = ByteArray(8192)
                        var bytesRead: Int
                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            output.write(buffer, 0, bytesRead)
                            downloadedBytes += bytesRead

                            if (totalLength > 0) {
                                val percent = ((downloadedBytes * 100) / totalLength).toInt()
                                mainHandler.post {
                                    progressBar.progress = percent
                                    statusText.text = "$percent% downloaded (${downloadedBytes / 1024} KB / ${totalLength / 1024} KB)"
                                }
                            }
                        }
                        output.flush()
                    }
                }

                // Mark this asset as installed in preferences
                val prefs = getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                prefs.edit().putLong(prefLastInstalledAssetId, apkAssetId).apply()

                mainHandler.post {
                    isDownloading = false
                    dismissUpdateBanner()
                    launchPackageInstaller(apkFile)
                }

            } catch (e: Exception) {
                mainHandler.post {
                    isDownloading = false
                    statusText.text = "Download failed: ${e.message}"
                    statusText.setTextColor(Color.parseColor("#FF6F61"))
                    Toast.makeText(this, "Update download failed: ${e.message}", Toast.LENGTH_LONG).show()
                    mainHandler.postDelayed({ dismissUpdateBanner() }, 3500)
                }
            } finally {
                connection?.disconnect()
            }
        }.start()
    }

    /**
     * Prompts Android package installer for this app update.
     */
    private fun launchPackageInstaller(apkFile: File) {
        if (!apkFile.exists() || apkFile.length() == 0L) {
            Toast.makeText(this, "Downloaded APK is missing or empty.", Toast.LENGTH_SHORT).show()
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!packageManager.canRequestPackageInstalls()) {
                pendingInstallFile = apkFile
                Toast.makeText(this, "Please allow PokéBonk to install updates", Toast.LENGTH_LONG).show()
                val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
                return
            }
        }

        try {
            val apkUri = FileProvider.getUriForFile(
                this,
                "${packageName}.fileprovider",
                apkFile
            )

            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(installIntent)
        } catch (e: Exception) {
            Toast.makeText(this, "Unable to launch installer: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    /**
     * Numerical semantic version comparator (e.g. 1.2 > 1.1, 1.10 > 1.2).
     * Replaces broken string comparison like "1.1" >= "latest".
     */
    private fun isNewerVersion(current: String, candidate: String): Boolean {
        val cleanCurrent = current.trim().removePrefix("v")
        val cleanCandidate = candidate.trim().removePrefix("v")

        if (cleanCandidate.isBlank() || cleanCandidate.equals("latest", ignoreCase = true)) {
            return false
        }

        val currentParts = cleanCurrent.split(".").mapNotNull { it.toIntOrNull() }
        val candidateParts = cleanCandidate.split(".").mapNotNull { it.toIntOrNull() }

        if (currentParts.isEmpty() || candidateParts.isEmpty()) {
            return false
        }

        val maxLen = maxOf(currentParts.size, candidateParts.size)
        for (i in 0 until maxLen) {
            val pCurrent = currentParts.getOrElse(i) { 0 }
            val pCandidate = candidateParts.getOrElse(i) { 0 }
            if (pCandidate > pCurrent) return true
            if (pCandidate < pCurrent) return false
        }
        return false
    }
}
