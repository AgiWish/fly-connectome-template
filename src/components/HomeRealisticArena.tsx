import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { asset, type Atlas } from "../lib/atlas";
import type { ActivityFrame } from "../lib/replay";
import type { LifeDiagnostics } from "../lib/autonomous-fly-life";

type Props = {
  atlas: Atlas;
  frame: ActivityFrame | null;
  diagnostics: LifeDiagnostics | null;
  macroCamera: boolean;
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

// 精确微观比例足底触地常量 (基于 scale = 0.28)
const FLY_FEET_GROUND_OFFSET = 0.026;

export function HomeRealisticArena({
  atlas,
  frame,
  diagnostics,
  macroCamera,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  const signalRef = useRef(frame);
  const diagRef = useRef(diagnostics);
  const macroRef = useRef(macroCamera);

  useEffect(() => { signalRef.current = frame; }, [frame]);
  useEffect(() => { diagRef.current = diagnostics; }, [diagnostics]);
  useEffect(() => { macroRef.current = macroCamera; }, [macroCamera]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const controller = new AbortController();
    let disposed = false;

    // 1. 单一主场景 (极度轻量稳定，防 OOM 崩溃)
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e141c);
    scene.fog = new THREE.FogExp2(0x0e141c, 0.85);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 12);
    camera.position.set(0.18, 0.26, 0.38);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "default",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    element.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // 防止穿入桌面底下
    controls.minDistance = 0.05;
    controls.maxDistance = 1.2;

    // 2. 真实昼夜灯光体系 (随现实时间变化色温与明暗)
    const ambientLight = new THREE.AmbientLight(0xdbe8f5, 1.6);
    scene.add(ambientLight);

    const mainSpot = new THREE.SpotLight(0xfff7ea, 7.5);
    mainSpot.position.set(0.35, 1.1, 0.45);
    mainSpot.angle = Math.PI / 3.6;
    mainSpot.penumbra = 0.5;
    mainSpot.castShadow = true;
    mainSpot.shadow.mapSize.width = 1024;
    mainSpot.shadow.mapSize.height = 1024;
    mainSpot.shadow.bias = -0.0002;
    scene.add(mainSpot);

    const fillLight = new THREE.DirectionalLight(0x7eaad4, 1.4);
    fillLight.position.set(-0.8, 0.7, -0.5);
    scene.add(fillLight);

    // 3. 实木桌面 (Oak Wood with Fine Grain)
    const tableGeom = new THREE.BoxGeometry(1.5, 0.04, 1.1);
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#8a5832";
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = "rgba(50, 28, 12, 0.1)";
    for (let i = 0; i < 512; i += 2) {
      ctx.fillRect(0, i, 512, 1.2);
    }
    const woodTex = new THREE.CanvasTexture(canvas);
    woodTex.wrapS = THREE.RepeatWrapping;
    woodTex.wrapT = THREE.RepeatWrapping;
    woodTex.repeat.set(3, 2);

    const tableMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      roughness: 0.32,
      metalness: 0.03,
    });
    const table = new THREE.Mesh(tableGeom, tableMat);
    table.position.y = -0.02;
    table.receiveShadow = true;
    scene.add(table);

    // 4. 立体白瓷果盘 (具有厚度与盘唇弧度)
    const saucerGroup = new THREE.Group();
    saucerGroup.position.set(0.28, 0.001, -0.1);
    scene.add(saucerGroup);

    // 盘底
    const plateGeom = new THREE.CylinderGeometry(0.12, 0.09, 0.008, 48);
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.1,
      metalness: 0.08,
    });
    const plate = new THREE.Mesh(plateGeom, plateMat);
    plate.castShadow = true;
    plate.receiveShadow = true;
    saucerGroup.add(plate);

    // 盘唇边缘弧圈 (Torus Rim)
    const rimGeom = new THREE.TorusGeometry(0.118, 0.005, 16, 48);
    const rim = new THREE.Mesh(rimGeom, plateMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.005;
    saucerGroup.add(rim);

    // 5. 新鲜立体苹果切片 (Apple Slice)
    const appleGroup = new THREE.Group();
    appleGroup.position.set(0, 0.008, 0);
    saucerGroup.add(appleGroup);

    const fleshGeom = new THREE.SphereGeometry(0.034, 20, 16, 0, Math.PI);
    const fleshMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.45 });
    const appleFlesh = new THREE.Mesh(fleshGeom, fleshMat);
    appleFlesh.rotation.x = Math.PI / 2;
    appleFlesh.castShadow = true;
    appleGroup.add(appleFlesh);

    const skinGeom = new THREE.SphereGeometry(0.0346, 20, 16, 0, Math.PI, 0, Math.PI / 3);
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xd91b42, roughness: 0.22 });
    const appleSkin = new THREE.Mesh(skinGeom, skinMat);
    appleSkin.rotation.x = Math.PI / 2;
    appleSkin.castShadow = true;
    appleGroup.add(appleSkin);

    // 晶莹微小反光水滴 (Water Droplets on Table)
    const dropMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.95,
      opacity: 1,
      transparent: true,
      roughness: 0.02,
      ior: 1.33,
    });
    const drop1 = new THREE.Mesh(new THREE.SphereGeometry(0.004, 12, 12), dropMat);
    drop1.position.set(-0.06, 0.002, 0.08);
    scene.add(drop1);

    const drop2 = new THREE.Mesh(new THREE.SphereGeometry(0.003, 12, 12), dropMat);
    drop2.position.set(0.14, 0.0015, 0.12);
    scene.add(drop2);

    // 6. 精巧微缩果蝇机体 (精巧灵动，真实 2~3mm 微缩感)
    const flyRoot = new THREE.Group();
    scene.add(flyRoot);

    const frontLeftPivot = new THREE.Group();
    const frontRightPivot = new THREE.Group();
    const leftWingPivot = new THREE.Group();
    const rightWingPivot = new THREE.Group();

    flyRoot.add(frontLeftPivot);
    flyRoot.add(frontRightPivot);
    flyRoot.add(leftWingPivot);
    flyRoot.add(rightWingPivot);

    const materials: Record<string, THREE.Material> = {};
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
      materials[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    }
    materials.membrane = new THREE.MeshStandardMaterial({
      color: 0xc4daf0,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.2,
    });

    const allocatedGeoms: THREE.BufferGeometry[] = [];

    // 加载果蝇网格
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
            allocatedGeoms.push(gL);
            const mL = new THREE.Mesh(gL, materials.membrane);
            mL.castShadow = true;
            mL.position.set(-pWL[0], -pWL[1], -pWL[2]);
            leftWingPivot.add(mL);

            const gR = new THREE.BufferGeometry();
            gR.setAttribute("position", new THREE.BufferAttribute(rawPos, 3));
            gR.setIndex(rightTris);
            gR.computeVertexNormals();
            allocatedGeoms.push(gR);
            const mR = new THREE.Mesh(gR, materials.membrane);
            mR.castShadow = true;
            mR.position.set(-pWR[0], -pWR[1], -pWR[2]);
            rightWingPivot.add(mR);
            continue;
          }

          const geom = new THREE.BufferGeometry();
          geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buffer.slice(part.positionByteOffset, part.positionByteOffset + part.positionCount * 12)), 3));
          geom.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer.slice(part.indexByteOffset, part.indexByteOffset + part.indexCount * 4)), 1));
          geom.computeVertexNormals();
          allocatedGeoms.push(geom);
          const mesh = new THREE.Mesh(geom, materials[part.material] ?? materials.body);
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          if (part.group === "front_left") {
            mesh.position.set(-pFL[0], -pFL[1], -pFL[2]);
            frontLeftPivot.add(mesh);
          } else if (part.group === "front_right") {
            mesh.position.set(-pFR[0], -pFR[1], -pFR[2]);
            frontRightPivot.add(mesh);
          } else {
            flyRoot.add(mesh);
          }
        }

        // 精巧微观真实比例缩放 (scale = 0.28)
        flyRoot.scale.setScalar(0.28);
        leftWingPivot.rotation.set(0.05, -0.22, 0.04);
        rightWingPivot.rotation.set(0.05, 0.22, -0.04);
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    })();

    // 7. 窗口自适应
    const fit = () => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();

    // 8. 物理生活动画与微单摄影机循环
    let frameId = 0;
    let prev = performance.now();
    let smoothTarget = new THREE.Vector3(0, 0, 0);

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const t = now / 1000;

      const diag = diagRef.current;
      if (diag) {
        // 昼夜光照微调
        const hour = diag.timeOfDayHour;
        if (hour >= 22 || hour < 6.5) {
          // 夜间模式：月光蓝调
          mainSpot.intensity = 2.5;
          mainSpot.color.setHex(0xaecae8);
          ambientLight.intensity = 0.9;
        } else if (hour >= 17 && hour < 20) {
          // 黄昏金色暖阳
          mainSpot.intensity = 8.5;
          mainSpot.color.setHex(0xffe2b8);
          ambientLight.intensity = 1.5;
        } else {
          // 白天明亮自然光
          mainSpot.intensity = 7.5;
          mainSpot.color.setHex(0xfffaed);
          ambientLight.intensity = 1.6;
        }

        // 果蝇坐标与触地高度
        const targetY = diag.currentPos.y + FLY_FEET_GROUND_OFFSET;
        flyRoot.position.set(diag.currentPos.x, targetY, diag.currentPos.z);
        flyRoot.rotation.y = (diag.headingDeg * Math.PI) / 180;

        // 睡眠与飞行姿态
        if (diag.isSleeping) {
          // 伏地睡眠：翅膀紧合，触角低垂，极其微弱呼吸
          const sleepBreath = Math.sin(t * 1.5) * 0.003;
          leftWingPivot.rotation.set(0.06, -0.25, 0.03 + sleepBreath);
          rightWingPivot.rotation.set(0.06, 0.25, -0.03 - sleepBreath);
          frontLeftPivot.rotation.set(0.08, 0, 0.04);
          frontRightPivot.rotation.set(0.08, 0, -0.04);
          flyRoot.position.y -= 0.002; // 贴近桌面卧倒
        } else if (diag.isAirborne || diag.wingFlappingHz > 100) {
          // 飞行振翅
          const flap = Math.sin(t * 55) * 0.45;
          leftWingPivot.rotation.set(-0.2, 0.35 + Math.cos(t * 55) * 0.2, 0.4 + flap);
          rightWingPivot.rotation.set(-0.2, -0.35 - Math.cos(t * 55) * 0.2, -0.4 - flap);
        } else if (diag.stage === "grooming_wings") {
          // 刷理双翅
          const flick = Math.sin(t * 26) * 0.16;
          leftWingPivot.rotation.set(0.05, -0.22 + flick * 0.5, 0.04 + flick);
          rightWingPivot.rotation.set(0.05, 0.22 - flick * 0.5, -0.04 - flick);
        } else {
          // 常态收翅
          const breathing = Math.sin(t * 3.5) * 0.006;
          leftWingPivot.rotation.set(0.05, -0.24, 0.04 + breathing);
          rightWingPivot.rotation.set(0.05, 0.24, -0.04 - breathing);
        }

        // 前足步态与搓脸
        if (!diag.isSleeping) {
          if (diag.stage === "grooming_face") {
            const rub = Math.sin(t * 18) * 0.26;
            frontLeftPivot.rotation.set(-0.32 + rub, 0, 0.22 + Math.cos(t * 18) * 0.08);
            frontRightPivot.rotation.set(-0.32 - rub, 0, -0.22 - Math.cos(t * 18) * 0.08);
          } else if (diag.stage === "feeding") {
            frontLeftPivot.rotation.set(Math.sin(t * 8) * 0.06, 0, 0.04);
            frontRightPivot.rotation.set(Math.cos(t * 8) * 0.06, 0, -0.04);
          } else if (diag.stage === "wandering" || diag.stage === "approaching_food") {
            const legGait = Math.sin(t * 14) * 0.32;
            frontLeftPivot.rotation.set(legGait, 0, 0.06);
            frontRightPivot.rotation.set(-legGait, 0, -0.06);
          } else {
            frontLeftPivot.rotation.set(0, 0, 0.04);
            frontRightPivot.rotation.set(0, 0, -0.04);
          }
        }

        // 微单微距跟拍摄像机 (更舒适的跟拍距离)
        if (macroRef.current) {
          smoothTarget.lerp(new THREE.Vector3(diag.currentPos.x, targetY + 0.008, diag.currentPos.z), 0.05);
          controls.target.copy(smoothTarget);

          const idealCam = new THREE.Vector3(
            diag.currentPos.x + 0.09,
            targetY + 0.09,
            diag.currentPos.z + 0.14
          );
          camera.position.lerp(idealCam, 0.035);
        }
      }

      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      controller.abort();
      observer.disconnect();
      controls.dispose();
      allocatedGeoms.forEach(g => g.dispose());
      tableGeom.dispose();
      tableMat.dispose();
      plateGeom.dispose();
      rimGeom.dispose();
      plateMat.dispose();
      fleshGeom.dispose();
      fleshMat.dispose();
      skinGeom.dispose();
      skinMat.dispose();
      woodTex.dispose();
      dropMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="home-arena-container full-terrarium">
      <div ref={host} className="home-viewport" aria-label="全屏沉浸微观生态缸" />
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
