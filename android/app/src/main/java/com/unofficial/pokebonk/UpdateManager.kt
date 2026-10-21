package com.unofficial.pokebonk

import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class UpdateManager(private val context: Context) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private val releasePageUrl = "https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest"
    private val directApkUrl = "https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest/download/PokeBonk.apk"
    private val versionJsonUrl = "https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest/download/version.json"
    private val releaseApiUrl = "https://api.github.com/repos/JOWEND04/unofficial_pokebonk_app/releases/latest"

    fun checkForUpdates(isUserInitiated: Boolean) {
        executor.execute {
            try {
                var remoteVersionName: String? = null
                var remoteVersionCode: Long = -1

                // 1. Check version.json directly (avoids GitHub API 60 req/hr rate limits)
                try {
                    val conn = (URL(versionJsonUrl).openConnection() as HttpURLConnection).apply {
                        requestMethod = "GET"
                        setRequestProperty("User-Agent", "PokeBonk-Android-Updater")
                        connectTimeout = 5000
                        readTimeout = 5000
                        instanceFollowRedirects = true
                    }
                    if (conn.responseCode == HttpURLConnection.HTTP_OK) {
                        val jsonStr = conn.inputStream.bufferedReader().use { it.readText() }
                        val vObj = JSONObject(jsonStr)
                        if (vObj.has("android")) {
                            val aObj = vObj.getJSONObject("android")
                            remoteVersionName = aObj.optString("versionName", null)
                            remoteVersionCode = aObj.optLong("versionCode", -1)
                        } else {
                            remoteVersionName = vObj.optString("versionName", null)
                            remoteVersionCode = vObj.optLong("versionCode", -1)
                        }
                    }
                } catch (_: Exception) {}

                // 2. Fallback to GitHub Releases API if version.json wasn't available
                if (remoteVersionName.isNullOrBlank() && remoteVersionCode <= 0) {
                    try {
                        val apiConn = (URL(releaseApiUrl).openConnection() as HttpURLConnection).apply {
                            requestMethod = "GET"
                            setRequestProperty("User-Agent", "PokeBonk-Android-Updater")
                            setRequestProperty("Accept", "application/vnd.github.v3+json")
                            connectTimeout = 6000
                            readTimeout = 6000
                        }
                        if (apiConn.responseCode == HttpURLConnection.HTTP_OK) {
                            val apiStr = apiConn.inputStream.bufferedReader().use { it.readText() }
                            val release = JSONObject(apiStr)
                            val tag = release.optString("tag_name", "").removePrefix("v").trim()
                            if (tag.isNotBlank() && tag != "latest") {
                                remoteVersionName = tag
                            }
                            val assets = release.optJSONArray("assets")
                            if (assets != null) {
                                for (i in 0 until assets.length()) {
                                    val asset = assets.getJSONObject(i)
                                    if (asset.optString("name").equals("version.json", ignoreCase = true)) {
                                        val vUrl = asset.optString("browser_download_url")
                                        if (vUrl.isNotBlank()) {
                                            val vConn = (URL(vUrl).openConnection() as HttpURLConnection).apply {
                                                connectTimeout = 4000
                                                readTimeout = 4000
                                                instanceFollowRedirects = true
                                            }
                                            if (vConn.responseCode == HttpURLConnection.HTTP_OK) {
                                                val vObj = JSONObject(vConn.inputStream.bufferedReader().use { it.readText() })
                                                remoteVersionCode = vObj.optLong("versionCode", remoteVersionCode)
                                                remoteVersionName = vObj.optString("versionName", remoteVersionName)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } catch (_: Exception) {}
                }

                // 3. Inspect locally installed app version
                val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    context.packageManager.getPackageInfo(context.packageName, android.content.pm.PackageManager.PackageInfoFlags.of(0))
                } else {
                    @Suppress("DEPRECATION")
                    context.packageManager.getPackageInfo(context.packageName, 0)
                }

                val currentVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    packageInfo.longVersionCode
                } else {
                    @Suppress("DEPRECATION")
                    packageInfo.versionCode.toLong()
                }
                val currentVersionName = packageInfo.versionName ?: "1.0"

                val hasUpdate = (remoteVersionCode > 0 && remoteVersionCode > currentVersionCode) ||
                        (!remoteVersionName.isNullOrBlank() && isSemverHigher(remoteVersionName, currentVersionName))

                if (hasUpdate) {
                    val displayVersion = remoteVersionName ?: "vNext"
                    mainHandler.post {
                        promptUpdateAvailable(displayVersion, currentVersionName)
                    }
                } else {
                    if (isUserInitiated) {
                        showToast("PokéBonk is up to date (v$currentVersionName)")
                    }
                }

            } catch (e: Exception) {
                if (isUserInitiated) {
                    showToast("Could not check for updates. Check internet connection.")
                }
            }
        }
    }

    private fun promptUpdateAvailable(remoteVersion: String, currentVersion: String) {
        try {
            if (context is android.app.Activity && (context.isFinishing || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && context.isDestroyed))) {
                return
            }
            AlertDialog.Builder(context)
                .setTitle("PokéBonk Update Available")
                .setMessage("A new version of PokéBonk (v$remoteVersion) is ready!\n\nYou are currently running v$currentVersion.\n\nOpen the GitHub Release page to download the latest APK?")
                .setPositiveButton("Open Release Page") { _, _ ->
                    openReleasePage()
                }
                .setNeutralButton("Direct Download APK") { _, _ ->
                    openDirectApkDownload()
                }
                .setNegativeButton("Later", null)
                .show()
        } catch (_: Exception) {}
    }

    fun openReleasePage() {
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(releasePageUrl)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            showToast("Could not open browser: ${e.localizedMessage}")
        }
    }

    fun openDirectApkDownload() {
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(directApkUrl)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            openReleasePage()
        }
    }

    private fun isSemverHigher(remote: String, local: String): Boolean {
        try {
            val rClean = remote.removePrefix("v").trim()
            val lClean = local.removePrefix("v").trim()
            val rParts = rClean.split(".").map { it.toIntOrNull() ?: 0 }
            val lParts = lClean.split(".").map { it.toIntOrNull() ?: 0 }
            val maxLen = maxOf(rParts.size, lParts.size)
            for (i in 0 until maxLen) {
                val r = rParts.getOrElse(i) { 0 }
                val l = lParts.getOrElse(i) { 0 }
                if (r > l) return true
                if (r < l) return false
            }
        } catch (_: Exception) {}
        return false
    }

    private fun showToast(msg: String) {
        mainHandler.post {
            Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
        }
    }
}
