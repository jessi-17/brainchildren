// Helping brainchildren stay in your life: start at login, desktop
// notifications, and one running copy at a time.
import { promises as fs, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

// ---------------------------------------------------------------- start at login

function autostartFile() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'brainchildren.vbs');
  }
  if (process.platform === 'darwin') return path.join(home, 'Library', 'LaunchAgents', 'app.brainchildren.plist');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'autostart', 'brainchildren.desktop');
}

export async function autostartStatus() {
  try {
    await fs.access(autostartFile());
    return true;
  } catch {
    return false;
  }
}

export async function setAutostart(on, { serverPath, dataDir, defaultDataDir }) {
  const file = autostartFile();
  if (!on) {
    await fs.rm(file, { force: true });
    return false;
  }
  const node = process.execPath;
  const args = [serverPath, '--no-open'];
  if (path.resolve(dataDir) !== path.resolve(defaultDataDir)) args.push('--data', dataDir);
  let body;
  if (process.platform === 'win32') {
    // runs node with no console window; quotes are doubled for VBScript
    const q = (s) => `""${s.replace(/"/g, '')}""`;
    const cmd = [q(node), ...args.map((a) => (a.startsWith('--') ? a : q(a)))].join(' ');
    body = `' Starts brainchildren quietly when you log in.\r\n' Created from brainchildren's settings. Delete this file (or switch it off there) to stop.\r\nCreateObject("WScript.Shell").Run "${cmd}", 0, False\r\n`;
  } else if (process.platform === 'darwin') {
    const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    body = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>app.brainchildren</string>
  <key>ProgramArguments</key><array>${[node, ...args].map((a) => `<string>${xml(a)}</string>`).join('')}</array>
  <key>RunAtLoad</key><true/>
</dict></plist>
`;
  } else {
    const q = (s) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
    body = `[Desktop Entry]\nType=Application\nName=brainchildren\nComment=your project ideas, living in a tiny pixel studio\nExec=${[node, ...args].map(q).join(' ')}\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n`;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  return true;
}

// ---------------------------------------------------------------- notifications

const xmlEsc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

export function notify(title, body, url) {
  return new Promise((resolve) => {
    const done = (err) => resolve(!err);
    if (process.platform === 'win32') {
      const toast = `<toast activationType="protocol" launch="${xmlEsc(url)}"><visual><binding template="ToastGeneric"><text>${xmlEsc(title)}</text><text>${xmlEsc(body)}</text></binding></visual><audio silent="true"/></toast>`;
      const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml(@'
${toast}
'@)
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))`;
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { windowsHide: true, timeout: 15000 }, done);
    } else if (process.platform === 'darwin') {
      const as = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      execFile('osascript', ['-e', `display notification ${as(body)} with title ${as(title)}`], { timeout: 15000 }, done);
    } else {
      execFile('notify-send', ['--app-name=brainchildren', title, body], { timeout: 15000 }, done);
    }
  });
}

// ---------------------------------------------------------------- one copy at a time

export async function findRunning(dataDir) {
  try {
    const lock = JSON.parse(await fs.readFile(path.join(dataDir, '.lock'), 'utf8'));
    process.kill(lock.pid, 0);
    const res = await fetch(`http://127.0.0.1:${lock.port}/__brainchildren`, { signal: AbortSignal.timeout(1200) });
    const info = await res.json();
    return info.app === 'brainchildren' ? { port: lock.port, pid: lock.pid } : null;
  } catch {
    return null;
  }
}

export async function writeLock(dataDir, port) {
  const file = path.join(dataDir, '.lock');
  await fs.writeFile(file, JSON.stringify({ pid: process.pid, port }));
  const clear = () => {
    try {
      // only remove it if it is still ours
      const lock = JSON.parse(readFileSync(file, 'utf8'));
      if (lock.pid === process.pid) rmSync(file, { force: true });
    } catch {}
  };
  return clear;
}
