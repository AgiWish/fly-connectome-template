import { useEffect, useRef, useState } from 'react';
import { BrainScene } from './components/BrainScene';
import { FlyScene } from './components/FlyScene';
import { Environment } from './components/Environment';
import { Attribution } from './components/Attribution';
import { asset, loadAtlas, type Atlas } from './lib/atlas';
import { frameAt, parseReplay, type ModelReplay } from './lib/replay';

const KIND_LABEL: Record<ModelReplay['source']['kind'], string> = {
  synthetic: '合成演示',
  predicted: '模型预测',
  measured: '实测数据',
};

export function App() {
  const [atlas,setAtlas] = useState<Atlas|null>(null);
  const [error,setError] = useState('');
  const [replay,setReplay] = useState<ModelReplay|null>(null);
  const [playing,setPlaying] = useState(true), [time,setTime] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const duration = replay?.frames.at(-1)?.time ?? 30;
  useEffect(() => {
    const abort = new AbortController();
    void loadAtlas(abort.signal).then(setAtlas).catch(e=>{if(!abort.signal.aborted)setError(String(e));});
    return () => abort.abort();
  },[]);
  useEffect(() => {
    if(!playing) return;
    let previous = performance.now(), frame = 0;
    const step = (now:number) => {
      const delta = document.hidden ? 0 : Math.min(.1,(now-previous)/1000); previous=now;
      setTime(value => Math.min(duration,value+delta));
      frame=requestAnimationFrame(step);
    };
    frame=requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  },[playing,duration]);
  useEffect(()=>{if(time>=duration)setPlaying(false);},[time,duration]);
  const accept = (value:unknown) => {
    if(!atlas) throw Error('请稍候，脑图谱还在加载中。');
    const validated = parseReplay(value,atlas.visibleIds);
    setReplay(validated);setTime(0);setPlaying(false);setError('');
  };
  const example = async () => {
    try {const response=await fetch(asset('examples/model-output.example.json'));if(!response.ok)throw Error('示例数据加载失败。');accept(await response.json());}
    catch(e){setError(String(e));}
  };
  const frame = replay ? frameAt(replay,time) : null;
  return <>
    <header><h1>果蝇大脑实验台</h1><span>环境刺激 / 解剖结构 / 模型输出</span><a href="https://github.com/cobanov/fly-connectome-template#readme">模板使用指南 ↗</a></header>
    <main>
      <p className="intro">这是一个果蝇大脑可视化工作台：左边是<b>刺激环境</b>（当前只是一个示例光点，可以换成你的游戏）；中间是雄性果蝇神经系统的 <b>12.4 万个真实神经元胞体</b> 3D 图谱（MaleCNS v1.0 实测数据）；右边是果蝇<b>身体</b>解剖模型。点击「加载合成示例」再点「播放」，就能看到神经活动信号在大脑里随时间亮起。注意：它本身不会产生神经活动，只负责把你喂给它的模型输出画出来。</p>
      <div className="toolbar">
        <span className="status">{playing?'运行中':'已暂停'} · {time.toFixed(2)} 秒</span>
        <div className="controls">
          <button onClick={()=>{setTime(0);setPlaying(false);}}>重置</button>
          <button onClick={()=>{if(time>=duration)setTime(0);setPlaying(!playing);}}>{playing?'暂停':'播放'}</button>
          <button disabled={!atlas} onClick={()=>void example()}>加载合成示例</button>
          <button disabled={!atlas} onClick={()=>file.current?.click()}>加载模型 JSON</button>
          {replay&&<button onClick={()=>{setReplay(null);setTime(0);setPlaying(false);}}>清除输出</button>}
          <input ref={file} hidden type="file" accept=".json,application/json" onChange={async event=>{
            const selected=event.target.files?.[0];event.target.value='';if(!selected)return;
            try {if(selected.size>10*1024*1024)throw Error('回放文件不能超过 10 MB。');accept(JSON.parse(await selected.text()));} catch(e){setError(String(e));}
          }}/>
        </div>
      </div>
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="workbench">
        <section className="panel environment-panel"><h2>01 / 环境刺激</h2><Environment time={time}/><div className="panel-bottom">通用刺激 · 未内置游戏或奖励机制</div></section>
        <section className="panel brain-panel"><h2>02 / 大脑胞体图谱 <span>MaleCNS v1.0</span></h2>
          {atlas?<BrainScene atlas={atlas} frame={frame}/>:<p className="loading" role="status">正在加载实测解剖数据…</p>}
          <div className="panel-bottom">{atlas?.visibleIds.size.toLocaleString('zh-CN') ?? '…'} 个实测胞体 <a href={asset('data/brain-atlas/NOTICE.md')}>数据说明 ↗</a></div>
        </section>
        <section className="panel fly-panel"><h2>03 / 身体 <span>Flybody</span></h2><FlyScene/><div className="panel-bottom">解剖网格 · 无运动仿真 <span>拖动可旋转</span></div></section>
      </div>
      <section className="model-status" aria-label="模型来源说明">
        <strong>{replay ? `${KIND_LABEL[replay.source.kind]}输出` : '仅解剖结构'}</strong>
        <p>{replay ? replay.source.name : '未连接任何神经模型，默认不会生成神经活动。'}</p>
        {replay&&<><p>归一化方式：{replay.source.normalization}</p><p>{replay.source.kind==='synthetic'?'当前只是演示数值：不是真实神经活动，也不由左侧刺激驱动。':'来源类别由上传文件自行声明，本查看器不做独立验证。'}</p></>}
        <label>实验时间 <input type="range" aria-label="实验时间" min="0" max={duration} step=".01" value={time} onChange={event=>setTime(Number(event.target.value))}/><span>{duration.toFixed(1)} 秒</span></label>
      </section>
      <details><summary>科学边界与自定义说明</summary><p>图谱只包含经过整理的胞体位置，不包含神经突形态或突触连接；点位保持原始比例，缺失的胞体位置不会被编造。大脑过滤器只选取视叶、中央脑和下行神经元类别，并不是完整的脑分割。</p><p>把 Environment.tsx 替换成你的环境；用 MaleCNS 胞体 ID 和以秒为单位的时间，把 ActivityFrame 活动帧传给 BrainScene。JSON 加载器会校验数据集、可见 ID 和归一化数值。GPU 训练和模型推理需要在本查看器之外单独运行。</p><p>数据集贡献者：FlyEM / HHMI Janelia、剑桥大学、MRC 分子生物学实验室和 Google Research。<a href="https://male-cns.janelia.org/download/">MaleCNS 数据与论文</a>，CC BY 4.0。<a href={asset('data/brain-atlas/manifest.json')}>确切来源、过滤条件与哈希值</a>。</p><p>模板代码采用自定义的署名要求许可证：请在你的网页 UI 和仓库 README 中保留模板/作者的署名链接。第三方资源保留其各自许可证。</p></details>
    </main>
    <Attribution/>
  </>;
}
