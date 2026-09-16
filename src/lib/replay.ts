export type ActivityFrame = { time: number; values: [number, number][] };
export type ModelReplay = {
  version: 1;
  dataset: 'male-cns:v1.0';
  source: { kind: 'synthetic' | 'predicted' | 'measured'; name: string; normalization: string };
  frames: ActivityFrame[];
};
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validate uploaded output against visible body IDs, not array indices or coordinates. */
export function parseReplay(input: unknown, visibleIds: ReadonlySet<number>): ModelReplay {
  if (!record(input) || input.version !== 1 || input.dataset !== 'male-cns:v1.0') throw Error('回放文件必须是 version 1，且数据集为 male-cns:v1.0。');
  const source = input.source;
  if (!record(source) || !['synthetic', 'predicted', 'measured'].includes(String(source.kind)) || typeof source.name !== 'string' || !source.name.trim() || typeof source.normalization !== 'string' || !source.normalization.trim()) throw Error('需要声明来源类型 kind、名称 name 和归一化方式 normalization。');
  if (!Array.isArray(input.frames) || input.frames.length < 2 || input.frames.length > 10000) throw Error('需要提供 2 到 10,000 帧。');
  let previous = -1;
  for (const frame of input.frames) {
    if (!record(frame) || typeof frame.time !== 'number' || !Number.isFinite(frame.time) || frame.time < 0 || frame.time <= previous) throw Error('帧时间必须是有限、非负且严格递增的数值。');
    previous = frame.time;
    if (!Array.isArray(frame.values) || frame.values.length > visibleIds.size) throw Error('帧数据无效。');
    const seen = new Set<number>();
    for (const pair of frame.values) {
      if (!Array.isArray(pair) || pair.length !== 2 || !Number.isSafeInteger(pair[0]) || !visibleIds.has(pair[0])) throw Error('每个值都必须使用图谱中可见的 MaleCNS 胞体 ID。');
      if (seen.has(pair[0])) throw Error('同一帧中出现了重复的胞体 ID。');
      if (typeof pair[1] !== 'number' || !Number.isFinite(pair[1]) || pair[1] < 0 || pair[1] > 1) throw Error('活动值必须是有限数值，且归一化到 [0, 1] 区间。');
      seen.add(pair[0]);
    }
  }
  if (input.frames[0].time !== 0) throw Error('第一帧必须从时间 0 开始。');
  return input as ModelReplay;
}

/** Hold the last sample; no fabricated interpolation, noise or spikes. */
export function frameAt(replay: ModelReplay, time: number): ActivityFrame {
  let low = 0, high = replay.frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (replay.frames[middle].time <= time) low = middle; else high = middle - 1;
  }
  return replay.frames[low];
}
