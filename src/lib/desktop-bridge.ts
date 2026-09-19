/**
 * Electron 桌面能力桥接层。
 *
 * preload.cjs 在 contextIsolation 下通过 contextBridge 暴露 window.flyDesktop；
 * 浏览器 / Node 测试环境下该对象不存在，所有方法安全无操作（no-op），
 * 因此 UI 代码无需关心当前是否运行在 Electron 中。
 *
 * 主进程侧约定（electron/main.cjs）：
 * - setIgnoreMouseEvents(false) 表示渲染侧接管鼠标；接管期间需每 10s 重发
 *   一次 false 作为心跳，主进程 45s 看门狗未收到心跳会自动恢复穿透，
 *   防止渲染进程卡死导致整个桌面鼠标失效。
 */

export interface FlyDesktopBridge {
  isDesktop: true;
  /** 请求切换鼠标穿透状态；重复发送 false 即作为看门狗心跳 */
  setIgnoreMouseEvents(ignore: boolean): void;
  /** 订阅"召唤果蝇"全局快捷键事件，返回取消订阅函数 */
  onSummonFly(listener: () => void): () => void;
  /** 订阅"切换神经思考监控舱"全局快捷键事件，返回取消订阅函数 */
  onToggleBrainCockpit(listener: () => void): () => void;
}

declare global {
  interface Window {
    flyDesktop?: FlyDesktopBridge;
  }
}

/** 获取桌面桥接对象；非 Electron 环境返回 undefined */
export function getDesktopBridge(): FlyDesktopBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.flyDesktop;
}

/** 安全地请求鼠标穿透切换；非 Electron 环境下无操作 */
export function setDesktopMouseIgnore(ignore: boolean): void {
  getDesktopBridge()?.setIgnoreMouseEvents(ignore);
}
