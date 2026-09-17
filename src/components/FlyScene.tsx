import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { asset } from '../lib/atlas';

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

type Props = {
  headingDeg?: number;
  recoil?: number;
  motorActive?: boolean;
};

/** An anatomical body view driven by biomimetic locomotion, wing flapping, and neural commands. */
export function FlyScene({ headingDeg = 0, recoil = 0, motorActive = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const targetHeading = useRef(headingDeg);
  const targetRecoil = useRef(recoil);

  useEffect(() => {
    targetHeading.current = headingDeg;
    targetRecoil.current = recoil;
  }, [headingDeg, recoil]);

  useEffect(() => {
    const element = host.current!;
    const controller = new AbortController();
    let disposed = false;
    const scene = new THREE.Scene();
    const modelRoot = new THREE.Group();
    scene.add(modelRoot);

    // 肢体与翅膀关节枢轴层级
    const frontLeftPivot = new THREE.Group();
    const frontRightPivot = new THREE.Group();
    const leftWingPivot = new THREE.Group();
    const rightWingPivot = new THREE.Group();

    modelRoot.add(frontLeftPivot);
    modelRoot.add(frontRightPivot);
    modelRoot.add(leftWingPivot);
    modelRoot.add(rightWingPivot);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.001, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.append(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;

    scene.add(new THREE.HemisphereLight(0xffedda, 0x18202a, 3.2));
    const light = new THREE.DirectionalLight(0xffdfb2, 4.2);
    light.position.set(2, 3, 4);
    scene.add(light);

    const materials: Record<string, THREE.Material> = {};
    const colors: Record<string, number> = {
      body: 0x9e6834,
      black: 0x15110e,
      red: 0xad331f,
      ocelli: 0xe6b351,
      'bristle-brown': 0x281c10,
      lower: 0xbb8949,
      brown: 0x52351f,
    };
    for (const [key, color] of Object.entries(colors)) {
      materials[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.65 });
    }
    materials.membrane = new THREE.MeshStandardMaterial({
      color: 0xc2d8ec,
      transparent: true,
      opacity: 0.48,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.2,
      metalness: 0.1,
    });

    let radius = 0.3;
    let corners: THREE.Vector3[] = [];

    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      camera.aspect = width / Math.max(1, height);
      const fov = Math.min(
        (camera.fov * Math.PI) / 180,
        2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect)
      );
      camera.position
        .set(0.35, 1.25, 2.2)
        .normalize()
        .multiplyScalar((radius / Math.sin(fov / 2)) * 1.15);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      controls.update();
      draw();
    };

    const draw = () => {
      if (corners.length) {
        camera.zoom = 1;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        const projected = corners.map(point => point.clone().project(camera));
        const extent = Math.max(...projected.flatMap(point => [Math.abs(point.x), Math.abs(point.y)]));
        camera.zoom = 1 / (extent * 1.12);
        camera.updateProjectionMatrix();
      }
      renderer.render(scene, camera);
    };

    controls.addEventListener('change', draw);

    void (async () => {
      const get = async (path: string) => {
        const r = await fetch(asset(`data/flybody/${path}`), { signal: controller.signal });
        if (!r.ok) throw Error('果蝇身体资源加载失败');
        return r;
      };
      try {
        const meta = (await (await get('model.json')).json()) as Model;
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
          // 独立拆解翅膀（membrane）为左翅与右翅
          if (part.material === 'membrane') {
            const rawPos = new Float32Array(buffer.slice(part.positionByteOffset, part.positionByteOffset + part.positionCount * 12));
            const rawIndices = new Uint32Array(buffer.slice(part.indexByteOffset, part.indexByteOffset + part.indexCount * 4));

            const leftTris: number[] = [];
            const rightTris: number[] = [];
            for (let i = 0; i < rawIndices.length; i += 3) {
              const i0 = rawIndices[i], i1 = rawIndices[i + 1], i2 = rawIndices[i + 2];
              const avgX = (rawPos[i0 * 3] + rawPos[i1 * 3] + rawPos[i2 * 3]) / 3;
              if (avgX < 0) {
                leftTris.push(i0, i1, i2);
              } else {
                rightTris.push(i0, i1, i2);
              }
            }

            // 构建左翅
            const geomLeft = new THREE.BufferGeometry();
            geomLeft.setAttribute('position', new THREE.BufferAttribute(rawPos, 3));
            geomLeft.setIndex(leftTris);
            geomLeft.computeVertexNormals();
            const meshLeft = new THREE.Mesh(geomLeft, materials.membrane);
            meshLeft.position.set(-pWL[0], -pWL[1], -pWL[2]);
            leftWingPivot.add(meshLeft);

            // 构建右翅
            const geomRight = new THREE.BufferGeometry();
            geomRight.setAttribute('position', new THREE.BufferAttribute(rawPos, 3));
            geomRight.setIndex(rightTris);
            geomRight.computeVertexNormals();
            const meshRight = new THREE.Mesh(geomRight, materials.membrane);
            meshRight.position.set(-pWR[0], -pWR[1], -pWR[2]);
            rightWingPivot.add(meshRight);
            continue;
          }

          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(
              new Float32Array(buffer.slice(part.positionByteOffset, part.positionByteOffset + part.positionCount * 12)),
              3
            )
          );
          geometry.setIndex(
            new THREE.BufferAttribute(
              new Uint32Array(buffer.slice(part.indexByteOffset, part.indexByteOffset + part.indexCount * 4)),
              1
            )
          );
          geometry.computeVertexNormals();
          const mesh = new THREE.Mesh(geometry, materials[part.material] ?? materials.body);

          if (part.group === 'front_left') {
            mesh.position.set(-pFL[0], -pFL[1], -pFL[2]);
            frontLeftPivot.add(mesh);
          } else if (part.group === 'front_right') {
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
        corners = [
          new THREE.Vector3(box.min.x, box.min.y, box.min.z),
          new THREE.Vector3(box.min.x, box.min.y, box.max.z),
          new THREE.Vector3(box.min.x, box.max.y, box.min.z),
          new THREE.Vector3(box.min.x, box.max.y, box.max.z),
          new THREE.Vector3(box.max.x, box.min.y, box.min.z),
          new THREE.Vector3(box.max.x, box.min.y, box.max.z),
          new THREE.Vector3(box.max.x, box.max.y, box.min.z),
          new THREE.Vector3(box.max.x, box.max.y, box.max.z),
        ];
        resize();
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    })();

    const observer = new ResizeObserver(resize);
    observer.observe(element);

    let frameId = 0;
    let currentYaw = 0;
    let currentRecoil = 0;

    const loop = () => {
      if (disposed) return;
      const t = performance.now() / 1000;

      // 1. 神经驱动朝向与惊吓冲量平滑更新
      const targetRad = (targetHeading.current * Math.PI) / 180;
      currentYaw += (targetRad - currentYaw) * 0.14;
      currentRecoil += (targetRecoil.current - currentRecoil) * 0.2;

      // 2. 自发生物生命微律动 (呼吸起伏与张望微颤)
      const breathing = Math.sin(t * 3.8) * 0.012;
      const fidgetYaw = Math.sin(t * 0.9) * 0.04 + Math.sin(t * 2.3) * 0.015;
      const fidgetPitch = Math.sin(t * 1.3) * 0.02;

      modelRoot.rotation.y = currentYaw + fidgetYaw;
      modelRoot.rotation.x = -currentRecoil * 0.5 + breathing + fidgetPitch;
      modelRoot.position.y = currentRecoil * 0.08 + Math.sin(t * 3.8) * 0.003;

      // 3. 翅膀振翅动力学 (Wing Flapping & Flicking Dynamics)
      if (currentRecoil > 0.25) {
        // 🚨 逃逸反射：两翅向外展开并高频扇翅振动 (200Hz 级逼真极速振动)
        const flap = Math.sin(t * 45) * 0.45;
        leftWingPivot.rotation.z = 0.4 + flap;
        leftWingPivot.rotation.y = 0.35 + Math.cos(t * 45) * 0.2;
        leftWingPivot.rotation.x = -0.2;

        rightWingPivot.rotation.z = -0.4 - flap;
        rightWingPivot.rotation.y = -0.35 - Math.cos(t * 45) * 0.2;
        rightWingPivot.rotation.x = -0.2;
      } else {
        // 待机自发微动：果蝇每隔 5 秒自主抖翅梳理 (Wing Flicking)
        const flickCycle = t % 5.5;
        if (flickCycle < 0.65) {
          const flick = Math.sin(t * 28) * 0.16;
          leftWingPivot.rotation.z = flick;
          leftWingPivot.rotation.y = flick * 0.5;
          rightWingPivot.rotation.z = -flick;
          rightWingPivot.rotation.y = -flick * 0.5;
        } else {
          // 静止微呼吸贴合在背部
          const wingRest = Math.sin(t * 3.8) * 0.005;
          leftWingPivot.rotation.set(0, 0, wingRest);
          rightWingPivot.rotation.set(0, 0, -wingRest);
        }
      }

      // 4. 前足步态与搓手行为
      const turningSpeed = Math.abs(targetRad - currentYaw);
      if (currentRecoil > 0.3) {
        // 惊吓姿态
        frontLeftPivot.rotation.x = -0.7 - Math.sin(t * 25) * 0.15;
        frontLeftPivot.rotation.z = 0.5;
        frontRightPivot.rotation.x = -0.7 - Math.cos(t * 25) * 0.15;
        frontRightPivot.rotation.z = -0.5;
      } else if (turningSpeed > 0.05) {
        // 迈步转向
        const legGait = Math.sin(t * 12) * 0.35;
        frontLeftPivot.rotation.x = legGait;
        frontLeftPivot.rotation.z = 0.08;
        frontRightPivot.rotation.x = -legGait;
        frontRightPivot.rotation.z = -0.08;
      } else {
        // 自主搓手
        const cycle = t % 7;
        if (cycle < 2.8) {
          const rub = Math.sin(t * 16) * 0.28;
          frontLeftPivot.rotation.x = -0.28 + rub;
          frontLeftPivot.rotation.z = 0.22 + Math.cos(t * 16) * 0.08;
          frontRightPivot.rotation.x = -0.28 - rub;
          frontRightPivot.rotation.z = -0.22 - Math.cos(t * 16) * 0.08;
        } else {
          frontLeftPivot.rotation.x = Math.sin(t * 4.2) * 0.03;
          frontLeftPivot.rotation.z = 0.05;
          frontRightPivot.rotation.x = Math.sin(t * 3.9 + 1.2) * 0.03;
          frontRightPivot.rotation.z = -0.05;
        }
      }

      draw();
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      controller.abort();
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <>
      <div ref={host} className="three-viewport fly-viewport" aria-label="Flybody 果蝇身体解剖网格" />
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
