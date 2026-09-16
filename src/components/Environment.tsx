/** Replace this component with your game, video, sensor feed or Gymnasium frontend. */
export function Environment({time}:{time:number}) {
  const x = 160 + Math.sin(time*.7)*100;
  return <div className="environment">
    <svg viewBox="0 0 320 320" role="img" aria-label="示例视觉刺激：网格上一个移动的光点">
      <defs><pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#242a30" strokeWidth=".5"/></pattern></defs>
      <rect width="320" height="320" fill="url(#grid)"/>
      <circle cx={x} cy="160" r="18" fill="#d5dce3"/>
      <path d="M160 150v20m-10-10h20" stroke="#566170"/>
    </svg>
    <p>示例视觉刺激</p><span>把这里替换成你的游戏或环境。当前这个光点不会驱动任何神经模型。</span>
  </div>;
}
