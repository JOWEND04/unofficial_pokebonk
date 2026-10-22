package com.unofficial.pokebonk

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

@SuppressLint("SetJavaScriptEnabled")
class PokeBonkWebView(context: Context) : WebView(context) {

    init {
        setBackgroundColor(Color.BLACK)
        isFocusable = true
        isFocusableInTouchMode = true
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

            // Standard modern Chrome mobile UA
            userAgentString = "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(this@PokeBonkWebView, true)
        }

        webChromeClient = WebChromeClient()
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                val host = url.host?.lowercase() ?: return false
                val internalHosts = listOf("pokebonk.com", "solais.cloud")

                if (internalHosts.any { host.contains(it) }) {
                    return false
                }

                // External links (Discord, GitHub, external auth) open in browser
                try {
                    val intent = Intent(Intent.ACTION_VIEW, url)
                    context.startActivity(intent)
                } catch (_: Exception) {}
                return true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                injectCoreAssets()
            }
        }

        addJavascriptInterface(AndroidBridge(), "AndroidApp")
    }

    private fun injectCoreAssets() {
        try {
            // Read unified core JS and CSS from Android assets
            val js = context.assets.open("pokebonk-core.js").bufferedReader().use { it.readText() }
            val css = context.assets.open("pokebonk-theme.css").bufferedReader().use { it.readText() }

            val cssInjection = """
                (function() {
                    if (document.getElementById('pb-injected-theme')) return;
                    const style = document.createElement('style');
                    style.id = 'pb-injected-theme';
                    style.textContent = ${JSONObject.quote(css)};
                    document.head.appendChild(style);
                })();
            """.trimIndent()

            evaluateJavascript(cssInjection, null)
            evaluateJavascript(js, null)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    inner class AndroidBridge {
        @JavascriptInterface
        fun reloadGame() {
            post {
                clearCache(false)
                reload()
            }
        }

        @JavascriptInterface
        fun checkForUpdatesManual() {
            post {
                openReleasePage()
            }
        }

        @JavascriptInterface
        fun openReleasePage() {
            post {
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest")).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(intent)
                } catch (_: Exception) {}
            }
        }

        @JavascriptInterface
        fun getAppVersion(): String {
            return try {
                val pInfo = context.packageManager.getPackageInfo(context.packageName, 0)
                pInfo.versionName ?: "1.0"
            } catch (_: Exception) {
                "1.0"
            }
        }
    }
}
