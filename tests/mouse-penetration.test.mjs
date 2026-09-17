import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveIgnoreMouse } from '../src/lib/mouse-penetration.ts';
import { getDesktopBridge, setDesktopMouseIgnore } from '../src/lib/desktop-bridge.ts';

test('默认状态（无悬停/无气泡/无监控舱）必须全屏穿透', () => {
  assert.equal(deriveIgnoreMouse({ cockpitOpen: false, petHovered: false, bubbleOpen: false }), true);
});

test('悬停果蝇本体时接管鼠标，不再穿透', () => {
  assert.equal(deriveIgnoreMouse({ cockpitOpen: false, petHovered: true, bubbleOpen: false }), false);
});

test('打开神经思考监控舱时接管鼠标', () => {
  assert.equal(deriveIgnoreMouse({ cockpitOpen: true, petHovered: false, bubbleOpen: false }), false);
});

test('关闭监控舱后（无其他交互态）恢复穿透', () => {
  assert.equal(deriveIgnoreMouse({ cockpitOpen: false, petHovered: false, bubbleOpen: false }), true);
});

test('summon 气泡打开时接管鼠标，气泡关闭后恢复穿透', () => {
  assert.equal(deriveIgnoreMouse({ cockpitOpen: false, petHovered: false, bubbleOpen: true }), false);
  assert.equal(deriveIgnoreMouse({ cockpitOpen: false, petHovered: false, bubbleOpen: false }), true);
});

test('组合状态不冲突：任一交互态为真即接管，全部结束才穿透', () => {
  assert.equal(deriveIgnoreMouse({ cockpitOpen: true, petHovered: true, bubbleOpen: true }), false);
  assert.equal(deriveIgnoreMouse({ cockpitOpen: true, petHovered: false, bubbleOpen: true }), false);
  assert.equal(deriveIgnoreMouse({ cockpitOpen: false, petHovered: true, bubbleOpen: true }), false);
  // 关掉监控舱但气泡仍开：仍接管（修复旧点击路径取反 bug 的回归点）
  assert.equal(deriveIgnoreMouse({ cockpitOpen: false, petHovered: false, bubbleOpen: true }), false);
  // 鼠标离开且气泡关闭且监控舱关闭：才穿透
  assert.equal(deriveIgnoreMouse({ cockpitOpen: false, petHovered: false, bubbleOpen: false }), true);
});

test('浏览器/Node 环境下 desktop bridge 安全无操作', () => {
  assert.equal(getDesktopBridge(), undefined);
  assert.doesNotThrow(() => setDesktopMouseIgnore(true));
  assert.doesNotThrow(() => setDesktopMouseIgnore(false));
});
