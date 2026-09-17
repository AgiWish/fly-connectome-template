// IPC 频道名常量：主进程 (main.cjs) 与预加载脚本 (preload.cjs) 共同引用，避免字符串漂移
module.exports = {
  SET_IGNORE_MOUSE_EVENTS: 'set-ignore-mouse-events',
  SUMMON_FLY: 'summon-fly',
  TOGGLE_BRAIN_COCKPIT: 'toggle-brain-cockpit',
};
