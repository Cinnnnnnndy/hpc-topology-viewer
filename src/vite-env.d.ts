/// <reference types="vite/client" />

declare module '*workbench-shell/pattern.js';
declare module '*aic-core-object/pattern.js';
declare module '*aiv-core-object/pattern.js';
declare module '*memory-architecture/pattern.js';

type PtoWorkbenchSplitDirection = 'horizontal' | 'vertical';

interface PtoWorkbenchResizablePanes {
  destroy(): void;
  getSizes(): number[];
  setSizes(nextSizes: number[]): void;
  refresh(): void;
}

interface PtoWorkbenchResizeMeta {
  phase: 'start' | 'drag' | 'end' | 'api' | 'refresh';
  event?: Event;
  direction: PtoWorkbenchSplitDirection;
}

interface PtoWorkbenchResizablePaneOptions {
  root?: Element | string;
  panes?: Array<Element | string>;
  direction?: PtoWorkbenchSplitDirection;
  sizes?: number[];
  defaultSize?: number[];
  minSize?: number | number[];
  gutterSize?: number;
  storageKey?: string;
  gutterLabel?: string;
  keyboard?: boolean;
  keyboardStep?: number;
  onResize?: (sizes: number[], meta: PtoWorkbenchResizeMeta) => void;
}

interface Window {
  PtoWorkbenchShell?: {
    initResizablePanes(options?: PtoWorkbenchResizablePaneOptions): PtoWorkbenchResizablePanes;
  };
  /** pto-design-system patterns/aic-core-object（vendored，全局注册） */
  PtoAicCorePattern?: Record<string, any>;
  /** pto-design-system patterns/aiv-core-object（vendored，全局注册） */
  PtoAivCorePattern?: Record<string, any>;
  /** pto-design-system patterns/memory-architecture（vendored，全局注册）
   *  L0 Core-Group 芯片内架构 pattern：GM/L2 轨道 + AIV1/AIC/AIV2 + MTE/FixPipe 路由。 */
  PtoMemoryArchitecturePattern?: {
    renderArchitecture(container: Element, presetOrKey?: any): void;
    createRouteOverlay(container: Element, presetOrKey?: any): { render(): void; update?(): void; schedule?(): void; destroy(): void } | null;
    attachHoverInteractions?(container: Element, presetOrKey?: any, options?: any): { setViewportScale?(z: number): void; destroy?(): void } | null;
    attachPathFocusInteractions?(container: Element, presetOrKey?: any, options?: any): { destroy?(): void } | null;
    setDetailVisibility?(container: Element, visible: boolean): void;
    setAivFolded?(container: Element, folded: boolean): void;
    setPathFocus?(container: Element, presetOrKey: any, payload: { selectors?: string[]; routes?: string[]; errorSelectors?: string[] }): void;
    clearPathFocus?(container: Element): void;
    setBufferBlocks?(root: Element, blocks: Array<{ core: string; buffer: string; label?: string; state?: string; tone?: string; cellRange?: [number, number]; sourceTile?: string }>): void;
    clearBufferBlocks?(root: Element): void;
    createZoomController?(options: any): { render?(): void; getZoom?(): number; getPan?(): { x: number; y: number }; setZoom?(z: number): void; setPan?(x: number, y: number): void; center?(): void; zoomAtPoint?(z: number, x: number, y: number): void; reset?(): void; destroy?(): void } | null;
  };
}
