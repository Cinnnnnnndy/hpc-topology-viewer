import { CockpitApp } from './CockpitApp';
import { SceneVisualProfileContext } from '../scene/visual-profile';

// workbench.html 现渲染「统一驾驶舱」（CockpitApp）取代原 ClusterView 工作台内容。
// ClusterView 本体不动，index.html 主应用不受影响。
export function WorkbenchApp() {
  return (
    <SceneVisualProfileContext.Provider value="opRankTime">
      <CockpitApp />
    </SceneVisualProfileContext.Provider>
  );
}
