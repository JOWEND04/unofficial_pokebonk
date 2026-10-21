package com.unofficial.pokebonk

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File
import java.net.URL
import org.json.JSONObject

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private val gameUrl = "https://pokebonk.com"

    private val releaseApiUrl = "https://api.github.com/repos/JOWEND04/unofficial_pokebonk/releases/latest"
    private val apkFileName = "PokeBonk.apk"
    private var downloadId: Long = 0L
    private var pendingInstallUri: Uri? = null

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        checkForLatestAndroidRelease()

        // Keep screen awake while playing on a Bluetooth controller
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Render edge-to-edge across the camera cutout in landscape
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        enableImmersiveFullscreen()

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(android.graphics.Color.BLACK)

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
                loadWithOverviewMode = true
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false

                userAgentString =
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            }

            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    val host = request?.url?.host ?: return false
                    val allowed = listOf("pokebonk", "solais.cloud", "google", "discord")
                    return allowed.none { host.contains(it, ignoreCase = true) }
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)

                    injectControllerLayoutPatch(view)

                    view?.requestFocus()
                }
            }
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        setContentView(webView)
        webView.loadUrl(gameUrl)
        webView.requestFocus()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                sendEscapeKeyToGame()
            }
        })
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
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        webView.pauseTimers()
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
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

                function showToast(msg) {
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

                    toast.textContent = msg;
                    toast.style.opacity = '1';
                    clearTimeout(toast.__timer);
                    toast.__timer = setTimeout(() => {
                        toast.style.opacity = '0';
                    }, 1800);
                }

                function applyLayoutPatch() {
                    try {
                        const nativeGetGamepads = navigator.getGamepads.bind(navigator);

                        navigator.getGamepads = function () {
                            const rawPads = nativeGetGamepads();
                            const result = [null, null, null, null];

                            for (let i = 0; i < rawPads.length; i++) {
                                const pad = rawPads[i];
                                if (!pad) continue;

                                const mappedButtons = pad.buttons.map((b) => ({
                                    pressed: !!(b && b.pressed),
                                    touched: !!(b && b.touched),
                                    value: Number((b && b.value) || 0)
                                }));

                                if (localStorage.getItem(STORAGE_KEY) === 'true' && mappedButtons.length >= 4) {
                                    const b0 = mappedButtons[0];
                                    mappedButtons[0] = mappedButtons[1];
                                    mappedButtons[1] = b0;

                                    const b2 = mappedButtons[2];
                                    mappedButtons[2] = mappedButtons[3];
                                    mappedButtons[3] = b2;
                                }

                                result[i] = {
                                    id: pad.id,
                                    index: pad.index,
                                    connected: pad.connected,
                                    timestamp: pad.timestamp,
                                    mapping: 'standard',
                                    axes: pad.axes ? pad.axes.map(v => Math.abs(v) < 0.08 ? 0 : v) : [],
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
                    const next = localStorage.getItem(STORAGE_KEY) !== 'true';
                    localStorage.setItem(STORAGE_KEY, String(next));
                    applyLayoutPatch();
                    showToast(next ? 'Switch layout enabled' : 'Xbox layout enabled');
                }

                if (!window.__pbAndroidLayoutReady) {
                    window.__pbAndroidLayoutReady = true;
                    applyLayoutPatch();

                    const toggle = document.getElementById('pb-android-layout-toggle') || (() => {
                        const btn = document.createElement('button');
                        btn.id = 'pb-android-layout-toggle';
                        btn.textContent = 'Layout';
                        Object.assign(btn.style, {
                            position: 'fixed',
                            right: '18px',
                            top: '18px',
                            zIndex: '2147483647',
                            padding: '10px 12px',
                            borderRadius: '10px',
                            border: '1px solid #ffd76d',
                            background: 'rgba(0,0,0,0.75)',
                            color: '#fff',
                            font: '600 12px/1.2 sans-serif',
                            cursor: 'pointer'
                        });
                        btn.onclick = toggleLayout;
                        document.body.appendChild(btn);
                        return btn;
                    })();

                    toggle.addEventListener('click', toggleLayout);
                }
            })();
            """.trimIndent(),
            null
        )
    }

    private fun checkForLatestAndroidRelease() {
        Thread {
            try {
                val json = URL(releaseApiUrl).readText()
                val release = JSONObject(json)
                val assets = release.optJSONArray("assets") ?: return@Thread

                var apkAsset: JSONObject? = null
                for (i in 0 until assets.length()) {
                    val asset = assets.getJSONObject(i)
                    if (asset.optString("name").equals("PokeBonk.apk", ignoreCase = true)) {
                        apkAsset = asset
                        break
                    }
                }

                if (apkAsset == null) {
                    return@Thread
                }

                val currentVersion = packageManager.getPackageInfo(packageName, 0).versionName ?: "0"
                val latestVersion = release.optString("tag_name", "").removePrefix("v")

                if (latestVersion.isBlank() || currentVersion >= latestVersion) {
                    return@Thread
                }

                val apkUrl = apkAsset.optString("browser_download_url")
                if (apkUrl.isBlank()) return@Thread

                runOnUiThread {
                    promptToDownloadApk(apkUrl)
                }
            } catch (_: Exception) {
                // Ignore network errors silently
            }
        }.start()
    }

    private fun promptToDownloadApk(apkUrl: String) {
        val apkUri = Uri.parse(apkUrl)
        val file = File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), apkFileName)
        if (file.exists()) {
            file.delete()
        }

        val request = DownloadManager.Request(apkUri)
            .setTitle("PokéBonk update")
            .setDescription("Downloading latest PokeBonk APK")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(this@MainActivity, Environment.DIRECTORY_DOWNLOADS, "pokebonk-update.apk")
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(true)

        val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        downloadId = dm.enqueue(request)

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val action = intent.action
                if (action == DownloadManager.ACTION_DOWNLOAD_COMPLETE) {
                    val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
                    if (id == downloadId) {
                        val downloadedFile = File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), apkFileName)
                        if (downloadedFile.exists()) {
                            pendingInstallUri = FileProvider.getUriForFile(
                                this@MainActivity,
                                "${packageName}.fileprovider",
                                downloadedFile
                            )

                            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                                setDataAndType(pendingInstallUri, "application/vnd.android.package-archive")
                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                            startActivity(installIntent)
                        }
                    }
                }
            }
        }

        registerReceiver(receiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE))
    }
}
