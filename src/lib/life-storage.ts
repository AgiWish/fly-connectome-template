export type LifeLogEvent = {
  id: string;
  timestamp: number;
  timeStr: string;
  type: 'eat' | 'sleep' | 'wake' | 'fly' | 'groom' | 'wander';
  title: string;
  detail: string;
};

export type PersistentFlyData = {
  name: string;
  birthTimestamp: number;
  lastActiveTimestamp: number;
  totalActiveSeconds: number;
  totalSteps: number;
  totalFlightMeters: number;
  totalFeeds: number;
  totalSleepMinutes: number;
  events: LifeLogEvent[];
};

const STORAGE_KEY = 'fly_connectome_life_data_v1';
const MAX_EVENTS = 50;
const EVENT_TYPES: ReadonlySet<string> = new Set(['eat', 'sleep', 'wake', 'fly', 'groom', 'wander']);

/** 数值字段校验：必须是有限数且不低于 min，否则回落默认值（拦截 Infinity/NaN/负数/字符串） */
function numOr(value: unknown, fallback: number, min = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fallback;
}

/** 事件结构校验：缺字段、类型非法、未知事件类型的元素一律过滤 */
function isValidEvent(value: unknown): value is LifeLogEvent {
  if (!value || typeof value !== 'object') return false;
  const ev = value as Record<string, unknown>;
  return (
    typeof ev.id === 'string' &&
    typeof ev.timestamp === 'number' && Number.isFinite(ev.timestamp) &&
    typeof ev.timeStr === 'string' &&
    typeof ev.type === 'string' && EVENT_TYPES.has(ev.type) &&
    typeof ev.title === 'string' &&
    typeof ev.detail === 'string'
  );
}

export class LifeStorage {
  private static cachedData: PersistentFlyData | null = null;

  public static load(): PersistentFlyData {
    if (this.cachedData) return this.cachedData;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // 逐字段校验：合法字段保留，损坏字段独立回落默认值（不再整体丢弃）
        this.cachedData = {
          name: typeof parsed.name === 'string' && parsed.name ? parsed.name : '小飞 (Flyer)',
          birthTimestamp: numOr(parsed.birthTimestamp, Date.now(), 1),
          lastActiveTimestamp: Date.now(),
          totalActiveSeconds: numOr(parsed.totalActiveSeconds, 0),
          totalSteps: numOr(parsed.totalSteps, 0),
          totalFlightMeters: numOr(parsed.totalFlightMeters, 0),
          totalFeeds: numOr(parsed.totalFeeds, 0),
          totalSleepMinutes: numOr(parsed.totalSleepMinutes, 0),
          events: Array.isArray(parsed.events)
            ? parsed.events.filter(isValidEvent).slice(-MAX_EVENTS)
            : [],
        };
        return this.cachedData;
      }
    } catch {
      // JSON 整体损坏：降级使用初始值
    }

    const initial: PersistentFlyData = {
      name: '小飞 (Flyer)',
      birthTimestamp: Date.now(),
      lastActiveTimestamp: Date.now(),
      totalActiveSeconds: 0,
      totalSteps: 0,
      totalFlightMeters: 0,
      totalFeeds: 0,
      totalSleepMinutes: 0,
      events: [
        {
          id: 'init-1',
          timestamp: Date.now(),
          timeStr: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          type: 'wake',
          title: '初临木纹餐桌',
          detail: '小生命在阳光倾洒的实木桌面上醒来，打量着周围的白瓷果盘与微观世界。',
        },
      ],
    };

    this.cachedData = initial;
    this.save(initial);
    return initial;
  }

  public static save(data: PersistentFlyData) {
    this.cachedData = data;
    try {
      data.lastActiveTimestamp = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      // 持久化失败（如 quota 满）：不向外抛出，但必须留下可观测信号
      console.warn('[LifeStorage] 持久化失败:', err);
    }
  }

  public static addEvent(
    type: LifeLogEvent['type'],
    title: string,
    detail: string
  ): LifeLogEvent {
    const data = this.load();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    const newEvent: LifeLogEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      timeStr,
      type,
      title,
      detail,
    };

    // 保留最近 50 条大事记
    data.events = [newEvent, ...data.events].slice(0, MAX_EVENTS);
    this.save(data);
    return newEvent;
  }

  public static reset() {
    localStorage.removeItem(STORAGE_KEY);
    this.cachedData = null;
    return this.load();
  }
}
