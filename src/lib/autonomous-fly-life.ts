import type { Atlas } from './atlas.ts';
import type { ActivityFrame } from './replay.ts';
import { LifeStorage, type LifeLogEvent, type PersistentFlyData } from './life-storage.ts';

export type LifeStage =
  | 'wandering'         // 在餐桌上漫步嗅探
  | 'approaching_food'  // 闻到苹果香味，主动爬向果盘
  | 'feeding'           // 在苹果切片旁停下，进食品尝
  | 'grooming_face'     // 满足地搓前手擦脸理触角
  | 'grooming_wings'    // 抖动翅膀清理翅面
  | 'flying'            // 振翅离地，在桌面上方低空盘旋一圈后降落
  | 'sleeping';         // 伏在阴凉处安静熟睡 (午间小憩或深夜深睡)

export type LifeDiagnostics = {
  stage: LifeStage;
  stageName: string;
  diaryMessage: string;
  hunger: number;        // 饥饿度 0~1
  energy: number;        // 体力值 0~1
  currentPos: { x: number; y: number; z: number };
  headingDeg: number;
  isAirborne: boolean;   // 是否在空中飞行
  isSleeping: boolean;   // 是否处于熟睡状态
  wingFlappingHz: number;// 翅膀振动频率
  activeNeuronCount: number;
  persistentData: PersistentFlyData;
  timeOfDayHour: number; // 当前自然时间 (小时)
};

export class AutonomousFlyLifeEngine {
  // 果蝇在餐桌上的 3D 坐标 (Y=0 为桌面高度)
  public posX = -0.12;
  public posY = 0;
  public posZ = 0.18;
  public heading = 0.8; // 弧度

  // 食物目标位置 (白瓷餐盘中的苹果切片坐标)
  public readonly foodPos = { x: 0.28, y: 0.015, z: -0.1 };

  // 阴凉小憩睡眠点 (果盘后方阴影处)
  public readonly sleepPos = { x: 0.32, y: 0, z: -0.18 };

  // 生理指标
  private hunger = 0.45;
  private stage: LifeStage = 'wandering';
  private stageTimer = 0;
  private isAirborne = false;
  private isSleeping = false;

  // 飞行参数
  private flightProgress = 0;
  private flightStart = { x: 0, y: 0, z: 0 };
  private flightTarget = { x: 0, y: 0, z: 0 };

  // 存储与定期存盘计时器
  private persistentData: PersistentFlyData;
  private saveTimer = 0;
  private stepAccumulator = 0; // 步数微小累加器，杜绝帧间 Math.round 舍入截断为 0

  // 神经元分组索引
  private opticIds: number[] = [];
  private centralIds: number[] = [];
  private motorIds: number[] = [];

  constructor(atlas: Atlas) {
    const { ids, groups } = atlas;
    for (let i = 0; i < ids.length; i++) {
      if (groups[i] === 0) this.opticIds.push(ids[i]);
      else if (groups[i] === 1) this.centralIds.push(ids[i]);
      else if (groups[i] === 2) this.motorIds.push(ids[i]);
    }
    this.persistentData = LifeStorage.load();
  }

