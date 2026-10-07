/* ANODE SURVIVAL — ПК-оболочка (Electron). Игра запускается как в браузере: тот же Chromium, WebGL через ANGLE/D3D11, без обфускации. */
const { app, BrowserWindow, ipcMain, Menu, protocol, net, powerSaveBlocker } = require('electron');
const path = require('path'), { pathToFileURL } = require('url');

/* Скорость: аппаратная растеризация, обход чёрного списка GPU, окно не «засыпает» в фоне */
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('use-angle', 'd3d11');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
if (!app.requestSingleInstanceLock()) app.quit();

const ROOT = path.join(__dirname, 'app');
let win = null, psb = 0;

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280, height: 720, minWidth: 800, minHeight: 450, show: false, backgroundColor: '#0a1224', title: 'ANODE SURVIVAL',
    icon: path.join(__dirname, 'build', 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false, devTools: !app.isPackaged }
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://game/index.html');
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
  const sendFs = () => win && !win.isDestroyed() && win.webContents.send('fs-state', win.isFullScreen());
  win.on('enter-full-screen', sendFs); win.on('leave-full-screen', sendFs);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => { win = null; });
  psb = powerSaveBlocker.start('prevent-display-sleep');   // экран не гаснет во время игры
}

app.whenReady().then(() => {
  protocol.handle('app', req => {
    let p = decodeURIComponent(new URL(req.url).pathname); if (p === '/' || !p) p = '/index.html';
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(f).toString());
  });
  ipcMain.on('fs-set', (_, v) => { if (win) win.setFullScreen(!!v); });
  ipcMain.on('quit', () => app.quit());
  createWindow();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (psb) try { powerSaveBlocker.stop(psb); } catch (e) {} app.quit(); });
