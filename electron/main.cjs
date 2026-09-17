const { app, BrowserWindow, screen, ipcMain, globalShortcut } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.bounds;

  // 创建 macOS 原生全屏完全透明、默认点击穿透桌面生态视窗
  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    enableLargerThanScreen: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false, // 允许本地 file:// 协议顺利加载 public/data 静态二进制资产
      backgroundThrottling: false, // 保证在 macOS 后台时保持平稳生命节律，不被系统冻结
    },
  });

  // 在所有虚拟桌面与全屏应用上方均保持可见
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  // 默认开启鼠标点击穿透：小果蝇在全屏幕漫步飞舞，完全不阻碍用户操作 Mac 上的任何软件
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  // 鼠标穿透动态控制：
  // 当鼠标悬停在果蝇热区或思考气泡上时：必须调用 setIgnoreMouseEvents(false) 且绝对不能加 forward: true，确保按钮 100% 可被点击！
  // 离开后：调用 setIgnoreMouseEvents(true, { forward: true }) 恢复全屏穿透
  ipcMain.on('set-ignore-mouse-events', (event, ignore) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      if (ignore) {
        win.setIgnoreMouseEvents(true, { forward: true });
      } else {
        win.setIgnoreMouseEvents(false);
      }
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 针对 macOS 特性优化
app.whenReady().then(() => {
  createWindow();

  // 注册全局快捷键：无论当前在哪个应用中，按 Command+Shift+F (或 Ctrl+Shift+F) 都能瞬间召唤小果蝇飞到视线中央
  try {
    globalShortcut.register('CommandOrControl+Shift+F', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('summon-fly');
      }
    });
  } catch (err) {
    console.error('Failed to register global shortcut:', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
