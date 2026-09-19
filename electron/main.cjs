const { app, BrowserWindow, screen, ipcMain, globalShortcut, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const CH = require('./channels.cjs');

let mainWindow = null;
// 穿透看门狗状态
let ignoreMouseState = true;
let ignoreMouseWatchdog = null;
const IGNORE_MOUSE_WATCHDOG_MS = 45_000;

const DIST_DIR = path.join(__dirname, '../dist');

// 自定义协议必须在 app ready 之前注册为特权 scheme（支持 fetch / stream / 安全上下文）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'flyapp',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function isAllowedDevUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch {
    return false;
  }
}

function clearIgnoreMouseWatchdog() {
  if (ignoreMouseWatchdog) {
    clearTimeout(ignoreMouseWatchdog);
    ignoreMouseWatchdog = null;
  }
}

function applyIgnoreMouse(win, ignore) {
  ignoreMouseState = Boolean(ignore);
  if (ignoreMouseState) {
    win.setIgnoreMouseEvents(true, { forward: true });
    clearIgnoreMouseWatchdog();
  } else {
    win.setIgnoreMouseEvents(false);
    // 看门狗：渲染侧每 10s 重复发送 false 作为心跳；若 45s 无心跳（渲染卡死），自动恢复穿透
    clearIgnoreMouseWatchdog();
    ignoreMouseWatchdog = setTimeout(() => {
      ignoreMouseWatchdog = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.warn('[watchdog] 45s 未收到穿透心跳，自动恢复 setIgnoreMouseEvents(true, {forward:true})');
        ignoreMouseState = true;
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
      }
    }, IGNORE_MOUSE_WATCHDOG_MS);
  }
}

function loadDistMissingFallback(win) {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>果蝇桌面宠物 - 缺少构建产物</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;background:#1a1a2e;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{max-width:520px;padding:32px;background:#16213e;border-radius:12px;line-height:1.8}
code{background:#0f3460;padding:2px 8px;border-radius:4px}</style></head>
<body><div class="card"><h2>尚未构建前端资源</h2>
<p>未找到 <code>dist/index.html</code>。请先在项目根目录运行：</p>
<p><code>npm run build</code></p>
<p>构建完成后重新运行 <code>npm run desktop</code>；开发调试请使用 <code>npm run desktop:dev</code>（需先启动 <code>npm run dev</code>）。</p>
</div></body></html>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

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
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // preload 需要 require('electron') 的 ipcRenderer，故用 .cjs + sandbox:false
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false, // 保证在 macOS 后台时保持平稳生命节律，不被系统冻结
    },
  });

  // [诊断] console-message 转发仅在 FLY_DEVTOOLS 下启用；错误级日志始终保留
  if (process.env.FLY_DEVTOOLS) {
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      const msg = event && typeof event === 'object' && 'message' in event ? event.message : message;
      const src = event && typeof event === 'object' && 'sourceId' in event ? event.sourceId : sourceId;
      const ln = event && typeof event === 'object' && 'line' in event ? event.line : line;
      console.log(`[renderer] ${msg} (${src}:${ln})`);
    });
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[load-fail] code=${code} desc=${desc} url=${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[render-gone] reason=${details.reason} exitCode=${details.exitCode}，重建窗口`);
    recreateWindow();
  });
  mainWindow.on('unresponsive', () => {
    console.error('[unresponsive] 渲染进程无响应，重建窗口');
    recreateWindow();
  });

  // 在所有虚拟桌面与全屏应用上方均保持可见
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  // 默认开启鼠标点击穿透：小果蝇在全屏幕漫步飞舞，完全不阻碍用户操作 Mac 上的任何软件
  applyIgnoreMouse(mainWindow, true);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    // devUrl 白名单：仅允许本机 http 地址，防止加载任意外部页面
    if (isAllowedDevUrl(devUrl)) {
      mainWindow.loadURL(devUrl);
    } else {
      console.error(`[security] 忽略非法 VITE_DEV_SERVER_URL: ${devUrl}（仅允许 http://127.0.0.1 或 http://localhost）`);
      loadDistOrFallback(mainWindow);
    }
  } else {
    loadDistOrFallback(mainWindow);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function loadDistOrFallback(win) {
  if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    win.loadURL('flyapp://local/index.html');
  } else {
    console.error('[dist-missing] dist/index.html 不存在，加载中文提示页。请先运行 npm run build');
    loadDistMissingFallback(win);
  }
}

function recreateWindow() {
  clearIgnoreMouseWatchdog();
  const old = mainWindow;
  mainWindow = null;
  if (old && !old.isDestroyed()) old.destroy();
  createWindow();
}

// 鼠标穿透动态控制（含看门狗）：
// 悬停热区时渲染侧发送 false（并每 10s 心跳重复）；离开时发送 true 恢复全屏穿透
ipcMain.on(CH.SET_IGNORE_MOUSE_EVENTS, (event, ignore) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    applyIgnoreMouse(win, ignore);
  }
});

// 单实例锁：未获锁直接退出；第二个实例启动时聚焦已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // 打包模式：flyapp:// 协议映射到 dist/，防目录穿越
    protocol.handle('flyapp', (request) => {
      try {
        const u = new URL(request.url);
        const relPath = decodeURIComponent(u.pathname).replace(/^\/+/, '');
        const filePath = path.normalize(path.join(DIST_DIR, relPath));
        if (!filePath.startsWith(DIST_DIR + path.sep) && filePath !== DIST_DIR) {
          console.error(`[security] 阻止目录穿越请求: ${request.url}`);
          return new Response('Forbidden', { status: 403 });
        }
        return net.fetch(pathToFileURL(filePath).toString());
      } catch (err) {
        console.error(`[protocol] flyapp 处理失败: ${request.url}`, err);
        return new Response('Not Found', { status: 404 });
      }
    });

    createWindow();

    // 注册全局快捷键：无论当前在哪个应用中，按 Command+Shift+F 瞬间召唤小果蝇飞到视线中央
    try {
      const okF = globalShortcut.register('CommandOrControl+Shift+F', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(CH.SUMMON_FLY);
        }
      });
      if (!okF) console.error('[shortcut] CommandOrControl+Shift+F 注册失败：快捷键可能已被其他应用占用');

      // 注册全局快捷键：按 Command+Shift+B 呼出/收起大脑神经元思考监控舱
      const okB = globalShortcut.register('CommandOrControl+Shift+B', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(CH.TOGGLE_BRAIN_COCKPIT);
        }
      });
      if (!okB) console.error('[shortcut] CommandOrControl+Shift+B 注册失败：快捷键可能已被其他应用占用');
    } catch (err) {
      console.error('Failed to register global shortcuts:', err);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('will-quit', () => {
  clearIgnoreMouseWatchdog();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
