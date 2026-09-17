import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Atlas } from "../lib/atlas";
import type { ActivityFrame } from "../lib/replay";
import type { LifeDiagnostics } from "../lib/autonomous-fly-life";

type Props = {
  atlas: Atlas;
  frame: ActivityFrame | null;
  diagnostics: LifeDiagnostics | null;
  onClose: () => void;
  onStimulate: (type: "giant_fiber" | "sucrose" | "apple" | "home") => void;
};

type ThoughtLog = {
  id: number;
  time: string;
  circuit: string;
  message: string;
  color: string;
};

export function NeuralThoughtCockpit({
  atlas,
  frame,
  diagnostics,
  onClose,
  onStimulate,
}: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [logs, setLogs] = useState<ThoughtLog[]>([]);
  const logIdRef = useRef(0);
  const lastStageRef = useRef<string>("");

  // 将高频变化的 props 存入 ref，供 Three.js 动画循环内部直接读取，避免销毁 WebGL
  const frameRef = useRef<ActivityFrame | null>(frame);
  frameRef.current = frame;

  const diagnosticsRef = useRef<LifeDiagnostics | null>(diagnostics);
  diagnosticsRef.current = diagnostics;

  // 记录意识流日志
  useEffect(() => {
    if (!diagnostics) return;
    const nowStr = new Date().toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    if (diagnostics.stage !== lastStageRef.current) {
      lastStageRef.current = diagnostics.stage;
      let circuit = "中枢中继";
      let color = "#38bdf8";

      if (diagnostics.stage === "flying") {
        circuit = "GF/逃逸起飞回路";
        color = "#fbbf24";
      } else if (diagnostics.stage === "approaching_food") {
        circuit = "嗅觉天线叶(AL) ➔ 罗盘";
        color = "#34d399";
      } else if (diagnostics.stage === "feeding") {
        circuit = "甜感受器 ➔ 多巴胺奖赏";
        color = "#f472b6";
      } else if (diagnostics.stage === "grooming_face" || diagnostics.stage === "grooming_wings") {
        circuit = "DNg11 肢体模式发生器";
        color = "#a78bfa";
      } else if (diagnostics.stage === "sleeping") {
        circuit = "昼夜节律钟 (PDF/DN1)";
        color = "#94a3b8";
      }

      const newLog: ThoughtLog = {
        id: ++logIdRef.current,
        time: nowStr,
        circuit,
        message: diagnostics.diaryMessage,
        color,
      };

      setLogs((prev) => [newLog, ...prev.slice(0, 24)]);
    }
  }, [diagnostics]);

  // 3D 脑星云渲染 (仅初始化一次，绝不随 frame 重新销毁重建)
  useEffect(() => {
    const container = canvasRef.current;
    if (!container || !atlas) return;

    // 清理遗留子元素
    container.innerHTML = "";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0.6, 3.2);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false, // 关键：使用不透明画布，杜绝透过系统桌面微信或网页
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x070b14, 1.0); // 纯黑夜空实底，荧光粒子对比度极高且不穿透
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.0;
    controls.minDistance = 1.0;
    controls.maxDistance = 6.0;
    controls.target.set(0, 0, 0);

    // 提取并归一化全脑神经元坐标
    const visibleCount = atlas.visibleIds.size;
    const xyzArr = new Float32Array(visibleCount * 3);
    const groupsArr = new Float32Array(visibleCount);
    const randSeeds = new Float32Array(visibleCount);
    const bodyIdsArr = new Uint32Array(visibleCount);

    const bounds = new THREE.Box3();
    let ptr = 0;
    for (let i = 0; i < atlas.ids.length; i++) {
      if (atlas.groups[i] >= 3) continue;
      const x = atlas.positions[i * 3];
      const y = atlas.positions[i * 3 + 1];
      const z = atlas.positions[i * 3 + 2];
      const pt = new THREE.Vector3(x, -y, -z);
      xyzArr[ptr * 3] = pt.x;
      xyzArr[ptr * 3 + 1] = pt.y;
      xyzArr[ptr * 3 + 2] = pt.z;
      groupsArr[ptr] = atlas.groups[i];
      bodyIdsArr[ptr] = atlas.ids[i];
      randSeeds[ptr] = ((atlas.ids[i] * 16807) % 2147483647) / 2147483647;
      bounds.expandByPoint(pt);
      ptr++;
    }

    const brainCenter = bounds.getCenter(new THREE.Vector3());
    const brainSize = bounds.getSize(new THREE.Vector3());
    const maxDim = Math.max(brainSize.x, brainSize.y, brainSize.z) || 1;
    const normScale = 2.8 / maxDim;

    for (let i = 0; i < visibleCount; i++) {
      xyzArr[i * 3] = (xyzArr[i * 3] - brainCenter.x) * normScale;
      xyzArr[i * 3 + 1] = (xyzArr[i * 3] - brainCenter.y) * normScale;
      xyzArr[i * 3 + 2] = (xyzArr[i * 3] - brainCenter.z) * normScale;
    }

    const idToIndex = new Map<number, number>();
    for (let i = 0; i < visibleCount; i++) {
      idToIndex.set(bodyIdsArr[i], i);
    }

    const brainGeom = new THREE.BufferGeometry();
    brainGeom.setAttribute("position", new THREE.BufferAttribute(xyzArr, 3));
    brainGeom.setAttribute("groupType", new THREE.BufferAttribute(groupsArr, 1));
    brainGeom.setAttribute("seed", new THREE.BufferAttribute(randSeeds, 1));
    const activityAttr = new Float32Array(visibleCount);
    brainGeom.setAttribute("activity", new THREE.BufferAttribute(activityAttr, 1));

    // 高精全脑发光星云着色器 (加法混合模式，纯黑底色，璀璨夺目)
    const brainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        pixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uTime: { value: 0 },
        uStageAct: { value: 0 },
        uStageGroup: { value: -1.0 },
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
        uniform float uStageAct;
        uniform float uStageGroup;

        void main() {
          vGroup = groupType;

          // 1. GPU 端并行自发微脉冲行波 (完全免 CPU 开销，120fps 极速呼吸)
          float wave = sin(position.x * 4.2 + position.y * 3.1 + position.z * 2.5 + uTime * 2.6 + seed * 6.28);
          vSpontaneous = pow(max(0.0, wave), 4.5) * 0.55;

          // 2. 行为回路阶段性协同激发
          float stageBoost = 0.0;
          if (abs(groupType - uStageGroup) < 0.5) {
            stageBoost = uStageAct * (0.65 + 0.35 * sin(uTime * 8.0 + seed * 10.0));
          }

          vActivity = max(activity, stageBoost);

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          // 精准点尺寸：常态下饱满清晰，放电时高亮放大
          float baseSize = 2.0 + vSpontaneous * 1.0;
          if (vActivity > 0.05) {
            baseSize = 3.2 + vActivity * 3.2;
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

          // 解剖脑区色彩：
          // group 0 (视觉/感觉触角叶): 亮翡翠绿
          // group 1 (中央复合体/蘑菇体): 荧光粉紫
          // group 2 (降行运动神经元/巨纤维): 太阳金黄
          vec3 baseColor = vec3(0.12, 0.55, 0.95);
          if (vGroup < 0.5) {
            baseColor = vec3(0.05, 0.85, 0.65);
          } else if (vGroup >= 0.5 && vGroup < 1.5) {
            baseColor = vec3(0.78, 0.35, 1.0);
          } else {
            baseColor = vec3(1.0, 0.65, 0.15);
          }

          vec3 sponColor = mix(baseColor, vec3(0.55, 0.92, 1.0), vSpontaneous);

          // 动作电位强烈爆发时的电火花
          vec3 activeColor = vec3(0.3, 1.0, 1.0);
          if (vGroup >= 0.5 && vGroup < 1.5) {
            activeColor = vec3(1.0, 0.65, 1.0);
          } else if (vGroup >= 1.5) {
            activeColor = vec3(1.0, 0.95, 0.4);
          }

          vec3 color = mix(sponColor, activeColor, vActivity);
          color = mix(color, vec3(1.0), smoothstep(0.5, 0.95, vActivity));

          float radial = 1.0 - smoothstep(0.12, 0.5, r);
          float totalEnergy = max(vActivity, vSpontaneous * 0.7);
          float alpha = (0.55 + 0.45 * totalEnergy) * radial;

          gl_FragColor = vec4(color, alpha);
        }
      `,
    });

    const points = new THREE.Points(brainGeom, brainMat);
    scene.add(points);

    // 视口自适应
    const fit = () => {
      if (!container) return;
      const w = container.clientWidth || 360;
      const h = container.clientHeight || 420;
      renderer.setSize(w, h, true);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(fit);
    observer.observe(container);
    fit();

    let frameId = 0;
    let lastProcessedFrame: ActivityFrame | null = null;

    const animate = (timeMs: number) => {
      controls.update();
      const t = timeMs / 1000;
      brainMat.uniforms.uTime.value = t;

      // 依据果蝇动作行为，驱动对应脑区放电
      const currentStage = diagnosticsRef.current?.stage ?? "wandering";
      let stageGroup = -1.0;
      let stageAct = 0.0;
      if (currentStage === "flying") {
        stageGroup = 2.0;
        stageAct = 0.95;
      } else if (currentStage === "approaching_food") {
        stageGroup = 0.0;
        stageAct = 0.85;
      } else if (currentStage === "feeding") {
        stageGroup = 1.0;
        stageAct = 0.75;
      } else if (currentStage === "grooming_face" || currentStage === "grooming_wings") {
        stageGroup = 2.0;
        stageAct = 0.7;
      }

      brainMat.uniforms.uStageGroup.value = stageGroup;
      brainMat.uniforms.uStageAct.value = stageAct;

      // 关键性能优化：只在新帧到达时单次更新 Buffer，彻底消除 CPU 60fps 密集循环与显存总线争用
      const curFrame = frameRef.current;
      if (curFrame && curFrame !== lastProcessedFrame) {
        lastProcessedFrame = curFrame;
        if (curFrame.values && curFrame.values.length > 0) {
          const actAttr = brainGeom.getAttribute("activity") as THREE.BufferAttribute;
          const actArray = actAttr.array as Float32Array;
          actArray.fill(0);
          for (let i = 0; i < curFrame.values.length; i++) {
            const [bId, v] = curFrame.values[i];
            const idx = idToIndex.get(bId);
            if (idx !== undefined) {
              actArray[idx] = v;
            }
          }
          actAttr.needsUpdate = true;
        }
      }

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      brainGeom.dispose();
      brainMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [atlas]); // 仅在图谱挂载时初始化一次，杜绝上下文丢失

  const activeCount = frame?.values?.length ?? 0;
  const hungerPct = Math.round((diagnostics?.hunger ?? 0) * 100);
  const energyPct = Math.round((diagnostics?.energy ?? 1) * 100);
  const flapHz = diagnostics?.wingFlappingHz ?? 0;

  return (
    <div className="neural-thought-cockpit">
      <div className="cockpit-header">
        <div className="cockpit-title-group">
          <span className="cockpit-dot" />
          <h3 className="cockpit-title">果蝇神经元实时思考监控舱</h3>
          <span className="cockpit-subtitle">FlyWire v783 & MaleCNS 闭环生命电位</span>
        </div>
        <div className="cockpit-header-right">
          <span className="cockpit-shortcut-hint">⌨️ 快捷键: Cmd+Shift+B</span>
          <button
            type="button"
            className="cockpit-close-btn"
            onClick={onClose}
            title="关闭监控舱 (可在果蝇身旁随时再次打开)"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="cockpit-body">
        <div className="cockpit-viewport-panel">
          <div className="cockpit-panel-badge">
            🧬 3D 真实脑连接组放电星云 ({atlas?.visibleIds?.size?.toLocaleString() ?? "23,210"} 神经元)
          </div>

          <div ref={canvasRef} className="cockpit-canvas" />

          {/* 脑区色彩图例 */}
          <div className="cockpit-brain-legend">
            <span className="legend-chip sensory">🟢 感觉/触角叶</span>
            <span className="legend-chip central">🟣 认知/蘑菇体</span>
            <span className="legend-chip motor">🟠 运动/巨纤维</span>
          </div>

          <div className="cockpit-canvas-overlay">
            <div className="metric-row">
              <span className="pill-metric">
                ⚡️ 活跃放电通道: <b>{activeCount}</b> 处
              </span>
              <span className="pill-metric">
                🪰 振翅频率: <b>{flapHz} Hz</b>
              </span>
            </div>
            <span className="hint-text">🖱️ 鼠标拖拽 360° 旋转 | 滚轮缩放查看神经核团</span>
          </div>
        </div>

        <div className="cockpit-info-panel">
          <div className="cockpit-section">
            <div className="section-title">📊 生理回路实时指标</div>
            <div className="telemetry-grid">
              <div className="telemetry-card">
                <span className="t-label">饥饿度</span>
                <div className="t-bar-wrap">
                  <div className="t-bar hunger" style={{ width: `${hungerPct}%` }} />
                </div>
                <span className="t-val">{hungerPct}%</span>
              </div>
              <div className="telemetry-card">
                <span className="t-label">生物体力</span>
                <div className="t-bar-wrap">
                  <div className="t-bar energy" style={{ width: `${energyPct}%` }} />
                </div>
                <span className="t-val">{energyPct}%</span>
              </div>
            </div>
          </div>

          <div className="cockpit-section thought-section">
            <div className="section-title">🧠 神经意识独白流 (Live Monologue)</div>
            <div className="thought-stream">
              {logs.length === 0 ? (
                <div className="empty-stream">正在监听 12.4 万突触电位传导…</div>
              ) : (
                logs.map((item) => (
                  <div key={item.id} className="thought-item">
                    <div className="thought-meta">
                      <span className="t-time">{item.time}</span>
                      <span className="t-circuit" style={{ borderColor: item.color, color: item.color }}>
                        {item.circuit}
                      </span>
                    </div>
                    <div className="thought-msg">{item.message}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 实时神经刺激注入控制台 (固定常驻底部，绝不被独白流挤出视口) */}
          <div className="cockpit-section stim-section">
            <div className="section-title">⚡️ 实时神经刺激注入 (Stimulus Injection)</div>
            <div className="stim-actions">
              <button
                type="button"
                className="stim-btn danger"
                onClick={() => onStimulate("giant_fiber")}
                title="高电位刺激巨纤维 (Giant Fiber)，瞬间激活逃逸回路并惊飞"
              >
                ⚡️ 刺激巨纤维 (惊飞)
              </button>
              <button
                type="button"
                className="stim-btn primary"
                onClick={() => onStimulate("apple")}
                title="注入乙酸乙酯/挥发果香，激活触角叶寻食趋化回路"
              >
                🍎 释放苹果果香
              </button>
              <button
                type="button"
                className="stim-btn warning"
                onClick={() => onStimulate("sucrose")}
                title="投喂蔗糖分子，激活甜味感受突触与多巴胺奖赏"
              >
                💧 投喂蔗糖水
              </button>
              <button
                type="button"
                className="stim-btn secondary"
                onClick={() => onStimulate("home")}
                title="中央罗盘校准至老巢航向，召回灵动岛休整"
              >
                🏝️ 回灵动岛
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
