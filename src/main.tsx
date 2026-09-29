/*! © 2026 王欣迪 (Cindy_wxd) · SPDX-License-Identifier: Apache-2.0 · 使用、修改或再分发须保留本署名与 NOTICE（https://github.com/Cinnnnnnndy/hpc-topology-viewer） */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/pto.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
