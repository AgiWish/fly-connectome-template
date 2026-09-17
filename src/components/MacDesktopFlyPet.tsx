import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { asset, type Atlas } from "../lib/atlas";
import { AutonomousFlyLifeEngine, type LifeDiagnostics } from "../lib/autonomous-fly-life";

type Props = {
  atlas: Atlas;
};

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

type RoamMode = "at_island" | "diving_down" | "screen_crawling" | "screen_cruising" | "flying_home";

/**
 * macOS 原生灵动岛与全屏自由漫游桌面宠物 (自然尺度、灵动六足步态、无常驻方框阻碍)
 */
export function MacDesktopFlyPet({ atlas }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [showBrainXray, setShowBrainXray] = useState(false);
  const [isMagnified, setIsMagnified] = useState(false);
  const [diagnostics, setDiagnostics] = useState<LifeDiagnostics | null>(null);

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
  const isHoveredRef = useRef(false);

  // 通知 Electron 开启或释放鼠标点击穿透
  const setElectronMouseIgnore = (ignore: boolean) => {
    try {
      // @ts-ignore
      if (window.require) {
        // @ts-ignore
        const { ipcRenderer } = window.require("electron");
        ipcRenderer.send("set-ignore-mouse-events", ignore);
      }
    } catch {}
  };

  // 鼠标悬停在果蝇本体上时：唤醒半透明轻量微药丸菜单
  const handleMouseEnterPet = () => {
    isHoveredRef.current = true;
    if (bubbleTimerRef.current) {
      clearTimeout(bubbleTimerRef.current);
      bubbleTimerRef.current = null;
    }
    setBubbleFading(false);
    setBubbleOpen(true);
    setElectronMouseIgnore(false); // 接管鼠标事件，允许点击微药丸操作
  };

  // 鼠标移出：1.2 秒内迅速淡出，恢复全屏纯净穿透
  const handleMouseLeavePet = () => {
    isHoveredRef.current = false;
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = window.setTimeout(() => {
      setBubbleFading(true);
      setTimeout(() => {
        setBubbleOpen(false);
        setBubbleFading(false);
        setElectronMouseIgnore(true); // 恢复 100% 鼠标穿透
      }, 220);
    }, 1200);
  };

  // 动作指令引用
  const actionTriggerRef = useRef<{
    feed?: () => void;
    goHome?: () => void;
    startle?: () => void;
    summon?: () => void;
  }>({});

  // 监听系统级全局快捷键 (来自 Electron 主进程) 与本地按键
  useEffect(() => {
    try {
      // @ts-ignore
      if (window.require) {
        // @ts-ignore
        const { ipcRenderer } = window.require("electron");
        const onSummon = () => {
          actionTriggerRef.current.summon?.();
        };
        ipcRenderer.on('summon-fly', onSummon);
        return () => {
          ipcRenderer.removeListener('summon-fly', onSummon);
        };
      }
    } catch {}
  }, []);

  // 监听空格键一键召唤
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        actionTriggerRef.current.summon?.();
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

    // 材质定义
    const matAmber = new THREE.MeshStandardMaterial({
      color: 0xc87d32,
      roughness: 0.28,
      metalness: 0.16,
    });
    const matDarkThorax = new THREE.MeshStandardMaterial({
      color: 0x4a2a12,
      roughness: 0.35,
      metalness: 0.12,
    });
    const matRubyEye = new THREE.MeshStandardMaterial({
      color: 0xee1105,
      roughness: 0.15,
      metalness: 0.25,
      emissive: 0x660500,
      emissiveIntensity: 0.45,
    });
    const matAbdomen = new THREE.MeshStandardMaterial({
      color: 0xb56c28,
      roughness: 0.32,
      metalness: 0.14,
    });
    const matWing = new THREE.MeshStandardMaterial({
      color: 0xf0f8ff,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.08,
      metalness: 0.2,
    });
    const matLeg = new THREE.MeshStandardMaterial({
      color: 0x3d2310,
      roughness: 0.4,
      metalness: 0.1,
    });
    const matAntenna = new THREE.MeshStandardMaterial({
      color: 0x1f140c,
      roughness: 0.6,
      metalness: 0.05,
    });

    // ── 3. 构造极度灵动鲜活的高拟真程序化生物果蝇 ──
    // A. 躯干 (Thorax)
    const thoraxGeom = new THREE.SphereGeometry(0.046, 16, 14);
    thoraxGeom.scale(1.0, 0.82, 1.28);
    const thoraxMesh = new THREE.Mesh(thoraxGeom, matDarkThorax);
    modelContainer.add(thoraxMesh);

    // B. 头部 (Head)
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0, 0.058);
    modelContainer.add(headGroup);

    const headGeom = new THREE.SphereGeometry(0.036, 16, 14);
    headGeom.scale(1.15, 0.88, 0.95);
    const headMesh = new THREE.Mesh(headGeom, matAmber);
    headGroup.add(headMesh);

    // 鲜红大复眼 (Ruby Eyes)
    const eyeGeom = new THREE.SphereGeometry(0.021, 14, 12);
    eyeGeom.scale(0.88, 1.12, 1.25);
    const eyeL = new THREE.Mesh(eyeGeom, matRubyEye);
    eyeL.position.set(-0.027, 0.008, 0.008);
    const eyeR = new THREE.Mesh(eyeGeom, matRubyEye);
    eyeR.position.set(0.027, 0.008, 0.008);
    headGroup.add(eyeL);
    headGroup.add(eyeR);

    // 触角 (Antennae)
    const antGeom = new THREE.CylinderGeometry(0.002, 0.001, 0.038, 6);
    antGeom.translate(0, 0.019, 0);
    const antL = new THREE.Mesh(antGeom, matAntenna);
    antL.position.set(-0.012, 0.012, 0.032);
    antL.rotation.set(0.5, 0.25, 0.3);
    const antR = new THREE.Mesh(antGeom, matAntenna);
    antR.position.set(0.012, 0.012, 0.032);
    antR.rotation.set(0.5, -0.25, -0.3);
    headGroup.add(antL);
    headGroup.add(antR);

    // C. 腹部 (Abdomen，带节段微缩放呼吸)
    const abdomenGroup = new THREE.Group();
    abdomenGroup.position.set(0, -0.006, -0.052);
    modelContainer.add(abdomenGroup);

    const abdGeom = new THREE.SphereGeometry(0.054, 16, 14);
    abdGeom.scale(0.92, 0.78, 1.68);
    const abdomenMesh = new THREE.Mesh(abdGeom, matAbdomen);
    abdomenMesh.position.set(0, 0, -0.046);
    abdomenGroup.add(abdomenMesh);

    // D. 双翅与铰接枢轴 (Wings)
    const leftWingPivot = new THREE.Group();
    const rightWingPivot = new THREE.Group();
    leftWingPivot.position.set(-0.026, 0.022, -0.012);
    rightWingPivot.position.set(0.026, 0.022, -0.012);
    modelContainer.add(leftWingPivot);
    modelContainer.add(rightWingPivot);

    const wingShape = new THREE.PlaneGeometry(0.075, 0.165, 4, 8);
    wingShape.translate(0, 0, -0.08);

    const wingL = new THREE.Mesh(wingShape, matWing);
    wingL.rotation.x = -Math.PI / 2;
    leftWingPivot.add(wingL);

    const wingR = new THREE.Mesh(wingShape, matWing);
    wingR.rotation.x = -Math.PI / 2;
    rightWingPivot.add(wingR);

    // E. 核心：六足铰接运动系统 (6 Articulated Legs for Tripod Gait)
    const createLeg = (lengthFemur: number, lengthTibia: number) => {
      const hip = new THREE.Group();

      const femurGeom = new THREE.CylinderGeometry(0.004, 0.003, lengthFemur, 6);
      femurGeom.translate(0, -lengthFemur / 2, 0);
      const femur = new THREE.Mesh(femurGeom, matLeg);

      const knee = new THREE.Group();
      knee.position.set(0, -lengthFemur, 0);

      const tibiaGeom = new THREE.CylinderGeometry(0.003, 0.0018, lengthTibia, 6);
      tibiaGeom.translate(0, -lengthTibia / 2, 0);
      const tibia = new THREE.Mesh(tibiaGeom, matLeg);
      knee.add(tibia);

      femur.add(knee);
      hip.add(femur);

      return { hip, femur, knee, tibia };
    };

    // 左右前足 (FL, FR)
    const legFL = createLeg(0.046, 0.052);
    legFL.hip.position.set(-0.026, -0.01, 0.026);
    modelContainer.add(legFL.hip);

    const legFR = createLeg(0.046, 0.052);
    legFR.hip.position.set(0.026, -0.01, 0.026);
    modelContainer.add(legFR.hip);

    // 左右中足 (ML, MR)
    const legML = createLeg(0.052, 0.058);
    legML.hip.position.set(-0.034, -0.012, 0.0);
    modelContainer.add(legML.hip);

    const legMR = createLeg(0.052, 0.058);
    legMR.hip.position.set(0.034, -0.012, 0.0);
    modelContainer.add(legMR.hip);

    // 左右后足 (HL, HR)
    const legHL = createLeg(0.058, 0.066);
    legHL.hip.position.set(-0.028, -0.014, -0.028);
    modelContainer.add(legHL.hip);

    const legHR = createLeg(0.058, 0.066);
    legHR.hip.position.set(0.028, -0.014, -0.028);
    modelContainer.add(legHR.hip);

    // 随身生物微柔光
    const bioLight = new THREE.PointLight(0xffedd5, 2.2, 140);
    bioLight.position.set(0, 10, 15);
    flyRoot.add(bioLight);

    // 4. 嵌合 12.4 万实测神经元星云
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
          gl_PointSize = (1.2 + vAct * 2.5) * 1.6;
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
          float alpha = mix(0.0, 0.92, uXray);
          gl_FragColor = vec4(col, (0.4 + 0.6 * vAct) * alpha * (1.0 - smoothstep(0.2, 0.5, r)));
        }
      `,
    });

    const brainPoints = new THREE.Points(brainGeom, brainMat);
    const brainGroup = new THREE.Group();
    brainGroup.scale.setScalar(0.0175);
    brainGroup.position.set(0, 0.004, 0.042);
    brainGroup.add(brainPoints);
    modelContainer.add(brainGroup);

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
        handleMouseEnterPet();
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

        // 自然生物视觉体量：基础设为 56 像素 (清晰呈现六足倒腾与复眼扑翼细节，特写 140 像素)
        const targetPixelSize = isMag ? 140 : 56;
        const realScale = targetPixelSize * 3.5;
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

        // 腹部微弱呼吸与触角颤动
        const breathe = 1 + Math.sin(t * 3.6) * 0.045;
        abdomenGroup.scale.set(breathe, breathe * 0.95, 1 + Math.sin(t * 3.6) * 0.06);
        antL.rotation.x = 0.5 + Math.sin(t * 22) * 0.08;
        antR.rotation.x = 0.5 + Math.cos(t * 22) * 0.08;

        // 翅膀扇动
        if (isAir || d.wingFlappingHz > 100) {
          const flap = Math.sin(t * 70) * 0.52;
          leftWingPivot.rotation.set(-0.25, 0.4, 0.45 + flap);
          rightWingPivot.rotation.set(-0.25, -0.4, -0.45 - flap);
        } else if (d.stage === "grooming_wings") {
          const flick = Math.sin(t * 24) * 0.18;
          leftWingPivot.rotation.set(0.04, -0.22 + flick * 0.5, 0.04 + flick);
          rightWingPivot.rotation.set(0.04, 0.22 - flick * 0.5, -0.04 - flick);
        } else {
          // 停歇时两翅收拢重叠在背上
          leftWingPivot.rotation.set(0.05, -0.18, 0.04);
          rightWingPivot.rotation.set(0.05, 0.18, -0.04);
        }

        // ── 真实的昆虫六足三角步态 (Tripod Gait Kinematics) ──
        if (isAir) {
          // 飞行中：六足向后上方收拢折叠，形成低风阻流线型
          legFL.hip.rotation.set(-0.4, -0.2, -0.3);
          legFR.hip.rotation.set(-0.4, 0.2, 0.3);
          legML.hip.rotation.set(-0.6, -0.3, -0.4);
          legMR.hip.rotation.set(-0.6, 0.3, 0.4);
          legHL.hip.rotation.set(-0.8, -0.2, -0.2);
          legHR.hip.rotation.set(-0.8, 0.2, 0.2);

          legFL.knee.rotation.x = 0.8;
          legFR.knee.rotation.x = 0.8;
          legML.knee.rotation.x = 1.0;
          legMR.knee.rotation.x = 1.0;
          legHL.knee.rotation.x = 1.2;
          legHR.knee.rotation.x = 1.2;
        } else if (d.stage === "grooming_face") {
          // 洗脸理毛：前两足抬起在眼睛前快速搓动
          const rubL = Math.sin(t * 28) * 0.35;
          const rubR = Math.cos(t * 28) * 0.35;
          legFL.hip.rotation.set(0.6 + rubL, -0.2, -0.4);
          legFR.hip.rotation.set(0.6 + rubR, 0.2, 0.4);
          legFL.knee.rotation.x = 0.9 + rubL * 0.4;
          legFR.knee.rotation.x = 0.9 + rubR * 0.4;

          // 中足后足保持稳固支撑
          legML.hip.rotation.set(0.0, -0.5, -0.3);
          legMR.hip.rotation.set(0.0, 0.5, 0.3);
          legHL.hip.rotation.set(-0.2, -0.3, -0.2);
          legHR.hip.rotation.set(-0.2, 0.3, 0.2);
        } else if (roamMode === "screen_crawling" && d.stage !== "sleeping") {
          // 真实三角步态：Group A (FL, MR, HL) 与 Group B (FR, ML, HR) 180度反相交替倒腾！
          const gaitPhase = t * 20; // 步态速度
          const swingA = Math.sin(gaitPhase);
          const liftA = Math.max(0, Math.cos(gaitPhase)) * 0.25;

          const swingB = Math.sin(gaitPhase + Math.PI);
          const liftB = Math.max(0, Math.cos(gaitPhase + Math.PI)) * 0.25;

          // Group A (前左, 中右, 后左)
          legFL.hip.rotation.set(0.25 + swingA * 0.38, -0.3, -0.2 - liftA);
          legMR.hip.rotation.set(0.0 + swingA * 0.35, 0.55, 0.3 + liftA);
          legHL.hip.rotation.set(-0.25 + swingA * 0.4, -0.45, -0.2 - liftA);

          legFL.knee.rotation.x = 0.5 + liftA * 0.6;
          legMR.knee.rotation.x = 0.6 + liftA * 0.6;
          legHL.knee.rotation.x = 0.7 + liftA * 0.6;

          // Group B (前右, 中左, 后右)
          legFR.hip.rotation.set(0.25 + swingB * 0.38, 0.3, 0.2 + liftB);
          legML.hip.rotation.set(0.0 + swingB * 0.35, -0.55, -0.3 - liftB);
          legHR.hip.rotation.set(-0.25 + swingB * 0.4, 0.45, 0.2 + liftB);

          legFR.knee.rotation.x = 0.5 + liftB * 0.6;
          legML.knee.rotation.x = 0.6 + liftB * 0.6;
          legHR.knee.rotation.x = 0.7 + liftB * 0.6;
        } else {
          // 停歇休整态：六足平稳自然着地支撑
          legFL.hip.rotation.set(0.22, -0.35, -0.2);
          legFR.hip.rotation.set(0.22, 0.35, 0.2);
          legML.hip.rotation.set(0.0, -0.5, -0.25);
          legMR.hip.rotation.set(0.0, 0.5, 0.25);
          legHL.hip.rotation.set(-0.25, -0.4, -0.2);
          legHR.hip.rotation.set(-0.25, 0.4, 0.2);

          legFL.knee.rotation.x = 0.5;
          legFR.knee.rotation.x = 0.5;
          legML.knee.rotation.x = 0.55;
          legMR.knee.rotation.x = 0.55;
          legHL.knee.rotation.x = 0.65;
          legHR.knee.rotation.x = 0.65;
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
      matAmber.dispose();
      matDarkThorax.dispose();
      matRubyEye.dispose();
      matAbdomen.dispose();
      matWing.dispose();
      matLeg.dispose();
      matAntenna.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [atlas]);

  return (
    <div className="desktop-pet-window">
      {/* 100% 透明全屏视口 */}
      <div ref={host} className="pet-canvas-viewport" />

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
              className={`tabii-pill-btn ${showBrainXray ? "active" : ""}`}
              onClick={() => setShowBrainXray(!showBrainXray)}
              title="透视颅内 12.4 万脑神经星系"
            >
              🧠 透视
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
    </div>
  );
}
