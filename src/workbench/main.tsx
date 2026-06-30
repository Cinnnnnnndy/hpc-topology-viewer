import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkbenchApp } from './WorkbenchApp';
import '../styles/pto.css';
import '../../../pto-design-system/patterns/workbench-shell/pattern.css';
import '../../../pto-design-system/patterns/workbench-shell/pattern.js';
import '../styles/workbench.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkbenchApp />
  </StrictMode>,
);
