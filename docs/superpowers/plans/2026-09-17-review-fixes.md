# 代码审查修复计划 (2026-09-17)

来源: 双审查员报告 (d1f116d..573964c + 工作区改动)。执行方式: subagent-driven-development, 工作区直接修改, 不提交 git。

## 共享契约 (Task 1 提供, Task 2 消费)
```ts
// preload 通过 contextBridge 暴露; 浏览器环境下为 undefined
interface FlyDesktopBridge {
  isDesktop: true;
  setIgnoreMouseEvents(ignore: boolean): void;  // 重复发送 false 即作为心跳, 主进程看门狗据此重置
  onSummonFly(listener: () => void): () => void;
  onToggleBrainCockpit(listener: () => void): () => void;
}
declare global { interface Window { flyDesktop?: FlyDesktopBridge } }
```
IPC 频道常量: electron/channels.cjs (fly:set-ignore-mouse-events / fly:summon-fly / fly:toggle-brain-cockpit)
打包模式: protocol.handle('flyapp') 自定义特权 scheme 服务 dist/, 替代 webSecurity:false。

## 任务与写集 (互不重叠)
- [ ] Task 1 Electron 安全与兜底: electron/main.cjs, electron/preload.cjs(新), electron/channels.cjs(新), package.json, .nvmrc
- [ ] Task 2 桌面宠物穿透与加载器: src/components/MacDesktopFlyPet.tsx, src/lib/desktop-bridge.ts(新), src/lib/mouse-penetration.ts(新), tests/mouse-penetration.test.mjs(新, TDD)
- [ ] Task 3 工作台资源释放与节流: src/components/UnifiedXRayWorkbench.tsx, src/components/NeuralThoughtCockpit.tsx, src/App.tsx, src/lib/live-brain.ts, 删除 BrainScene.tsx/FlyScene.tsx/Environment.tsx
- [ ] Task 4 持久化校验 TDD: src/lib/life-storage.ts, tests/life-storage.test.mjs(新), tests/life-stability.test.mjs, src/lib/autonomous-fly-life.ts(仅类型清理)

## 修复后检查
- 每任务 reviewer 复审; 最终整体 review; npm test + tsc + vite build + check:assets 全绿

## Ledger
- 创建: 计划与契约已定, 派遣 4 名实现者。
- 已派遣: Task1=Ohm(Electron), Task2=Russell(宠物), Task3=Ampere(工作台), Task4=Meitner(存储)
