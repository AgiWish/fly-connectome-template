import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AutonomousFlyLifeEngine } from '../src/lib/autonomous-fly-life.ts';

// 准备测试用 mock 脑图谱
const idsBuf = readFileSync(new URL('../public/data/brain-atlas/ids.bin', import.meta.url));
const groupsBuf = readFileSync(new URL('../public/data/brain-atlas/groups.bin', import.meta.url));
const ids = new Uint32Array(idsBuf.buffer, idsBuf.byteOffset, idsBuf.byteLength / 4);
const groups = new Uint8Array(groupsBuf.buffer, groupsBuf.byteOffset, groupsBuf.byteLength);

// 模拟 localStorage
global.localStorage = {
  store: {},
  getItem(k) { return this.store[k] ?? null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; }
};

test('通宵长跑 20,000 步稳定性：坐标无 NaN、状态机活跃无死锁', () => {
  const engine = new AutonomousFlyLifeEngine({
    positions: new Float32Array(),
    ids,
    groups,
    visibleIds: new Set(ids)
  });

  const stageCounts = {};

  for (let i = 0; i < 20000; i++) {
    const { diagnostics: d } = engine.step(0.05, false);
    stageCounts[d.stage] = (stageCounts[d.stage] || 0) + 1;

    // 坐标与朝向数值必须完全有限
    assert.ok(Number.isFinite(d.currentPos.x), `第 ${i} 步 x 非有限数`);
    assert.ok(Number.isFinite(d.currentPos.y), `第 ${i} 步 y 非有限数`);
    assert.ok(Number.isFinite(d.currentPos.z), `第 ${i} 步 z 非有限数`);
    assert.ok(Number.isFinite(d.headingDeg), `第 ${i} 步 headingDeg 非有限数`);
  }

  // 必须经历了多个生命阶段（不能卡死在单一状态）
  const stageKeys = Object.keys(stageCounts);
  assert.ok(stageKeys.length >= 3, `生命阶段过少，可能死锁: ${stageKeys.join(', ')}`);

  // 大事记数组严格保持 <= 50 条
  assert.ok(engine.persistentData.events.length <= 50, '大事记超出 50 条上限');
  assert.ok(engine.persistentData.totalSteps > 0, '总步数必须正向累加');
});

test('避障惊飞、投喂蔗糖与灵动岛阶段调度测试', () => {
  const engine = new AutonomousFlyLifeEngine({
    positions: new Float32Array(),
    ids,
    groups,
    visibleIds: new Set(ids)
  });

  // 测试避障起飞
  engine.triggerStartle();
  const { diagnostics: d1 } = engine.step(0.016, false);
  assert.equal(d1.stage, 'flying', 'triggerStartle 必须立即进入 flying 状态');
  assert.equal(d1.isAirborne, true, 'isAirborne 必须为 true');

  // 测试投喂蔗糖
  engine.feedSucrose();
  const { diagnostics: d2 } = engine.step(0.016, false);
  assert.equal(d2.stage, 'feeding', 'feedSucrose 必须进入 feeding 阶段');
  assert.ok(d2.hunger < 0.5, '投喂后饥饿度必须显著下降');

  // 测试手动阶段设置
  engine.setStage('grooming_face');
  const { diagnostics: d3 } = engine.step(0.016, false);
  assert.equal(d3.stage, 'grooming_face');
});
