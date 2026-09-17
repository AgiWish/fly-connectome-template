import { useEffect, useRef, useState } from 'react';
import type { StimulusInput } from '../lib/live-brain';

type Props = {
  time: number;
  interactive?: boolean;
  onStimulusChange?: (stimulus: StimulusInput) => void;
};

export function Environment({ time, interactive = true, onStimulusChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [isLooming, setIsLooming] = useState(false);
  const lastPos = useRef({ x: 160, y: 160, time: performance.now() });

  // 默认自动运动位置
  const autoX = 160 + Math.sin(time * 0.9) * 110;
  const autoY = 160 + Math.cos(time * 0.45) * 35;

  const currentX = mousePos ? mousePos.x : autoX;
  const currentY = mousePos ? mousePos.y : autoY;

  // 归一化到 [-1, 1] 坐标系 (160 为中心点)
  const normX = Math.max(-1, Math.min(1, (currentX - 160) / 120));
  const normY = Math.max(-1, Math.min(1, (currentY - 160) / 120));

  useEffect(() => {
    if (!onStimulusChange) return;

    const now = performance.now();
    const dt = Math.max(0.001, (now - lastPos.current.time) / 1000);
    const dx = currentX - lastPos.current.x;
    const dy = currentY - lastPos.current.y;
    const speed = Math.hypot(dx, dy) / dt;
    lastPos.current = { x: currentX, y: currentY, time: now };

    onStimulusChange({
      x: normX,
      y: normY,
      speed,
      isLooming,
      interactive: !!mousePos,
    });
  }, [currentX, currentY, isLooming, normX, normY, mousePos, onStimulusChange]);

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scaleX = 320 / rect.width;
    const scaleY = 320 / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    setMousePos({ x: Math.max(20, Math.min(300, x)), y: Math.max(20, Math.min(300, y)) });
  };

  const handlePointerLeave = () => {
    setMousePos(null);
    setIsLooming(false);
  };

  const triggerLooming = () => {
    setIsLooming(true);
    setTimeout(() => setIsLooming(false), 600);
  };

  return (
    <div className="environment interactive-env">
      <svg
        ref={svgRef}
        viewBox="0 0 320 320"
        role="img"
        aria-label="交互式视觉刺激视网膜"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={triggerLooming}
      >
        <defs>
          <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0H0V32" fill="none" stroke="#242a30" strokeWidth=".5" />
          </pattern>
          <radialGradient id="lightGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="40%" stopColor="#5bc0eb" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#5bc0eb" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="loomingGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff3366" stopOpacity="1" />
            <stop offset="60%" stopColor="#880e4f" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#ff3366" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="320" height="320" fill="url(#grid)" />

        {/* 视网膜视野指示与注视十字 */}
        <circle cx="160" cy="160" r="120" fill="none" stroke="#1f2d3d" strokeWidth="1" strokeDasharray="4 4" />
        <path d="M160 140v40m-20-20h40" stroke="#374151" strokeWidth="1.5" />

        {/* 视刺激光斑 */}
        <circle
          cx={currentX}
          cy={currentY}
          r={isLooming ? 56 : 28}
          fill={isLooming ? 'url(#loomingGlow)' : 'url(#lightGlow)'}
          style={{ transition: isLooming ? 'r 0.12s ease-out' : 'none' }}
        />
        <circle
          cx={currentX}
          cy={currentY}
          r={isLooming ? 24 : 10}
          fill={isLooming ? '#ff3366' : '#ffffff'}
          style={{ transition: isLooming ? 'r 0.12s ease-out' : 'none' }}
        />

        {/* 交互提示 */}
        <text x="160" y="300" textAnchor="middle" fill="#758295" fontSize="11" pointerEvents="none">
          {isLooming ? '🚨 巨物突袭阴影 (Looming)！' : mousePos ? '🎯 鼠标引导光斑位置' : '移动鼠标悬停引导光斑 · 点击触发避障'}
        </text>
      </svg>
      <div className="stimulus-actions">
        <button
          className="stimulus-btn"
          type="button"
          onClick={triggerLooming}
          title="模拟鸟类俯冲或捕食者快速靠近"
        >
          模拟天敌突袭 (Looming 避障)
        </button>
      </div>
      <p><b>实时视觉刺激输入</b></p>
      <span>在网格内移动鼠标，果蝇视叶神经元将实时随方位感知并驱动转身。</span>
    </div>
  );
}
