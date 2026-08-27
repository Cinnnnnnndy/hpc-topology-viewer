(function attachPtoMoeRouting(globalScope) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function resolveRoot(root) {
    return typeof root === 'string' ? document.querySelector(root) : root;
  }

  function render(rootInput, options = {}) {
    const root = resolveRoot(rootInput);
    if (!root) throw new Error('PtoMoeRouting.render requires a valid root.');
    const dataApi = options.dataApi || globalScope.PtoMoeRoutingData;
    if (!dataApi) throw new Error('PtoMoeRouting requires a routing data provider.');
    const model = options.model || dataApi.MODEL;
    const trace = options.trace || dataApi.createRoutingTrace();
    const validation = dataApi.validateTrace ? dataApi.validateTrace(trace) : { valid: true, errors: [] };
    if (!validation.valid) throw new Error(`Invalid routing trace: ${validation.errors.join(' ')}`);

    const firstLayer = model.moeLayers.includes(options.initialLayer) ? options.initialLayer : model.moeLayers[0];
    const anomalyLayers = new Map((options.anomalyLayers || []).map((entry) => [Number(entry.layer), entry]));
    const state = {
      view: options.initialView === 'journey' ? 'journey' : 'layer',
      layer: firstLayer,
      tokenId: Number.isInteger(options.initialToken) ? Math.max(0, Math.min(model.batchSize - 1, options.initialToken)) : 0,
      activeRanks: new Set(Array.isArray(options.activeRanks) ? options.activeRanks : []),
      language: options.language === 'zh' ? 'zh' : 'en',
      theme: options.theme === 'light' ? 'light' : 'dark',
      scale: 1,
      fitMode: true,
    };
    const showChrome = options.showChrome !== false;
    let activeTooltipTarget = null;
    let panGesture = null;
    let suppressSelection = false;
    let destroyed = false;
    let controller = null;
    let resizeObserver = null;

    root.classList.add('pto-moe-routing');
    root.dataset.theme = state.theme;
    root.innerHTML = `${showChrome ? `
      <header class="pto-moe-routing__toolbar">
        <div class="tab-control" role="tablist" aria-label="MoE routing views">
          <button class="tab-control-item" type="button" role="tab" data-moe-view="layer">单层路由</button>
          <button class="tab-control-item" type="button" role="tab" data-moe-view="journey">Token 整网路径</button>
        </div>
        <div class="pto-moe-routing__stepper">
          <button class="btn btn-icon btn-ghost btn-sm" type="button" data-moe-step="-1" aria-label="Previous">‹</button>
          <span class="toolbar-readout" data-moe-readout></span>
          <button class="btn btn-icon btn-ghost btn-sm" type="button" data-moe-step="1" aria-label="Next">›</button>
          <button class="btn btn-icon btn-ghost btn-sm" type="button" data-moe-theme aria-label="Switch theme">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>
          </button>
        </div>
      </header>` : ''}
      <div class="pto-moe-routing__stage">
        <section class="moe-view" data-moe-panel="layer"><div class="moe-svg-scroll"><svg class="moe-diagram moe-layer-diagram" data-moe-diagram="layer" role="img" aria-label="128 ranks, 256 experts and token dispatch queues at one MoE layer"></svg></div></section>
        <section class="moe-view" data-moe-panel="journey" hidden><div class="moe-svg-scroll"><svg class="moe-diagram moe-journey-diagram" data-moe-diagram="journey" role="img" aria-label="One token routed through all 46 transformer layers"></svg></div></section>
        <div class="moe-tooltip" data-moe-tooltip role="status" hidden></div>
      </div>`;

    const elements = {
      tabs: Array.from(root.querySelectorAll('[data-moe-view]')),
      panels: {
        layer: root.querySelector('[data-moe-panel="layer"]'),
        journey: root.querySelector('[data-moe-panel="journey"]'),
      },
      diagrams: {
        layer: root.querySelector('[data-moe-diagram="layer"]'),
        journey: root.querySelector('[data-moe-diagram="journey"]'),
      },
      stepButtons: Array.from(root.querySelectorAll('[data-moe-step]')),
      readout: root.querySelector('[data-moe-readout]'),
      themeButton: root.querySelector('[data-moe-theme]'),
      tooltip: root.querySelector('[data-moe-tooltip]'),
      stage: root.querySelector('.pto-moe-routing__stage'),
    };

    function svgElement(tag, attributes = {}, text = '') {
      const node = document.createElementNS(SVG_NS, tag);
      Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, String(value)));
      if (text) node.textContent = text;
      return node;
    }

    function append(parent, tag, attributes, text) {
      const node = svgElement(tag, attributes, text);
      parent.appendChild(node);
      return node;
    }

    function tooltipTarget(node, copy, selection) {
      node.dataset.tooltip = copy;
      if (selection) {
        node.dataset.selection = JSON.stringify(selection);
        node.setAttribute('tabindex', '0');
      }
      return node;
    }

    function roundedPath(x1, y1, x2, y2) {
      const bend = Math.max(22, Math.abs(y2 - y1) * 0.24);
      return `M ${x1} ${y1} C ${x1} ${y1 - bend}, ${x2} ${y2 + bend}, ${x2} ${y2}`;
    }

    function renderQueue(group, expertId, load, threshold, isTarget, x, y, rankId, isAnomaly = false) {
      const label = append(group, 'text', { x, y: y + 8, class: `moe-expert-label${isAnomaly ? ' is-anomaly' : ''}` }, `E${expertId}`);
      if (isAnomaly) tooltipTarget(label, `L${state.layer} · R${rankId} · E${expertId} overload: ${load} routed copies`, { type: 'expert', layer: state.layer, expertId, rankId, load, overloaded: true });
      for (let slot = 0; slot < 5; slot += 1) {
        const filled = slot < Math.min(load, 5);
        const overflow = load > threshold && slot === 4;
        const token = append(group, 'circle', {
          cx: x + 34 + slot * 9,
          cy: y + 4.5,
          r: 4.2,
          class: `moe-queue-slot${filled ? ' is-filled' : ''}${overflow ? ' is-overflow' : ''}${isAnomaly ? ' is-anomaly' : ''}`,
        });
        if (overflow) tooltipTarget(token, `E${expertId} overload: ${load} copies > threshold ${threshold.toFixed(1)}`, { type: 'expert', expertId, rankId, load, overloaded: true });
      }
      if (load > 5) {
        const count = append(group, 'text', { x: x + 77, y: y + 8, class: 'moe-queue-count' }, `+${load - 5}`);
        tooltipTarget(count, `E${expertId} overload: ${load} copies > threshold ${threshold.toFixed(1)}`, { type: 'expert', expertId, rankId, load, overloaded: true });
      }
      if (isTarget) append(group, 'circle', { cx: x + 24, cy: y + 4.5, r: 3.2, class: 'moe-dispatch-token' });
    }

    function renderLayerDiagram() {
      const svg = elements.diagrams.layer;
      const layerRoutes = trace.get(state.layer);
      const stats = dataApi.computeLayerStats(layerRoutes);
      const focusRoute = layerRoutes[state.tokenId];
      const targetExperts = new Set(focusRoute.map((route) => route.expertId));
      const targetRanks = new Set(focusRoute.map((route) => route.rankId));
      const layerAnomaly = anomalyLayers.get(state.layer);
      const anomalyRanks = new Set(layerAnomaly?.rankIds || []);
      const anomalyExperts = new Set(layerAnomaly?.expertIds || []);
      const width = 2120;
      const height = 900;
      const gridX = 154;
      const gridY = 50;
      const cardW = 112;
      const cardH = 76;
      const gapX = 8;
      const gapY = 12;
      const routerX = 930;
      const routerY = 790;

      svg.replaceChildren();
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.dataset.logicalWidth = String(width);
      svg.dataset.logicalHeight = String(height);
      append(svg, 'text', { x: gridX, y: 28, class: 'moe-axis-label' }, `R0–R127 · 2 experts / rank · L${state.layer}`);

      for (let rankId = 0; rankId < model.rankCount; rankId += 1) {
        const column = rankId % 16;
        const row = Math.floor(rankId / 16);
        const x = gridX + column * (cardW + gapX);
        const y = gridY + row * (cardH + gapY);
        const ownedExperts = dataApi.expertsForRank ? dataApi.expertsForRank(rankId) : [rankId * model.expertsPerRank, rankId * model.expertsPerRank + 1];
        const [expertA, expertB] = ownedExperts;
        const loadA = stats.expertLoads[expertA];
        const loadB = stats.expertLoads[expertB];
        const hot = loadA > stats.overloadThreshold || loadB > stats.overloadThreshold;
        const idle = loadA + loadB === 0;
        const target = targetRanks.has(rankId);
        const active = state.activeRanks.has(rankId);
        const anomaly = anomalyRanks.has(rankId) || anomalyExperts.has(expertA) || anomalyExperts.has(expertB);
        const group = append(svg, 'g', { 'data-rank': rankId });
        const reason = hot ? 'overload threshold exceeded' : idle ? 'no routed copies' : 'normal load';
        tooltipTarget(group, `R${rankId} · E${expertA}: ${loadA} · E${expertB}: ${loadB} · ${reason}${active ? ' · active traffic slice' : ''}`, {
          type: 'rank', rankId, experts: [expertA, expertB], loads: [loadA, loadB], hot, idle, active,
        });
        append(group, 'rect', {
          x, y, width: cardW, height: cardH, rx: 7,
          class: `moe-rank-card${hot ? ' is-hot' : ''}${idle ? ' is-idle' : ''}${target ? ' is-target' : ''}${active ? ' is-context' : ''}${anomaly ? ' is-anomaly' : ''}`,
        });
        append(group, 'text', { x: x + 7, y: y + 15, class: 'moe-rank-label' }, `R${rankId}`);
        renderQueue(group, expertA, loadA, stats.overloadThreshold, targetExperts.has(expertA), x + 12, y + 27, rankId, anomalyExperts.has(expertA));
        renderQueue(group, expertB, loadB, stats.overloadThreshold, targetExperts.has(expertB), x + 12, y + 50, rankId, anomalyExperts.has(expertB));
      }

      const bank = tooltipTarget(append(svg, 'g'), `${model.batchSize} input tokens at L${state.layer}`, { type: 'token', tokenId: state.tokenId, layer: state.layer });
      append(bank, 'rect', { x: 36, y: 775, width: 168, height: 50, rx: 8, class: 'moe-token-bank' });
      append(bank, 'text', { x: 52, y: 797, class: 'moe-token-title' }, `${model.batchSize} TOKENS`);
      append(bank, 'text', { x: 52, y: 814, class: 'moe-expert-label' }, `T${String(state.tokenId).padStart(3, '0')} highlighted`);
      append(svg, 'path', { d: `M 204 800 H ${routerX}`, class: 'moe-flow-bus' });
      focusRoute.forEach((route, index) => {
        const column = route.rankId % 16;
        const row = Math.floor(route.rankId / 16);
        const targetX = gridX + column * (cardW + gapX) + cardW / 2;
        const targetY = gridY + row * (cardH + gapY) + (route.expertId % 2 === 0 ? 29 : 47);
        const path = tooltipTarget(append(svg, 'path', {
          d: roundedPath(routerX + 12 + index * 14.4, routerY, targetX, targetY), class: 'moe-dispatch-path',
        }), `T${String(state.tokenId).padStart(3, '0')} → E${route.expertId} / R${route.rankId} · weight ${route.weight.toFixed(4)}`, {
          type: 'route', tokenId: state.tokenId, layer: state.layer, ...route,
        });
        path.style.strokeWidth = String(1 + route.weight * 5);
      });
      append(svg, 'rect', { x: routerX, y: routerY, width: 160, height: 58, rx: 8, class: 'moe-router-box' });
      append(svg, 'text', { x: routerX + 21, y: routerY + 21, class: 'moe-router-title' }, 'TOP-8 ROUTER');
      append(svg, 'text', { x: routerX + 42, y: routerY + 43, class: 'moe-expert-label' }, `token T${String(state.tokenId).padStart(3, '0')}`);
      append(svg, 'text', { x: 1120, y: 820, class: 'moe-axis-label' }, 'dispatch → queue → local expert');
    }

    function expertY(expertId) {
      return 62 + expertId * 4.4;
    }

    function renderJourneyDiagram() {
      const svg = elements.diagrams.journey;
      const columnW = 74;
      const startX = 226;
      const width = startX + model.totalLayers * columnW + 90;
      const height = 1300;
      const sharedY = 1230;
      const scenes = [];
      svg.replaceChildren();
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('preserveAspectRatio', 'xMinYMid meet');
      svg.dataset.logicalWidth = String(width);
      svg.dataset.logicalHeight = String(height);
      const input = tooltipTarget(append(svg, 'g'), `${model.batchSize} input tokens · T${String(state.tokenId).padStart(3, '0')} highlighted`, { type: 'token', tokenId: state.tokenId });
      append(input, 'rect', { x: 24, y: 575, width: 168, height: 50, rx: 8, class: 'moe-token-bank' });
      append(input, 'text', { x: 40, y: 597, class: 'moe-token-title' }, `${model.batchSize} TOKENS`);
      append(input, 'text', { x: 40, y: 614, class: 'moe-expert-label' }, `T${String(state.tokenId).padStart(3, '0')} highlighted`);
      append(svg, 'path', { d: `M 192 600 H ${startX - 10}`, class: 'moe-flow-bus' });

      for (let layer = 0; layer < model.totalLayers; layer += 1) {
        const x = startX + layer * columnW;
        const anomaly = anomalyLayers.get(layer);
        const band = append(svg, 'rect', { x, y: 42, width: columnW, height: 1187, class: `moe-layer-band${layer % 2 ? ' is-alternate' : ''}${anomaly ? ' is-anomaly' : ''}` });
        if (anomaly) tooltipTarget(band, anomaly.tooltip || `L${layer} · anomalous routing hotspot`, { type: 'layer-anomaly', layer });
        const layerLabel = append(svg, 'text', { x: x + columnW / 2, y: 28, 'text-anchor': 'middle', class: `moe-layer-label${anomaly ? ' is-anomaly' : ''}` }, `L${layer}`);
        if (anomaly) tooltipTarget(layerLabel, anomaly.tooltip || `L${layer} · anomalous routing hotspot`, { type: 'layer-anomaly', layer });
        if (layer < 2) {
          const dense = tooltipTarget(append(svg, 'g'), `L${layer} · Dense FFN`, { type: 'dense-layer', layer });
          append(dense, 'rect', { x: x + 14, y: 600, width: columnW - 28, height: 36, rx: 18, class: 'moe-dense-node' });
          append(dense, 'text', { x: x + columnW / 2, y: 622, 'text-anchor': 'middle', class: 'moe-node-label' }, 'Dense');
          continue;
        }
        const routes = trace.get(layer)[state.tokenId];
        const byExpert = new Map(routes.map((route) => [route.expertId, route]));
        const aggregateY = routes.reduce((sum, route) => sum + expertY(route.expertId) * route.weight, 0);
        const expertX = x + columnW / 2;
        const aggregateX = x + columnW - 8;
        scenes.push({ layer, routes, aggregateY, expertX, aggregateX });
        for (let expertId = 0; expertId < model.expertCount; expertId += 1) {
          const route = byExpert.get(expertId);
          const node = append(svg, 'circle', {
            cx: expertX, cy: expertY(expertId), r: route ? 4.5 : 2.1,
            class: `moe-expert-node${route ? ' is-routed' : ' is-inactive'}`,
          });
          if (route) tooltipTarget(node, `L${layer} · E${route.expertId} / R${route.rankId} · weight ${route.weight.toFixed(4)}`, { type: 'expert', layer, tokenId: state.tokenId, ...route });
        }
        routes.forEach((route) => append(svg, 'line', {
          x1: expertX, y1: expertY(route.expertId), x2: aggregateX, y2: aggregateY, class: 'moe-expert-spoke',
        }));
      }
      append(svg, 'path', { d: scenes.map((scene, index) => `${index ? 'L' : 'M'} ${scene.aggregateX} ${scene.aggregateY}`).join(' '), class: 'moe-aggregate-path' });
      scenes.forEach((scene) => tooltipTarget(append(svg, 'circle', { cx: scene.aggregateX, cy: scene.aggregateY, r: 7, class: 'moe-aggregate-node' }), `L${scene.layer} · weighted sum of Top-8 routed outputs`, { type: 'aggregate', layer: scene.layer, tokenId: state.tokenId }));
      const sharedStart = startX + 2 * columnW + columnW / 2;
      const sharedEnd = startX + 45 * columnW + columnW / 2;
      append(svg, 'line', { x1: sharedStart, y1: sharedY, x2: sharedEnd, y2: sharedY, class: 'moe-shared-track' });
      model.moeLayers.forEach((layer) => tooltipTarget(append(svg, 'circle', { cx: startX + layer * columnW + columnW / 2, cy: sharedY, r: 3.5, class: 'moe-shared-node' }), `L${layer} · Shared Expert · always active`, { type: 'shared-expert', layer }));
      append(svg, 'text', { x: sharedStart, y: 1272, class: 'moe-axis-label' }, 'SHARED EXPERT · L2–L45');
      const axisX = startX + 2 * columnW - 44;
      for (let expertId = 0; expertId < model.expertCount; expertId += 32) append(svg, 'text', { x: axisX, y: expertY(expertId) + 4, class: 'moe-axis-label' }, `E${expertId}`);
      if (options.showJourneyLegend !== false) append(svg, 'text', { x: 24, y: 28, class: 'moe-axis-label' }, `TOKEN T${String(state.tokenId).padStart(3, '0')} · 256 EXPERTS / MOE LAYER · BLACK = TOP-8 · BLUE = WEIGHTED SUM`);
    }

    function applyScale(scale) {
      const svg = elements.diagrams[state.view];
      const width = Number(svg.dataset.logicalWidth);
      const height = Number(svg.dataset.logicalHeight);
      if (!width || !height) return false;
      state.scale = Math.max(0.12, Math.min(2, Number(scale) || 1));
      svg.style.width = `${width * state.scale}px`;
      svg.style.height = `${height * state.scale}px`;
      svg.style.minWidth = '0';
      svg.style.minHeight = '0';
      svg.style.margin = 'auto';
      return true;
    }

    function fitDiagram() {
      const panel = elements.panels[state.view];
      const scroll = panel?.querySelector?.('.moe-svg-scroll') || panel?.children?.[0];
      const svg = elements.diagrams[state.view];
      const logicalWidth = Number(svg.dataset.logicalWidth);
      const logicalHeight = Number(svg.dataset.logicalHeight);
      const availableWidth = Number(scroll?.clientWidth || elements.stage.clientWidth || 0);
      const availableHeight = Number(scroll?.clientHeight || elements.stage.clientHeight || 0);
      if (!logicalWidth || !logicalHeight || !availableWidth || !availableHeight) return false;
      state.fitMode = true;
      return applyScale(Math.min(1, availableWidth / logicalWidth, availableHeight / logicalHeight));
    }

    function scheduleScale() {
      const apply = () => state.fitMode ? fitDiagram() : applyScale(state.scale);
      if (typeof globalScope.requestAnimationFrame === 'function') globalScope.requestAnimationFrame(apply);
      else apply();
    }

    function moveTooltip() {
      if (elements.tooltip.hidden || !activeTooltipTarget) return;
      const stageRect = elements.stage.getBoundingClientRect();
      const targetRect = activeTooltipTarget.getBoundingClientRect();
      const tooltipRect = elements.tooltip.getBoundingClientRect();
      const gap = 12;
      let x = targetRect.right - stageRect.left + gap;
      if (x + tooltipRect.width > stageRect.width - 8) x = targetRect.left - stageRect.left - tooltipRect.width - gap;
      const y = Math.max(8, Math.min(targetRect.top - stageRect.top, stageRect.height - tooltipRect.height - 8));
      elements.tooltip.style.left = `${Math.max(8, x)}px`;
      elements.tooltip.style.top = `${y}px`;
    }

    function showTooltip(event) {
      const target = event.target.closest?.('[data-tooltip]');
      if (!target) return;
      activeTooltipTarget = target;
      elements.tooltip.textContent = target.dataset.tooltip;
      elements.tooltip.hidden = false;
      moveTooltip();
    }

    function hideTooltip(event) {
      if (event.relatedTarget?.closest?.('[data-tooltip]')) return;
      activeTooltipTarget = null;
      elements.tooltip.hidden = true;
    }

    function beginPan(event) {
      if (event.button !== 0) return;
      const scroll = event.currentTarget;
      panGesture = { scroll, pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: scroll.scrollLeft, top: scroll.scrollTop, moved: false, captured: false };
    }

    function movePan(event) {
      if (!panGesture || event.pointerId !== panGesture.pointerId) return;
      const dx = event.clientX - panGesture.x;
      const dy = event.clientY - panGesture.y;
      panGesture.moved = panGesture.moved || Math.hypot(dx, dy) > 3;
      if (!panGesture.moved) return;
      if (!panGesture.captured) {
        panGesture.captured = true;
        panGesture.scroll.setPointerCapture?.(event.pointerId);
        panGesture.scroll.classList.add('is-panning');
      }
      event.preventDefault();
      panGesture.scroll.scrollLeft = panGesture.left - dx;
      panGesture.scroll.scrollTop = panGesture.top - dy;
      elements.tooltip.hidden = true;
    }

    function endPan(event) {
      if (!panGesture || event.pointerId !== panGesture.pointerId) return;
      const { scroll, pointerId, moved, captured } = panGesture;
      panGesture = null;
      scroll.classList.remove('is-panning');
      if (captured) try { scroll.releasePointerCapture?.(pointerId); } catch (_) { /* no-op */ }
      suppressSelection = moved;
      if (moved) globalScope.requestAnimationFrame(() => { suppressSelection = false; });
    }

    function wheelZoom(event) {
      event.preventDefault();
      const scroll = event.currentTarget;
      const rect = scroll.getBoundingClientRect();
      const anchorX = event.clientX - rect.left;
      const anchorY = event.clientY - rect.top;
      const oldScale = state.scale;
      const contentX = scroll.scrollLeft + anchorX;
      const contentY = scroll.scrollTop + anchorY;
      state.fitMode = false;
      applyScale(oldScale * Math.exp(-event.deltaY * 0.0015));
      const ratio = state.scale / oldScale;
      globalScope.requestAnimationFrame(() => {
        scroll.scrollLeft = contentX * ratio - anchorX;
        scroll.scrollTop = contentY * ratio - anchorY;
      });
      notifyState();
    }

    function emitSelection(target) {
      if (!target?.dataset.selection || typeof options.onSelect !== 'function') return;
      options.onSelect(JSON.parse(target.dataset.selection), controller);
    }

    function stateSnapshot() {
      return Object.freeze({ ...state, activeRanks: Object.freeze(Array.from(state.activeRanks)) });
    }

    function notifyState() {
      if (typeof options.onStateChange === 'function') options.onStateChange(stateSnapshot(), controller);
    }

    function syncView({ notify = true } = {}) {
      const layerView = state.view === 'layer';
      elements.panels.layer.hidden = !layerView;
      elements.panels.journey.hidden = layerView;
      elements.tabs.forEach((tab) => {
        const selected = tab.dataset.moeView === state.view;
        tab.classList.toggle('is-selected', selected);
        tab.setAttribute('aria-selected', String(selected));
      });
      if (elements.readout) elements.readout.textContent = layerView ? `L${state.layer}` : `T${String(state.tokenId).padStart(3, '0')}`;
      if (layerView) renderLayerDiagram();
      else renderJourneyDiagram();
      scheduleScale();
      if (notify) notifyState();
    }

    controller = {
      model,
      validation,
      getState: stateSnapshot,
      setView(view) {
        if (view !== 'layer' && view !== 'journey') return false;
        state.view = view;
        state.fitMode = true;
        syncView();
        return true;
      },
      switchView(view) {
        return controller.setView(view);
      },
      setLayer(layer) {
        if (!model.moeLayers.includes(layer)) return false;
        state.layer = layer;
        syncView();
        return true;
      },
      setToken(tokenId) {
        if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId >= model.batchSize) return false;
        state.tokenId = tokenId;
        syncView();
        return true;
      },
      setActiveRanks(rankIds) {
        state.activeRanks = new Set(Array.isArray(rankIds) ? rankIds : []);
        if (state.view === 'layer') renderLayerDiagram();
        notifyState();
        return controller;
      },
      setLanguage(language) {
        state.language = language === 'zh' ? 'zh' : 'en';
        notifyState();
        return controller;
      },
      setTheme(theme) {
        state.theme = theme === 'light' ? 'light' : 'dark';
        root.dataset.theme = state.theme;
        if (options.syncDocumentTheme) document.documentElement.dataset.theme = state.theme;
        if (elements.themeButton) elements.themeButton.setAttribute('aria-label', state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
        return controller;
      },
      step(direction) {
        const delta = direction < 0 ? -1 : 1;
        if (state.view === 'layer') {
          const index = model.moeLayers.indexOf(state.layer);
          state.layer = model.moeLayers[(index + delta + model.moeLayers.length) % model.moeLayers.length];
        } else state.tokenId = (state.tokenId + delta + model.batchSize) % model.batchSize;
        syncView();
        return controller;
      },
      fit() {
        fitDiagram();
        return controller;
      },
      setZoom(scale) {
        state.fitMode = false;
        applyScale(scale);
        notifyState();
        return controller;
      },
      zoomIn() {
        return controller.setZoom(state.scale * 1.2);
      },
      zoomOut() {
        return controller.setZoom(state.scale / 1.2);
      },
      refresh() {
        syncView({ notify: false });
        return controller;
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        resizeObserver?.disconnect();
        root.replaceChildren();
        root.classList.remove('pto-moe-routing');
      },
    };

    elements.tabs.forEach((tab) => tab.addEventListener('click', () => controller.setView(tab.dataset.moeView)));
    elements.stepButtons.forEach((button) => button.addEventListener('click', () => controller.step(Number(button.dataset.moeStep))));
    elements.themeButton?.addEventListener('click', () => controller.setTheme(state.theme === 'light' ? 'dark' : 'light'));
    Object.values(elements.diagrams).forEach((svg) => {
      svg.addEventListener('pointerover', showTooltip);
      svg.addEventListener('pointermove', moveTooltip);
      svg.addEventListener('pointerout', hideTooltip);
      svg.addEventListener('click', (event) => {
        if (suppressSelection) { suppressSelection = false; return; }
        emitSelection(event.target.closest?.('[data-selection]'));
      });
      svg.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') emitSelection(event.target.closest?.('[data-selection]'));
      });
    });
    Object.values(elements.panels).forEach((panel) => {
      const scroll = panel.querySelector('.moe-svg-scroll');
      scroll.addEventListener('pointerdown', beginPan);
      scroll.addEventListener('pointermove', movePan);
      scroll.addEventListener('pointerup', endPan);
      scroll.addEventListener('pointercancel', endPan);
      scroll.addEventListener('wheel', wheelZoom, { passive: false });
    });
    controller.setTheme(state.theme);
    syncView({ notify: false });
    if (globalScope.ResizeObserver) {
      resizeObserver = new globalScope.ResizeObserver(() => {
        if (state.fitMode) fitDiagram();
      });
      resizeObserver.observe(elements.stage);
    }
    return controller;
  }

  globalScope.PtoMoeRouting = Object.freeze({ render });
})(typeof globalThis !== 'undefined' ? globalThis : this);
