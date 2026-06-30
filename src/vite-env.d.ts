/// <reference types="vite/client" />

declare module '*workbench-shell/pattern.js';

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
}
