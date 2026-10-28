// Pip — main process.
// Creates one transparent, always-on-top, click-through window covering the
// primary screen's work area. Pip lives inside it. The window only captures the
// mouse while the cursor is over Pip, so the rest of your desktop stays usable.

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  screen,
  ipcMain,
  globalShortcut,
  nativeImage,
} = require('electron');
const path = require('path');
const settings = require('./settings');
const { swatch } = require('./swatch');

const TOGGLE_SHORTCUT = 'CommandOrControl+Alt+P';

// Transparent windows on Linux need this flag.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

// Only ever run one Pip at a time.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let tray = null;
let prefs = settings.load();

function assetPath(...parts) {
  return path.join(__dirname, '..', 'assets', ...parts);
}

function send(command, data) {
  if (win && !win.isDestroyed()) win.webContents.send('command', command, data);
}

function fitToScreen() {
  if (!win || win.isDestroyed()) return;
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds(workArea);
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();

  win = new BrowserWindow({
    ...workArea,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // never steal keyboard focus from what you're doing
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  // Click-through by default; `forward` still delivers mousemove so Pip can
  // notice the cursor (Windows + macOS).
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else win.showInactive();
  refreshTray();
}

function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  settings.save(prefs);
  send('prefs', prefs);
  refreshTray();
}

// Options shown in the tray. Colours are the swatches next to each choice.
const SKINS = [
  ['classic', 'Classic (ivory)', '#f5efe3'],
  ['neon', 'Neon (purple)', '#9a70fa'],
  ['retro', 'Retro (green)', '#66cc92'],
  ['midnight', 'Midnight (black)', '#3f3d4d'],
];

const GLOWS = [
  ['blue', 'Blue', '#4fc8ff'],
  ['cyan', 'Cyan', '#4ff0e6'],
  ['pink', 'Pink', '#ff73d1'],
  ['green', 'Green', '#6dff9e'],
  ['amber', 'Amber', '#ffbf4d'],
  ['purple', 'Purple', '#b48cff'],
];

const ANTENNAS = [
  ['tubes', 'Glow tubes'],
  ['bulbs', 'Round bulbs'],
];

const SIZES = [
  ['small', 'Small'],
  ['medium', 'Medium'],
  ['large', 'Large'],
];

const ROAM = [
  ['bottom', 'Bottom of screen'],
  ['anywhere', 'Anywhere'],
];

// Colour choices: a swatch icon, with a tick on the current one.
// (Plain items rather than radio items so the swatch shows on every OS.)
function swatchMenu(options, key) {
  return options.map(([value, label, hex]) => ({
    label: prefs[key] === value ? `${label}   ✓` : label,
    icon: swatch(hex),
    click: () => setPref(key, value),
  }));
}

function radioMenu(options, key) {
  return options.map(([value, label]) => ({
    label,
    type: 'radio',
    checked: prefs[key] === value,
    click: () => setPref(key, value),
  }));
}

function checkbox(label, key, extra = {}) {
  return {
    label,
    type: 'checkbox',
    checked: !!prefs[key],
    click: (item) => setPref(key, item.checked),
    ...extra,
  };
}

function buildMenu() {
  const skin = SKINS.find(([v]) => v === prefs.skin) || SKINS[0];
  const glow = GLOWS.find(([v]) => v === prefs.glow) || GLOWS[0];

  return Menu.buildFromTemplate([
    { label: 'Pip', enabled: false },
    { type: 'separator' },
    { label: 'Say hi', click: () => send('say-hi') },
    { label: 'Call Pip over', click: () => send('summon') },
    {
      label: win && win.isVisible() ? 'Hide Pip' : 'Show Pip',
      accelerator: TOGGLE_SHORTCUT,
      click: toggleVisible,
    },
    { type: 'separator' },
    { label: 'Color', icon: swatch(skin[2]), submenu: swatchMenu(SKINS, 'skin') },
    { label: 'Glow color', icon: swatch(glow[2]), submenu: swatchMenu(GLOWS, 'glow') },
    { label: 'Antennas', submenu: radioMenu(ANTENNAS, 'antenna') },
    { label: 'Size', submenu: radioMenu(SIZES, 'size') },
    checkbox('Stickers', 'stickers'),
    checkbox('Ambient light', 'ambient'),
    { type: 'separator' },
    checkbox('Let Pip roam', 'wander'),
    { label: 'Roam area', submenu: radioMenu(ROAM, 'roam') },
    checkbox('Speech bubbles', 'bubbles'),
    {
      label: 'Start with computer',
      type: 'checkbox',
      checked: prefs.startAtLogin,
      visible: process.platform !== 'linux',
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        setPref('startAtLogin', item.checked);
      },
    },
    { type: 'separator' },
    { label: 'Quit Pip', click: () => app.quit() },
  ]);
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildMenu());
}

function createTray() {
  const iconFile =
    process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const icon = nativeImage.createFromPath(assetPath(iconFile));
  if (process.platform === 'darwin') icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip('Pip');
  tray.on('click', () => send('say-hi'));
  refreshTray();
}

// --- IPC from the renderer -------------------------------------------------

ipcMain.on('set-click-through', (_event, through) => {
  if (!win || win.isDestroyed()) return;
  if (through) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
});

ipcMain.handle('get-prefs', () => prefs);

// --- App lifecycle -----------------------------------------------------------

app.on('second-instance', () => {
  if (win && !win.isVisible()) toggleVisible();
  send('say-hi');
});

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  createWindow();
  createTray();

  globalShortcut.register(TOGGLE_SHORTCUT, toggleVisible);
  screen.on('display-metrics-changed', fitToScreen);
  screen.on('display-added', fitToScreen);
  screen.on('display-removed', fitToScreen);
});

app.on('will-quit', () => globalShortcut.unregisterAll());

// Pip lives in the tray, so closing the window shouldn't quit on any platform.
app.on('window-all-closed', (e) => e.preventDefault());