  public step(
    dt: number,
    generateBrainActivity: boolean = true
  ): { frame: ActivityFrame; diagnostics: LifeDiagnostics } {
    const delta = Math.min(0.05, Math.max(0.001, dt));
    this.stageTimer += delta;
    this.saveTimer += delta;

    // 累计生命时长与步数
    this.persistentData.totalActiveSeconds += delta;

    // 获取当前真实时间的小时数
    const now = new Date();
    const nowHour = now.getHours() + now.getMinutes() / 60;
    // 真实果蝇昼夜生物钟 (诺贝尔奖级果蝇节律模型)：
    // 23:00 - 06:30 深夜睡眠
    // 13:00 - 14:30 午间小憩 (Siesta)
    const isNaturalSleepTime = (nowHour >= 23 || nowHour < 6.5) || (nowHour >= 13 && nowHour < 14.5);

    // 饥饿度变化：清醒时增加，睡眠时极其缓慢
    if (this.stage === 'sleeping') {
      this.hunger = Math.min(1.0, this.hunger + delta * 0.0015);
      this.persistentData.totalSleepMinutes += delta / 60;
    } else {
      this.hunger = Math.min(1.0, this.hunger + delta * 0.012);
    }

    // 状态机演化 (活性与长跑稳定性保证)
    switch (this.stage) {
      case 'sleeping': {
        this.isSleeping = true;
        this.isAirborne = false;
        // 苏醒条件：
        // 1. 到达白昼清醒时间且小憩超过 12 秒；
        // 2. 即使在深夜睡眠期，若沉睡超过 45 秒且饥饿度 > 0.75，短暂苏醒起夜觅食 (保证观察生命活性，杜绝死锁)
        const canWakeDay = !isNaturalSleepTime && this.stageTimer > 12;
        const canWakeNightHunger = this.hunger > 0.75 && this.stageTimer > 45;

        if (canWakeDay || canWakeNightHunger) {
          this.stage = 'grooming_face';
          this.stageTimer = 0;
          this.isSleeping = false;
          LifeStorage.addEvent(
            'wake',
            canWakeNightHunger ? '夜间苏醒觅食' : '从睡眠中苏醒',
            canWakeNightHunger ? '夜间被微弱饥饿唤醒，揉搓触角准备在果盘旁找点宵夜。' : '伸展前肢搓拭复眼，开始新周期的漫步与觅食。'
          );
        }
        break;
      }

      case 'wandering': {
        this.isSleeping = false;
        const speed = 0.045;
        this.posX += Math.sin(this.heading) * speed * delta;
        this.posZ += Math.cos(this.heading) * speed * delta;
        this.stepAccumulator += speed * delta * 120;
        if (this.stepAccumulator >= 1) {
          const inc = Math.floor(this.stepAccumulator);
          this.persistentData.totalSteps += inc;
          this.stepAccumulator -= inc;
        }

        this.heading += (Math.sin(this.stageTimer * 1.5) * 0.4 + (Math.random() - 0.5) * 0.25) * delta;

        // 餐桌边缘反弹保护
        if (Math.abs(this.posX) > 0.42) this.heading = -this.heading + Math.PI;
        if (Math.abs(this.posZ) > 0.32) this.heading = Math.PI - this.heading;

        // 如果是昼夜睡觉时间，且吃饱了，找地方安睡
        if (isNaturalSleepTime && this.stageTimer > 8 && this.hunger < 0.6) {
          this.stage = 'sleeping';
          this.stageTimer = 0;
          LifeStorage.addEvent('sleep', '进入舒适睡眠', '爬到果盘背光的阴凉处伏卧，进入节律性慢波深度睡眠。');
        } else if (this.hunger > 0.55 || this.stageTimer > 10.0) {
          // 闻到苹果香味，主动去觅食
          this.stage = 'approaching_food';
          this.stageTimer = 0;
        } else if (this.stageTimer > 4.5 && Math.random() < 0.35) {
          this.stage = 'grooming_face';
          this.stageTimer = 0;
        }
        break;
      }

      case 'approaching_food': {
        this.isSleeping = false;
        const dx = this.foodPos.x - this.posX;
        const dz = this.foodPos.z - this.posZ;
        const dist = Math.hypot(dx, dz);
        const targetAngle = Math.atan2(dx, dz);

        let diff = targetAngle - this.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.heading += diff * Math.min(1, delta * 3.6);

        const speed = 0.06;
        this.posX += Math.sin(this.heading) * speed * delta;
        this.posZ += Math.cos(this.heading) * speed * delta;
        this.stepAccumulator += speed * delta * 120;
        if (this.stepAccumulator >= 1) {
          const inc = Math.floor(this.stepAccumulator);
          this.persistentData.totalSteps += inc;
          this.stepAccumulator -= inc;
        }

        if (dist < 0.042) {
          this.stage = 'feeding';
          this.stageTimer = 0;
          this.persistentData.totalFeeds += 1;
          LifeStorage.addEvent('eat', '品尝美味苹果', '抵达发酵苹果切片边缘，停下来探头吸食甜美汁液。');
        }
        break;
      }

      case 'feeding': {
        this.isSleeping = false;
        this.hunger = Math.max(0.02, this.hunger - delta * 0.2);

        if (this.stageTimer > 4.5) {
          this.stage = 'grooming_face';
          this.stageTimer = 0;
          LifeStorage.addEvent('groom', '吃饱洗脸理角', '享用完苹果大餐，停在桌上仔细对搓前肢清理触角面部。');
        }
        break;
      }

      case 'grooming_face': {
        this.isSleeping = false;
        if (this.stageTimer > 3.2) {
          if (Math.random() < 0.45) {
            this.stage = 'grooming_wings';
          } else if (Math.random() < 0.45 && !isNaturalSleepTime) {
            this.startFlight();
          } else {
            this.stage = 'wandering';
          }
          this.stageTimer = 0;
        }
        break;
      }

      case 'grooming_wings': {
        this.isSleeping = false;
        if (this.stageTimer > 2.5) {
          if (Math.random() < 0.55 && !isNaturalSleepTime) {
            this.startFlight();
          } else {
            this.stage = 'wandering';
          }
          this.stageTimer = 0;
        }
        break;
      }

      case 'flying': {
        this.isSleeping = false;
        this.flightProgress += delta * 0.52;
        const p = Math.min(1, this.flightProgress);

        this.posY = Math.sin(p * Math.PI) * 0.11;
        this.posX = this.flightStart.x + (this.flightTarget.x - this.flightStart.x) * p;
        this.posZ = this.flightStart.z + (this.flightTarget.z - this.flightStart.z) * p;

        this.heading = Math.atan2(
          this.flightTarget.x - this.flightStart.x,
          this.flightTarget.z - this.flightStart.z
        );

        if (p >= 1) {
          this.posY = 0;
          this.isAirborne = false;
          this.stage = 'wandering';
          this.stageTimer = 0;
          const distFlight = Math.hypot(
            this.flightTarget.x - this.flightStart.x,
            this.flightTarget.z - this.flightStart.z
          );
          this.persistentData.totalFlightMeters += Number(distFlight.toFixed(2));
          LifeStorage.addEvent('fly', '平稳滑翔降落', `以 220Hz 极速振翅完成了一次 ${(distFlight * 100).toFixed(0)} 厘米的低空巡游降落。`);
        }
        break;
      }
    }

    // 防御 NaN 与坐标丢失
    if (!Number.isFinite(this.posX) || !Number.isFinite(this.posZ) || !Number.isFinite(this.heading)) {
      this.posX = 0;
      this.posZ = 0;
      this.heading = 0;
    }

    // 每 5 秒自动存盘持久化一次
    if (this.saveTimer > 5.0) {
      this.saveTimer = 0;
      LifeStorage.save(this.persistentData);
    }

    // 神经元放电帧计算 (真实生物学行为映射)
    const values: [number, number][] = [];
    let wingHz = 0;

    const pushPulse = (ids: number[], ratio: number, intensity: number) => {
      if (!generateBrainActivity) return; // 挂机时不生成庞大数组，彻底消除 GC 压力
      const step = Math.max(1, Math.floor(1 / ratio));
      for (let i = 0; i < ids.length; i += step) {
        values.push([ids[i], Math.min(1, intensity * (0.8 + Math.random() * 0.4))]);
      }
    };

    if (this.stage === 'sleeping') {
      // 睡眠时慢波自发放电 (微弱节律)
      wingHz = 0;
      pushPulse(this.centralIds, 0.08, 0.2);
    } else if (this.stage === 'flying') {
      wingHz = 220;
      pushPulse(this.motorIds, 0.75, 0.98);
      pushPulse(this.centralIds, 0.4, 0.85);
    } else if (this.stage === 'approaching_food') {
      wingHz = 0;
      pushPulse(this.centralIds, 0.45, 0.85);
      pushPulse(this.opticIds, 0.25, 0.6);
      pushPulse(this.motorIds, 0.35, 0.55);
    } else if (this.stage === 'feeding') {
      wingHz = 0;
      pushPulse(this.centralIds, 0.35, 0.75);
    } else if (this.stage === 'grooming_face') {
      wingHz = 0;
      pushPulse(this.motorIds, 0.4, 0.65);
    } else if (this.stage === 'grooming_wings') {
      wingHz = 35;
      pushPulse(this.motorIds, 0.5, 0.7);
    } else {
      wingHz = 0;
      pushPulse(this.motorIds, 0.25, 0.45);
      pushPulse(this.opticIds, 0.2, 0.35);
    }

    // 状态日志文本
    let stageName = '餐桌漫步';
    let diaryMessage = '在实木餐桌上自然踱步嗅探，六足迈出真实的昆虫三角步态。';

    if (this.stage === 'sleeping') {
      stageName = '😴 伏地沉睡中';
      diaryMessage = `处于自然的${nowHour >= 13 && nowHour < 15 ? '午间小憩' : '深夜睡眠'}期，身体伏卧、触角垂下，呼吸极为轻缓。`;
    } else if (this.stage === 'approaching_food') {
      stageName = '🍎 闻到苹果甜香';
      diaryMessage = '触角嗅探到餐盘边缘苹果切片的发酵果香 ➔ 调整中央脑罗盘，快步爬向食物！';
    } else if (this.stage === 'feeding') {
      stageName = '😋 享受美味苹果';
      diaryMessage = '停在苹果切片旁吸食果汁，腹部轻柔起伏，饥饿感逐渐消退。';
    } else if (this.stage === 'grooming_face') {
      stageName = '🧼 吃饱洗脸理角';
      diaryMessage = '吃饱喝足，果蝇停在桌上认真搓动前足，仔细梳理复眼和触角。';
    } else if (this.stage === 'grooming_wings') {
      stageName = '🪶 抖动刷理双翅';
      diaryMessage = '轻展半透明薄翅，用后足由前向后刷理翅面尘埃。';
    } else if (this.stage === 'flying') {
      stageName = '⚡ 轻盈振翅起飞';
      diaryMessage = '双翅以 220Hz 极速扇动离开桌面，在空中划出优美弧线滑翔降落。';
    }

    const headingDeg = Math.round((this.heading * 180) / Math.PI) % 360;

    const diagnostics: LifeDiagnostics = {
      stage: this.stage,
      stageName,
      diaryMessage,
      hunger: Number(this.hunger.toFixed(2)),
      energy: Number((1 - this.hunger * 0.5).toFixed(2)),
      currentPos: {
        x: Number(this.posX.toFixed(3)),
        y: Number(this.posY.toFixed(3)),
        z: Number(this.posZ.toFixed(3)),
      },
      headingDeg: headingDeg < 0 ? headingDeg + 360 : headingDeg,
      isAirborne: this.isAirborne,
      isSleeping: this.isSleeping,
      wingFlappingHz: wingHz,
      activeNeuronCount: values.length,
      persistentData: this.persistentData,
      timeOfDayHour: Number(nowHour.toFixed(2)),
    };

    return {
      frame: { time: performance.now() / 1000, values },
      diagnostics,
    };
  }

