import { useEffect, useRef, useState } from 'react';
import { HomeRealisticArena } from './components/HomeRealisticArena';
import { UnifiedXRayWorkbench } from './components/UnifiedXRayWorkbench';
import { MacDesktopFlyPet } from './components/MacDesktopFlyPet';
import { Attribution } from './components/Attribution';
import { asset, loadAtlas, type Atlas } from './lib/atlas';
import { frameAt, parseReplay, type ModelReplay, type ActivityFrame } from './lib/replay';
import {
  AutonomousFlyLifeEngine,
  type LifeDiagnostics,
} from './lib/autonomous-fly-life';
import {
  LiveBrainEngine,
  type StimulusInput,
  type ThoughtDiagnostics,
} from './lib/live-brain';

type Mode = 'desktop_pet' | 'home_life' | 'xray_lab' | 'replay';

const KIND_LABEL: Record<ModelReplay['source']['kind'], string> = {
  synthetic: '合成演示',
  predicted: '模型预测',
  measured: '实测数据',
};

const isElectron = typeof window !== 'undefined' && (
  window.navigator.userAgent.includes('Electron') ||
  window.location.search.includes('mode=pet')
);

export function App() {
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('desktop_pet');

  // 家居写实生活引擎
  const lifeEngineRef = useRef<AutonomousFlyLifeEngine | null>(null);
  // 高频帧数据走 ref（渲染组件按帧读取 current），避免 60fps React 重渲染整棵组件树
  const [lifeDiag, setLifeDiag] = useState<LifeDiagnostics | null>(null);
  const [macroCamera, setMacroCamera] = useState(true);

  // 生活大事记抽屉展开状态
  const [showDiaryDrawer, setShowDiaryDrawer] = useState(false);

  // X-Ray 实验室引擎状态
  const xRayEngineRef = useRef<LiveBrainEngine | null>(null);
  const [xrayOpacity, setXrayOpacity] = useState(0.55);
  const [stimulus, setStimulus] = useState<StimulusInput>({
    x: 0,
    y: 0,
    speed: 0,
    isLooming: false,
    interactive: false,
  });
  const stimulusRef = useRef(stimulus);
  useEffect(() => { stimulusRef.current = stimulus; }, [stimulus]);
  const xrayFrameRef = useRef<ActivityFrame | null>(null);
  const [xrayDiag, setXrayDiag] = useState<ThoughtDiagnostics | null>(null);

  // 离线数据回放状态
  const [replay, setReplay] = useState<ModelReplay | null>(null);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const duration = replay?.frames.at(-1)?.time ?? 30;

  // 初始化加载 MaleCNS 真实解剖图谱
  useEffect(() => {
    const abort = new AbortController();
    void loadAtlas(abort.signal)
      .then(loaded => {
        setAtlas(loaded);
        lifeEngineRef.current = new AutonomousFlyLifeEngine(loaded);
        xRayEngineRef.current = new LiveBrainEngine(loaded);
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, []);

  // 真实家居生活循环 (完全自主常驻挂机)
  useEffect(() => {
    if (mode !== 'home_life' || !atlas) return;
    let frameId = 0;
    let prev = performance.now();
    let lastUiUpdate = 0;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;

      if (lifeEngineRef.current) {
        const res = lifeEngineRef.current.step(dt, true);
        if (now - lastUiUpdate > 250) {
          lastUiUpdate = now;
          setLifeDiag(res.diagnostics);
        }
      }
      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [mode, atlas]);

  // X-Ray 实验室交互循环
  useEffect(() => {
    if (mode !== 'xray_lab' || !atlas) return;
    let frameId = 0;
    let prev = performance.now();
    let lastUiUpdate = 0;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;

      if (xRayEngineRef.current) {
        const res = xRayEngineRef.current.step(stimulusRef.current, dt);
        xrayFrameRef.current = res.frame;
        if (now - lastUiUpdate > 250) {
          lastUiUpdate = now;
          setXrayDiag(res.diagnostics);
        }
      }
      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [mode, atlas]);

  // 回放模式循环
  useEffect(() => {
    if (mode !== 'replay' || !playing) return;
    let previous = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const delta = document.hidden ? 0 : Math.min(0.1, (now - previous) / 1000);
      previous = now;
      setTime(value => Math.min(duration, value + delta));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [mode, playing, duration]);

  useEffect(() => {
    if (mode === 'replay' && time >= duration) setPlaying(false);
  }, [mode, time, duration]);

  const acceptReplay = (value: unknown) => {
    if (!atlas) throw Error('请稍候，脑图谱还在加载中。');
    const validated = parseReplay(value, atlas.visibleIds);
    setReplay(validated);
    setTime(0);
    setPlaying(false);
    setError('');
    setMode('replay');
  };

  const loadSyntheticExample = async () => {
    try {
      const response = await fetch(asset('examples/model-output.example.json'));
      if (!response.ok) throw Error('示例数据加载失败。');
      acceptReplay(await response.json());
    } catch (e) {
      setError(String(e));
    }
  };

  // 格式化累计陪伴时长
  const totalSeconds = lifeDiag?.persistentData.totalActiveSeconds ?? 0;
  const companionDays = Math.floor(totalSeconds / 86400);
  const companionHours = Math.floor((totalSeconds % 86400) / 3600);
  const companionMins = Math.floor((totalSeconds % 3600) / 60);

  // 桌面宠物全透明模式时切换 body 样式
  useEffect(() => {
    if (mode === 'desktop_pet') {
      document.body.classList.add('desktop-pet-mode');
      document.documentElement.classList.add('desktop-pet-mode');
    } else {
      document.body.classList.remove('desktop-pet-mode');
      document.documentElement.classList.remove('desktop-pet-mode');
    }
  }, [mode]);

  // 原生桌面透明宠物模式 (Electron 或极简挂机)
  if (mode === 'desktop_pet') {
    return atlas ? (
      <div style={{ position: 'relative', width: '100vw', height: '100vh', background: 'transparent' }}>
        <MacDesktopFlyPet atlas={atlas} />
        {!isElectron && (
          <button
            type="button"
            style={{
              position: 'fixed',
              top: 10,
              left: 10,
              zIndex: 9999,
              opacity: 0.6,
              fontSize: 10,
              background: 'rgba(15,23,42,0.7)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
            onClick={() => setMode('home_life')}
          >
            ← 返回完整工作台
          </button>
        )}
      </div>
    ) : (
      <div style={{ color: '#94a3b8', padding: 20, fontSize: 11, background: 'transparent' }}>
        正在同步 MaleCNS 真实神经元并降临 Mac 桌面…
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* 顶部现代化毛玻璃导航 */}
      <header className="glass-header">
        <div className="brand-group">
          <h1>微观生态数字生命 · 果蝇全天候伴侣</h1>
          <span className="subtitle">MaleCNS 124,289 实测神经元 · 真实昼夜生物节律 · 数据永久保留</span>
        </div>

        <div className="header-controls">
          <div className="mode-toggle">
            <button
              type="button"
              className=""
              onClick={() => setMode('desktop_pet')}
              title="切换为 100% 透明轻量悬浮宠物形态"
            >
              🖥️ 桌面透明宠物
            </button>
            <button
              type="button"
              className={mode === 'home_life' ? 'active-mode' : ''}
              onClick={() => setMode('home_life')}
            >
              🏡 真实微观生活 (挂机)
            </button>
            <button
              type="button"
              className={mode === 'xray_lab' ? 'active-mode' : ''}
              onClick={() => setMode('xray_lab')}
            >
              🔬 赛博透视镜
            </button>
            <button
              type="button"
              className={mode === 'replay' ? 'active-mode' : ''}
              onClick={() => setMode('replay')}
            >
              📁 数据回放
            </button>
          </div>

          {mode === 'home_life' && (
            <button
              type="button"
              className={`diary-toggle-btn ${showDiaryDrawer ? 'btn-active' : ''}`}
              onClick={() => setShowDiaryDrawer(!showDiaryDrawer)}
            >
              📖 生活大事记 ({lifeDiag?.persistentData.events.length ?? 0})
            </button>
          )}

          {mode === 'xray_lab' && (
            <div className="xray-control-box">
              <label>
                🔍 透视：
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={xrayOpacity}
                  onChange={e => setXrayOpacity(Number(e.target.value))}
                />
              </label>
            </div>
          )}
        </div>
      </header>

      {/* 主视窗舞台 */}
      <main className="immersive-stage">
        {mode === 'home_life' ? (
          atlas ? (
            <div className="home-stage-wrapper">
              <HomeRealisticArena
                atlas={atlas}
                diagnostics={lifeDiag}
                macroCamera={macroCamera}
              />

              {/* 悬浮生活状态卡片 (右上方毛玻璃) */}
              <div className="floating-pet-card">
                <div className="pet-card-title">
                  <span className="pet-name">🪰 {lifeDiag?.persistentData.name ?? '小飞'}</span>
                  <span className="pet-age">
                    陪伴 {companionDays > 0 ? `${companionDays}天 ` : ''}
                    {companionHours > 0 ? `${companionHours}小时 ` : ''}
                    {companionMins}分钟
                  </span>
                </div>
                <div className="pet-status-row">
                  <span className="status-label">当前状态：</span>
                  <span className="status-value">{lifeDiag?.stageName ?? '漫步中'}</span>
                </div>
                <div className="pet-stat-bar">
                  <span>饱腹感：</span>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{ width: `${Math.round((1 - (lifeDiag?.hunger ?? 0)) * 100)}%` }}
                    />
                  </div>
                  <span className="progress-num">{Math.round((1 - (lifeDiag?.hunger ?? 0)) * 100)}%</span>
                </div>
                <div className="pet-metrics-grid">
                  <div>爬行步数：<b>{(lifeDiag?.persistentData.totalSteps ?? 0).toLocaleString()}</b></div>
                  <div>进食次数：<b>{lifeDiag?.persistentData.totalFeeds ?? 0} 次</b></div>
                  <div>飞行里程：<b>{(lifeDiag?.persistentData.totalFlightMeters ?? 0).toFixed(1)} 米</b></div>
                  <div>睡眠时长：<b>{Math.round(lifeDiag?.persistentData.totalSleepMinutes ?? 0)} 分</b></div>
                </div>
              </div>

              {/* 悬浮底部工具栏 */}
              <div className="floating-bottom-bar">
                <button
                  type="button"
                  className={`macro-btn ${macroCamera ? 'macro-active' : ''}`}
                  onClick={() => setMacroCamera(!macroCamera)}
                >
                  📹 微距电影跟拍：{macroCamera ? '开' : '关'}
                </button>
                <div className="live-event-ticker">
                  <b>🕒 最新动向：</b> {lifeDiag?.diaryMessage ?? '在餐桌上自然踱步嗅探…'}
                </div>
                <div className="time-badge">
                  {((lifeDiag?.timeOfDayHour ?? 12) >= 22 || (lifeDiag?.timeOfDayHour ?? 12) < 6.5)
                    ? '🌙 静谧夜间月光'
                    : ((lifeDiag?.timeOfDayHour ?? 12) >= 17 && (lifeDiag?.timeOfDayHour ?? 12) < 20)
                    ? '🌅 傍晚金色余晖'
                    : '☀️ 室内暖阳'}
                </div>
              </div>
            </div>
          ) : (
            <div className="loading-container">
              <p className="loading">正在组装微观生活生态与 12.4 万全脑神经星系…</p>
            </div>
          )
        ) : mode === 'xray_lab' ? (
          atlas ? (
            <UnifiedXRayWorkbench
              atlas={atlas}
              frame={xrayFrameRef}
              stimulus={stimulus}
              diagnostics={xrayDiag}
              xrayOpacity={xrayOpacity}
              onStimulusMove={setStimulus}
            />
          ) : null
        ) : (
          atlas ? (
            <UnifiedXRayWorkbench
              atlas={atlas}
              frame={replay ? frameAt(replay, time) : null}
              stimulus={stimulus}
              diagnostics={null}
              xrayOpacity={0.65}
            />
          ) : null
        )}

        {/* 右侧滑出式生活大事记抽屉 (Life Diary Drawer) */}
        {showDiaryDrawer && (
          <aside className="diary-drawer" aria-label="生活大事记抽屉">
            <div className="drawer-header">
              <h3>📖 果蝇生活大事记</h3>
              <button
                type="button"
                className="close-drawer-btn"
                onClick={() => setShowDiaryDrawer(false)}
              >
                ✕
              </button>
            </div>
            <p className="drawer-desc">
              数据保存在本地浏览器中，记录这只小生命的每一个真实生活瞬间。
            </p>
            <div className="timeline-list">
              {(lifeDiag?.persistentData.events ?? []).map(ev => (
                <div key={ev.id} className={`timeline-item type-${ev.type}`}>
                  <div className="timeline-meta">
                    <span className="timeline-time">{ev.timeStr}</span>
                    <span className="timeline-tag">{ev.title}</span>
                  </div>
                  <div className="timeline-detail">{ev.detail}</div>
                </div>
              ))}
            </div>
          </aside>
        )}
      </main>

      {error && <p className="error" role="alert">{error}</p>}
      <Attribution />
    </div>
  );
}
