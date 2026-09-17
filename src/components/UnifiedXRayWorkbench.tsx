import { useEffect, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { asset, type Atlas } from "../lib/atlas";
import type { ActivityFrame } from "../lib/replay";
import type { StimulusInput, ThoughtDiagnostics } from "../lib/live-brain";

type Props = {
  atlas: Atlas;
  /** 直值模式每帧经 React 传递；高频循环请改传 ref，渲染内部按帧读取，避免 60fps reconciliation */
  frame: ActivityFrame | null | MutableRefObject<ActivityFrame | null>;
  stimulus: StimulusInput;
  diagnostics: ThoughtDiagnostics | null;
  xrayOpacity: number; // 0=实体, 0.4=X-Ray透视, 1=纯神经元
  onStimulusMove?: (stim: StimulusInput) => void;
};

type ProbeInfo = {
  bodyId: number;
  groupName: string;
  x: number;
  y: number;
  z: number;
  activity: number;
} | null;

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

const GROUP_NAMES = ["视叶 (Optic Lobe)", "中央脑 (Central Brain)", "下行神经元 (Descending)"];

export function UnifiedXRayWorkbench({
  atlas,
  frame,
  stimulus,
  diagnostics,
  xrayOpacity,
  onStimulusMove,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [hoveredNeuron, setHoveredNeuron] = useState<ProbeInfo>(null);
  const [error, setError] = useState("");

  const signalRef = useRef(frame);
  const stimRef = useRef(stimulus);
  const diagRef = useRef(diagnostics);
  const xrayRef = useRef(xrayOpacity);

  // 兼容直值与 ref 两种帧来源：直值模式下镜像到内部 ref；ref 模式下直接共用
  const frameInnerRef = useRef<ActivityFrame | null>(null);
  const isFrameRef = typeof frame === "object" && frame !== null && "current" in frame;
  useEffect(() => {
    if (!isFrameRef) signalRef.current = frame;
  }, [frame, isFrameRef]);
  useEffect(() => {
    if (isFrameRef) signalRef.current = frame.current;
  });
  useEffect(() => { stimRef.current = stimulus; }, [stimulus]);
  useEffect(() => { diagRef.current = diagnostics; }, [diagnostics]);
  useEffect(() => { xrayRef.current = xrayOpacity; }, [xrayOpacity]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const controller = new AbortController();
    let disposed = false;

    // 1. Three.js 场景初始化
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.001, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 0.3;
    controls.maxDistance = 2.5;

    // 灯光体系：冷调未来科幻实验室打光
    scene.add(new THREE.AmbientLight(0x1a2634, 2.5));
    const mainLight = new THREE.DirectionalLight(0xd5e8ff, 3.8);
    mainLight.position.set(2, 3, 3);
    scene.add(mainLight);
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 2.5);
    rimLight.position.set(-2, -1, -2);
    scene.add(rimLight);

    // 2. 空间悬浮刺激光斑系统 (3D Interactive Light Stimulus)
    const stimGroup = new THREE.Group();
    scene.add(stimGroup);

    const stimLight = new THREE.PointLight(0x38bdf8, 4, 1.2);
    stimGroup.add(stimLight);

    const stimCoreGeom = new THREE.SphereGeometry(0.014, 16, 16);
    const stimCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const stimCoreMesh = new THREE.Mesh(stimCoreGeom, stimCoreMat);
    stimGroup.add(stimCoreMesh);

    const stimHaloGeom = new THREE.SphereGeometry(0.035, 16, 16);
    const stimHaloMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 });
    const stimHaloMesh = new THREE.Mesh(stimHaloGeom, stimHaloMat);
    stimGroup.add(stimHaloMesh);

    // 3. 果蝇机体根节点 (包含骨骼、足肢、翅膀与体内大脑)
    const modelRoot = new THREE.Group();
    scene.add(modelRoot);

    const frontLeftPivot = new THREE.Group();
    const frontRightPivot = new THREE.Group();
    const leftWingPivot = new THREE.Group();
    const rightWingPivot = new THREE.Group();
    const brainInHead = new THREE.Group();

    modelRoot.add(frontLeftPivot);
    modelRoot.add(frontRightPivot);
    modelRoot.add(leftWingPivot);
    modelRoot.add(rightWingPivot);
    modelRoot.add(brainInHead);

    // 4. 外骨骼材质字典 (支持 X-Ray 琉璃晶莹透视)
    const materials: Record<string, THREE.MeshStandardMaterial> = {};
    const baseColors: Record<string, number> = {
      body: 0x9e6834,
      black: 0x15110e,
      red: 0xad331f,
      ocelli: 0xe6b351,
      "bristle-brown": 0x281c10,
      lower: 0xbb8949,
      brown: 0x52351f,
    };

    for (const [key, color] of Object.entries(baseColors)) {
      materials[key] = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.35,
        metalness: 0.15,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
      });
    }

    materials.membrane = new THREE.MeshStandardMaterial({
      color: 0x90cdf4,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.1,
    });

    let radius = 0.3;

    // 5. 加载果蝇身体网格与解绑肢体
    void (async () => {
      try {
        const get = async (path: string) => {
          const r = await fetch(asset(`data/flybody/${path}`), { signal: controller.signal });
          if (!r.ok) throw Error("果蝇身体资源加载失败");
          return r;
        };
        const meta = (await (await get("model.json")).json()) as Model;
        const buffer = await (await get(meta.binary)).arrayBuffer();
        if (disposed) return;

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

            const leftTris: number[] = [];
            const rightTris: number[] = [];
            for (let i = 0; i < rawIndices.length; i += 3) {
              const i0 = rawIndices[i], i1 = rawIndices[i + 1], i2 = rawIndices[i + 2];
              const avgX = (rawPos[i0 * 3] + rawPos[i1 * 3] + rawPos[i2 * 3]) / 3;
              if (avgX < 0) leftTris.push(i0, i1, i2);
              else rightTris.push(i0, i1, i2);
            }

            const geomLeft = new THREE.BufferGeometry();
            geomLeft.setAttribute("position", new THREE.BufferAttribute(rawPos, 3));
            geomLeft.setIndex(leftTris);
            geomLeft.computeVertexNormals();
            const meshLeft = new THREE.Mesh(geomLeft, materials.membrane);
            meshLeft.position.set(-pWL[0], -pWL[1], -pWL[2]);
            leftWingPivot.add(meshLeft);

            const geomRight = new THREE.BufferGeometry();
            geomRight.setAttribute("position", new THREE.BufferAttribute(rawPos, 3));
            geomRight.setIndex(rightTris);
            geomRight.computeVertexNormals();
            const meshRight = new THREE.Mesh(geomRight, materials.membrane);
            meshRight.position.set(-pWR[0], -pWR[1], -pWR[2]);
            rightWingPivot.add(meshRight);
            continue;
          }

          const geom = new THREE.BufferGeometry();
          geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buffer.slice(part.positionByteOffset, part.positionByteOffset + part.positionCount * 12)), 3));
          geom.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer.slice(part.indexByteOffset, part.indexByteOffset + part.indexCount * 4)), 1));
          geom.computeVertexNormals();
          const mesh = new THREE.Mesh(geom, materials[part.material] ?? materials.body);

          if (part.group === "front_left") {
            mesh.position.set(-pFL[0], -pFL[1], -pFL[2]);
            frontLeftPivot.add(mesh);
          } else if (part.group === "front_right") {
            mesh.position.set(-pFR[0], -pFR[1], -pFR[2]);
            frontRightPivot.add(mesh);
          } else {
            modelRoot.add(mesh);
          }
        }

        const box = new THREE.Box3().setFromObject(modelRoot);
        const center = box.getCenter(new THREE.Vector3());
        modelRoot.position.sub(center);
        radius = box.getBoundingSphere(new THREE.Sphere()).radius;
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    })();

    // 6. 加载 124,289 个 MaleCNS 胞体，并精确嵌合进头骨内部 (Nesting in Head)
    let brainMesh: THREE.Points | undefined;
    let brainGeom: THREE.BufferGeometry | undefined;
    let brainMat: THREE.ShaderMaterial | undefined;
    let xyzArr: Float32Array;
    let bodyIdsArr: Uint32Array;
    let groupsArr: Uint8Array;

    const visibleCount = atlas.visibleIds.size;
    xyzArr = new Float32Array(visibleCount * 3);
    bodyIdsArr = new Uint32Array(visibleCount);
    groupsArr = new Uint8Array(visibleCount);
    const randSeeds = new Float32Array(visibleCount);

    const bounds = new THREE.Box3();
    let ptr = 0;
    for (let i = 0; i < atlas.ids.length; i++) {
      if (atlas.groups[i] >= 3) continue;
      const x = atlas.positions[i * 3], y = atlas.positions[i * 3 + 1], z = atlas.positions[i * 3 + 2];
      const pt = new THREE.Vector3(x, -y, -z);
      xyzArr[ptr * 3] = pt.x;
      xyzArr[ptr * 3 + 1] = pt.y;
      xyzArr[ptr * 3 + 2] = pt.z;
      bodyIdsArr[ptr] = atlas.ids[i];
      groupsArr[ptr] = atlas.groups[i];
      randSeeds[ptr] = ((atlas.ids[i] * 16807) % 2147483647) / 2147483647;
      bounds.expandByPoint(pt);
      ptr++;
    }

    const brainCenter = bounds.getCenter(new THREE.Vector3());
    const brainSize = bounds.getSize(new THREE.Vector3());
    const normScale = 5 / Math.max(brainSize.x, brainSize.y, brainSize.z);

    for (let i = 0; i < visibleCount; i++) {
      xyzArr[i * 3] = (xyzArr[i * 3] - brainCenter.x) * normScale;
      xyzArr[i * 3 + 1] = (xyzArr[i * 3 + 1] - brainCenter.y) * normScale;
      xyzArr[i * 3 + 2] = (xyzArr[i * 3 + 2] - brainCenter.z) * normScale;
    }

    const idToIndex = new Map<number, number>();
    for (let i = 0; i < visibleCount; i++) {
      idToIndex.set(bodyIdsArr[i], i);
    }

    brainGeom = new THREE.BufferGeometry();
    brainGeom.setAttribute("position", new THREE.BufferAttribute(xyzArr, 3));
    brainGeom.setAttribute("groupType", new THREE.BufferAttribute(new Float32Array(groupsArr), 1));
    brainGeom.setAttribute("seed", new THREE.BufferAttribute(randSeeds, 1));
    const activityAttr = new Float32Array(visibleCount);
    brainGeom.setAttribute("activity", new THREE.BufferAttribute(activityAttr, 1));

    brainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        pixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uTime: { value: 0 },
        uStimX: { value: 0 },
        uLooming: { value: 0 },
      },
      vertexShader: `
        attribute float activity;
        attribute float groupType;
        attribute float seed;
        varying float vActivity;
        varying float vGroup;
        varying float vSpontaneous;
        uniform float pixelRatio;
        uniform float uTime;
        uniform float uStimX;
        uniform float uLooming;

        void main() {
          vGroup = groupType;

          float gpuFieldAct = 0.0;
          if (groupType < 0.5) {
            float diff = (position.x * 0.45) - uStimX;
            float distSq = diff * diff + (position.y * position.y * 0.2);
            float opticResponse = exp(-distSq * 2.8) * 0.95;
            if (uLooming > 0.5) opticResponse = max(opticResponse, 0.98);
            gpuFieldAct = opticResponse;
          } else if (groupType >= 1.5) {
            float motorSide = uStimX * position.x;
            gpuFieldAct = clamp(motorSide * 1.8 + (uLooming > 0.5 ? 1.0 : 0.08), 0.0, 1.0);
          }

          vActivity = max(activity, gpuFieldAct);

          // 神经元自发微脉冲行波
          float wave = sin(position.x * 4.2 + position.y * 3.1 + position.z * 2.5 + uTime * 2.5 + seed * 6.28);
          vSpontaneous = pow(max(0.0, wave), 5.0) * 0.45;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

          float baseSize = 1.35 + vSpontaneous * 1.0;
          if (vActivity > 0.05) {
            baseSize = 2.4 + vActivity * 3.5;
          }
          gl_PointSize = baseSize * pixelRatio;
        }
      `,
      fragmentShader: `
        varying float vActivity;
        varying float vGroup;
        varying float vSpontaneous;

        void main() {
          float r = length(gl_PointCoord - vec2(0.5));
          if (r > 0.5) discard;

          vec3 baseColor = vec3(0.12, 0.32, 0.65);
          if (vGroup > 0.5 && vGroup < 1.5) baseColor = vec3(0.24, 0.28, 0.42);
          else if (vGroup >= 1.5) baseColor = vec3(0.48, 0.35, 0.18);

          vec3 sponColor = mix(baseColor, vec3(0.4, 0.75, 0.95), vSpontaneous);
          if (vGroup > 0.5 && vGroup < 1.5) sponColor = mix(sponColor, vec3(0.68, 0.55, 0.88), vSpontaneous);

          // 穿透外壳的高能荧光
          vec3 activeColor = vec3(0.1, 0.98, 1.0);
          if (vGroup > 0.5 && vGroup < 1.5) activeColor = vec3(0.88, 0.68, 1.0);
          else if (vGroup >= 1.5) activeColor = vec3(1.0, 0.88, 0.25);

          vec3 color = mix(sponColor, activeColor, vActivity);
          color = mix(color, vec3(1.0), smoothstep(0.6, 1.0, vActivity));

          float totalEnergy = max(vActivity, vSpontaneous * 0.6);
          float alpha = (0.35 + 0.65 * totalEnergy) * (1.0 - smoothstep(0.16, 0.5, r));
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });

    brainMesh = new THREE.Points(brainGeom, brainMat);
    // 🧠 关键一步：精确缩放并平移，使大脑不偏不倚嵌合在果蝇半透明复眼头颅内！
    brainInHead.position.set(0, 0.038, 0.118);
    brainInHead.scale.setScalar(0.0172);
    brainInHead.add(brainMesh);

    // 7. 视角与尺寸自适应
    const fit = () => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };

    camera.position.set(0.25, 0.45, 0.75);
    camera.lookAt(0, 0.02, 0.05);
    controls.target.set(0, 0.02, 0.05);
    controls.update();

    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(element);
    fit();

    // 8. 鼠标 3D 空间交互与探针
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.002 };
    const mouse2D = new THREE.Vector2();
    let isDragging3D = false;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button === 0) isDragging3D = true;
    };

    const handlePointerMove = (e: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      mouse2D.set(x, y);

      // 将鼠标映射为空间 3D 刺激光源
      if (onStimulusMove) {
        onStimulusMove({
          x: Math.max(-1, Math.min(1, x * 1.3)),
          y: Math.max(-1, Math.min(1, y * 1.3)),
          speed: 1,
          isLooming: stimRef.current.isLooming,
          interactive: true,
        });
      }

      // 探针检测体内发光神经元
      if (brainMesh && !isDragging3D) {
        raycaster.setFromCamera(mouse2D, camera);
        const hits = raycaster.intersectObject(brainMesh);
        if (hits.length > 0 && hits[0].index !== undefined) {
          const idx = hits[0].index;
          const bId = bodyIdsArr[idx];
          const g = groupsArr[idx];
          const px = xyzArr[idx * 3];
          const py = xyzArr[idx * 3 + 1];
          const pz = xyzArr[idx * 3 + 2];
          const act = brainGeom?.getAttribute("activity")?.getX(idx) ?? 0;
          setHoveredNeuron({
            bodyId: bId,
            groupName: GROUP_NAMES[g] ?? "未分类",
            x: Number(px.toFixed(2)),
            y: Number(py.toFixed(2)),
            z: Number(pz.toFixed(2)),
            activity: Number(act.toFixed(2)),
          });
        }
      }
    };

    const handlePointerUp = () => { isDragging3D = false; };

    element.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    // 9. 主渲染与物理动力学循环 (60FPS)
    let frameId = 0;
    let prevTime = performance.now();
    let currentYaw = 0;
    let currentRecoil = 0;

    const animate = (now: number) => {
      const dt = Math.min(0.05, (now - prevTime) / 1000);
      prevTime = now;
      const t = now / 1000;

      // 更新 X-Ray 材质透视度 (0=实体, 0.4=透视, 1=纯神经元)
      const curXray = xrayRef.current;
      for (const [k, mat] of Object.entries(materials)) {
        if (k === "membrane") {
          mat.opacity = Math.max(0.08, (1 - curXray * 0.85) * 0.45);
        } else {
          // 躯干甲壳透视度调节
          mat.opacity = Math.max(0.04, (1 - curXray) * 0.85);
          mat.roughness = 0.25 + (1 - curXray) * 0.4;
        }
      }

      // 更新 3D 悬浮刺激光源位置
      const stim = stimRef.current;
      const stimTargetX = stim.x * 0.28;
      const stimTargetY = 0.04 + stim.y * 0.16;
      const stimTargetZ = stim.isLooming ? 0.18 : 0.42;

      stimGroup.position.x += (stimTargetX - stimGroup.position.x) * 0.15;
      stimGroup.position.y += (stimTargetY - stimGroup.position.y) * 0.15;
      stimGroup.position.z += (stimTargetZ - stimGroup.position.z) * 0.15;

      if (stim.isLooming) {
        stimLight.color.setHex(0xff3366);
        stimHaloMat.color.setHex(0xff3366);
        stimHaloMesh.scale.setScalar(2.2);
      } else {
        stimLight.color.setHex(0x38bdf8);
        stimHaloMat.color.setHex(0x38bdf8);
        stimHaloMesh.scale.setScalar(1.0 + Math.sin(t * 4) * 0.15);
      }

      // 神经驱动身体朝向与惊吓后撤
      const diag = diagRef.current;
      const targetRad = ((diag?.flyHeadingDeg ?? 0) * Math.PI) / 180;
      const targetRecoil = diag?.recoil ?? 0;

      currentYaw += (targetRad - currentYaw) * 0.14;
      currentRecoil += (targetRecoil - currentRecoil) * 0.2;

      // 呼吸起伏与张望微颤
      const breathing = Math.sin(t * 3.8) * 0.01;
      const fidgetYaw = Math.sin(t * 0.9) * 0.035;
      const fidgetPitch = Math.sin(t * 1.3) * 0.018;

      modelRoot.rotation.y = currentYaw + fidgetYaw;
      modelRoot.rotation.x = -currentRecoil * 0.45 + breathing + fidgetPitch;
      modelRoot.position.y = currentRecoil * 0.06 + Math.sin(t * 3.8) * 0.002;

      // 翅膀扇动与抖动
      if (currentRecoil > 0.22) {
        const flap = Math.sin(t * 48) * 0.48;
        leftWingPivot.rotation.set(-0.2, 0.35 + Math.cos(t * 48) * 0.2, 0.4 + flap);
        rightWingPivot.rotation.set(-0.2, -0.35 - Math.cos(t * 48) * 0.2, -0.4 - flap);
      } else {
        const flickCycle = t % 5.5;
        if (flickCycle < 0.6) {
          const flick = Math.sin(t * 28) * 0.18;
          leftWingPivot.rotation.set(0, flick * 0.5, flick);
          rightWingPivot.rotation.set(0, -flick * 0.5, -flick);
        } else {
          leftWingPivot.rotation.set(0, 0, Math.sin(t * 3.8) * 0.004);
          rightWingPivot.rotation.set(0, 0, -Math.sin(t * 3.8) * 0.004);
        }
      }

      // 前足步态与搓手
      const turningSpeed = Math.abs(targetRad - currentYaw);
      if (currentRecoil > 0.28) {
        frontLeftPivot.rotation.set(-0.7 - Math.sin(t * 25) * 0.15, 0, 0.5);
        frontRightPivot.rotation.set(-0.7 - Math.cos(t * 25) * 0.15, 0, -0.5);
      } else if (turningSpeed > 0.04) {
        const legGait = Math.sin(t * 12) * 0.35;
        frontLeftPivot.rotation.set(legGait, 0, 0.08);
        frontRightPivot.rotation.set(-legGait, 0, -0.08);
      } else {
        const cycle = t % 7;
        if (cycle < 2.8) {
          const rub = Math.sin(t * 16) * 0.28;
          frontLeftPivot.rotation.set(-0.28 + rub, 0, 0.22 + Math.cos(t * 16) * 0.08);
          frontRightPivot.rotation.set(-0.28 - rub, 0, -0.22 - Math.cos(t * 16) * 0.08);
        } else {
          frontLeftPivot.rotation.set(Math.sin(t * 4.2) * 0.03, 0, 0.05);
          frontRightPivot.rotation.set(Math.sin(t * 3.9 + 1.2) * 0.03, 0, -0.05);
        }
      }

      // 给脑着色器注入时间与空间刺激
      if (brainMat) {
        brainMat.uniforms.uTime.value = t;
        brainMat.uniforms.uStimX.value = stim.x;
        brainMat.uniforms.uLooming.value = stim.isLooming ? 1.0 : 0.0;
      }

      // 脑电位更新
      const curSig = signalRef.current;
      if (brainGeom && curSig?.values) {
        activityAttr.fill(0);
        for (let i = 0; i < curSig.values.length; i++) {
          const [bId, v] = curSig.values[i];
          const idx = idToIndex.get(bId);
          if (idx !== undefined) activityAttr[idx] = v;
        }
        brainGeom.getAttribute("activity").needsUpdate = true;
      }

      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      controller.abort();
      resizeObserver.disconnect();
      element.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [atlas]);

  return (
    <div className="unified-workbench-container">
      {/* 3D 渲染主画布 */}
      <div ref={host} className="unified-viewport" aria-label="赛博生物透视镜全景视窗" />

      {/* 快捷交互操作胶囊栏 */}
      <div className="workbench-floating-actions">
        <button
          type="button"
          className="looming-trigger-btn"
          onClick={() => {
            if (onStimulusMove) {
              onStimulusMove({
                ...stimRef.current,
                isLooming: true,
              });
              setTimeout(() => {
                if (onStimulusMove) {
                  onStimulusMove({
                    ...stimRef.current,
                    isLooming: false,
                  });
                }
              }, 650);
            }
          }}
        >
          🚨 突袭避障测试 (Looming Escape)
        </button>
      </div>

      {/* 神经元射线拾取探针浮窗 */}
      {hoveredNeuron && (
        <div className="neuron-hover-card unified-card">
          <div className="neuron-card-header">
            <strong>🔬 真实神经元探针</strong>
            <span className="neuron-id">Body ID: {hoveredNeuron.bodyId}</span>
          </div>
          <div className="neuron-card-body">
            <div>解剖脑区：{hoveredNeuron.groupName}</div>
            <div>体内三维坐标：({hoveredNeuron.x}, {hoveredNeuron.y}, {hoveredNeuron.z})</div>
            <div>放电活性：{hoveredNeuron.activity > 0 ? `⚡ 放电中 (${hoveredNeuron.activity})` : "微弱自发静息态"}</div>
          </div>
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
