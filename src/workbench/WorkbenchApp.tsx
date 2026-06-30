import { ClusterView } from '../view/ClusterView';
import { SceneVisualProfileContext } from '../scene/visual-profile';

export function WorkbenchApp() {
  return (
    <SceneVisualProfileContext.Provider value="opRankTime">
      <ClusterView chrome="workbench" />
    </SceneVisualProfileContext.Provider>
  );
}
