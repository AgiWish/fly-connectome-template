import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { asset, type Atlas } from "../lib/atlas";
import type { ActivityFrame } from "../lib/replay";
import { AutonomousFlyLifeEngine, type LifeDiagnostics } from "../lib/autonomous-fly-life";
import { getDesktopBridge, setDesktopMouseIgnore } from "../lib/desktop-bridge";
import { deriveIgnoreMouse } from "../lib/mouse-penetration";
import { NeuralThoughtCockpit } from "./NeuralThoughtCockpit";

type Props = {
  atlas: Atlas;
};

type RoamMode = "at_island" | "diving_down" | "screen_crawling" | "screen_cruising" | "flying_home";

type Model = {
  binary: string;
  pivots: Record<string, [number, number, number]>;
  parts: {
    group: string;
    material: string;
    positionByteOffset: number;
    positionCount: number;
    indexByteOffset: number;
    indexCount: number;
  }[];
};

/**
 * macOS 原生灵动岛与全屏自由漫游桌面宠物 (自然尺度、灵动六足步态、无常驻方框阻碍、随叫随到神经思考舱)
 */
export function MacDesktopFlyPet({ atlas }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [showBrainXray, setShowBrainXray] = useState(false);
  const [isMagnified, setIsMagnified] = useState(false);
  const [diagnostics, setDiagnostics] = useState<LifeDiagnostics | null>(null);

  // 后台神经思考监控舱展开状态 (支持全局快捷键 Cmd+Shift+B 随叫随到)
  const [showCockpit, setShowCockpit] = useState(false);
  const [currentFrame, setCurrentFrame] = useState<ActivityFrame | null>(null);
  const showCockpitRef = useRef(false);
  useEffect(() => { showCockpitRef.current = showCockpit; }, [showCockpit]);

  // 轻量微胶囊状态 (默认完全隐藏！绝不在桌面上跟着移动大白方框)
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [bubbleFading, setBubbleFading] = useState(false);
  const [bubblePos, setBubblePos] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 - 50, isBelow: false });
  const [hitboxPos, setHitboxPos] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  const lifeEngineRef = useRef<AutonomousFlyLifeEngine | null>(null);
  const xrayRef = useRef(showBrainXray);
  useEffect(() => { xrayRef.current = showBrainXray; }, [showBrainXray]);

  const magRef = useRef(isMagnified);
  useEffect(() => { magRef.current = isMagnified; }, [isMagnified]);

  const bubbleTimerRef = useRef<number | null>(null);
  const bubbleFadeTimerRef = useRef<number | null>(null);
  // 悬停状态提升为 React state：与 showCockpit/bubbleOpen 共同作为穿透推导的唯一事实源
  const [petHovered, setPetHovered] = useState(false);

  // ── 鼠标穿透单一事实源 ──
  // 任一交互态（监控舱展开 / 悬停本体 / 气泡打开）为真即接管鼠标；全部结束才恢复全屏穿透。
  // 历史 bug：多条命令式路径各自调用 setIgnoreMouseEvents，点击路径取反导致"打开监控舱反而穿透"，
  // 且任一路径漏恢复即锁死桌面鼠标。现统一由本 effect 派生，杜绝路径间互相覆盖。
  const ignoreMouse = deriveIgnoreMouse({ cockpitOpen: showCockpit, petHovered, bubbleOpen });
  useEffect(() => {
    setDesktopMouseIgnore(ignoreMouse);
    if (ignoreMouse) return;
    // 看门狗心跳：接管期间每 10s 重发一次 false，主进程 45s 无心跳会自动恢复穿透兜底
    const heartbeat = window.setInterval(() => setDesktopMouseIgnore(false), 10_000);
    return () => window.clearInterval(heartbeat);
  }, [ignoreMouse]);

  // 卸载兜底：组件销毁时恢复全屏穿透，并清理气泡定时器
  useEffect(() => {
    return () => {
      setDesktopMouseIgnore(true);
      clearBubbleTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearBubbleTimers = () => {
    if (bubbleTimerRef.current) {
      clearTimeout(bubbleTimerRef.current);
      bubbleTimerRef.current = null;
    }
    if (bubbleFadeTimerRef.current) {
      clearTimeout(bubbleFadeTimerRef.current);
      bubbleFadeTimerRef.current = null;
    }
  };

  // 淡出并关闭微气泡（220ms 淡出动画后真正卸载；淡出定时器可跟踪，重新悬停时可取消）
  const fadeCloseBubble = () => {
    setBubbleFading(true);
    if (bubbleFadeTimerRef.current) clearTimeout(bubbleFadeTimerRef.current);
    bubbleFadeTimerRef.current = window.setTimeout(() => {
      bubbleFadeTimerRef.current = null;
      setBubbleOpen(false);
      setBubbleFading(false);
    }, 220);
  };

  // 鼠标悬停在果蝇本体上时：唤醒半透明轻量微药丸菜单
  const handleMouseEnterPet = () => {
    setPetHovered(true);
    clearBubbleTimers();
    setBubbleFading(false);
    setBubbleOpen(true);
  };

  // 鼠标移出：1.2 秒内迅速淡出，恢复全屏纯净穿透
  const handleMouseLeavePet = () => {
    setPetHovered(false);
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = window.setTimeout(() => {
      bubbleTimerRef.current = null;
      fadeCloseBubble();
    }, 1200);
  };

  // 动作指令引用
  const actionTriggerRef = useRef<{
    feed?: () => void;
    goHome?: () => void;
    startle?: () => void;
    summon?: () => void;
  }>({});

  // 监听系统级全局快捷键 (来自 Electron 主进程，经 contextBridge 安全桥接)
  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    const offSummon = bridge.onSummonFly(() => {
      actionTriggerRef.current.summon?.();
    });
    const offCockpit = bridge.onToggleBrainCockpit(() => {
      // 只改状态，穿透由派生 effect 统一处理
      setShowCockpit((prev) => !prev);
    });
    return () => {
      offSummon();
      offCockpit();
    };
  }, []);

  // 监听空格键一键召唤与 Cmd/Ctrl+Shift+B 切换神经思考舱
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        actionTriggerRef.current.summon?.();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        setShowCockpit((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const controller = new AbortController();

    lifeEngineRef.current = new AutonomousFlyLifeEngine(atlas);

    // 1. 全屏完全透明场景
    const scene = new THREE.Scene();

    let screenW = window.innerWidth;
    let screenH = window.innerHeight;

    // 1:1 像素映射透视相机
    const camera = new THREE.PerspectiveCamera(30, screenW / screenH, 1, 5000);
    const vFovRad = (30 * Math.PI) / 180;
    const getCamDist = (h: number) => (h / 2) / Math.tan(vFovRad / 2);
    camera.position.set(0, 0, getCamDist(screenH));
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);

    // 自然环境主光与侧向边缘光 (增强甲壳与六足轮廓)
    scene.add(new THREE.AmbientLight(0xffffff, 2.6));
    const dirLight = new THREE.DirectionalLight(0xfff7ed, 3.4);
    dirLight.position.set(300, 600, 800);
    scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 1.8);
    rimLight.position.set(-300, -500, 500);
    scene.add(rimLight);

    // 2. 果蝇总根节点
    const flyRoot = new THREE.Group();
    scene.add(flyRoot);

    const modelContainer = new THREE.Group();
    flyRoot.add(modelContainer);

    const flybodyRoot = new THREE.Group();
    modelContainer.add(flybodyRoot);

    // 肢体与双翅铰接枢轴
    const frontLeftPivot = new THREE.Group();
    const frontRightPivot = new THREE.Group();
    const leftWingPivot = new THREE.Group();
    const rightWingPivot = new THREE.Group();
    const brainInHead = new THREE.Group();

    flybodyRoot.add(frontLeftPivot);
    flybodyRoot.add(frontRightPivot);
    flybodyRoot.add(leftWingPivot);
    flybodyRoot.add(rightWingPivot);
    flybodyRoot.add(brainInHead);

    // ── 3. 构造 100% 真实权威生物解剖孪生 Flybody 材质体系 ──
    const materials: Record<string, THREE.MeshStandardMaterial> = {
      // 几丁质胸背外骨骼
      body: new THREE.MeshStandardMaterial({
        color: 0xa86832,
        roughness: 0.38,
        metalness: 0.12,
      }),
      // 刚毛尖端、足爪微钩与口器
      black: new THREE.MeshStandardMaterial({
        color: 0x16120f,
        roughness: 0.5,
        metalness: 0.08,
      }),
      // 灿烂红宝石大复眼 (Ruby Compound Eyes)
      red: new THREE.MeshStandardMaterial({
        color: 0xcc1a10,
        emissive: 0x5a0600,
        emissiveIntensity: 0.35,
        roughness: 0.18,
        metalness: 0.22,
      }),
      // 额顶 3 只晶状小单眼 (Ocelli)
      ocelli: new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0x78350f,
        emissiveIntensity: 0.45,
        roughness: 0.12,
        metalness: 0.15,
      }),
      // 背板与头部专属解剖刚毛毛序 (Bristles)
      "bristle-brown": new THREE.MeshStandardMaterial({
        color: 0x382012,
        roughness: 0.6,
        metalness: 0.05,
      }),
      // 腹侧淡色几丁质
      lower: new THREE.MeshStandardMaterial({
        color: 0xb5824c,
        roughness: 0.45,
        metalness: 0.1,
      }),
      // 腹部黑黄相间的真实体节条纹 (Abdominal Terga)
      brown: new THREE.MeshStandardMaterial({
        color: 0x55341c,
        roughness: 0.35,
        metalness: 0.14,
      }),
      // 高精半透明脉络翅膜 (Membrane Wings)
      membrane: new THREE.MeshStandardMaterial({
        color: 0xdbeafe,
        transparent: true,
        opacity: 0.76,
        side: THREE.DoubleSide,
        depthWrite: false,
        roughness: 0.08,
        metalness: 0.22,
      }),
    };

    // 随身生物微柔光
    const bioLight = new THREE.PointLight(0xffedd5, 2.2, 140);
    bioLight.position.set(0, 10, 15);
    flyRoot.add(bioLight);

    // 加载 Flybody 真实解剖网格 (93,879 独立多边形)
    // 几何体登记表：卸载时统一 dispose，避免 GPU 显存泄漏
    const flybodyGeometries: THREE.BufferGeometry[] = [];
    void (async () => {
      try {
        const get = async (path: string) => {
          const r = await fetch(asset(`data/flybody/${path}`), { signal: controller.signal });
          if (!r.ok) throw Error("Flybody 身体资源加载失败");
          return r;
        };
        const meta = (await (await get("model.json")).json()) as Model;
        const buffer = await (await get(meta.binary)).arrayBuffer();
        // 组件已卸载：不再向场景追加任何几何体
        if (controller.signal.aborted) return;

        const pFL = meta.pivots.front_left ?? [0.0209, -0.0272, 0.0317];
        const pFR = meta.pivots.front_right ?? [-0.0209, -0.0272, 0.0317];
        const pWL = [-0.0462, 0.0096, -0.0128];
        const pWR = [0.0462, 0.0096, -0.0128];

        frontLeftPivot.position.set(pFL[0], pFL[1], pFL[2]);
        frontRightPivot.position.set(pFR[0], pFR[1], pFR[2]);
        leftWingPivot.position.set(pWL[0], pWL[1], pWL[2]);
        rightWingPivot.position.set(pWR[0], pWR[1], pWR[2]);

        for (const part of meta.parts) {
          if (part.material === "membrane") {
            const rawPos = new Float32Array(buffer.slice(part.positionByteOffset, part.positionByteOffset + part.positionCount * 12));
            const rawIndices = new Uint32Array(buffer.slice(part.indexByteOffset, part.indexByteOffset + part.indexCount * 4));
            const leftTris: number[] = [], rightTris: number[] = [];
            for (let i = 0; i < rawIndices.length; i += 3) {
              const i0 = rawIndices[i], i1 = rawIndices[i + 1], i2 = rawIndices[i + 2];
              const avgX = (rawPos[i0 * 3] + rawPos[i1 * 3] + rawPos[i2 * 3]) / 3;
              if (avgX < 0) leftTris.push(i0, i1, i2);
              else rightTris.push(i0, i1, i2);
            }
            const gL = new THREE.BufferGeometry();
            gL.setAttribute("position", new THREE.BufferAttribute(rawPos, 3));
            gL.setIndex(leftTris);
            gL.computeVertexNormals();
            flybodyGeometries.push(gL);
            const mL = new THREE.Mesh(gL, materials.membrane);
            mL.position.set(-pWL[0], -pWL[1], -pWL[2]);
            leftWingPivot.add(mL);

            const gR = new THREE.BufferGeometry();
            gR.setAttribute("position", new THREE.BufferAttribute(rawPos, 3));
            gR.setIndex(rightTris);
            gR.computeVertexNormals();
            flybodyGeometries.push(gR);
            const mR = new THREE.Mesh(gR, materials.membrane);
            mR.position.set(-pWR[0], -pWR[1], -pWR[2]);
            rightWingPivot.add(mR);
            continue;
          }

          const geom = new THREE.BufferGeometry();
          geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buffer.slice(part.positionByteOffset, part.positionByteOffset + part.positionCount * 12)), 3));
          geom.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer.slice(part.indexByteOffset, part.indexByteOffset + part.indexCount * 4)), 1));
          geom.computeVertexNormals();
          flybodyGeometries.push(geom);
          const mesh = new THREE.Mesh(geom, materials[part.material] ?? materials.body);

          if (part.group === "front_left") {
            mesh.position.set(-pFL[0], -pFL[1], -pFL[2]);
            frontLeftPivot.add(mesh);
          } else if (part.group === "front_right") {
            mesh.position.set(-pFR[0], -pFR[1], -pFR[2]);
            frontRightPivot.add(mesh);
          } else {
            flybodyRoot.add(mesh);
          }
        }

        // 精确对齐几何中心至原点
        const box = new THREE.Box3().setFromObject(flybodyRoot);
        const center = box.getCenter(new THREE.Vector3());
        flybodyRoot.position.sub(center);

        // 默认漫步与停歇姿态：双翅如真实果蝇般剪刀状合拢在背部
        leftWingPivot.rotation.set(0.05, -0.22, 0.04);
        rightWingPivot.rotation.set(0.05, 0.22, -0.04);
      } catch (e) {
        if (!controller.signal.aborted) console.error("加载 Flybody 失败:", e);
      }
    })();

    // 4. 嵌合 12.4 万实测神经元星云于果蝇复眼头颅内
    const { positions, ids, groups } = atlas;
    const count = atlas.visibleIds.size;
    const xyz = new Float32Array(count * 3);
    const gTypes = new Float32Array(count);
    const activityArr = new Float32Array(count);
    const idMap = new Map<number, number>();

    const bounds = new THREE.Box3();
    let ptr = 0;
    for (let i = 0; i < ids.length; i++) {
      if (groups[i] >= 3) continue;
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      const pt = new THREE.Vector3(x, -y, -z);
      xyz[ptr * 3] = pt.x;
      xyz[ptr * 3 + 1] = pt.y;
      xyz[ptr * 3 + 2] = pt.z;
      gTypes[ptr] = groups[i];
      idMap.set(ids[i], ptr);
      bounds.expandByPoint(pt);
      ptr++;
    }

    const brainCenter = bounds.getCenter(new THREE.Vector3());
    const brainSize = bounds.getSize(new THREE.Vector3());
    const normScale = 5 / Math.max(brainSize.x, brainSize.y, brainSize.z);

    for (let i = 0; i < count; i++) {
      xyz[i * 3] = (xyz[i * 3] - brainCenter.x) * normScale;
      xyz[i * 3 + 1] = (xyz[i * 3] - brainCenter.y) * normScale;
      xyz[i * 3 + 2] = (xyz[i * 3] - brainCenter.z) * normScale;
    }

    const brainGeom = new THREE.BufferGeometry();
    brainGeom.setAttribute("position", new THREE.BufferAttribute(xyz, 3));
    brainGeom.setAttribute("activity", new THREE.BufferAttribute(activityArr, 1));
    brainGeom.setAttribute("groupType", new THREE.BufferAttribute(gTypes, 1));

    const brainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uXray: { value: 0.0 },
      },
      vertexShader: `
        attribute float activity;
        attribute float groupType;
        varying float vAct;
        varying float vGroup;
        void main() {
          vAct = activity;
          vGroup = groupType;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (1.4 + vAct * 2.8) * 1.6;
        }
      `,
      fragmentShader: `
        varying float vAct;
        varying float vGroup;
        uniform float uXray;
        void main() {
          float r = length(gl_PointCoord - vec2(0.5));
          if (r > 0.5) discard;
          vec3 col = mix(vec3(0.1, 0.6, 0.95), vec3(0.1, 0.98, 1.0), vAct);
          if (vGroup >= 1.5) col = mix(vec3(0.85, 0.45, 0.15), vec3(1.0, 0.9, 0.25), vAct);
          float alpha = mix(0.0, 0.95, uXray);
          gl_FragColor = vec4(col, (0.4 + 0.6 * vAct) * alpha * (1.0 - smoothstep(0.18, 0.5, r)));
        }
      `,
    });

    const brainPoints = new THREE.Points(brainGeom, brainMat);
    // 🧠 精确嵌合在 Flybody 头颅复眼中央
    brainInHead.position.set(0, 0.038, 0.118);
    brainInHead.scale.setScalar(0.0172);
    brainInHead.add(brainPoints);

    // 5. 视口自适应
    const fit = () => {
      screenW = window.innerWidth;
      screenH = window.innerHeight;
      renderer.setSize(screenW, screenH, true);
      camera.aspect = screenW / screenH;
      camera.position.set(0, 0, getCamDist(screenH));
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();

    // 6. 灵动岛 (Notch) 老巢与动力学系统
    const getIslandPos = () => ({ x: 0, y: screenH / 2 - 46 });

    let flyX = 0;
    let flyY = 60;
    let flyZ = 12;
    let heading = Math.PI * 0.9;
    let roamMode: RoamMode = "diving_down";
    let modeTimer = 0;

    let flightProgress = 0;
    let flightDuration = 1.6;
    let flightStart = { x: 0, y: 100, z: 25 };
    let flightEnd = { x: 0, y: 60, z: 0 };

    // 注册交互指令
    actionTriggerRef.current = {
      feed: () => {
        if (lifeEngineRef.current) {
          lifeEngineRef.current.feedSucrose();
        }
      },
      goHome: () => {
        if (roamMode !== "at_island" && roamMode !== "flying_home") {
          roamMode = "flying_home";
          modeTimer = 0;
          flightProgress = 0;
          flightDuration = 2.0;
          flightStart = { x: flyX, y: flyY, z: flyZ };
          const island = getIslandPos();
          flightEnd = { x: island.x, y: island.y, z: 0 };
          if (lifeEngineRef.current) lifeEngineRef.current.setStage("flying");
        }
      },
      startle: () => {
        // 避障惊飞 (Giant Fiber 触发起飞)
        if (lifeEngineRef.current) {
          lifeEngineRef.current.triggerStartle();
        }
        roamMode = "screen_cruising";
        modeTimer = 0;
        flightProgress = 0;
        flightDuration = 1.3;
        flightStart = { x: flyX, y: flyY, z: flyZ };
        flightEnd = {
          x: (Math.random() - 0.5) * screenW * 0.72,
          y: (Math.random() - 0.4) * screenH * 0.68,
          z: 0,
        };
      },
      summon: () => {
        // 一键召唤到视线区
        roamMode = "diving_down";
        modeTimer = 0;
        flightProgress = 0;
        flightDuration = 0.9;
        flightStart = { x: flyX, y: flyY, z: flyZ };
        flightEnd = { x: 0, y: 60, z: 0 };
        // 召唤专属气泡路径：展开 6s 后自动收起（不复用 hover 路径，避免伪造悬停态锁死穿透）
        if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
        setBubbleFading(false);
        setBubbleOpen(true);
        bubbleTimerRef.current = window.setTimeout(() => {
          bubbleTimerRef.current = null;
          fadeCloseBubble();
        }, 6000);
        if (lifeEngineRef.current) {
          lifeEngineRef.current.triggerStartle();
        }
      },
    };

    let frameId = 0;
    let prev = performance.now();
    let lastUiUpdate = 0;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const t = now / 1000;
      modeTimer += dt;

      if (lifeEngineRef.current) {
        const isXray = xrayRef.current;
        const isMag = magRef.current;

        const { frame: curFrame, diagnostics: d } = lifeEngineRef.current.step(dt, true);

        // 同步 UI 状态
        if (now - lastUiUpdate > 180) {
          lastUiUpdate = now;
          setDiagnostics(d);
          if (showCockpitRef.current && curFrame) {
            setCurrentFrame(curFrame);
          }
          const screenPxX = screenW / 2 + flyX;
          const screenPxY = screenH / 2 - flyY;
          setHitboxPos({ x: screenPxX, y: screenPxY });

          const isNearTop = screenPxY < 140;
          setBubblePos({
            x: Math.max(120, Math.min(screenW - 120, screenPxX)),
            y: isNearTop ? screenPxY + 46 : screenPxY - 86,
            isBelow: isNearTop,
          });
        }

        // 自然生物视觉体量：基础设为 52 像素 (真实米粒黄金体量，特写 140 像素)
        const targetPixelSize = isMag ? 140 : 52;
        const realScale = targetPixelSize * 2.8;
        flyRoot.scale.setScalar(realScale);

        // 灵动岛动力学状态流转
        const island = getIslandPos();

        if (roamMode === "at_island") {
          flyX = island.x;
          flyY = island.y;
          flyZ = 0;
          heading = Math.PI;

          if (modeTimer > 16 || d.stage === "flying" || d.stage === "approaching_food") {
            roamMode = "diving_down";
            modeTimer = 0;
            flightProgress = 0;
            flightDuration = 1.7;
            flightStart = { x: flyX, y: flyY, z: 0 };
            flightEnd = {
              x: (Math.random() - 0.5) * screenW * 0.7,
              y: -screenH * 0.12 + (Math.random() - 0.5) * screenH * 0.38,
              z: 0,
            };
            if (lifeEngineRef.current) lifeEngineRef.current.setStage("flying");
          }
        } else if (roamMode === "diving_down" || roamMode === "screen_cruising" || roamMode === "flying_home") {
          flightProgress = Math.min(1, flightProgress + dt / flightDuration);
          const p = flightProgress;
          flyX = flightStart.x + (flightEnd.x - flightStart.x) * p;
          flyY = flightStart.y + (flightEnd.y - flightStart.y) * p;
          flyZ = Math.sin(p * Math.PI) * 45;

          heading = Math.atan2(flightEnd.x - flightStart.x, flightEnd.y - flightStart.y);

          if (p >= 1) {
            flyZ = 0;
            if (roamMode === "flying_home") {
              roamMode = "at_island";
              modeTimer = 0;
              if (lifeEngineRef.current) lifeEngineRef.current.setStage("grooming_face");
            } else {
              roamMode = "screen_crawling";
              modeTimer = 0;
              if (lifeEngineRef.current) lifeEngineRef.current.setStage("wandering");
            }
          }
        } else if (roamMode === "screen_crawling") {
          flyZ = 0;
          const crawlSpeed = d.stage === "sleeping" ? 0 : 36;
          flyX += Math.sin(heading) * crawlSpeed * dt;
          flyY += Math.cos(heading) * crawlSpeed * dt;

          heading += (Math.sin(t * 1.6) * 0.55 + (Math.random() - 0.5) * 0.28) * dt;

          const marginX = screenW * 0.44;
          const marginY = screenH * 0.42;
          if (flyX > marginX) heading = -Math.abs(heading);
          if (flyX < -marginX) heading = Math.abs(heading);
          if (flyY > marginY) heading = Math.PI - heading;
          if (flyY < -marginY) heading = -heading;

          if (modeTimer > 32) {
            actionTriggerRef.current.goHome?.();
          } else if (d.stage === "flying") {
            roamMode = "screen_cruising";
            modeTimer = 0;
            flightProgress = 0;
            flightDuration = 1.4;
            flightStart = { x: flyX, y: flyY, z: 0 };
            flightEnd = {
              x: (Math.random() - 0.5) * screenW * 0.78,
              y: (Math.random() - 0.5) * screenH * 0.68,
              z: 0,
            };
          }
        }

        // 同步位置
        flyRoot.position.set(flyX, flyY, flyZ);

        const isAir = roamMode !== "at_island" && roamMode !== "screen_crawling";

        // 姿态角修正 (背部双翅朝向用户屏幕)
        const pitchAngle = isAir ? Math.PI / 2 - 0.24 : Math.PI / 2;
        const rollWobble = (roamMode === "screen_crawling" && d.stage !== "sleeping") ? Math.sin(t * 18) * 0.05 : 0;
        flyRoot.rotation.set(pitchAngle, rollWobble, -heading);

        // 真实的机体微呼吸
        const breathe = 1 + Math.sin(t * 3.6) * 0.015;
        flybodyRoot.scale.set(breathe, breathe, 1 + Math.sin(t * 3.6) * 0.02);

        // 翅膀扇动与自然收拢
        if (isAir || d.wingFlappingHz > 100) {
          const flap = Math.sin(t * 72) * 0.52;
          leftWingPivot.rotation.set(-0.25, 0.38 + Math.cos(t * 72) * 0.18, 0.45 + flap);
          rightWingPivot.rotation.set(-0.25, -0.38 - Math.cos(t * 72) * 0.18, -0.45 - flap);
        } else if (d.stage === "grooming_wings") {
          const flick = Math.sin(t * 24) * 0.18;
          leftWingPivot.rotation.set(0.05, -0.22 + flick * 0.4, 0.04 + flick);
          rightWingPivot.rotation.set(0.05, 0.22 - flick * 0.4, -0.04 - flick);
        } else {
          // 停歇时两翅如真实果蝇般剪刀状合拢在背上
          leftWingPivot.rotation.set(0.05, -0.22, 0.04);
          rightWingPivot.rotation.set(0.05, 0.22, -0.04);
        }

        // 前足洗脸理毛与真实步态动作机
        if (d.stage === "grooming_face") {
          // 洗脸搓眼：两前足交替抬起到复眼前抚拭触角与眼睛
          const rubL = Math.sin(t * 26) * 0.35;
          const rubR = Math.cos(t * 26) * 0.35;
          frontLeftPivot.rotation.set(-0.35 + rubL, 0.1, 0.25 + Math.cos(t * 26) * 0.1);
          frontRightPivot.rotation.set(-0.35 + rubR, -0.1, -0.25 - Math.cos(t * 26) * 0.1);
        } else if (roamMode === "screen_crawling" && d.stage !== "sleeping") {
          // 爬行迈步：前足自然交替
          const step = Math.sin(t * 18) * 0.26;
          frontLeftPivot.rotation.set(step, 0, 0.08);
          frontRightPivot.rotation.set(-step, 0, -0.08);
        } else if (isAir) {
          // 飞行中前足收拢流线型
          frontLeftPivot.rotation.set(-0.5, 0.15, 0.25);
          frontRightPivot.rotation.set(-0.5, -0.15, -0.25);
        } else {
          frontLeftPivot.rotation.set(0, 0, 0);
          frontRightPivot.rotation.set(0, 0, 0);
        }

        // 脑电星系微光
        brainMat.uniforms.uXray.value = isXray ? 1.0 : 0.0;
        if (curFrame?.values && curFrame.values.length > 0) {
          activityArr.fill(0);
          for (const [bId, v] of curFrame.values) {
            const idx = idMap.get(bId);
            if (idx !== undefined) activityArr[idx] = v;
          }
          brainGeom.getAttribute("activity").needsUpdate = true;
        }
      }

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frameId);
      controller.abort();
      observer.disconnect();
      brainGeom.dispose();
      brainMat.dispose();
      flybodyGeometries.forEach((g) => g.dispose());
      Object.values(materials).forEach((m) => m.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [atlas]);

  // 监控舱内的实时神经刺激注入处理
  const handleStimulate = (type: "giant_fiber" | "sucrose" | "apple" | "home") => {
    if (type === "giant_fiber") {
      actionTriggerRef.current.startle?.();
    } else if (type === "sucrose") {
      actionTriggerRef.current.feed?.();
    } else if (type === "apple") {
      if (lifeEngineRef.current) {
        lifeEngineRef.current.setStage("approaching_food");
      }
    } else if (type === "home") {
      actionTriggerRef.current.goHome?.();
    }
  };

  return (
    <div className="desktop-pet-window">
      {/* 100% 透明全屏视口 */}
      <div ref={host} className="pet-canvas-viewport" />

      {/* 桌面右上角常驻极简后台指示标 (微弱透明，不干扰工作，随时一键展开) */}
      <div
        className={`cockpit-toggle-pill ${showCockpit ? "active" : ""}`}
        onClick={() => setShowCockpit(!showCockpit)}
        title="打开/收起神经思考监控舱 (全局快捷键 Cmd+Shift+B)"
      >
        🧠 神经思考监控舱
      </div>

      {/* 果蝇触碰感应热区 (点击直接触发巨纤维惊飞起飞，悬停唤起轻量微药丸) */}
      <div
        className="fly-interactive-hitbox"
        style={{
          left: `${hitboxPos.x}px`,
          top: `${hitboxPos.y}px`,
        }}
        onMouseEnter={handleMouseEnterPet}
        onMouseLeave={handleMouseLeavePet}
        onClick={() => actionTriggerRef.current.startle?.()}
        title="点击惊飞小飞，悬停显示微胶囊操作"
      />

      {/* 极简半透明微胶囊菜单 (仅在悬停时出现，绝非常驻移动大方框) */}
      {bubbleOpen && (
        <div
          className={`tabii-thought-bubble ${bubbleFading ? "fading-out" : ""}`}
          style={{
            left: `${bubblePos.x}px`,
            top: `${bubblePos.y}px`,
            transform: "translateX(-50%)",
          }}
          onMouseEnter={handleMouseEnterPet}
          onMouseLeave={handleMouseLeavePet}
        >
          <div className="tabii-bubble-header">
            <span className="tabii-bubble-title">
              🪰 小飞
            </span>
            <span className="tabii-bubble-badge">
              {diagnostics?.stageName ?? "漫步中"}
            </span>
          </div>

          <div className="tabii-bubble-actions">
            <button
              type="button"
              className={`tabii-pill-btn ${showCockpit ? "active" : ""}`}
              onClick={() => setShowCockpit(!showCockpit)}
              title="打开/收起神经思考监控舱 (快捷键 Cmd+Shift+B)"
            >
              🧠 思考后台
            </button>
            <button
              type="button"
              className={`tabii-pill-btn ${showBrainXray ? "active" : ""}`}
              onClick={() => setShowBrainXray(!showBrainXray)}
              title="透视颅内 12.4 万脑神经星系"
            >
              🌌 透视
            </button>
            <button
              type="button"
              className={`tabii-pill-btn ${isMagnified ? "active" : ""}`}
              onClick={() => setIsMagnified(!isMagnified)}
              title="切换显微特写模式"
            >
              {isMagnified ? "🔍 特写" : "🔍 显微"}
            </button>
            <button
              type="button"
              className="tabii-pill-btn"
              onClick={() => actionTriggerRef.current.feed?.()}
              title="投喂蔗糖水，激活多巴胺回路"
            >
              💧 喂糖
            </button>
            <button
              type="button"
              className="tabii-pill-btn"
              onClick={() => actionTriggerRef.current.goHome?.()}
              title="回灵动岛休整"
            >
              🏝️ 回岛
            </button>
          </div>
        </div>
      )}

      {/* 后台神经元实时思考监控舱 (Neural Cockpit) */}
      {showCockpit && (
        <NeuralThoughtCockpit
          atlas={atlas}
          frame={currentFrame}
          diagnostics={diagnostics}
          onClose={() => setShowCockpit(false)}
          onStimulate={handleStimulate}
        />
      )}
    </div>
  );
}
