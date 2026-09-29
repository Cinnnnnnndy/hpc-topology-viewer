/*! © 2026 王欣迪 (Cindy_wxd) · SPDX-License-Identifier: Apache-2.0 · 使用、修改或再分发须保留本署名与 NOTICE（https://github.com/Cinnnnnnndy/hpc-topology-viewer） */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkbenchApp } from './WorkbenchApp';
import '../styles/pto.css';
import '../vendor/workbench-shell/pattern.css';
import '../vendor/workbench-shell/pattern.js';
import '../styles/workbench.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkbenchApp />
  </StrictMode>,
);
