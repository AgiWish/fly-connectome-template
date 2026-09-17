import test from 'node:test';
import assert from 'node:assert/strict';
import { LifeStorage } from '../src/lib/life-storage.ts';

const STORAGE_KEY = 'fly_connectome_life_data_v1';

// 可注入故障的 localStorage 模拟（throwOnSet 模拟 quota 满）
function makeStorage({ throwOnSet = false } = {}) {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) {
      if (throwOnSet) throw new Error('QuotaExceededError: storage is full');
      store.set(key, String(value));
    },
    removeItem(key) { store.delete(key); },
    seed(key, value) { store.set(key, value); },
  };
}

function useStorage(storage) {
  global.localStorage = storage;
  // 清除模块级缓存，强制下次 load 重新读取存储
  LifeStorage.cachedData = null;
}

function captureWarn(fn) {
  const calls = [];
  const original = console.warn;
  console.warn = (...args) => calls.push(args);
  try { fn(); } finally { console.warn = original; }
  return calls;
}

const validEvent = (overrides = {}) => ({
  id: 'e-1',
  timestamp: 1726000000000,
  timeStr: '12:00',
  type: 'eat',
  title: '品尝美味苹果',
  detail: '停在苹果切片旁吸食果汁。',
  ...overrides,
});

test('save → load 往返：修改后的字段被完整持久化', () => {
  useStorage(makeStorage());
  const data = LifeStorage.load();
  assert.equal(data.name, '小飞 (Flyer)');

  data.name = '阿飞';
  data.totalSteps = 123;
  data.totalFeeds = 7;
  LifeStorage.save(data);

  LifeStorage.cachedData = null;
  const reloaded = LifeStorage.load();
  assert.equal(reloaded.name, '阿飞');
  assert.equal(reloaded.totalSteps, 123);
  assert.equal(reloaded.totalFeeds, 7);
});

test('损坏 JSON：整体回落初始默认值', () => {
  const storage = makeStorage();
  storage.seed(STORAGE_KEY, '{oops this is not json');
  useStorage(storage);

  const data = LifeStorage.load();
  assert.equal(data.name, '小飞 (Flyer)');
  assert.equal(data.totalSteps, 0);
  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].id, 'init-1');
});

test('字段类型错误：坏字段回落默认、好字段保留', () => {
  const storage = makeStorage();
  storage.seed(STORAGE_KEY, JSON.stringify({
    name: '小坏',
    birthTimestamp: 1726000000000,
    totalSteps: 'abc',
    totalActiveSeconds: 66,
    totalFlightMeters: 'fast',
    totalFeeds: 3,
    totalSleepMinutes: null,
    events: 'not-an-array',
  }));
  useStorage(storage);

  const data = LifeStorage.load();
  assert.equal(data.name, '小坏', '合法 name 必须保留');
  assert.equal(data.birthTimestamp, 1726000000000, '合法 birthTimestamp 必须保留');
  assert.equal(data.totalSteps, 0, '字符串 totalSteps 必须回落默认 0');
  assert.equal(data.totalActiveSeconds, 66, '合法 totalActiveSeconds 必须保留');
  assert.equal(data.totalFlightMeters, 0, '字符串 totalFlightMeters 必须回落默认 0');
  assert.equal(data.totalFeeds, 3, '合法 totalFeeds 必须保留');
  assert.equal(data.totalSleepMinutes, 0, 'null totalSleepMinutes 必须回落默认 0');
  assert.deepEqual(data.events, [], '非数组 events 必须回落默认 []');
});

test('events 元素缺字段/类型非法时被结构过滤，合法元素保留', () => {
  const good1 = validEvent({ id: 'g1' });
  const good2 = validEvent({ id: 'g2', type: 'fly' });
  const storage = makeStorage();
  storage.seed(STORAGE_KEY, JSON.stringify({
    birthTimestamp: 1726000000000,
    events: [good1, { id: 'bad-1' }, null, 'junk', validEvent({ type: 'dance' }), good2],
  }));
  useStorage(storage);

  const data = LifeStorage.load();
  assert.deepEqual(data.events.map(e => e.id), ['g1', 'g2']);
});

test('数值为 Infinity/负数/非法 birthTimestamp 时回落默认', () => {
  const storage = makeStorage();
  // 1e999 经 JSON.parse 后为 Infinity
  storage.seed(STORAGE_KEY, '{"birthTimestamp":-100,"totalSteps":-5,"totalFlightMeters":1e999,"totalFeeds":-0.1,"totalActiveSeconds":12}');
  useStorage(storage);

  const data = LifeStorage.load();
  assert.equal(data.totalSteps, 0, '负数 totalSteps 必须回落默认');
  assert.ok(Number.isFinite(data.totalFlightMeters), 'Infinity 必须回落默认');
  assert.equal(data.totalFlightMeters, 0);
  assert.equal(data.totalFeeds, 0, '负数 totalFeeds 必须回落默认');
  assert.equal(data.totalActiveSeconds, 12, '合法字段保留');
  assert.ok(Number.isFinite(data.birthTimestamp) && data.birthTimestamp > 0, '非法 birthTimestamp 必须回落默认');
});

test('setItem 抛错（quota 满）：不向外抛出且调用 console.warn', () => {
  useStorage(makeStorage({ throwOnSet: true }));

  const warns = captureWarn(() => {
    const data = LifeStorage.load();
    data.totalSteps = 9;
    assert.doesNotThrow(() => LifeStorage.save(data), 'save 不得向外抛错');
    assert.doesNotThrow(() => LifeStorage.addEvent('wake', '测试', 'quota 下添加事件不得崩溃'));
  });

  assert.ok(warns.length >= 1, '持久化失败必须产生 console.warn 信号');
  const flattened = warns.flat().map(String).join(' ');
  assert.ok(flattened.includes('QuotaExceededError'), 'warn 内容必须包含原始错误信息');
});

test('events 超上限：加载时截断为最近 50 条', () => {
  const events = Array.from({ length: 60 }, (_, i) => validEvent({ id: `e${i}` }));
  const storage = makeStorage();
  storage.seed(STORAGE_KEY, JSON.stringify({ birthTimestamp: 1726000000000, events }));
  useStorage(storage);

  const data = LifeStorage.load();
  assert.equal(data.events.length, 50);
  assert.equal(data.events[0].id, 'e10', '必须保留最近 50 条（丢弃最旧的 10 条）');
  assert.equal(data.events[49].id, 'e59');
});
