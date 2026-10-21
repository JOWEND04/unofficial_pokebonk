package com.unofficial.pokebonk

import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : ComponentActivity() {

    private lateinit var webView: PokeBonkWebView
    private lateinit var updateManager: UpdateManager
    private val mainHandler = Handler(Looper.getMainLooper())
    private var lastBackPressTime = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep screen awake while playing
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Extend edge-to-edge through display cutouts on Android 9+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }

        enableImmersiveFullscreen()

        updateManager = UpdateManager(this)
        webView = PokeBonkWebView(this, updateManager)

        val root = FrameLayout(this).apply {
            setBackgroundColor(android.graphics.Color.BLACK)
            addView(
                webView,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )
        }

        setContentView(root)
        webView.loadUrl("https://pokebonk.com")

        // Back press handling: first tap sends Escape to game menu, double tap exits
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

        // Check for updates in background after 5s
        mainHandler.postDelayed({
            if (!isFinishing && !isDestroyed) {
                updateManager.checkForUpdates(isUserInitiated = false)
            }
        }, 5000)
    }

    private fun sendEscapeKeyToGame() {
        val escapeScript = """
            window.dispatchEvent(new KeyboardEvent('keydown', {'key': 'Escape', 'code': 'Escape', 'keyCode': 27, 'bubbles': true}));
            setTimeout(() => {
                window.dispatchEvent(new KeyboardEvent('keyup', {'key': 'Escape', 'code': 'Escape', 'keyCode': 27, 'bubbles': true}));
            }, 50);
        """.trimIndent()
        webView.evaluateJavascript(escapeScript, null)
    }

    private fun enableImmersiveFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).let { controller ->
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
        if (GamepadHelper.isGamepadEvent(event)) {
            if (!webView.hasFocus()) webView.requestFocus()
            if (webView.onGenericMotionEvent(event)) return true
        }
        return super.dispatchGenericMotionEvent(event)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (GamepadHelper.isGamepadEvent(event)) {
            if (!webView.hasFocus()) webView.requestFocus()
            if (webView.dispatchKeyEvent(event)) return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onResume() {
        super.onResume()
        enableImmersiveFullscreen()
        webView.onResume()
        webView.resumeTimers()
    }

    override fun onPause() {
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
}
