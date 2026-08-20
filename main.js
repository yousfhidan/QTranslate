const {
  app, BrowserWindow, globalShortcut, Tray, Menu,
  nativeImage, ipcMain, clipboard, screen, dialog, safeStorage
} = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');

let mainWindow, tray, popupWindow, ocrWindow, clipIconWindow;
let isQuitting = false;
let psProc = null;

// ─── Hotkeys Config ───────────────────────────────────────────
const HOTKEYS_FILE = path.join(app.getPath('userData'), 'hotkeys.json');
const DEFAULT_HOTKEYS = {
  popup: 'Control+Q',
  mainWindow: 'CommandOrControl+Alt+Q',
  toggleWindow: 'CommandOrControl+Alt+T',
  ocr: 'CommandOrControl+Shift+O',
};

function loadHotkeys() {
  try {
    if (fs.existsSync(HOTKEYS_FILE)) {
      return { ...DEFAULT_HOTKEYS, ...JSON.parse(fs.readFileSync(HOTKEYS_FILE, 'utf8')) };
    }
  } catch (_) { }
  return { ...DEFAULT_HOTKEYS };
}

function saveHotkeys(hotkeys) {
  try { fs.writeFileSync(HOTKEYS_FILE, JSON.stringify(hotkeys, null, 2)); } catch (_) { }
}

let currentHotkeys = loadHotkeys();

// ─── متغير مشترك لآخر نص في الـ clipboard ────────────────────
let lastClipText = '';

// ─── Copy selected text (Fast WScript.Shell SendKeys Ctrl+C) ──────
function copySelectedText() {
  return new Promise((resolve) => {
    const prev = clipboard.readText();
    const cmd = `powershell -NoProfile -NonInteractive -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys('^c')"`;
    exec(cmd, { windowsHide: true }, () => {
      setTimeout(() => resolve(clipboard.readText() || prev), 120);
    });
  });
}

// ─── Register All Global Shortcuts ───────────────────────────
function registerHotkeys(hk) {
  globalShortcut.unregisterAll();
  const results = {};
  const reg = (name, combo, fn) => {
    if (!combo) { results[name] = false; return; }
    try {
      const ok = globalShortcut.register(combo, fn);
      results[name] = ok;
      if (!ok) console.warn('Hotkey failed to register:', combo);
    } catch (err) {
      results[name] = false;
      console.warn('Bad hotkey format:', combo, err.message);
    }
  };

  reg('popup', hk.popup, async () => {
    const clipBefore = clipboard.readText().trim();
    await copySelectedText();
    const clipAfter = clipboard.readText().trim();
    const text = clipAfter || clipBefore;
    if (!text) return;
    lastClipText = text;
    const { x, y } = screen.getCursorScreenPoint();
    showPopupAt(text, x, y);
  });

  reg('mainWindow', hk.mainWindow, () => {
    const text = clipboard.readText();
    mainWindow.show(); mainWindow.focus();
    if (text) mainWindow.webContents.send('translate-clipboard', text);
  });

  reg('toggleWindow', hk.toggleWindow, () => {
    mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
  });

  reg('ocr', hk.ocr, () => {
    if (!ocrWindow || ocrWindow.isDestroyed()) createOcrWindow();
    else ocrWindow.focus();
  });

  return results;
}

// ─── Main Window ─────────────────────────────────────────────
function createMainWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: 960, height: 660,
    x: Math.round((sw - 960) / 2),
    y: Math.round((sh - 660) / 2),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true,
    },
    frame: false, transparent: true,
    resizable: true, minWidth: 720, minHeight: 520,
    show: false, backgroundColor: '#00000000',
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (e) => { if (!isQuitting) { e.preventDefault(); mainWindow.hide(); } });
}

// ─── Popup Window ─────────────────────────────────────────────
function createPopupWindow() {
  popupWindow = new BrowserWindow({
    width: 440, height: 210,
    frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: false, focusable: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-popup.js'),
      nodeIntegration: false, contextIsolation: true,
    }
  });
  popupWindow.loadFile(path.join(__dirname, 'src', 'popup.html'));
  popupWindow.on('blur', () => { if (!popupWindow._pinned) popupWindow.hide(); });
}

