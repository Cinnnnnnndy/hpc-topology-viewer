/**
 * CubeCockpit — 「立方重排」工作区：内嵌 AI Infra 统一 3D 拓扑驾驶舱原型（v22）。
 *
 * 原型是一份自包含的 vanilla Three.js（r128）应用，功能完整（物理机房 3D 拓扑、L7→L0 层级
 * 下钻、场景副本/巡检/MoE 越界/慢 DP/单机深潜/部署审视、TP/PP/EP/DP 连线镜头、演练回放、
 * 5 种立方形态重排…）。为 100% 保留其全部功能，这里以 iframe 挂载静态资源
 * `public/cube-cockpit.html`，而非把 2600 行 Three.js 逐行改写成 React-Three-Fiber。
 *
 * 「统一适配」：
 *   · 原型本就用 PTO 对齐的色板（--sys-* / --dv-*，蓝 #4369EF·绿 #04D793·橙 #FFAA3B·红 #FF4B7B），
 *     与本项目 pto.css 基本一致；
 *   · 明暗主题随宿主项目联动 —— 初始经 `?theme=` 注入，切换时 postMessage 通知原型内的 applyTheme。
 */
import { useEffect, useRef } from 'react';

// Vite base 下的静态资源路径（GitHub Pages 项目页 = /hpc-topology-viewer/cube-cockpit.html）
const COCKPIT_URL = `${import.meta.env.BASE_URL}cube-cockpit.html`;

export function CubeCockpit({ dark }: { dark: boolean }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const theme = dark ? 'dark' : 'light';

  // 主题联动：宿主明暗变化 → postMessage 通知原型（原型内 applyTheme 会同步 data-theme + 3D 雾/光）
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: 'cockpit-theme', theme }, '*');
  }, [theme]);

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 11, background: 'var(--bg)' }}>
      <iframe
        ref={frameRef}
        title="立方重排 · AI Infra 统一驾驶舱"
        // 初始主题经 URL 注入，避免原型先以默认浅色闪一帧再切
        src={`${COCKPIT_URL}?theme=${theme}`}
        onLoad={() => frameRef.current?.contentWindow?.postMessage({ type: 'cockpit-theme', theme }, '*')}
        style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: 'var(--bg)' }}
      />
    </div>
  );
}