  private startFlight() {
    this.stage = 'flying';
    this.stageTimer = 0;
    this.isAirborne = true;
    this.flightProgress = 0;
    this.flightStart = { x: this.posX, y: this.posY, z: this.posZ };
    this.flightTarget = {
      x: (Math.random() - 0.5) * 0.45,
      y: 0,
      z: (Math.random() - 0.5) * 0.35,
    };
  }

  /**
   * 触发巨纤维 (Giant Fiber) 避障逃跑反射：
   * 遇到光标急速接近或惊吓时，瞬间激发全脑逃逸回路，以 220Hz 极速振翅起飞逃逸！
   */
  public triggerStartle(customTarget?: { x: number; y: number }) {
    this.stage = 'flying';
    this.stageTimer = 0;
    this.isAirborne = true;
    this.isSleeping = false;
    this.flightProgress = 0;
    this.flightStart = { x: this.posX, y: this.posY, z: this.posZ };
    if (customTarget) {
      this.flightTarget = { x: customTarget.x, y: 0, z: customTarget.y };
    } else {
      this.flightTarget = {
        x: (Math.random() - 0.5) * 0.5,
        y: 0,
        z: (Math.random() - 0.5) * 0.4,
      };
    }
    LifeStorage.addEvent('fly', '巨纤维触发避障逃逸', '检测到环境光标突袭，巨纤维神经元瞬时发放动作电位，应急振翅起飞！');
  }

  /**
   * 投喂一滴蔗糖水 (Sucrose droplet)
   */
  public feedSucrose() {
    this.hunger = Math.max(0, this.hunger - 0.45);
    this.stage = 'feeding';
    this.stageTimer = 0;
    this.isAirborne = false;
    this.isSleeping = false;
    LifeStorage.addEvent('eat', '品尝美味蔗糖水', '感受到甜味刺激，甜感受受体神经元(Gr5a)高频激活，多巴胺回路愉悦放电。');
  }

  /**
   * 切换指定行为阶段 (例如飞回灵动岛休整或苏醒)
   */
  public setStage(newStage: LifeStage) {
    this.stage = newStage;
    this.stageTimer = 0;
    if (newStage === 'flying') {
      this.isAirborne = true;
      this.isSleeping = false;
    } else if (newStage === 'sleeping') {
      this.isAirborne = false;
      this.isSleeping = true;
    } else {
      this.isAirborne = false;
      this.isSleeping = false;
    }
  }
}
