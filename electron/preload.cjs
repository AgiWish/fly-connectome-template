// 预加载脚本：在 contextIsolation 开启下，通过 contextBridge 向渲染进程暴露最小桌面能力
// 注意：必须使用 .cjs（sandbox:false + CommonJS），否则无法 require('electron')
const { contextBridge, ipcRenderer } = require('electron');
const CH = require('./channels.cjs');

contextBridge.exposeInMainWorld('flyDesktop', {
  isDesktop: true,

  // 渲染进程请求切换鼠标穿透状态（主进程侧带 45s 看门狗兜底）
  setIgnoreMouseEvents(ignore) {
    ipcRenderer.send(CH.SET_IGNORE_MOUSE_EVENTS, Boolean(ignore));
  },

  // 订阅“召唤果蝇”全局快捷键事件，返回 unsubscribe 函数
  onSummonFly(listener) {
    const handler = () => listener();
    ipcRenderer.on(CH.SUMMON_FLY, handler);
    return () => ipcRenderer.removeListener(CH.SUMMON_FLY, handler);
  },

  // 订阅“切换大脑监控舱”全局快捷键事件，返回 unsubscribe 函数
  onToggleBrainCockpit(listener) {
    const handler = () => listener();
    ipcRenderer.on(CH.TOGGLE_BRAIN_COCKPIT, handler);
    return () => ipcRenderer.removeListener(CH.TOGGLE_BRAIN_COCKPIT, handler);
  },
});
