using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace PokeBonk.Launcher
{
    public enum LauncherState
    {
        Checking,
        NotInstalled,
        UpdateAvailable,
        Downloading,
        Extracting,
        Ready,
        Playing,
        Error
    }

    public class LauncherForm : Form
    {
        // P/Invoke for borderless window dragging, shadow, and window activation
        [DllImport("user32.dll")]
        public static extern bool ReleaseCapture();
        [DllImport("user32.dll")]
        public static extern int SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);
        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        private const int WM_NCLBUTTONDOWN = 0xA1;
        private const int HT_CAPTION = 0x2;
        private const int CS_DROPSHADOW = 0x00020000;
        private const int SW_RESTORE = 9;

        // Theme Palette (Authentic PokéBonk palette: Deep Slate, Poké Red, White)
        private static readonly Color ColorBg = ColorTranslator.FromHtml("#1a1630");
        private static readonly Color ColorHeader = ColorTranslator.FromHtml("#131022");
        private static readonly Color ColorCard = ColorTranslator.FromHtml("#221d3b");
        private static readonly Color ColorCardBorder = Color.FromArgb(35, 255, 255, 255);
        private static readonly Color ColorRed = ColorTranslator.FromHtml("#e94756");
        private static readonly Color ColorRedHover = ColorTranslator.FromHtml("#ff5c6d");
        private static readonly Color ColorRedActive = ColorTranslator.FromHtml("#d63b4a");
        private static readonly Color ColorButtonSec = ColorTranslator.FromHtml("#2d274c");
        private static readonly Color ColorButtonSecHover = ColorTranslator.FromHtml("#3b3363");
        private static readonly Color ColorButtonDanger = ColorTranslator.FromHtml("#3d1b28");
        private static readonly Color ColorButtonDangerHover = ColorTranslator.FromHtml("#591e32");
        private static readonly Color ColorTextWhite = Color.White;
        private static readonly Color ColorTextMuted = ColorTranslator.FromHtml("#94a3b8");
        private static readonly Color ColorSuccess = ColorTranslator.FromHtml("#22c55e");
        private static readonly Color ColorWarning = ColorTranslator.FromHtml("#f59e0b");

        // Paths & Configuration
        private readonly string launcherVersion = "2.4.15";
        private readonly string localAppDataDir;
        private readonly string gameDir;
        private readonly string gameExePath;
        private readonly string versionJsonPath;
        private readonly string tempExePath;
        private readonly string settingsJsonPath;

        // State variables
        private LauncherState currentState = LauncherState.Checking;
        private string localVersion = null;
        private string remoteVersion = null;
        private string statusMessage = "Checking for game updates…";
        private string downloadDetail = "";
        private int downloadPercent = 0;
        private long bytesReceived = 0;
        private long totalBytes = 0;
        private double downloadSpeedMBs = 0.0;
        private DateTime lastSpeedCalcTime = DateTime.MinValue;
        private long lastSpeedBytes = 0;
        private WebClient activeWebClient = null;
        private System.Windows.Forms.Timer gameMonitorTimer = null;
        private bool autoCloseOnPlay = false;

        // Hover states for custom interactive elements
        private bool hoverBtnMinimize = false;
        private bool hoverBtnClose = false;
        private bool hoverBtnMainAction = false;
        private bool hoverBtnFolder = false;
        private bool hoverBtnRepair = false;
        private bool hoverBtnCheckUpdates = false;
        private bool hoverBtnUninstall = false;
        private bool hoverLinkWeb = false;
        private bool hoverLinkGitHub = false;
        private bool hoverLinkDiscord = false;
        private bool hoverCheckAutoClose = false;

        // Hit-test rectangles
        private readonly Rectangle rectTitleBar = new Rectangle(0, 0, 920, 44);
        private readonly Rectangle rectBtnMinimize = new Rectangle(920 - 76, 7, 32, 30);
        private readonly Rectangle rectBtnClose = new Rectangle(920 - 40, 7, 32, 30);
        private readonly Rectangle rectMainAction = new Rectangle(585, 248, 295, 60);
        private readonly Rectangle rectBtnFolder = new Rectangle(585, 324, 142, 36);
        private readonly Rectangle rectBtnRepair = new Rectangle(738, 324, 142, 36);
        private readonly Rectangle rectBtnCheckUpdates = new Rectangle(585, 370, 142, 36);
        private readonly Rectangle rectBtnUninstall = new Rectangle(738, 370, 142, 36);
        private readonly Rectangle rectAutoClose = new Rectangle(585, 424, 295, 24);
        private readonly Rectangle rectLinkWeb = new Rectangle(36, 480, 120, 26);
        private readonly Rectangle rectLinkGitHub = new Rectangle(170, 480, 130, 26);
        private readonly Rectangle rectLinkDiscord = new Rectangle(315, 480, 150, 26);

        public LauncherForm()
        {
            // Initialize paths in %LOCALAPPDATA%\PokeBonk\
            localAppDataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PokeBonk");
            gameDir = Path.Combine(localAppDataDir, "game");
            gameExePath = Path.Combine(gameDir, "PokeBonk.exe");
            versionJsonPath = Path.Combine(gameDir, "version.json");
            tempExePath = Path.Combine(gameDir, "PokeBonk.exe.tmp");
            settingsJsonPath = Path.Combine(localAppDataDir, "launcher_settings.json");

            // Form properties
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Size = new Size(920, 540);
            this.BackColor = ColorBg;
            this.Text = "PokéBonk Launcher";

            // Optimize rendering for anti-aliasing and double buffering
            this.SetStyle(
                ControlStyles.AllPaintingInWmPaint |
                ControlStyles.UserPaint |
                ControlStyles.DoubleBuffer |
                ControlStyles.OptimizedDoubleBuffer |
                ControlStyles.ResizeRedraw,
                true
            );

            // Ensure directories exist
            try
            {
                if (!Directory.Exists(localAppDataDir)) Directory.CreateDirectory(localAppDataDir);
                if (!Directory.Exists(gameDir)) Directory.CreateDirectory(gameDir);
            }
            catch {}

            LoadSettings();
            RegisterSelf();

            // Setup TLS 1.2 for secure GitHub connectivity
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            ServicePointManager.DefaultConnectionLimit = 8;

            this.Load += (s, e) =>
            {
                StartGameMonitor();
                Task.Factory.StartNew(() => InitializeAsync());
            };
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ClassStyle |= CS_DROPSHADOW;
                return cp;
            }
        }

        private void RegisterSelf()
        {
            // Maintain a synced copy of the launcher in %LOCALAPPDATA%\PokeBonk\PokeBonk-Launcher.exe
            try
            {
                string currentExe = Process.GetCurrentProcess().MainModule.FileName;
                string permanentExe = Path.Combine(localAppDataDir, "PokeBonk-Launcher.exe");
                if (!string.Equals(currentExe, permanentExe, StringComparison.OrdinalIgnoreCase))
                {
                    File.Copy(currentExe, permanentExe, true);
                }
            }
            catch {}
        }

        private void LoadSettings()
        {
            try
            {
                if (File.Exists(settingsJsonPath))
                {
                    string json = File.ReadAllText(settingsJsonPath);
                    var serializer = new JavaScriptSerializer();
                    var dict = serializer.Deserialize<System.Collections.Generic.Dictionary<string, object>>(json);
                    if (dict != null && dict.ContainsKey("autoCloseOnPlay"))
                    {
                        autoCloseOnPlay = Convert.ToBoolean(dict["autoCloseOnPlay"]);
                    }
                }
            }
            catch {}
        }

        private void SaveSettings()
        {
            try
            {
                var dict = new System.Collections.Generic.Dictionary<string, object>
                {
                    { "autoCloseOnPlay", autoCloseOnPlay }
                };
                var serializer = new JavaScriptSerializer();
                File.WriteAllText(settingsJsonPath, serializer.Serialize(dict));
            }
            catch {}
        }

        private void StartGameMonitor()
        {
            if (gameMonitorTimer == null)
            {
                gameMonitorTimer = new System.Windows.Forms.Timer();
                gameMonitorTimer.Interval = 1200;
                gameMonitorTimer.Tick += (s, e) =>
                {
                    if (currentState == LauncherState.Downloading || currentState == LauncherState.Extracting)
                    {
                        return;
                    }

                    bool running = IsGameRunning();
                    if (running && currentState != LauncherState.Playing)
                    {
                        currentState = LauncherState.Playing;
                        statusMessage = "PokéBonk is currently running";
                        this.Invalidate();
                    }
                    else if (!running && currentState == LauncherState.Playing)
                    {
                        CheckLocalInstalledGame();
                        if (File.Exists(gameExePath))
                        {
                            currentState = LauncherState.Ready;
                            statusMessage = string.Format("PokéBonk is up to date (v{0})", localVersion ?? launcherVersion);
                        }
                        else
                        {
                            currentState = LauncherState.NotInstalled;
                            statusMessage = "PokéBonk is ready to install";
                        }
                        this.Invalidate();
                    }
                };
            }
            gameMonitorTimer.Start();
        }

        private async Task InitializeAsync()
        {
            CheckLocalInstalledGame();
            await CheckForUpdatesAsync();
        }

        private void CheckLocalInstalledGame()
        {
            if (File.Exists(gameExePath))
            {
                localVersion = null;
                // Try reading version.json
                if (File.Exists(versionJsonPath))
                {
                    try
                    {
                        string json = File.ReadAllText(versionJsonPath);
                        var serializer = new JavaScriptSerializer();
                        var dict = serializer.Deserialize<System.Collections.Generic.Dictionary<string, object>>(json);
                        if (dict != null)
                        {
                            if (dict.ContainsKey("version"))
                            {
                                localVersion = dict["version"].ToString();
                            }
                            else if (dict.ContainsKey("versionName"))
                            {
                                localVersion = dict["versionName"].ToString();
                            }
                            else if (dict.ContainsKey("windows"))
                            {
                                var w = dict["windows"] as System.Collections.Generic.Dictionary<string, object>;
                                if (w != null && w.ContainsKey("version"))
                                {
                                    localVersion = w["version"].ToString();
                                }
                            }
                        }
                    }
                    catch {}
                }

                // Fallback to FileVersionInfo
                if (string.IsNullOrEmpty(localVersion))
                {
                    try
                    {
                        var info = FileVersionInfo.GetVersionInfo(gameExePath);
                        if (!string.IsNullOrEmpty(info.ProductVersion))
                        {
                            localVersion = info.ProductVersion.Trim().TrimStart('v');
                        }
                    }
                    catch {}
                }

                if (string.IsNullOrEmpty(localVersion))
                {
                    localVersion = launcherVersion;
                }
            }
            else
            {
                localVersion = null;
            }
        }

        private async Task CheckForUpdatesAsync()
        {
            if (currentState != LauncherState.Downloading && currentState != LauncherState.Extracting && currentState != LauncherState.Playing)
            {
                currentState = LauncherState.Checking;
                statusMessage = "Checking for updates from GitHub…";
                this.BeginInvoke(new Action(() => this.Invalidate()));
            }

            await Task.Run(() =>
            {
                try
                {
                    string foundRemote = null;

                    // 1. Check latest.yml directly from GitHub Release assets
                    try
                    {
                        using (var client = new WebClient())
                        {
                            client.Headers[HttpRequestHeader.UserAgent] = "PokeBonk-Launcher/" + launcherVersion;
                            string yml = client.DownloadString("https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest/download/latest.yml");
                            var match = Regex.Match(yml, @"version:\s*['""]?([0-9a-zA-Z.-]+)");
                            if (match.Success)
                            {
                                foundRemote = match.Groups[1].Value.Trim().TrimStart('v');
                            }
                        }
                    }
                    catch {}

                    // 2. Check version.json
                    if (string.IsNullOrEmpty(foundRemote))
                    {
                        try
                        {
                            using (var client = new WebClient())
                            {
                                client.Headers[HttpRequestHeader.UserAgent] = "PokeBonk-Launcher/" + launcherVersion;
                                string json = client.DownloadString("https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest/download/version.json");
                                var serializer = new JavaScriptSerializer();
                                var dict = serializer.Deserialize<System.Collections.Generic.Dictionary<string, object>>(json);
                                if (dict != null)
                                {
                                    if (dict.ContainsKey("windows"))
                                    {
                                        var w = dict["windows"] as System.Collections.Generic.Dictionary<string, object>;
                                        if (w != null && w.ContainsKey("version"))
                                        {
                                            foundRemote = w["version"].ToString().Trim().TrimStart('v');
                                        }
                                    }
                                    else if (dict.ContainsKey("version"))
                                    {
                                        foundRemote = dict["version"].ToString().Trim().TrimStart('v');
                                    }
                                }
                            }
                        }
                        catch {}
                    }

                    // 3. Fallback to GitHub Release API
                    if (string.IsNullOrEmpty(foundRemote))
                    {
                        try
                        {
                            using (var client = new WebClient())
                            {
                                client.Headers[HttpRequestHeader.UserAgent] = "PokeBonk-Launcher/" + launcherVersion;
                                string apiJson = client.DownloadString("https://api.github.com/repos/JOWEND04/unofficial_pokebonk_app/releases/latest");
                                var serializer = new JavaScriptSerializer();
                                var dict = serializer.Deserialize<System.Collections.Generic.Dictionary<string, object>>(apiJson);
                                if (dict != null && dict.ContainsKey("tag_name"))
                                {
                                    string tag = dict["tag_name"].ToString().Trim().TrimStart('v');
                                    if (tag != "latest") foundRemote = tag;
                                }
                            }
                        }
                        catch {}
                    }

                    remoteVersion = foundRemote;
                }
                catch
                {
                    remoteVersion = null;
                }
            });

            // Update UI state based on version comparison
            this.BeginInvoke(new Action(() =>
            {
                CheckLocalInstalledGame();

                if (IsGameRunning())
                {
                    currentState = LauncherState.Playing;
                    statusMessage = "PokéBonk is currently running";
                }
                else if (!File.Exists(gameExePath))
                {
                    currentState = LauncherState.NotInstalled;
                    statusMessage = remoteVersion != null
                        ? string.Format("PokéBonk v{0} available to install", remoteVersion)
                        : "PokéBonk is ready to install";
                }
                else if (!string.IsNullOrEmpty(remoteVersion) && CompareVersions(remoteVersion, localVersion) > 0)
                {
                    currentState = LauncherState.UpdateAvailable;
                    statusMessage = string.Format("Update Available: v{0} (Installed: v{1})", remoteVersion, localVersion);
                }
                else
                {
                    currentState = LauncherState.Ready;
                    statusMessage = string.Format("PokéBonk is up to date (v{0})", localVersion ?? launcherVersion);
                }

                this.Invalidate();
            }));
        }

        private static int CompareVersions(string v1, string v2)
        {
            if (string.IsNullOrEmpty(v1) && string.IsNullOrEmpty(v2)) return 0;
            if (string.IsNullOrEmpty(v1)) return -1;
            if (string.IsNullOrEmpty(v2)) return 1;

            string[] p1 = v1.Trim().TrimStart('v').Split('.');
            string[] p2 = v2.Trim().TrimStart('v').Split('.');
            int maxLen = Math.Max(p1.Length, p2.Length);

            for (int i = 0; i < maxLen; i++)
            {
                int n1 = 0, n2 = 0;
                if (i < p1.Length) int.TryParse(Regex.Replace(p1[i], @"[^\d]", ""), out n1);
                if (i < p2.Length) int.TryParse(Regex.Replace(p2[i], @"[^\d]", ""), out n2);
                if (n1 > n2) return 1;
                if (n1 < n2) return -1;
            }
            return 0;
        }

        private bool IsGameRunning()
        {
            try
            {
                int myPid = Process.GetCurrentProcess().Id;
                foreach (var p in Process.GetProcessesByName("PokeBonk"))
                {
                    if (p.Id != myPid)
                    {
                        try
                        {
                            if (!p.HasExited) return true;
                        }
                        catch {}
                    }
                }
            }
            catch {}
            return false;
        }

        private void KillOrphanedGameProcesses()
        {
            try
            {
                int myPid = Process.GetCurrentProcess().Id;
                foreach (var p in Process.GetProcessesByName("PokeBonk"))
                {
                    if (p.Id != myPid && p.MainWindowHandle == IntPtr.Zero)
                    {
                        try { p.Kill(); } catch {}
                    }
                }
            }
            catch {}
        }

        private void KillAllGameProcesses()
        {
            try
            {
                int myPid = Process.GetCurrentProcess().Id;
                foreach (var p in Process.GetProcessesByName("PokeBonk"))
                {
                    if (p.Id != myPid)
                    {
                        try { p.Kill(); } catch {}
                    }
                }
            }
            catch {}
        }

        private bool FocusGameWindow()
        {
            try
            {
                int myPid = Process.GetCurrentProcess().Id;
                foreach (var p in Process.GetProcessesByName("PokeBonk"))
                {
                    if (p.Id != myPid && p.MainWindowHandle != IntPtr.Zero)
                    {
                        ShowWindow(p.MainWindowHandle, SW_RESTORE);
                        SetForegroundWindow(p.MainWindowHandle);
                        return true;
                    }
                }
            }
            catch {}
            return false;
        }

        private void StartDownload(bool launchAfter = true)
        {
            if (currentState == LauncherState.Downloading) return;

            // Warn if game is open
            if (IsGameRunning())
            {
                var res = MessageBox.Show(
                    "PokéBonk is currently running. Please close the game before installing or updating.\n\nWould you like to close it now?",
                    "Game is Running",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Information
                );
                if (res == DialogResult.Yes)
                {
                    KillAllGameProcesses();
                }
                else
                {
                    return;
                }
            }

            currentState = LauncherState.Downloading;
            downloadPercent = 0;
            bytesReceived = 0;
            totalBytes = 0;
            downloadSpeedMBs = 0.0;
            lastSpeedCalcTime = DateTime.UtcNow;
            lastSpeedBytes = 0;
            statusMessage = "Downloading PokéBonk…";
            downloadDetail = "Connecting to download server…";
            this.Invalidate();

            string downloadUrl = "https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest/download/PokeBonk.exe";

            try
            {
                if (File.Exists(tempExePath))
                {
                    try { File.Delete(tempExePath); } catch {}
                }

                activeWebClient = new WebClient();
                activeWebClient.Headers[HttpRequestHeader.UserAgent] = "PokeBonk-Launcher/" + launcherVersion;

                activeWebClient.DownloadProgressChanged += (s, e) =>
                {
                    this.BeginInvoke(new Action(() =>
                    {
                        downloadPercent = e.ProgressPercentage;
                        bytesReceived = e.BytesReceived;
                        totalBytes = e.TotalBytesToReceive;

                        var now = DateTime.UtcNow;
                        double elapsedSeconds = (now - lastSpeedCalcTime).TotalSeconds;
                        if (elapsedSeconds >= 0.5)
                        {
                            long deltaBytes = bytesReceived - lastSpeedBytes;
                            downloadSpeedMBs = Math.Round((deltaBytes / elapsedSeconds) / (1024.0 * 1024.0), 2);
                            lastSpeedBytes = bytesReceived;
                            lastSpeedCalcTime = now;
                        }

                        double mbRecv = Math.Round(bytesReceived / (1024.0 * 1024.0), 1);
                        double mbTotal = totalBytes > 0 ? Math.Round(totalBytes / (1024.0 * 1024.0), 1) : 0;

                        if (totalBytes > 0)
                        {
                            downloadDetail = string.Format("{0:0.0} MB / {1:0.0} MB ({2}%) • {3:0.0} MB/s",
                                mbRecv, mbTotal, downloadPercent, downloadSpeedMBs);
                        }
                        else
                        {
                            downloadDetail = string.Format("{0:0.0} MB downloaded • {1:0.0} MB/s",
                                mbRecv, downloadSpeedMBs);
                        }

                        this.Invalidate();
                    }));
                };

                activeWebClient.DownloadFileCompleted += (s, e) =>
                {
                    this.BeginInvoke(new Action(() =>
                    {
                        if (e.Error != null)
                        {
                            currentState = LauncherState.Error;
                            statusMessage = "Download failed: " + e.Error.Message;
                            downloadDetail = "Click Repair or try again later.";
                            this.Invalidate();
                            return;
                        }

                        if (e.Cancelled)
                        {
                            currentState = LauncherState.Ready;
                            statusMessage = "Download cancelled.";
                            this.Invalidate();
                            return;
                        }

                        // Finalize installation
                        try
                        {
                            currentState = LauncherState.Extracting;
                            statusMessage = "Installing game files…";
                            downloadDetail = "Finalizing installation…";
                            this.Invalidate();

                            // Safe atomic swap
                            if (File.Exists(gameExePath))
                            {
                                string oldBackup = gameExePath + ".old";
                                try { if (File.Exists(oldBackup)) File.Delete(oldBackup); } catch {}
                                try { File.Move(gameExePath, oldBackup); } catch {}
                            }

                            File.Move(tempExePath, gameExePath);

                            // Write version.json
                            string targetVersion = remoteVersion ?? launcherVersion;
                            var verData = new System.Collections.Generic.Dictionary<string, object>
                            {
                                { "version", targetVersion },
                                { "versionName", targetVersion },
                                { "installedAt", DateTime.UtcNow.ToString("o") }
                            };
                            var serializer = new JavaScriptSerializer();
                            File.WriteAllText(versionJsonPath, serializer.Serialize(verData));

                            localVersion = targetVersion;
                            downloadDetail = "";

                            if (launchAfter)
                            {
                                statusMessage = string.Format("PokéBonk v{0} installed! Launching game…", targetVersion);
                                this.Invalidate();
                                LaunchGame();
                            }
                            else
                            {
                                currentState = LauncherState.Ready;
                                statusMessage = string.Format("PokéBonk v{0} is ready to play!", targetVersion);
                                this.Invalidate();
                            }
                        }
                        catch (Exception ex)
                        {
                            currentState = LauncherState.Error;
                            statusMessage = "Install error: " + ex.Message;
                            this.Invalidate();
                        }
                    }));
                };

                activeWebClient.DownloadFileAsync(new Uri(downloadUrl), tempExePath);
            }
            catch (Exception ex)
            {
                currentState = LauncherState.Error;
                statusMessage = "Failed to start download: " + ex.Message;
                this.Invalidate();
            }
        }

        private void LaunchGame()
        {
            if (!File.Exists(gameExePath))
            {
                StartDownload(true);
                return;
            }

            // If game is already running with an active window, bring it to front
            if (FocusGameWindow())
            {
                currentState = LauncherState.Playing;
                statusMessage = "PokéBonk is currently running";
                this.Invalidate();
                return;
            }

            // Clean up any stale headless processes before launching fresh
            KillOrphanedGameProcesses();

            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = gameExePath,
                    WorkingDirectory = gameDir,
                    UseShellExecute = true
                };

                Process.Start(startInfo);
                currentState = LauncherState.Playing;
                statusMessage = "Launching PokéBonk…";
                this.Invalidate();

                if (autoCloseOnPlay)
                {
                    this.Close();
                    return;
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to launch PokéBonk: " + ex.Message, "Launch Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                currentState = LauncherState.Ready;
                this.Invalidate();
            }
        }

        private void UninstallGame()
        {
            if (!File.Exists(gameExePath) && !Directory.Exists(gameDir))
            {
                MessageBox.Show("PokéBonk is not currently installed.", "Not Installed", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            var confirm = MessageBox.Show(
                "Are you sure you want to uninstall PokéBonk?\n\nThis will remove all downloaded game files from your computer.",
                "Uninstall PokéBonk",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning
            );

            if (confirm != DialogResult.Yes) return;

            try
            {
                // Kill running processes first
                KillAllGameProcesses();

                // Delete game directory files
                if (Directory.Exists(gameDir))
                {
                    try
                    {
                        Directory.Delete(gameDir, true);
                    }
                    catch
                    {
                        foreach (string file in Directory.GetFiles(gameDir))
                        {
                            try { File.Delete(file); } catch {}
                        }
                    }
                }

                // Re-create clean empty directory
                if (!Directory.Exists(gameDir)) Directory.CreateDirectory(gameDir);

                localVersion = null;
                currentState = LauncherState.NotInstalled;
                statusMessage = "PokéBonk was successfully uninstalled.";
                this.Invalidate();

                MessageBox.Show(
                    "PokéBonk has been successfully uninstalled.\n\nYou can reinstall it at any time by clicking 'INSTALL GAME'.",
                    "Uninstall Complete",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
            catch (Exception ex)
            {
                MessageBox.Show("Error during uninstall: " + ex.Message, "Uninstall Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        // ==================== RENDERING & PAINTING ====================

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;

            // 1. Draw Outer Window Background
            using (var brush = new SolidBrush(ColorBg))
            {
                g.FillRectangle(brush, this.ClientRectangle);
            }

            // Subtle border
            using (var pen = new Pen(Color.FromArgb(40, 255, 255, 255), 1))
            {
                g.DrawRectangle(pen, 0, 0, this.Width - 1, this.Height - 1);
            }

            // 2. Draw Header Bar
            DrawHeader(g);

            // 3. Draw Hero Showcase (Left Side)
            DrawHeroPanel(g);

            // 4. Draw Action & Status Dock (Right Side)
            DrawActionDock(g);
        }

        private void DrawHeader(Graphics g)
        {
            // Header background
            using (var brush = new SolidBrush(ColorHeader))
            {
                g.FillRectangle(brush, rectTitleBar);
            }
            using (var pen = new Pen(Color.FromArgb(25, 255, 255, 255), 1))
            {
                g.DrawLine(pen, 0, 44, this.Width, 44);
            }

            // Poké Ball Vector Emblem (Left)
            DrawPokeBall(g, 18, 14, 18);

            // Title: POKÉBONK
            using (var font = new Font("Segoe UI", 11.5f, FontStyle.Bold))
            using (var brush = new SolidBrush(ColorTextWhite))
            {
                g.DrawString("POKÉBONK", font, brush, 44, 12);
            }

            // Capsule Badge: LAUNCHER
            int badgeX = 142;
            int badgeY = 13;
            var rectBadge = new Rectangle(badgeX, badgeY, 78, 19);
            using (var path = GetRoundedRectangle(rectBadge, 9))
            using (var brush = new SolidBrush(Color.FromArgb(45, 39, 76)))
            using (var pen = new Pen(Color.FromArgb(65, 56, 102), 1))
            {
                g.FillPath(brush, path);
                g.DrawPath(pen, path);
            }
            using (var font = new Font("Segoe UI", 8.0f, FontStyle.Bold))
            using (var brush = new SolidBrush(ColorTranslator.FromHtml("#cbd5e1")))
            {
                var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                g.DrawString("LAUNCHER", font, brush, rectBadge, sf);
            }

            // Discreet Version Tag in Top-Left (as requested: non-imposing, clean slate)
            using (var font = new Font("Segoe UI", 9.0f, FontStyle.Regular))
            using (var brush = new SolidBrush(ColorTextMuted))
            {
                g.DrawString("v" + launcherVersion, font, brush, 230, 14);
            }

            // Minimize Button
            if (hoverBtnMinimize)
            {
                using (var brush = new SolidBrush(Color.FromArgb(35, 255, 255, 255)))
                using (var path = GetRoundedRectangle(rectBtnMinimize, 4))
                {
                    g.FillPath(brush, path);
                }
            }
            using (var pen = new Pen(ColorTextWhite, 1.5f))
            {
                g.DrawLine(pen, rectBtnMinimize.X + 10, rectBtnMinimize.Y + 16, rectBtnMinimize.Right - 10, rectBtnMinimize.Y + 16);
            }

            // Close Button
            if (hoverBtnClose)
            {
                using (var brush = new SolidBrush(ColorRed))
                using (var path = GetRoundedRectangle(rectBtnClose, 4))
                {
                    g.FillPath(brush, path);
                }
            }
            using (var pen = new Pen(ColorTextWhite, 1.5f))
            {
                int cx = rectBtnClose.X + rectBtnClose.Width / 2;
                int cy = rectBtnClose.Y + rectBtnClose.Height / 2;
                g.DrawLine(pen, cx - 5, cy - 5, cx + 5, cy + 5);
                g.DrawLine(pen, cx + 5, cy - 5, cx - 5, cy + 5);
            }
        }

        private void DrawHeroPanel(Graphics g)
        {
            // Watermark Poké Ball Graphic in Background
            DrawPokeBallWatermark(g, 320, 160, 320);

            // Hero Brand Title
            using (var font = new Font("Segoe UI", 28.0f, FontStyle.Bold))
            using (var brush = new SolidBrush(ColorTextWhite))
            {
                g.DrawString("POKÉBONK", font, brush, 36, 75);
            }

            // Poké Red Accent Stripe
            using (var brush = new SolidBrush(ColorRed))
            {
                g.FillRectangle(brush, 38, 128, 56, 4);
            }

            // Subtitle
            using (var font = new Font("Segoe UI", 12.0f, FontStyle.Regular))
            using (var brush = new SolidBrush(ColorTranslator.FromHtml("#e2e8f0")))
            {
                g.DrawString("Real-Time Pokémon Action Battle Arena", font, brush, 36, 142);
            }

            // Feature Badges (Clean text, no emoji boxes)
            DrawFeaturePill(g, 36, 180, "Controller Ready");
            DrawFeaturePill(g, 186, 180, "60 FPS Uncapped");
            DrawFeaturePill(g, 336, 180, "GPU Accelerated");

            // Game Overview & Highlights Card
            var rectCard = new Rectangle(36, 226, 470, 230);
            using (var path = GetRoundedRectangle(rectCard, 8))
            using (var brush = new SolidBrush(ColorCard))
            using (var pen = new Pen(ColorCardBorder, 1))
            {
                g.FillPath(brush, path);
                g.DrawPath(pen, path);
            }

            // Status Badge Inside Card
            Color dotColor = ColorSuccess;
            string dotLabel = "Up to Date";
            if (currentState == LauncherState.Checking) { dotColor = ColorTextMuted; dotLabel = "Checking..."; }
            else if (currentState == LauncherState.NotInstalled) { dotColor = ColorWarning; dotLabel = "Not Installed"; }
            else if (currentState == LauncherState.UpdateAvailable) { dotColor = ColorWarning; dotLabel = "Update Available"; }
            else if (currentState == LauncherState.Downloading) { dotColor = ColorRed; dotLabel = "Downloading..."; }
            else if (currentState == LauncherState.Playing) { dotColor = ColorSuccess; dotLabel = "Game Active"; }

            // Status Indicator Dot
            using (var brush = new SolidBrush(dotColor))
            {
                g.FillEllipse(brush, 56, 248, 10, 10);
            }
            using (var font = new Font("Segoe UI", 10.0f, FontStyle.Bold))
            using (var brush = new SolidBrush(ColorTextWhite))
            {
                g.DrawString("Game Status: " + dotLabel, font, brush, 74, 243);
            }

            // Version info rows
            using (var font = new Font("Segoe UI", 9.5f, FontStyle.Regular))
            using (var fontBold = new Font("Segoe UI", 9.5f, FontStyle.Bold))
            using (var brushMuted = new SolidBrush(ColorTextMuted))
            using (var brushWhite = new SolidBrush(ColorTextWhite))
            {
                g.DrawString("Installed Version:", font, brushMuted, 56, 280);
                g.DrawString(localVersion != null ? "v" + localVersion : "None (Not Installed)", fontBold, brushWhite, 180, 280);

                g.DrawString("Latest Release:", font, brushMuted, 56, 310);
                g.DrawString(remoteVersion != null ? "v" + remoteVersion : "Connecting…", fontBold, brushWhite, 180, 310);

                g.DrawString("Install Location:", font, brushMuted, 56, 340);
                string displayPath = gameExePath;
                if (displayPath.Length > 38) displayPath = "…" + displayPath.Substring(displayPath.Length - 37);
                g.DrawString(displayPath, font, brushMuted, 180, 340);

                g.DrawString("Engine:", font, brushMuted, 56, 370);
                g.DrawString("Chromium D3D11 / Native Gamepad / Low Latency", font, brushWhite, 180, 370);
            }

            // Quick Links at Bottom (Clean text, no emoji boxes)
            DrawQuickLink(g, rectLinkWeb, "pokebonk.com", hoverLinkWeb);
            DrawQuickLink(g, rectLinkGitHub, "GitHub Releases", hoverLinkGitHub);
            DrawQuickLink(g, rectLinkDiscord, "Community Discord", hoverLinkDiscord);
        }

        private void DrawActionDock(Graphics g)
        {
            // Right Side Action Card
            var rectDock = new Rectangle(565, 60, 335, 456);
            using (var path = GetRoundedRectangle(rectDock, 8))
            using (var brush = new SolidBrush(ColorCard))
            using (var pen = new Pen(ColorCardBorder, 1))
            {
                g.FillPath(brush, path);
                g.DrawPath(pen, path);
            }

            // Heading
            using (var font = new Font("Segoe UI", 12.0f, FontStyle.Bold))
            using (var brush = new SolidBrush(ColorTextWhite))
            {
                g.DrawString("PLAY POKÉBONK", font, brush, 585, 80);
            }

            // Description / Status Banner
            var rectStatusBox = new Rectangle(585, 115, 295, 68);
            using (var path = GetRoundedRectangle(rectStatusBox, 6))
            using (var brush = new SolidBrush(Color.FromArgb(20, 0, 0, 0)))
            using (var pen = new Pen(ColorCardBorder, 1))
            {
                g.FillPath(brush, path);
                g.DrawPath(pen, path);
            }

            using (var font = new Font("Segoe UI", 9.0f, FontStyle.Regular))
            using (var brush = new SolidBrush(ColorTextMuted))
            {
                var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                g.DrawString(statusMessage, font, brush, rectStatusBox, sf);
            }

            // Progress Bar Section (Visible during downloading / installing)
            if (currentState == LauncherState.Downloading || currentState == LauncherState.Extracting)
            {
                var rectProgressTrack = new Rectangle(585, 195, 295, 10);
                using (var path = GetRoundedRectangle(rectProgressTrack, 5))
                using (var brush = new SolidBrush(Color.FromArgb(40, 255, 255, 255)))
                {
                    g.FillPath(brush, path);
                }

                int fillWidth = Math.Max(10, (int)(295 * (downloadPercent / 100.0)));
                var rectProgressFill = new Rectangle(585, 195, fillWidth, 10);
                using (var path = GetRoundedRectangle(rectProgressFill, 5))
                using (var brush = new LinearGradientBrush(rectProgressFill, ColorRed, ColorRedHover, 0f))
                {
                    g.FillPath(brush, path);
                }

                // Download Detail Text
                using (var font = new Font("Segoe UI", 8.5f, FontStyle.Regular))
                using (var brush = new SolidBrush(ColorTranslator.FromHtml("#cbd5e1")))
                {
                    var sf = new StringFormat { Alignment = StringAlignment.Center };
                    g.DrawString(downloadDetail, font, brush, new Rectangle(585, 212, 295, 28), sf);
                }
            }

            // ================= PRIMARY ACTION BUTTON (Riot Client Style, Clean Text) =================
            string actionText = "PLAY";
            Color btnColor = ColorRed;
            if (hoverBtnMainAction) btnColor = ColorRedHover;

            if (currentState == LauncherState.NotInstalled)
            {
                actionText = "INSTALL GAME";
            }
            else if (currentState == LauncherState.UpdateAvailable)
            {
                actionText = "UPDATE GAME";
            }
            else if (currentState == LauncherState.Downloading)
            {
                actionText = string.Format("DOWNLOADING ({0}%)", downloadPercent);
                btnColor = Color.FromArgb(120, ColorRed);
            }
            else if (currentState == LauncherState.Extracting)
            {
                actionText = "INSTALLING…";
                btnColor = Color.FromArgb(120, ColorRed);
            }
            else if (currentState == LauncherState.Playing)
            {
                actionText = "GAME RUNNING";
                btnColor = ColorSuccess;
            }
            else if (currentState == LauncherState.Checking)
            {
                actionText = "CHECKING…";
                btnColor = ColorButtonSec;
            }

            using (var path = GetRoundedRectangle(rectMainAction, 6))
            using (var brush = new SolidBrush(btnColor))
            {
                g.FillPath(brush, path);
            }

            using (var font = new Font("Segoe UI", 12.0f, FontStyle.Bold))
            using (var brush = new SolidBrush(ColorTextWhite))
            {
                var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                g.DrawString(actionText, font, brush, rectMainAction, sf);
            }

            // ================= UTILITY BUTTONS (Zero Emojis - Crisp Text) =================
            DrawSecondaryButton(g, rectBtnFolder, "Open Folder", hoverBtnFolder);
            DrawSecondaryButton(g, rectBtnRepair, "Repair Files", hoverBtnRepair);
            DrawSecondaryButton(g, rectBtnCheckUpdates, "Check Updates", hoverBtnCheckUpdates);
            
            // Dedicated Uninstall Button
            bool canUninstall = File.Exists(gameExePath);
            DrawDangerButton(g, rectBtnUninstall, "Uninstall", hoverBtnUninstall, canUninstall);

            // ================= AUTO-CLOSE CHECKBOX =================
            var rectBox = new Rectangle(rectAutoClose.X, rectAutoClose.Y + 3, 16, 16);
            using (var brush = new SolidBrush(Color.FromArgb(40, 255, 255, 255)))
            using (var pen = new Pen(ColorCardBorder, 1))
            {
                g.FillRectangle(brush, rectBox);
                g.DrawRectangle(pen, rectBox);
            }

            if (autoCloseOnPlay)
            {
                using (var pen = new Pen(ColorRed, 2))
                {
                    g.DrawLine(pen, rectBox.X + 3, rectBox.Y + 8, rectBox.X + 7, rectBox.Y + 12);
                    g.DrawLine(pen, rectBox.X + 7, rectBox.Y + 12, rectBox.X + 13, rectBox.Y + 4);
                }
            }

            using (var font = new Font("Segoe UI", 9.0f, FontStyle.Regular))
            using (var brush = new SolidBrush(hoverCheckAutoClose ? ColorTextWhite : ColorTextMuted))
            {
                g.DrawString("Close launcher when game launches", font, brush, rectAutoClose.X + 24, rectAutoClose.Y + 2);
            }
        }

        private void DrawFeaturePill(Graphics g, int x, int y, string label)
        {
            var rect = new Rectangle(x, y, 140, 26);
            using (var path = GetRoundedRectangle(rect, 4))
            using (var brush = new SolidBrush(Color.FromArgb(30, 255, 255, 255)))
            using (var pen = new Pen(ColorCardBorder, 1))
            {
                g.FillPath(brush, path);
                g.DrawPath(pen, path);
            }
            using (var font = new Font("Segoe UI", 8.5f, FontStyle.Regular))
            using (var brush = new SolidBrush(ColorTextWhite))
            {
                var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                g.DrawString(label, font, brush, rect, sf);
            }
        }

        private void DrawQuickLink(Graphics g, Rectangle rect, string label, bool isHover)
        {
            using (var font = new Font("Segoe UI", 9.0f, isHover ? FontStyle.Underline : FontStyle.Regular))
            using (var brush = new SolidBrush(isHover ? ColorRedHover : ColorTextMuted))
            {
                g.DrawString(label, font, brush, rect.X, rect.Y);
            }
        }

        private void DrawSecondaryButton(Graphics g, Rectangle rect, string text, bool isHover)
        {
            Color bg = isHover ? ColorButtonSecHover : ColorButtonSec;
            using (var path = GetRoundedRectangle(rect, 5))
            using (var brush = new SolidBrush(bg))
            using (var pen = new Pen(ColorCardBorder, 1))
            {
                g.FillPath(brush, path);
                g.DrawPath(pen, path);
            }
            using (var font = new Font("Segoe UI", 9.0f, FontStyle.Regular))
            using (var brush = new SolidBrush(ColorTextWhite))
            {
                var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                g.DrawString(text, font, brush, rect, sf);
            }
        }

        private void DrawDangerButton(Graphics g, Rectangle rect, string text, bool isHover, bool isEnabled)
        {
            Color bg = !isEnabled ? Color.FromArgb(20, 255, 255, 255) : (isHover ? ColorButtonDangerHover : ColorButtonDanger);
            Color border = !isEnabled ? ColorCardBorder : (isHover ? ColorRed : Color.FromArgb(60, ColorRed));
            Color textColor = !isEnabled ? ColorTextMuted : (isHover ? ColorTextWhite : ColorTranslator.FromHtml("#f87171"));

            using (var path = GetRoundedRectangle(rect, 5))
            using (var brush = new SolidBrush(bg))
            using (var pen = new Pen(border, 1))
            {
                g.FillPath(brush, path);
                g.DrawPath(pen, path);
            }
            using (var font = new Font("Segoe UI", 9.0f, FontStyle.Regular))
            using (var brush = new SolidBrush(textColor))
            {
                var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                g.DrawString(text, font, brush, rect, sf);
            }
        }

        private void DrawPokeBall(Graphics g, int x, int y, int size)
        {
            int r = size / 2;
            int cx = x + r;
            int cy = y + r;

            // Top half (Red)
            using (var brush = new SolidBrush(ColorRed))
            {
                g.FillPie(brush, x, y, size, size, 180, 180);
            }

            // Bottom half (White)
            using (var brush = new SolidBrush(Color.White))
            {
                g.FillPie(brush, x, y, size, size, 0, 180);
            }

            // Outer ring
            using (var pen = new Pen(Color.FromArgb(20, 16, 35), 1.5f))
            {
                g.DrawEllipse(pen, x, y, size, size);
                g.DrawLine(pen, x, cy, x + size, cy);
            }

            // Center button
            int centerR = size / 5;
            using (var brush = new SolidBrush(Color.White))
            using (var pen = new Pen(Color.FromArgb(20, 16, 35), 1.5f))
            {
                g.FillEllipse(brush, cx - centerR, cy - centerR, centerR * 2, centerR * 2);
                g.DrawEllipse(pen, cx - centerR, cy - centerR, centerR * 2, centerR * 2);
            }
        }

        private void DrawPokeBallWatermark(Graphics g, int x, int y, int size)
        {
            int r = size / 2;
            int cx = x + r;
            int cy = y + r;

            using (var pen = new Pen(Color.FromArgb(12, 255, 255, 255), 2.5f))
            {
                g.DrawEllipse(pen, x, y, size, size);
                g.DrawLine(pen, x, cy, x + size, cy);
                int centerR = size / 6;
                g.DrawEllipse(pen, cx - centerR, cy - centerR, centerR * 2, centerR * 2);
            }
        }

        private static GraphicsPath GetRoundedRectangle(Rectangle rect, int radius)
        {
            var path = new GraphicsPath();
            int d = radius * 2;
            path.AddArc(rect.X, rect.Y, d, d, 180, 90);
            path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
            path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
            path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        // ==================== INTERACTIVITY & EVENTS ====================

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);

            // Allow dragging from title bar
            if (e.Button == MouseButtons.Left && rectTitleBar.Contains(e.Location) &&
                !rectBtnMinimize.Contains(e.Location) && !rectBtnClose.Contains(e.Location))
            {
                ReleaseCapture();
                SendMessage(this.Handle, WM_NCLBUTTONDOWN, HT_CAPTION, 0);
                return;
            }

            // Minimize
            if (e.Button == MouseButtons.Left && rectBtnMinimize.Contains(e.Location))
            {
                this.WindowState = FormWindowState.Minimized;
                return;
            }

            // Close
            if (e.Button == MouseButtons.Left && rectBtnClose.Contains(e.Location))
            {
                this.Close();
                return;
            }

            // Main Action Button
            if (e.Button == MouseButtons.Left && rectMainAction.Contains(e.Location))
            {
                if (currentState == LauncherState.Ready)
                {
                    LaunchGame();
                }
                else if (currentState == LauncherState.Playing)
                {
                    FocusGameWindow();
                }
                else if (currentState == LauncherState.NotInstalled || currentState == LauncherState.UpdateAvailable || currentState == LauncherState.Error)
                {
                    StartDownload(true);
                }
                return;
            }

            // Open Folder
            if (e.Button == MouseButtons.Left && rectBtnFolder.Contains(e.Location))
            {
                try
                {
                    if (!Directory.Exists(gameDir)) Directory.CreateDirectory(gameDir);
                    Process.Start("explorer.exe", gameDir);
                }
                catch {}
                return;
            }

            // Repair / Reinstall
            if (e.Button == MouseButtons.Left && rectBtnRepair.Contains(e.Location))
            {
                var choice = MessageBox.Show(
                    "This will verify and re-download a fresh copy of the latest PokéBonk game executable.\n\nContinue?",
                    "Repair Game Files",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question
                );
                if (choice == DialogResult.Yes)
                {
                    StartDownload(true);
                }
                return;
            }

            // Check Updates
            if (e.Button == MouseButtons.Left && rectBtnCheckUpdates.Contains(e.Location))
            {
                Task.Factory.StartNew(() => CheckForUpdatesAsync());
                return;
            }

            // Uninstall Game
            if (e.Button == MouseButtons.Left && rectBtnUninstall.Contains(e.Location))
            {
                UninstallGame();
                return;
            }

            // Auto-Close Checkbox
            if (e.Button == MouseButtons.Left && rectAutoClose.Contains(e.Location))
            {
                autoCloseOnPlay = !autoCloseOnPlay;
                SaveSettings();
                this.Invalidate();
                return;
            }

            // Web links
            if (e.Button == MouseButtons.Left && rectLinkWeb.Contains(e.Location))
            {
                Process.Start("https://pokebonk.com");
                return;
            }
            if (e.Button == MouseButtons.Left && rectLinkGitHub.Contains(e.Location))
            {
                Process.Start("https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest");
                return;
            }
            if (e.Button == MouseButtons.Left && rectLinkDiscord.Contains(e.Location))
            {
                Process.Start("https://discord.gg/solais");
                return;
            }
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            Point p = e.Location;

            bool newHoverMin = rectBtnMinimize.Contains(p);
            bool newHoverClose = rectBtnClose.Contains(p);
            bool newHoverMain = rectMainAction.Contains(p);
            bool newHoverFolder = rectBtnFolder.Contains(p);
            bool newHoverRepair = rectBtnRepair.Contains(p);
            bool newHoverCheck = rectBtnCheckUpdates.Contains(p);
            bool newHoverUninstall = rectBtnUninstall.Contains(p);
            bool newHoverAutoClose = rectAutoClose.Contains(p);
            bool newHoverWeb = rectLinkWeb.Contains(p);
            bool newHoverGitHub = rectLinkGitHub.Contains(p);
            bool newHoverDiscord = rectLinkDiscord.Contains(p);

            bool needsRedraw = (newHoverMin != hoverBtnMinimize) ||
                               (newHoverClose != hoverBtnClose) ||
                               (newHoverMain != hoverBtnMainAction) ||
                               (newHoverFolder != hoverBtnFolder) ||
                               (newHoverRepair != hoverBtnRepair) ||
                               (newHoverCheck != hoverBtnCheckUpdates) ||
                               (newHoverUninstall != hoverBtnUninstall) ||
                               (newHoverAutoClose != hoverCheckAutoClose) ||
                               (newHoverWeb != hoverLinkWeb) ||
                               (newHoverGitHub != hoverLinkGitHub) ||
                               (newHoverDiscord != hoverLinkDiscord);

            hoverBtnMinimize = newHoverMin;
            hoverBtnClose = newHoverClose;
            hoverBtnMainAction = newHoverMain;
            hoverBtnFolder = newHoverFolder;
            hoverBtnRepair = newHoverRepair;
            hoverBtnCheckUpdates = newHoverCheck;
            hoverBtnUninstall = newHoverUninstall;
            hoverCheckAutoClose = newHoverAutoClose;
            hoverLinkWeb = newHoverWeb;
            hoverLinkGitHub = newHoverGitHub;
            hoverLinkDiscord = newHoverDiscord;

            if (newHoverMin || newHoverClose || newHoverMain || newHoverFolder ||
                newHoverRepair || newHoverCheck || newHoverUninstall || newHoverAutoClose ||
                newHoverWeb || newHoverGitHub || newHoverDiscord)
            {
                this.Cursor = Cursors.Hand;
            }
            else
            {
                this.Cursor = Cursors.Default;
            }

            if (needsRedraw)
            {
                this.Invalidate();
            }
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            hoverBtnMinimize = false;
            hoverBtnClose = false;
            hoverBtnMainAction = false;
            hoverBtnFolder = false;
            hoverBtnRepair = false;
            hoverBtnCheckUpdates = false;
            hoverBtnUninstall = false;
            hoverCheckAutoClose = false;
            hoverLinkWeb = false;
            hoverLinkGitHub = false;
            hoverLinkDiscord = false;
            this.Cursor = Cursors.Default;
            this.Invalidate();
        }

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new LauncherForm());
        }
    }
}
