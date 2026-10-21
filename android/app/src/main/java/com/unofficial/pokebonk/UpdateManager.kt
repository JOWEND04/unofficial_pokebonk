package com.unofficial.pokebonk

import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class UpdateManager(private val context: Context) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private val releaseApiUrl = "https://api.github.com/repos/JOWEND04/unofficial_pokebonk_app/releases/latest"

    fun checkForUpdates(isUserInitiated: Boolean) {
        executor.execute {
            try {
                val conn = (URL(releaseApiUrl).openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    setRequestProperty("User-Agent", "PokeBonk-Android-V2")
                    setRequestProperty("Accept", "application/vnd.github.v3+json")
                    connectTimeout = 8000
                    readTimeout = 8000
                }

                if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                    if (isUserInitiated) {
                        showToast("Could not reach update server (${conn.responseCode})")
                    }
                    return@execute
                }

                val jsonStr = conn.inputStream.bufferedReader().use { it.readText() }
                val release = JSONObject(jsonStr)
                val tagName = release.optString("tag_name", "latest")
                val assets = release.optJSONArray("assets") ?: return@execute

                var apkDownloadUrl: String? = null
                var remoteVersionCode: Long = -1
                var remoteVersionName: String = tagName

                // Search for PokeBonk.apk and version.json
                for (i in 0 until assets.length()) {
                    val asset = assets.getJSONObject(i)
                    val name = asset.optString("name")
                    if (name.equals("PokeBonk.apk", ignoreCase = true)) {
                        apkDownloadUrl = asset.optString("browser_download_url")
                    } else if (name.equals("version.json", ignoreCase = true)) {
                        val vUrl = asset.optString("browser_download_url")
                        if (vUrl.isNotBlank()) {
                            try {
                                val vConn = (URL(vUrl).openConnection() as HttpURLConnection).apply {
                                    connectTimeout = 5000
                                    readTimeout = 5000
                                }
                                if (vConn.responseCode == HttpURLConnection.HTTP_OK) {
                                    val vObj = JSONObject(vConn.inputStream.bufferedReader().use { it.readText() })
                                    remoteVersionCode = vObj.optLong("versionCode", -1)
                                    remoteVersionName = vObj.optString("versionName", remoteVersionName)
                                }
                            } catch (_: Exception) {}
                        }
                    }
                }

                if (apkDownloadUrl.isNullOrBlank()) {
                    if (isUserInitiated) showToast("No APK build found in latest release.")
                    return@execute
                }

                // Check local version
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

                val hasUpdate = (remoteVersionCode > 0 && remoteVersionCode > currentVersionCode)

                if (hasUpdate) {
                    mainHandler.post {
                        promptInstallUpdate(remoteVersionName, apkDownloadUrl)
                    }
                } else {
                    if (isUserInitiated) {
                        showToast("PokéBonk is up to date (v${packageInfo.versionName ?: "1.0"})")
                    }
                }

            } catch (e: Exception) {
                if (isUserInitiated) {
                    showToast("Update check failed: ${e.localizedMessage ?: "Network error"}")
                }
            }
        }
    }

    private fun promptInstallUpdate(versionName: String, downloadUrl: String) {
        AlertDialog.Builder(context)
            .setTitle("New PokéBonk Update Available")
            .setMessage("Version $versionName is available. Would you like to download and install it?")
            .setPositiveButton("Update Now") { _, _ ->
                downloadAndInstall(downloadUrl)
            }
            .setNegativeButton("Later", null)
            .show()
    }

    private fun downloadAndInstall(downloadUrl: String) {
        showToast("Downloading PokéBonk update…")
        executor.execute {
            try {
                val conn = (URL(downloadUrl).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 12000
                    readTimeout = 15000
                    instanceFollowRedirects = true
                }

                val outputFile = File(context.cacheDir, "PokeBonk_Update.apk")
                conn.inputStream.use { input ->
                    FileOutputStream(outputFile).use { output ->
                        input.copyTo(output)
                    }
                }

                mainHandler.post {
                    launchInstaller(outputFile)
                }
            } catch (e: Exception) {
                showToast("Download failed: ${e.localizedMessage}")
            }
        }
    }

    private fun launchInstaller(apkFile: File) {
        try {
            val contentUri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                apkFile
            )

            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(contentUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(installIntent)
        } catch (e: Exception) {
            showToast("Failed to launch installer: ${e.localizedMessage}")
        }
    }

    private fun showToast(msg: String) {
        mainHandler.post {
            Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
        }
    }
}
