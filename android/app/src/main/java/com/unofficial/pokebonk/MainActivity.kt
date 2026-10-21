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

            if (apkAsset == null) return@Thread

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
        .setDestinationInExternalFilesDir(Environment.DIRECTORY_DOWNLOADS, apkFileName)
        .setAllowedOverMetered(true)
        .setAllowedToWrite(true)
        .setAllowedUnderRoaming(true)

    val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    downloadId = dm.enqueue(request)

    registerReceiver(object : BroadcastReceiver() {
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
    }, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE))
}
