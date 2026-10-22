# PokéBonk Dedicated Launcher (Riot Client Style)

The PokéBonk Dedicated Launcher is a native, ultra-lightweight Windows desktop launcher (~180 KB) designed in the style of modern gaming clients (e.g. Riot Client). It provides seamless game management, background updates with real-time download progress tracking, binary verification, file repair, and zero-lock executable swapping.

---

## Key Features

1. **Riot Client Gaming Experience:**
   - Deep slate theme (`#1a1630`) with authentic Poké Red (`#e94756`) accents and white/slate text.
   - Zero frosted gold styling.
   - Frameless, smooth-dragging window with custom minimize and close controls.
   - Discreet, non-imposing version tag in the top-left (`v2.4.15`).
   - High-DPI Per-Monitor V2 awareness for razor-sharp rendering on 4K, 1440p, and 1080p displays.

2. **Zero-Lock Auto-Updater:**
   - Separates the launcher executable (`PokeBonk-Launcher.exe`) from the game client executable (`%LOCALAPPDATA%\PokeBonk\game\PokeBonk.exe`).
   - When updating, the game executable is not running, eliminating all Windows kernel file-locking and sharing violation errors.
   - Downloads updates to a temporary binary and performs an atomic swap with rollback safety.
   - Automatically maintains `version.json` in the game directory.

3. **Real-Time Download Progress Bar:**
   - Live download percentage indicator.
   - Real-time transfer stats (e.g. `82.4 MB / 111.3 MB (74%) • 14.8 MB/s`).
   - Visual gradient progress bar during installation and updates.

4. **One-Click Play & Utilities:**
   - **`PLAY`**: Launches the standalone game client directly.
   - **`INSTALL GAME`**: Downloads and automatically launches the game upon installation.
   - **`UPDATE GAME`**: Automatically detected when a newer release is published on GitHub.
   - **`GAME RUNNING`**: Tracks active game status and brings the game window to focus when clicked.
   - **`Open Folder`**: Opens `%LOCALAPPDATA%\PokeBonk\game` in Windows File Explorer.
   - **`Repair Files`**: Verifies and re-downloads a clean copy of the game binary.
   - **`Uninstall`**: Fully removes installed game files from `%LOCALAPPDATA%\PokeBonk\game` with confirmation.
   - **`Close launcher when game launches`**: Optional toggle to exit the launcher upon starting the game.
   - **Clean Typography**: Uses crisp native fonts with zero missing unicode emoji boxes.

---

## Build Instructions

The launcher requires zero external runtime dependencies and compiles natively on any Windows 10/11 machine using the built-in Microsoft Visual C# Compiler (`csc.exe`):

```powershell
powershell -ExecutionPolicy Bypass -File launcher/build.ps1
```

Output:
```
windows/dist/PokeBonk-Launcher.exe (~180 KB)
```