function showPopupAt(text, x, y) {
  if (!popupWindow || popupWindow.isDestroyed()) createPopupWindow();

  const { workArea } = screen.getDisplayNearestPoint({ x, y });
  let px = x + 12, py = y + 12;
  if (px + 440 > workArea.x + workArea.width) px = x - 450;
  if (py + 210 > workArea.y + workArea.height) py = y - 220;
  popupWindow.setPosition(Math.max(0, px), Math.max(0, py));
  popupWindow._pinned = false;
  popupWindow.showInactive();
  if (text && text.trim()) popupWindow.webContents.send('popup-translate', text.trim());
}

// ─── OCR Window ───────────────────────────────────────────────
function createOcrWindow() {
  const { bounds } = screen.getPrimaryDisplay();
  ocrWindow = new BrowserWindow({
    x: bounds.x, y: bounds.y,
    width: bounds.width, height: bounds.height,
    frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-ocr.js'),
      nodeIntegration: false, contextIsolation: true,
    }
  });
  ocrWindow.loadFile(path.join(__dirname, 'src', 'ocr-overlay.html'));
}

// ─── System Tray ─────────────────────────────────────────────
function createTray() {
  let icon;
  try { icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png')); }
  catch (_) { icon = nativeImage.createEmpty(); }
  tray = new Tray(icon);
  tray.setToolTip('QTranslate - مترجم فوري');

  const rebuild = () => {
    const hk = currentHotkeys;
    const menu = Menu.buildFromTemplate([
      { label: '🌐 فتح QTranslate', click: () => { mainWindow.show(); mainWindow.focus(); } },
      { type: 'separator' },
      { label: `📋 ترجمة الحافظة  ${hk.mainWindow}`, click: () => { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('translate-clipboard', clipboard.readText()); } },
      { label: `🖱️ نافذة Popup  ${hk.popup}`, click: async () => { const { x, y } = screen.getCursorScreenPoint(); showPopupAt(clipboard.readText(), x, y); } },
      { label: `🔍 OCR  ${hk.ocr}`, click: () => { if (!ocrWindow || ocrWindow.isDestroyed()) createOcrWindow(); else ocrWindow.focus(); } },
      { label: '⚙️ إعدادات الاختصارات', click: () => { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('open-hotkeys-settings'); } },
      { type: 'separator' },
      { label: '❌ إغلاق', click: () => { isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(menu);
  };

  rebuild();
  tray.on('click', () => mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus()));
  return rebuild;
}

// ─── Floating Clipboard Icon ──────────────────────────────────
let clipIconText = '';
let clipIconPos = { x: 0, y: 0 };
let clipIconHideTimer;

function createClipIconWindow() {
  clipIconWindow = new BrowserWindow({
    width: 44, height: 44,
    frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: false, focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-clip-icon.js'),
      nodeIntegration: false, contextIsolation: true,
    }
  });
  clipIconWindow.setAlwaysOnTop(true, 'screen-saver');
  clipIconWindow.loadFile(path.join(__dirname, 'src', 'clip-icon.html'));
}

function showClipIconAt(text, x, y) {
  if (!clipIconWindow || clipIconWindow.isDestroyed()) createClipIconWindow();
  clipIconText = text;
  clipIconPos = { x, y };
  clearTimeout(clipIconHideTimer);

  const display = screen.getDisplayNearestPoint({ x, y });
  const wa = display.workArea;
  let ix = x + 14, iy = y + 18;
  if (ix + 44 > wa.x + wa.width) ix = x - 56;
  if (iy + 44 > wa.y + wa.height) iy = y - 56;
  ix = Math.max(wa.x, ix);
  iy = Math.max(wa.y, iy);

  clipIconWindow.setPosition(Math.round(ix), Math.round(iy));
  clipIconWindow.showInactive();
  clipIconWindow.setAlwaysOnTop(true, 'screen-saver');

  clipIconHideTimer = setTimeout(() => {
    if (clipIconWindow && !clipIconWindow.isDestroyed()) clipIconWindow.hide();
  }, 4000);
}

// ─── Safe Process Cleanup ─────────────────────────────────────
function stopPsProc() {
  if (psProc && !psProc.killed) {
    try { psProc.kill(); } catch (_) { }
    psProc = null;
  }
}

// ─── App Ready ────────────────────────────────────────────────
let rebuildTray;
app.whenReady().then(() => {
  createMainWindow();
  rebuildTray = createTray();
  registerHotkeys(currentHotkeys);
  createClipIconWindow();

  let mouseWasDown = false;
  let checkingCopy = false;

  // Smart Drag-Selection Mouse Listener (Only triggers Ctrl+C on real text selection drag > 25px)
  const PS_MOUSE_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinAPI {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  public struct POINT { public int X; public int Y; }
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public static void PressCtrlC() {
    keybd_event(0x11, 0, 0, UIntPtr.Zero);
    keybd_event(0x43, 0, 0, UIntPtr.Zero);
    keybd_event(0x43, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    keybd_event(0x11, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }
  public static string GetForegroundTitle() {
    var sb = new StringBuilder(256);
    GetWindowText(GetForegroundWindow(), sb, 256);
    return sb.ToString();
  }
}
"@
$wasDown = $false
$startX = 0
$startY = 0
while ($true) {
  $isDown = ([WinAPI]::GetAsyncKeyState(1) -band 0x8000) -ne 0
  if ($isDown -and -not $wasDown) {
    $pt = New-Object WinAPI+POINT
    [WinAPI]::GetCursorPos([ref]$pt)
    $startX = $pt.X
    $startY = $pt.Y
    $wasDown = $true
  } elseif (-not $isDown -and $wasDown) {
    $pt = New-Object WinAPI+POINT
    [WinAPI]::GetCursorPos([ref]$pt)
    $dist = [Math]::Sqrt([Math]::Pow($pt.X - $startX, 2) + [Math]::Pow($pt.Y - $startY, 2))
    $wasDown = $false
    if ($dist -gt 25) {
      Start-Sleep -Milliseconds 60
      $title = [WinAPI]::GetForegroundTitle()
      if ($title -notmatch "QTranslate") {
        [WinAPI]::PressCtrlC()
        Start-Sleep -Milliseconds 250
        Write-Output "UP"
        [Console]::Out.Flush()
      }
    }
  }
  Start-Sleep -Milliseconds 40
}`.trim();

  psProc = spawn('powershell', ['-NoProfile', '-Command', PS_MOUSE_SCRIPT], {
    windowsHide: true,
  });

  psProc.stdout.on('data', async (data) => {
    const lines = data.toString().split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line === 'UP') {
        if (checkingCopy) continue;
        checkingCopy = true;
        await new Promise(r => setTimeout(r, 200));
        try {
          const newClip = clipboard.readText().trim();
          if (newClip && newClip !== lastClipText && newClip.length <= 5000) {
            lastClipText = newClip;
            const { x, y } = screen.getCursorScreenPoint();
            showClipIconAt(newClip, x, y);
          }
        } catch (_) { }
        checkingCopy = false;
      }
    }
  });

  psProc.on('error', (err) => {
    console.warn('[Mouse] PowerShell unavailable:', err.message);
  });

  psProc.on('close', (code) => {
    console.warn('[Mouse] PowerShell exited with code:', code);
  });

  // Clipboard polling safety interval
  setInterval(() => {
    if (checkingCopy || mouseWasDown) return;
    try {
      const clip = clipboard.readText().trim();
      if (clip && clip !== lastClipText && clip.length <= 5000) {
        lastClipText = clip;
        const { x, y } = screen.getCursorScreenPoint();
        showClipIconAt(clip, x, y);
      }
    } catch (_) { }
  }, 400);

  ipcMain.on('clip-icon-clicked', () => {
    const text = clipIconText;
    if (clipIconWindow && !clipIconWindow.isDestroyed()) clipIconWindow.hide();
    clearTimeout(clipIconHideTimer);
    if (!text || !text.trim()) return;
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('translate-clipboard', text.trim());
  });

  ipcMain.on('popup-resize', (_, w, h) => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      const [cx, cy] = popupWindow.getPosition();
      popupWindow.setSize(Math.max(w, 320), Math.max(h, 120));
      popupWindow.setPosition(cx, cy);
    }
  });

  ipcMain.handle('get-hotkeys', () => currentHotkeys);

  ipcMain.on('update-hotkeys', (_, newHotkeys) => {
    currentHotkeys = { ...currentHotkeys, ...newHotkeys };
    saveHotkeys(currentHotkeys);
    const results = registerHotkeys(currentHotkeys);
    if (rebuildTray) rebuildTray();
    mainWindow.webContents.send('hotkeys-updated', currentHotkeys, results);
  });

  ipcMain.on('reset-hotkeys', () => {
    currentHotkeys = { ...DEFAULT_HOTKEYS };
    saveHotkeys(currentHotkeys);
    const results = registerHotkeys(currentHotkeys);
    if (rebuildTray) rebuildTray();
    mainWindow.webContents.send('hotkeys-updated', currentHotkeys, results);
  });
});

// ─── IPC Handlers ─────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-close', () => mainWindow.hide());
ipcMain.on('window-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('copy-text', (_, t) => clipboard.writeText(t));
ipcMain.on('popup-pin', () => { if (popupWindow) popupWindow._pinned = true; });
ipcMain.on('popup-close', () => { if (popupWindow) popupWindow.hide(); });
ipcMain.on('popup-open-main', (_, text) => { mainWindow.show(); mainWindow.focus(); if (text) mainWindow.webContents.send('translate-clipboard', text); });

// OCR region handler
ipcMain.on('ocr-region-selected', async (_, region) => {
  if (ocrWindow && !ocrWindow.isDestroyed()) ocrWindow.hide();

  // Wait for Windows to repaint screen behind overlay
  await new Promise(r => setTimeout(r, 250));

  try {
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: region.screenW, height: region.screenH }
    });
    if (!sources.length) return;
    const cropped = sources[0].thumbnail.crop({ x: region.x, y: region.y, width: region.width, height: region.height });

    if (region.action === 'copy-image') {
      clipboard.writeImage(cropped);
      if (tray) { tray.setToolTip('✅ تم نسخ الصورة!'); setTimeout(() => tray.setToolTip('QTranslate'), 3000); }
      return;
    }
    if (region.action === 'save-image') {
      const { filePath } = await dialog.showSaveDialog({ title: 'حفظ لقطة', defaultPath: `screenshot_${Date.now()}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] });
      if (filePath) fs.writeFileSync(filePath, cropped.toPNG());
      return;
    }
    // OCR + Translate
    mainWindow.show(); mainWindow.focus();
    mainWindow.webContents.send('ocr-image-data', cropped.toDataURL());
  } catch (err) { console.error('OCR error:', err); }
});

ipcMain.on('open-ocr-window', () => {
  if (!ocrWindow || ocrWindow.isDestroyed()) createOcrWindow();
  else ocrWindow.focus();
});

ipcMain.on('ocr-cancel', () => { if (ocrWindow && !ocrWindow.isDestroyed()) ocrWindow.close(); });

ipcMain.on('pause-hotkeys', () => globalShortcut.unregisterAll());
ipcMain.on('resume-hotkeys', () => registerHotkeys(currentHotkeys));

// ─── Safe Cleanup App Events ──────────────────────────────────
app.on('before-quit', () => {
  isQuitting = true;
  stopPsProc();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopPsProc();
});

app.on('window-all-closed', () => {
  // Controlled by Tray
});
