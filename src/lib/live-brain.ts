import type { Atlas } from './atlas';
import type { ActivityFrame } from './replay';

export type StimulusInput = {
  // 相对位置: x in [-1, 1] (左到右), y in [-1, 1] (上到下)
  x: number;
  y: number;
  speed: number;
  isLooming: boolean;
  interactive: boolean;
};

export type ThoughtStage = 'idle' | 'grooming' | 'perception' | 'decision' | 'motor' | 'escape';

export type ThoughtDiagnostics = {
  stage: ThoughtStage;
  stageName: string;
  headingErrorDeg: number;
  leftOptic: number;
  rightOptic: number;
  centralActivity: number;
  leftMotor: number;
  rightMotor: number;
  flyHeadingDeg: number;
  recoil: number;
  message: string;
  behavior: string;
};

export class LiveBrainEngine {
  private leftOpticIds: number[] = [];
  private rightOpticIds: number[] = [];
  private centralIds: number[] = [];
  private leftDescIds: number[] = [];
  private rightDescIds: number[] = [];

  // 神经动力学膜电位状态 (Leaky Integrators)
  private vOpticLeft = 0;
  private vOpticRight = 0;
  private vCentral = 0;
  private vDescLeft = 0;
  private vDescRight = 0;
  private vEscape = 0;

  // 果蝇身体朝向状态 (弧度)
  private flyHeading = 0;
  private flyRecoil = 0;

  // 内部自主意识时钟与漫游倾向
  private internalClock = 0;

  constructor(atlas: Atlas) {
    this.buildIndex(atlas);
  }

