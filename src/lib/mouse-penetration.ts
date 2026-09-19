/**
 * 桌面宠物鼠标穿透单一事实源。
 *
 * 背景：历史上穿透状态散落在多条命令式路径（悬停/点击/快捷键/召唤），
 * 其中点击路径存在取反 bug（打开监控舱时反而恢复穿透），且任何一条路径
 * 漏恢复都会锁死整个桌面的鼠标交互。
 *
 * 现在统一由本函数根据交互态推导：任一交互态为真 → 接管鼠标（不穿透）；
 * 全部结束 → 恢复全屏穿透。渲染侧只需在状态变化时调用一次 setDesktopMouseIgnore。
 */
export interface MousePenetrationState {
  /** 神经思考监控舱是否展开 */
  cockpitOpen: boolean;
  /** 鼠标是否悬停在果蝇本体热区上 */
  petHovered: boolean;
  /** 微气泡菜单是否打开（含 summon 召唤展开的临时气泡） */
  bubbleOpen: boolean;
}

export function deriveIgnoreMouse(state: MousePenetrationState): boolean {
  return !(state.cockpitOpen || state.petHovered || state.bubbleOpen);
}
