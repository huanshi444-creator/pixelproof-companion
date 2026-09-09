using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("PixelProof Companion")]
[assembly: AssemblyDescription("Local browser companion for PixelProof")]
[assembly: AssemblyCompany("PixelProof")]
[assembly: AssemblyProduct("PixelProof Companion")]
[assembly: AssemblyCopyright("Copyright © PixelProof 2026")]
[assembly: AssemblyVersion("0.3.0.0")]
[assembly: AssemblyFileVersion("0.3.0.0")]

namespace PixelProofCompanion
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            bool createdNew;
            using (Mutex mutex = new Mutex(true, "Local\\PixelProofCompanion", out createdNew))
            {
                if (!createdNew)
                {
                    MessageBox.Show("PixelProof 本机伴侣已经在运行。请回到 Figma 插件点击“重新检测”。", "PixelProof Companion", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new CompanionApplicationContext());
            }
        }
    }

    internal sealed class CompanionApplicationContext : ApplicationContext
    {
        private const string HealthUrl = "http://localhost:49321/health";
        private const string StartupRegistryPath = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
        private const string StartupRegistryName = "PixelProof Companion";

        private readonly NotifyIcon trayIcon;
        private readonly ToolStripMenuItem statusItem;
        private readonly ToolStripMenuItem autoStartItem;
        private readonly System.Windows.Forms.Timer healthTimer;
        private readonly StatusForm statusForm;
        private readonly string baseDirectory;
        private readonly string logDirectory;
        private Process companionProcess;
        private StreamWriter outputLog;
        private StreamWriter errorLog;
        private bool online;
        private bool onlineNotificationShown;
        private bool exiting;
        private DateTime nextStartAttempt = DateTime.MinValue;

        internal CompanionApplicationContext()
        {
            baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
            logDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PixelProof Companion", "logs");
            Directory.CreateDirectory(logDirectory);

            statusItem = new ToolStripMenuItem("状态：正在启动…");
            statusItem.Enabled = false;

            autoStartItem = new ToolStripMenuItem("开机自动启动");
            autoStartItem.Checked = IsAutoStartEnabled();
            autoStartItem.Click += delegate { ToggleAutoStart(); };

            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("打开伴侣窗口", null, delegate { ShowStatusWindow(); });
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("在浏览器中查看状态", null, delegate { OpenUrl(HealthUrl); });
            menu.Items.Add("重新启动伴侣", null, delegate { RestartCompanion(); });
            menu.Items.Add("打开日志文件夹", null, delegate { OpenFolder(logDirectory); });
            menu.Items.Add(autoStartItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出 PixelProof Companion", null, delegate { ExitCompanion(); });

            Icon appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            trayIcon = new NotifyIcon();
            trayIcon.Icon = appIcon ?? SystemIcons.Application;
            trayIcon.Text = "PixelProof Companion · 正在启动";
            trayIcon.ContextMenuStrip = menu;
            trayIcon.Visible = true;
            trayIcon.DoubleClick += delegate { ShowStatusWindow(); };

            statusForm = new StatusForm(
                trayIcon.Icon,
                delegate { RestartCompanion(); },
                delegate { OpenFolder(logDirectory); },
                delegate { ToggleAutoStart(); },
                delegate { ExitCompanion(); },
                autoStartItem.Checked
            );

            healthTimer = new System.Windows.Forms.Timer();
            healthTimer.Interval = 1200;
            healthTimer.Tick += delegate { CheckHealthAndRecover(); };

            StartCompanion();
            healthTimer.Start();
            statusForm.Show();
        }

        private void StartCompanion()
        {
            if (exiting || DateTime.UtcNow < nextStartAttempt || IsHealthy())
            {
                return;
            }

            string nodePath = Path.Combine(baseDirectory, "runtime", "node.exe");
            string appDirectory = Path.Combine(baseDirectory, "app");
            string serverPath = Path.Combine(appDirectory, "companion", "server.cjs");

            if (!File.Exists(nodePath) || !File.Exists(serverPath))
            {
                SetStatus(false, "发布包不完整");
                MessageBox.Show("发布包不完整。请重新解压整个 PixelProof Companion 文件夹，不要只复制 EXE。", "PixelProof Companion", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            try
            {
                CloseLogs();
                outputLog = CreateLogWriter("companion.log");
                errorLog = CreateLogWriter("companion-error.log");

                ProcessStartInfo startInfo = new ProcessStartInfo();
                startInfo.FileName = nodePath;
                startInfo.Arguments = "\"" + serverPath + "\"";
                startInfo.WorkingDirectory = appDirectory;
                startInfo.UseShellExecute = false;
                startInfo.CreateNoWindow = true;
                startInfo.WindowStyle = ProcessWindowStyle.Hidden;
                startInfo.RedirectStandardOutput = true;
                startInfo.RedirectStandardError = true;
                startInfo.EnvironmentVariables["PIXELPROOF_PORT"] = "49321";

                companionProcess = new Process();
                companionProcess.StartInfo = startInfo;
                companionProcess.EnableRaisingEvents = true;
                companionProcess.OutputDataReceived += delegate(object sender, DataReceivedEventArgs args) { WriteLog(outputLog, args.Data); };
                companionProcess.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs args) { WriteLog(errorLog, args.Data); };
                companionProcess.Start();
                companionProcess.BeginOutputReadLine();
                companionProcess.BeginErrorReadLine();
                nextStartAttempt = DateTime.UtcNow.AddSeconds(3);
                SetStatus(false, "正在启动…");
            }
            catch (Exception error)
            {
                WriteLog(errorLog, error.ToString());
                nextStartAttempt = DateTime.UtcNow.AddSeconds(5);
                SetStatus(false, "启动失败");
            }
        }

        private void CheckHealthAndRecover()
        {
            bool healthy = IsHealthy();
            SetStatus(healthy, healthy ? "本机伴侣在线" : "本机伴侣离线");

            if (healthy)
            {
                if (!onlineNotificationShown)
                {
                    onlineNotificationShown = true;
                    trayIcon.BalloonTipTitle = "PixelProof Companion 已启动";
                    trayIcon.BalloonTipText = "请回到 Figma 插件点击“重新检测”。";
                    trayIcon.BalloonTipIcon = ToolTipIcon.Info;
                    trayIcon.ShowBalloonTip(2600);
                }
                return;
            }

            onlineNotificationShown = false;
            if (companionProcess == null || companionProcess.HasExited)
            {
                StartCompanion();
            }
        }

        private static bool IsHealthy()
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(HealthUrl);
                request.Method = "GET";
                request.Timeout = 650;
                request.ReadWriteTimeout = 650;
                request.Proxy = null;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                {
                    return response.StatusCode == HttpStatusCode.OK && reader.ReadToEnd().Contains("\"ok\":true");
                }
            }
            catch
            {
                return false;
            }
        }

        private void SetStatus(bool isOnline, string label)
        {
            online = isOnline;
            statusItem.Text = "状态：" + label;
            trayIcon.Text = isOnline ? "PixelProof Companion · 在线" : "PixelProof Companion · " + label;
            if (statusForm != null) statusForm.SetStatus(isOnline, label);
        }

        private void ShowStatusWindow()
        {
            if (statusForm.WindowState == FormWindowState.Minimized) statusForm.WindowState = FormWindowState.Normal;
            statusForm.Show();
            statusForm.BringToFront();
            statusForm.Activate();
            if (!online) StartCompanion();
        }

        private void RestartCompanion()
        {
            StopOwnedProcess();
            nextStartAttempt = DateTime.MinValue;
            onlineNotificationShown = false;
            StartCompanion();
        }

        private void ToggleAutoStart()
        {
            bool enable = !autoStartItem.Checked;
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(StartupRegistryPath, true))
                {
                    if (key == null) throw new InvalidOperationException("无法打开 Windows 启动项设置。");
                    if (enable) key.SetValue(StartupRegistryName, "\"" + Application.ExecutablePath + "\"");
                    else key.DeleteValue(StartupRegistryName, false);
                }
                autoStartItem.Checked = enable;
                statusForm.SetAutoStart(enable);
                trayIcon.BalloonTipTitle = "PixelProof Companion";
                trayIcon.BalloonTipText = enable ? "已开启开机自动启动。" : "已关闭开机自动启动。";
                trayIcon.BalloonTipIcon = ToolTipIcon.Info;
                trayIcon.ShowBalloonTip(1800);
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "PixelProof Companion", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static bool IsAutoStartEnabled()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(StartupRegistryPath, false))
                {
                    return key != null && key.GetValue(StartupRegistryName) != null;
                }
            }
            catch
            {
                return false;
            }
        }

        private StreamWriter CreateLogWriter(string fileName)
        {
            StreamWriter writer = new StreamWriter(Path.Combine(logDirectory, fileName), true);
            writer.AutoFlush = true;
            writer.WriteLine("[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] PixelProof Companion starting");
            return writer;
        }

        private static void WriteLog(StreamWriter writer, string message)
        {
            if (writer == null || String.IsNullOrEmpty(message)) return;
            try { writer.WriteLine("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + message); }
            catch { }
        }

        private void CloseLogs()
        {
            if (outputLog != null) { outputLog.Dispose(); outputLog = null; }
            if (errorLog != null) { errorLog.Dispose(); errorLog = null; }
        }

        private void StopOwnedProcess()
        {
            if (companionProcess == null) return;
            try
            {
                if (!companionProcess.HasExited)
                {
                    companionProcess.Kill();
                    companionProcess.WaitForExit(1800);
                }
            }
            catch { }
            companionProcess.Dispose();
            companionProcess = null;
            CloseLogs();
        }

        private static void OpenUrl(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch { }
        }

        private static void OpenFolder(string path)
        {
            try { Process.Start("explorer.exe", "\"" + path + "\""); }
            catch { }
        }

        private void ExitCompanion()
        {
            exiting = true;
            healthTimer.Stop();
            StopOwnedProcess();
            trayIcon.Visible = false;
            statusForm.AllowClose = true;
            statusForm.Close();
            ExitThread();
        }

        protected override void ExitThreadCore()
        {
            exiting = true;
            if (healthTimer != null) healthTimer.Stop();
            StopOwnedProcess();
            if (statusForm != null && !statusForm.IsDisposed)
            {
                statusForm.AllowClose = true;
                statusForm.Dispose();
            }
            if (trayIcon != null) trayIcon.Dispose();
            base.ExitThreadCore();
        }
    }

    internal sealed class StatusDot : Control
    {
        internal bool Online { get; set; }

        internal StatusDot()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
            Size = new Size(12, 12);
        }

        protected override void OnPaint(PaintEventArgs args)
        {
            base.OnPaint(args);
            args.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            Color color = Online ? Color.FromArgb(75, 196, 107) : Color.FromArgb(124, 131, 141);
            using (SolidBrush glow = new SolidBrush(Color.FromArgb(45, color)))
            using (SolidBrush fill = new SolidBrush(color))
            {
                args.Graphics.FillEllipse(glow, 0, 0, 12, 12);
                args.Graphics.FillEllipse(fill, 3, 3, 6, 6);
            }
        }
    }

    internal sealed class StatusForm : Form
    {
        private readonly StatusDot statusDot;
        private readonly Label statusLabel;
        private readonly Label statusDescription;
        private readonly CheckBox autoStartCheckBox;
        private readonly Action restartAction;
        private readonly Action openLogsAction;
        private readonly Action toggleAutoStartAction;
        private readonly Action exitAction;
        private bool syncingAutoStart;

        internal bool AllowClose { get; set; }

        internal StatusForm(Icon icon, Action restart, Action openLogs, Action toggleAutoStart, Action exit, bool autoStartEnabled)
        {
            restartAction = restart;
            openLogsAction = openLogs;
            toggleAutoStartAction = toggleAutoStart;
            exitAction = exit;

            Text = "PixelProof Companion";
            Icon = icon;
            ClientSize = new Size(390, 286);
            MinimumSize = new Size(406, 325);
            MaximumSize = new Size(406, 325);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = Color.FromArgb(24, 26, 29);
            ForeColor = Color.FromArgb(238, 240, 243);
            Font = new Font("Segoe UI", 9f, FontStyle.Regular, GraphicsUnit.Point);
            AutoScaleMode = AutoScaleMode.Dpi;

            PictureBox logo = new PictureBox();
            logo.Image = icon.ToBitmap();
            logo.SizeMode = PictureBoxSizeMode.Zoom;
            logo.SetBounds(22, 20, 34, 34);
            Controls.Add(logo);

            Label title = CreateLabel("PixelProof Companion", 68, 19, 270, 22, 13f, FontStyle.Bold, Color.FromArgb(246, 247, 249));
            Controls.Add(title);
            Label subtitle = CreateLabel("设计还原度与 Token 检查的本机服务", 68, 42, 280, 18, 8.5f, FontStyle.Regular, Color.FromArgb(148, 154, 163));
            Controls.Add(subtitle);

            Panel statusCard = new Panel();
            statusCard.SetBounds(22, 76, 346, 76);
            statusCard.BackColor = Color.FromArgb(34, 37, 42);
            Controls.Add(statusCard);

            statusDot = new StatusDot();
            statusDot.Location = new Point(16, 18);
            statusCard.Controls.Add(statusDot);
            statusLabel = CreateLabel("正在启动…", 39, 13, 285, 22, 10f, FontStyle.Bold, Color.FromArgb(238, 240, 243));
            statusCard.Controls.Add(statusLabel);
            statusDescription = CreateLabel("正在连接 localhost:49321", 39, 38, 285, 20, 8f, FontStyle.Regular, Color.FromArgb(148, 154, 163));
            statusCard.Controls.Add(statusDescription);

            autoStartCheckBox = new CheckBox();
            autoStartCheckBox.Text = "开机自动启动";
            autoStartCheckBox.Checked = autoStartEnabled;
            autoStartCheckBox.AutoSize = true;
            autoStartCheckBox.Location = new Point(22, 168);
            autoStartCheckBox.ForeColor = Color.FromArgb(196, 201, 208);
            autoStartCheckBox.FlatStyle = FlatStyle.Flat;
            autoStartCheckBox.CheckedChanged += delegate
            {
                if (!syncingAutoStart) toggleAutoStartAction();
            };
            Controls.Add(autoStartCheckBox);

            Button logsButton = CreateButton("查看日志", 267, 162, 101, 31, false);
            logsButton.Click += delegate { openLogsAction(); };
            Controls.Add(logsButton);

            Button restartButton = CreateButton("重新启动", 22, 208, 106, 38, false);
            restartButton.Click += delegate { restartAction(); };
            Controls.Add(restartButton);

            Button minimizeButton = CreateButton("最小化到托盘", 137, 208, 112, 38, false);
            minimizeButton.Click += delegate { Hide(); };
            Controls.Add(minimizeButton);

            Button exitButton = CreateButton("关闭伴侣", 258, 208, 110, 38, true);
            exitButton.Click += delegate { exitAction(); };
            Controls.Add(exitButton);

            Label hint = CreateLabel("点右上角 × 只会缩到托盘；“关闭伴侣”会停止本机服务。", 22, 257, 346, 18, 7.5f, FontStyle.Regular, Color.FromArgb(121, 127, 136));
            Controls.Add(hint);

            FormClosing += delegate(object sender, FormClosingEventArgs args)
            {
                if (!AllowClose && args.CloseReason == CloseReason.UserClosing)
                {
                    args.Cancel = true;
                    Hide();
                }
            };
        }

        internal void SetStatus(bool online, string label)
        {
            statusDot.Online = online;
            statusDot.Invalidate();
            statusLabel.Text = label;
            statusLabel.ForeColor = online ? Color.FromArgb(103, 206, 129) : Color.FromArgb(238, 240, 243);
            statusDescription.Text = online ? "Figma 插件现在可以开始检查" : "正在连接 localhost:49321";
        }

        internal void SetAutoStart(bool enabled)
        {
            syncingAutoStart = true;
            autoStartCheckBox.Checked = enabled;
            syncingAutoStart = false;
        }

        private static Label CreateLabel(string text, int x, int y, int width, int height, float size, FontStyle style, Color color)
        {
            Label label = new Label();
            label.Text = text;
            label.SetBounds(x, y, width, height);
            label.Font = new Font("Segoe UI", size, style, GraphicsUnit.Point);
            label.ForeColor = color;
            label.BackColor = Color.Transparent;
            label.AutoEllipsis = true;
            return label;
        }

        private static Button CreateButton(string text, int x, int y, int width, int height, bool danger)
        {
            Button button = new Button();
            button.Text = text;
            button.SetBounds(x, y, width, height);
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderSize = 1;
            button.FlatAppearance.BorderColor = danger ? Color.FromArgb(255, 98, 90) : Color.FromArgb(67, 72, 80);
            button.BackColor = danger ? Color.FromArgb(255, 98, 90) : Color.FromArgb(40, 43, 48);
            button.ForeColor = danger ? Color.White : Color.FromArgb(230, 233, 237);
            button.Cursor = Cursors.Hand;
            button.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold, GraphicsUnit.Point);
            button.UseVisualStyleBackColor = false;
            return button;
        }
    }
}
