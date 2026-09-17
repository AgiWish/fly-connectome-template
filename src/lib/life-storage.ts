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

export class LifeStorage {
  private static cachedData: PersistentFlyData | null = null;

  public static load(): PersistentFlyData {
    if (this.cachedData) return this.cachedData;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.cachedData = {
          name: parsed.name ?? '小飞 (Flyer)',
          birthTimestamp: parsed.birthTimestamp ?? Date.now(),
          lastActiveTimestamp: Date.now(),
          totalActiveSeconds: parsed.totalActiveSeconds ?? 0,
          totalSteps: parsed.totalSteps ?? 0,
          totalFlightMeters: parsed.totalFlightMeters ?? 0,
          totalFeeds: parsed.totalFeeds ?? 0,
          totalSleepMinutes: parsed.totalSleepMinutes ?? 0,
          events: Array.isArray(parsed.events) ? parsed.events.slice(-50) : [],
        };
        return this.cachedData;
      }
    } catch {
      // 降级使用初始值
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
    } catch {
      // 容错处理
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
    data.events = [newEvent, ...data.events].slice(0, 50);
    this.save(data);
    return newEvent;
  }

  public static reset() {
    localStorage.removeItem(STORAGE_KEY);
    this.cachedData = null;
    return this.load();
  }
}
