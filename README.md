# PokéBonk (Unofficial Native Client)

High-performance native wrappers for **PokéBonk** on **Android** and **Windows**.

---

## 🚀 Features

- **🎮 Seamless Controller Support:** Native Bluetooth and USB gamepad mapping (Xbox, Nintendo Switch Pro/Joy-Con, 8BitDo, DualShock/DualSense).
- **🎯 Stick Sensitivity:** In-app sensitivity scaling (50% – 200%) configured directly in Settings or toggled via menu/shortcut.
- **🔄 In-App Updaters:**
  - **Android:** Direct APK download and installation without manual browser navigation or update loops.
  - **Windows:** Background auto-updater powered by `electron-updater` and `latest.yml`.
- **📱 Clean Mobile Experience:** Single floating menu (`⚙ Menu`) for touch/controller switching, reload, and updates.
- **💻 Desktop Shortcuts:**
  - `F8`: Cycle analog stick sensitivity (50% – 200%)
  - `F9`: Swap Nintendo / Xbox `A/B` & `X/Y` button layout
  - `F11` / `Alt+Enter`: Toggle Fullscreen / Windowed
  - `Hold Start + Select (1.5s)`: Exit application

---

## 🤖 Automated Version Bumping & Git Commits

This repository includes a continuous delivery pipeline (`.github/workflows/release.yml`) that automates versioning and releases:

1. **Automatic Detection:** Whenever changes in `android/` or `windows/` are pushed to `main`, GitHub Actions detects which platform was modified.
2. **Auto-Bump:**
   - **Android:** Increments `versionCode` (+1) and bumps patch `versionName` (e.g. `1.2` ➔ `1.3`) in `android/app/build.gradle.kts`.
   - **Windows:** Increments patch version (e.g. `2.4.0` ➔ `2.4.1`) in `windows/package.json`.
3. **Automated Commit:** Creates a release commit:
   `chore(release): auto-bump version (all patch) [skip ci]`
   and pushes it back to the branch.
4. **Automated Build & Upload:** Builds `PokeBonk.apk` and `PokeBonk.exe`, generates `version.json` & `latest.yml`, and publishes them under the GitHub Releases `latest` tag.

### Manual Release / Custom Bump Level
You can also trigger a release manually with custom bump levels:
1. Go to **Actions** ➔ **Automated Build & Release** ➔ **Run workflow**.
2. Select your target platform (`all`, `android`, or `windows`).
3. Select the bump level (`patch`, `minor`, `major`, or `none`).

### Local Version Bumping
You can also bump versions locally before committing:
```powershell
# Using PowerShell:
.\scripts\bump-version.ps1 -Type patch -Target all -Commit

# Or directly with Python:
python scripts/bump_version.py --type patch --target all
```
