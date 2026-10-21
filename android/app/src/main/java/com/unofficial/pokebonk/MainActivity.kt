package com.unofficial.pokebonk

import android.annotation.SuppressLint
import android.os.Build
import android.os.Bundle
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
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private val gameUrl = "https://pokebonk.com"

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

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(android.graphics.Color.BLACK)

            // Critical for routing gamepad axes and buttons into Chromium
            isFocusable = true
            isFocusableInTouchMode = true
            defaultFocusHighlightEnabled = false // Hides ugly Android focus box around the canvas

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

                // Desktop User-Agent ensures clean desktop UI and native controller prompts
                userAgentString = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            }

            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    val host = request?.url?.host ?: return false
                    // Allow PokéBonk domains and OAuth/login providers if user signs in
                    val allowed = listOf("pokebonk", "solais.cloud", "google", "discord")
                    return allowed.none { host.contains(it, ignoreCase = true) }
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    // Force WebGL canvas to 100% fullscreen and prevent touch callouts/selection
                    view?.evaluateJavascript(
                        """
                        (function() {
                            const style = document.createElement('style');
                            style.innerHTML = `
                                * { -webkit-touch-callout: none !important; -webkit-user-select: none !important; user-select: none !important; outline: none !important; }
                                html, body { margin: 0 !important; padding: 0 !important; width: 100vw !important; height: 100vh !important; overflow: hidden !important; background: #000 !important; }
                                canvas#game { width: 100vw !important; height: 100vh !important; display: block !important; object-fit: cover !important; }
                            `;
                            document.head.appendChild(style);
                            window.focus();
                        })();
                        """.trimIndent(),
                        null
                    )
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

        // Swipe-back on the phone screen triggers in-game Escape (Pause) instead of closing the app
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                sendEscapeKeyToGame()
            }
        })
    }

    // Route analog sticks, triggers (L2/R2), and D-Pad hat axes directly to WebView
    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
        val isGamepad = (event.source and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK ||
                        (event.source and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
        if (isGamepad) {
            if (!webView.hasFocus()) webView.requestFocus()
            if (webView.onGenericMotionEvent(event)) return true
        }
        return super.dispatchGenericMotionEvent(event)
    }

    // Route Bluetooth controller face buttons, bumpers, and D-pad keys directly to WebView
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val isGamepad = (event.source and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD ||
                        (event.source and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK ||
                        (event.source and InputDevice.SOURCE_DPAD) == InputDevice.SOURCE_DPAD

        if (isGamepad) {
            if (!webView.hasFocus()) webView.requestFocus()

            // Many Bluetooth controllers map 'B' to KEYCODE_BACK; prevent it from exiting the app
            if (event.keyCode == KeyEvent.KEYCODE_BACK || event.keyCode == KeyEvent.KEYCODE_BUTTON_B) {
                if (event.keyCode == KeyEvent.KEYCODE_BACK) {
                    // Translate raw Android Back from controller into a proper Gamepad B button event
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
        // Flush cookies/localStorage to disk immediately so run progress is never lost
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
}