  private buildIndex(atlas: Atlas) {
    const { positions, ids, groups } = atlas;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (let i = 0; i < ids.length; i++) {
      if (groups[i] >= 3) continue;
      const x = positions[i * 3];
      const y = -positions[i * 3 + 1];
      const z = -positions[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const centerX = (minX + maxX) / 2;
    const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const scale = 5 / maxDim;

    for (let i = 0; i < ids.length; i++) {
      const g = groups[i];
      if (g >= 3) continue;
      const id = ids[i];
      const nx = (positions[i * 3] - centerX) * scale;

      if (g === 0) {
        if (nx < -0.35) this.leftOpticIds.push(id);
        else if (nx > 0.35) this.rightOpticIds.push(id);
      } else if (g === 1) {
        if (Math.abs(nx) < 0.8) this.centralIds.push(id);
      } else if (g === 2) {
        if (nx <= 0) this.leftDescIds.push(id);
        else this.rightDescIds.push(id);
      }
    }
  }

  public step(stimulus: StimulusInput, dt: number): { frame: ActivityFrame; diagnostics: ThoughtDiagnostics } {
    const delta = Math.min(0.05, Math.max(0.001, dt));
    this.internalClock += delta;

    // 1. 刺激方位与果蝇朝向的误差角
    const targetAngle = stimulus.x * (Math.PI / 3);
    const headingError = targetAngle - this.flyHeading;

    // 2. 自主生命节律判定 (搓手 / 漫游 / 警觉追踪)
    const isGroomingCycle = (this.internalClock % 7) < 2.8 && !stimulus.interactive && Math.abs(headingError) < 0.15;

    // 3. 感知输入
    const baseOpticDrive = Math.min(1, Math.abs(stimulus.x) * 1.4 + 0.12);
    let leftDrive = 0;
    let rightDrive = 0;

    if (stimulus.isLooming) {
      leftDrive = 1.0;
      rightDrive = 1.0;
    } else {
      if (headingError > 0.04) {
        rightDrive = baseOpticDrive;
        leftDrive = baseOpticDrive * Math.max(0.12, 1 - headingError * 1.5);
      } else if (headingError < -0.04) {
        leftDrive = baseOpticDrive;
        rightDrive = baseOpticDrive * Math.max(0.12, 1 + headingError * 1.5);
      } else {
        // 自发呼吸背景放电
        leftDrive = 0.15 + Math.sin(this.internalClock * 2.5) * 0.05;
        rightDrive = 0.15 + Math.cos(this.internalClock * 2.5) * 0.05;
      }
    }

    // 4. 神经动力学积分 (Leaky Integrators)
    const tauOptic = 0.04;
    this.vOpticLeft += (leftDrive - this.vOpticLeft) * (delta / tauOptic);
    this.vOpticRight += (rightDrive - this.vOpticRight) * (delta / tauOptic);

    // 中央脑整合
    const tauCentral = 0.07;
    const centralDrive = Math.max(this.vOpticLeft, this.vOpticRight) * 0.95 + (isGroomingCycle ? 0.18 : 0);
    this.vCentral += (centralDrive - this.vCentral) * (delta / tauCentral);

    // 下行神经元转向指令
    const tauDesc = 0.06;
    let descLeftDrive = 0;
    let descRightDrive = 0;

    if (stimulus.isLooming) {
      this.vEscape += (1.0 - this.vEscape) * (delta / 0.03);
      descLeftDrive = 1.0;
      descRightDrive = 1.0;
    } else {
      this.vEscape += (0.0 - this.vEscape) * (delta / 0.1);
      if (headingError > 0.03) {
        descRightDrive = Math.min(1, headingError * 1.7 * this.vCentral);
        descLeftDrive = 0.06;
      } else if (headingError < -0.03) {
        descLeftDrive = Math.min(1, -headingError * 1.7 * this.vCentral);
        descRightDrive = 0.06;
      } else {
        descLeftDrive = 0.08;
        descRightDrive = 0.08;
      }
    }

    this.vDescLeft += (descLeftDrive - this.vDescLeft) * (delta / tauDesc);
    this.vDescRight += (descRightDrive - this.vDescRight) * (delta / tauDesc);

    // 5. 身体物理运动产生
    const turnRate = (this.vDescRight - this.vDescLeft) * 3.6;
    this.flyHeading += turnRate * delta;

    if (this.vEscape > 0.3) {
      this.flyRecoil = Math.min(1, this.flyRecoil + delta * 7);
    } else {
      this.flyRecoil = Math.max(0, this.flyRecoil - delta * 3.5);
    }

    // 6. 提取激活胞体
    const values: [number, number][] = [];
    const pushSubset = (ids: number[], act: number, sampleRatio: number, jitter: number) => {
      if (act < 0.04) return;
      const step = Math.max(1, Math.floor(1 / sampleRatio));
      for (let i = 0; i < ids.length; i += step) {
        const factor = 1 - jitter * 0.5 + Math.sin(i * 3.7 + performance.now() * 0.01) * jitter * 0.5;
        const val = Math.min(1, Math.max(0, act * factor));
        if (val > 0.04) values.push([ids[i], val]);
      }
    };

    pushSubset(this.leftOpticIds, this.vOpticLeft, 0.35, 0.25);
    pushSubset(this.rightOpticIds, this.vOpticRight, 0.35, 0.25);
    pushSubset(this.centralIds, this.vCentral, 0.3, 0.35);
    pushSubset(this.leftDescIds, this.vDescLeft, 0.6, 0.15);
    pushSubset(this.rightDescIds, this.vDescRight, 0.6, 0.15);

    // 7. 行为状态判定
    const headingDeg = Math.round((this.flyHeading * 180) / Math.PI);
    const errDeg = Math.round((headingError * 180) / Math.PI);

    let stage: ThoughtStage = 'idle';
    let stageName = '静息注视';
    let behavior = '保持观察平衡';
    let message = '视野平稳，神经元在微弱自发放电呼吸。';

    if (this.vEscape > 0.35) {
      stage = 'escape';
      stageName = '🚨 捕食突袭逃逸反应 (Looming Escape)';
      behavior = '后仰振翅避障';
      message = '视叶检测到高角速度扩张阴影 ➔ 触发中央巨纤维下行爆发 ➔ 启动后跳回避！';
    } else if (Math.abs(errDeg) > 8) {
      if (this.vDescLeft > 0.2 || this.vDescRight > 0.2) {
        stage = 'motor';
        stageName = '阶段 3：下行运动控制 (Motor Output)';
        behavior = errDeg > 0 ? '向右侧交替迈步' : '向左侧交替迈步';
        message = `偏航指令激活: ${errDeg > 0 ? '右侧' : '左侧'}下行神经元放电 ➔ 驱动前足与身体转向对准目标。`;
      } else if (this.vCentral > 0.25) {
        stage = 'decision';
        stageName = '阶段 2：中央脑方位判定 (Central Processing)';
        behavior = '计算转向角度';
        message = `中央复合体比对罗盘朝向 ➔ 计算转向误差角 Δθ = ${errDeg > 0 ? '+' : ''}${errDeg}°。`;
      } else {
        stage = 'perception';
        stageName = '阶段 1：视网膜与视叶感知 (Perception)';
        behavior = '复眼追踪光斑';
        message = `光斑偏${errDeg > 0 ? '右' : '左'} ➔ ${errDeg > 0 ? '右' : '左'}侧视叶 (Optic Lobe) 胞体群优先受激放电。`;
      }
    } else if (isGroomingCycle) {
      stage = 'grooming';
      stageName = '🧼 自主梳理行为 (Grooming)';
      behavior = '前足搓手理角';
      message = '目标已锁定，果蝇进入自发行为节律：前足对搓清理触角与面部。';
    } else {
      stageName = '已锁定目标 (Fixated)';
      behavior = '身体轻微呼吸微动';
      message = `目标已进入双眼中央视野 (朝向 ${headingDeg}°)，果蝇保持注视与自发呼吸微动。`;
    }

    const diagnostics: ThoughtDiagnostics = {
      stage,
      stageName,
      headingErrorDeg: errDeg,
      leftOptic: Number(this.vOpticLeft.toFixed(2)),
      rightOptic: Number(this.vOpticRight.toFixed(2)),
      centralActivity: Number(this.vCentral.toFixed(2)),
      leftMotor: Number(this.vDescLeft.toFixed(2)),
      rightMotor: Number(this.vDescRight.toFixed(2)),
      flyHeadingDeg: headingDeg,
      recoil: Number(this.flyRecoil.toFixed(2)),
      message,
      behavior,
    };

    return {
      frame: { time: performance.now() / 1000, values },
      diagnostics,
    };
  }

  public reset() {
    this.vOpticLeft = 0;
    this.vOpticRight = 0;
    this.vCentral = 0;
    this.vDescLeft = 0;
    this.vDescRight = 0;
    this.vEscape = 0;
    this.flyHeading = 0;
    this.flyRecoil = 0;
    this.internalClock = 0;
  }
}
