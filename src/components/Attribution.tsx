import { asset } from '../lib/atlas';

/** Required by LICENSE. You may restyle or relocate this credit, but keep it readable and linked. */
export function Attribution() {
  return <footer><span>基于 <a href="https://github.com/cobanov/fly-connectome-template">fly-connectome-template</a> 构建 · 作者 <a href="https://github.com/cobanov">Mert Cobanov</a> · <a href={asset("TEMPLATE-LICENSE.txt")}>许可证</a></span><span>数据：<a href="https://male-cns.janelia.org/">MaleCNS · CC BY 4.0</a> · 身体：<a href="https://github.com/TuragaLab/flybody">Flybody · Apache 2.0</a></span></footer>;
}
