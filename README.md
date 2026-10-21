# PokéBonk (Unofficial Native Client)

High-performance native wrappers for **PokéBonk** on **Android**, **Windows**, and **iOS**.

---

## 🚀 Features

- **🎮 Seamless Controller Support:** Native Bluetooth and USB gamepad mapping (Xbox Wireless, PlayStation DualSense/DualShock, Nintendo Switch Pro/Joy-Con, Backbone, Razer Kishi, 8BitDo).
- **🎯 Stick Sensitivity:** In-app sensitivity scaling (50% – 200%) configured directly in Settings or toggled via menu/shortcut.
- **🔄 In-App Updaters & Multi-Platform Releases:**
  - **Android (`PokeBonk.apk`):** Direct APK download and installation without manual browser navigation or update loops.
  - **Windows (`PokeBonk.exe`):** Background auto-updater powered by `electron-updater` and `latest.yml`.
  - **iOS (`PokeBonk.ipa`):** Sideloadable IPA packaged for iPhone and iPad with native `GameController` framework support.
- **📱 Clean Mobile Experience:** Single floating menu (`⚙ Menu`) for touch/controller switching, reload, and updates.
- **💻 Desktop Shortcuts:**
  - `F8`: Cycle analog stick sensitivity (50% – 200%)
  - `F9`: Swap Nintendo / Xbox `A/B` & `X/Y` button layout
  - `F11` / `Alt+Enter`: Toggle Fullscreen / Windowed
  - `Hold Start + Select (1.5s)`: Exit application

---

## 🍏 iOS Sideloading & Installation Guide

Because PokéBonk is an unofficial fan client, it cannot be hosted directly on the Apple App Store. You can install **`PokeBonk.ipa`** for free using any of the following methods:

### Option 1: SideStore (Recommended — Wireless Auto-Refresh)
1. Download **`PokeBonk.ipa`** from [GitHub Releases](https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest).
2. Open **SideStore** on your iPhone or iPad.
3. Tap **+** (Add App) and select `PokeBonk.ipa`.
4. *Benefit:* SideStore automatically re-signs the app wirelessly over Wi-Fi using your free Apple ID so it never expires.

### Option 2: AltStore
1. Download **`PokeBonk.ipa`** onto your device.
2. In **AltStore**, go to the **My Apps** tab and tap the **+** icon in the top left.
3. Select `PokeBonk.ipa` and enter your Apple ID to sign.

### Option 3: Sideloadly (PC / Mac)
1. Download and open **Sideloadly** on your computer.
2. Connect your iPhone via USB.
3. Drag and drop **`PokeBonk.ipa`** into Sideloadly, enter your Apple ID, and click **Start**.

### Option 4: TrollStore (Permanent Signing — iOS 14.0 – 17.0)
If your device has **TrollStore** installed:
1. Open GitHub Releases in Safari and download `PokeBonk.ipa`.
2. Tap the downloaded file ➔ **Share** ➔ **Open with TrollStore**.
3. It installs permanently without any 7-day expiration or Apple ID requirements.

### Option 5: Safari Web App ("Add to Home Screen" — Zero Tools Needed)
1. Open `https://pokebonk.com` in **Safari**.
2. Tap the **Share** button (box with upward arrow) at the bottom.
3. Scroll down and select **Add to Home Screen**.
4. The web app launches standalone in landscape without browser URL bars, complete with Web Gamepad support.

---

## 🤖 Automated Version Bumping & Git Commits

This repository includes a continuous delivery pipeline (`.github/workflows/release.yml`) that automates versioning and releases:

1. **Automatic Detection:** Whenever changes in `android/`, `windows/`, or `ios/` are pushed to `main`, GitHub Actions detects which platform was modified.
2. **Auto-Bump:**
   - **Android:** Increments `versionCode` (+1) and bumps patch `versionName` (e.g. `1.8` ➔ `1.9`) in `android/app/build.gradle.kts`.
   - **Windows:** Increments patch version (e.g. `2.4.9` ➔ `2.4.10`) in `windows/package.json`.
   - **iOS:** Increments `CFBundleVersion` (+1) and bumps patch `CFBundleShortVersionString` (e.g. `1.0.0` ➔ `1.0.1`) in `ios/PokeBonk/Resources/Info.plist` and `ios/PokeBonk.xcodeproj/project.pbxproj`.
3. **Automated Commit:** Creates a release commit:
   `chore(release): auto-bump version (all patch) [skip ci]`
   and pushes it back to the branch.
4. **Automated Build & Upload:** Builds `PokeBonk.apk`, `PokeBonk.exe`, and `PokeBonk.ipa`, generates `version.json` & `latest.yml`, and publishes them under the GitHub Releases `latest` tag.

### Manual Release / Custom Bump Level
You can also trigger a release manually with custom bump levels:
1. Go to **Actions** ➔ **Automated Build & Release** ➔ **Run workflow**.
2. Select your target platform (`all`, `android`, `windows`, or `ios`).
3. Select the bump level (`patch`, `minor`, `major`, or `none`).

### Local Version Bumping
You can also bump versions locally before committing:
```powershell
# Using PowerShell:
.\scripts\bump-version.ps1 -Type patch -Target all -Commit

# Or directly with Python:
python scripts/bump_version.py --type patch --target all
```
