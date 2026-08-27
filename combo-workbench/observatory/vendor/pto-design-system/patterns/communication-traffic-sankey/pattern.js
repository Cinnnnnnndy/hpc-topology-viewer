(function registerPtoCommunicationTrafficSankeyPattern(global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ENGINE_ORDER = ['aic', 'aiv', 'unattributed'];
  const CHILD_GAP = 7;
  const RANK_GAP = 58;
  const EXPANDED_SLOT_HEIGHT = 48;
  const DEFAULT_VISUAL_CONFIG = Object.freeze({
    ribbonOpacity: 0.6,
    ribbonGlow: 4,
    ribbonSaturation: 1.45,
    spectrumShift: 3,
    traceOpacity: 0.9,
    structureOpacity: 0.5,
    gateIntensity: 0,
    fieldIntensity: 0.55,
    curvature: 0.46,
    spectralGradient: true,
    signalGlyphs: false,
    flowTrace: true,
  });
  const ENGINE_LABELS = {
    aic: 'AIC',
    aiv: 'AIV',
    unattributed: 'Unattributed',
  };

  function htmlNode(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function svgNode(tag, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => {
      if (value !== undefined && value !== null) element.setAttribute(key, String(value));
    });
    return element;
  }

  function formatNumber(value, digits = 1) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
  }

  function formatBytes(bytes) {
    if (bytes >= 1024 ** 3) return `${formatNumber(bytes / (1024 ** 3), 2)} GiB`;
    if (bytes >= 1024 ** 2) return `${formatNumber(bytes / (1024 ** 2), 1)} MiB`;
    if (bytes >= 1024) return `${formatNumber(bytes / 1024, 1)} KiB`;
    return `${formatNumber(bytes, 0)} B`;
  }

  function eventMeasure(event) {
    return Number(event.value ?? event.bytes ?? 0) || 0;
  }

  function eventChild(event, side) {
    return event[`${side}Child`] ?? event[`${side}Engine`] ?? null;
  }

  function childDefinitions(rank, side) {
    const configured = rank?.[`${side}Children`] || rank?.children;
    if (Array.isArray(configured) && configured.length) {
      return configured.map((child) => (typeof child === 'string'
        ? { id: child, label: child, type: 'group' }
        : { type: 'group', ...child }));
    }
    return ENGINE_ORDER.map((engine) => ({
      id: engine,
      label: ENGINE_LABELS[engine],
      type: engine,
    }));
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value)));
  }

  function normalizeVisualConfig(config = {}) {
    return {
      ribbonOpacity: clamp(config.ribbonOpacity ?? DEFAULT_VISUAL_CONFIG.ribbonOpacity, 0.2, 0.95),
      ribbonGlow: clamp(config.ribbonGlow ?? DEFAULT_VISUAL_CONFIG.ribbonGlow, 0, 18),
      ribbonSaturation: clamp(config.ribbonSaturation ?? DEFAULT_VISUAL_CONFIG.ribbonSaturation, 0.6, 1.8),
      spectrumShift: clamp(config.spectrumShift ?? DEFAULT_VISUAL_CONFIG.spectrumShift, -45, 45),
      traceOpacity: clamp(config.traceOpacity ?? DEFAULT_VISUAL_CONFIG.traceOpacity, 0, 1),
      structureOpacity: clamp(config.structureOpacity ?? DEFAULT_VISUAL_CONFIG.structureOpacity, 0.15, 1),
      gateIntensity: clamp(config.gateIntensity ?? DEFAULT_VISUAL_CONFIG.gateIntensity, 0, 1),
      fieldIntensity: clamp(config.fieldIntensity ?? DEFAULT_VISUAL_CONFIG.fieldIntensity, 0, 1),
      curvature: clamp(config.curvature ?? DEFAULT_VISUAL_CONFIG.curvature, 0.2, 0.68),
      spectralGradient: config.spectralGradient ?? DEFAULT_VISUAL_CONFIG.spectralGradient,
      signalGlyphs: config.signalGlyphs ?? DEFAULT_VISUAL_CONFIG.signalGlyphs,
      flowTrace: config.flowTrace ?? DEFAULT_VISUAL_CONFIG.flowTrace,
    };
  }

  function endpointId(side, rank, child, expanded) {
    return expanded.has(`${side}:${rank}`)
      ? `${side}-r${rank}-${child || 'unattributed'}`
      : `${side}-r${rank}`;
  }

  function getFabric(sourceRank, targetRank, ranksById) {
    if (sourceRank === targetRank) return 'local';
    if (ranksById.get(sourceRank)?.node === ranksById.get(targetRank)?.node) return 'hccs';
    return 'roce';
  }

  function getFabricLabel(fabric) {
    return fabric === 'local' ? 'LOCAL' : fabric.toUpperCase();
  }

  function sankeyPath(x0, x1, sourceTop, sourceBottom, targetTop, targetBottom, curvature) {
    const curve = (x1 - x0) * curvature;
    return [
      `M${x0},${sourceTop}`,
      `C${x0 + curve},${sourceTop} ${x1 - curve},${targetTop} ${x1},${targetTop}`,
      `L${x1},${targetBottom}`,
      `C${x1 - curve},${targetBottom} ${x0 + curve},${sourceBottom} ${x0},${sourceBottom}`,
      'Z',
    ].join(' ');
  }

  function centerPath(x0, x1, sourceY, targetY, curvature) {
    const curve = (x1 - x0) * curvature;
    return `M${x0},${sourceY} C${x0 + curve},${sourceY} ${x1 - curve},${targetY} ${x1},${targetY}`;
  }

  function signalGlyphPath(engine, x, y) {
    if (engine === 'aic') {
      return `M${x},${y + 5} H${x + 6} V${y} H${x + 13} V${y + 10} H${x + 20}`;
    }
    if (engine === 'aiv') {
      return `M${x},${y + 5} C${x + 4},${y - 1} ${x + 6},${y - 1} ${x + 10},${y + 5} S${x + 16},${y + 11} ${x + 20},${y + 5}`;
    }
    if (engine === 'unattributed') {
      return `M${x},${y + 5} H${x + 20}`;
    }
    return `M${x},${y + 7} H${x + 6} V${y + 2} H${x + 14} V${y + 7} H${x + 20}`;
  }

  function aggregate(data, timeWindow, expanded) {
    const ranksById = new Map(data.ranks.map((rank) => [rank.rank, rank]));
    const events = data.events.filter((event) => (
      event.timestamp >= timeWindow.start && event.timestamp < timeWindow.end
    ));
    const sourceTotals = new Map();
    const targetTotals = new Map();
    const linkMap = new Map();

    events.forEach((event) => {
      const sourceChild = eventChild(event, 'source');
      const targetChild = eventChild(event, 'target');
      const value = eventMeasure(event);
      const source = endpointId('source', event.sourceRank, sourceChild, expanded);
      const target = endpointId('target', event.targetRank, targetChild, expanded);
      sourceTotals.set(source, (sourceTotals.get(source) || 0) + value);
      targetTotals.set(target, (targetTotals.get(target) || 0) + value);
      const key = `${source}__${target}`;
      if (!linkMap.has(key)) {
        linkMap.set(key, {
          id: key,
          source,
          target,
          sourceRank: event.sourceRank,
          targetRank: event.targetRank,
          sourceEngine: expanded.has(`source:${event.sourceRank}`)
            ? sourceChild || 'unattributed'
            : null,
          targetEngine: expanded.has(`target:${event.targetRank}`)
            ? targetChild || 'unattributed'
            : null,
          value: 0,
          duration: 0,
          eventIds: [],
          streams: new Set(),
          transports: new Set(),
          hasUnattributed: false,
        });
      }
      const link = linkMap.get(key);
      link.value += value;
      link.duration += event.duration;
      link.eventIds.push(event.id);
      link.streams.add(event.streamId || 'unknown');
      link.transports.add(event.transport || getFabric(event.sourceRank, event.targetRank, ranksById));
      link.hasUnattributed ||= !sourceChild || !targetChild;
    });

    function buildNodes(side, totals) {
      return data.ranks.flatMap((rank) => {
        const isExpanded = expanded.has(`${side}:${rank.rank}`);
        if (!isExpanded) {
          const id = `${side}-r${rank.rank}`;
          return [{
            id,
            rank: rank.rank,
            node: rank.node,
            engine: null,
            expanded: false,
            value: totals.get(id) || 0,
          }];
        }
        return childDefinitions(rank, side).map((child) => {
          const id = `${side}-r${rank.rank}-${child.id}`;
          return {
            id,
            rank: rank.rank,
            node: rank.node,
            engine: child.id,
            label: child.label || child.id,
            childType: child.type || 'group',
            capacity: child.capacity || null,
            status: child.status || null,
            expanded: true,
            value: totals.get(id) || 0,
          };
        }).filter((node) => node.value > 0);
      });
    }

    const totalBytes = events.reduce((sum, event) => sum + eventMeasure(event), 0);
    const attributedBytes = events.reduce((sum, event) => (
      eventChild(event, 'source') && eventChild(event, 'target') ? sum + eventMeasure(event) : sum
    ), 0);
    const rankReceive = new Map(data.ranks.map((rank) => [rank.rank, 0]));
    events.forEach((event) => rankReceive.set(
      event.targetRank,
      (rankReceive.get(event.targetRank) || 0) + eventMeasure(event),
    ));

    return {
      events,
      links: [...linkMap.values()],
      sources: buildNodes('source', sourceTotals),
      targets: buildNodes('target', targetTotals),
      sourceTotals,
      targetTotals,
      totalBytes,
      attributedBytes,
      rankReceive,
    };
  }

  function getLayoutExtras(nodes) {
    let childGaps = 0;
    let rankGaps = 0;
    const ranks = [...new Set(nodes.map((node) => node.rank))];
    ranks.forEach((rank, index) => {
      const count = nodes.filter((node) => node.rank === rank).length;
      childGaps += Math.max(0, count - 1) * CHILD_GAP;
      if (index < ranks.length - 1) rankGaps += RANK_GAP;
    });
    return childGaps + rankGaps;
  }

  function layoutColumn(nodes, x, scale, top, nodeWidth) {
    let cursor = top;
    let currentRank = null;
    const layouts = new Map();
    const groups = [];
    let group = null;
    nodes.forEach((node) => {
      if (node.rank !== currentRank) {
        if (group) groups.push(group);
        if (currentRank !== null) cursor += RANK_GAP;
        currentRank = node.rank;
        group = { rank: node.rank, y: cursor, expanded: node.expanded, nodes: [] };
      } else {
        cursor += CHILD_GAP;
      }
      const height = Math.max(node.value * scale, 2);
      const slotHeight = node.expanded ? Math.max(height, EXPANDED_SLOT_HEIGHT) : height;
      const slotY = cursor;
      const layout = {
        ...node,
        x,
        y: slotY + (slotHeight - height) / 2,
        width: nodeWidth,
        height,
        slotY,
        slotHeight,
      };
      layouts.set(node.id, layout);
      group.nodes.push(layout);
      cursor += slotHeight;
    });
    if (group) groups.push(group);
    groups.forEach((item) => {
      const last = item.nodes[item.nodes.length - 1];
      item.height = last ? last.slotY + last.slotHeight - item.y : 0;
    });
    return { layouts, groups, bottom: cursor };
  }

  function render(container, options = {}) {
    if (!container) throw new Error('communication-traffic-sankey requires a container');
    let data = options.data;
    let timeWindow = { ...data.defaultWindow };
    const expanded = new Set([
      ...(data.defaultExpanded?.source || []).map((rank) => `source:${rank}`),
      ...(data.defaultExpanded?.target || []).map((rank) => `target:${rank}`),
    ]);
    let selectedLinkId = null;
    let selectedNodeId = null;
    let focusedEventIds = new Set();
    let currentAggregate = null;
    let visualConfig = normalizeVisualConfig(options.visual);

    const root = htmlNode('section', 'pto-traffic-sankey');
    const canvas = htmlNode('div', 'pto-traffic-sankey__canvas');
    const svg = svgNode('svg', {
      class: 'pto-traffic-sankey__svg',
      viewBox: '0 0 1280 520',
      role: 'img',
      'aria-label': data.ariaLabel || data.title,
      preserveAspectRatio: 'xMidYMid meet',
    });
    canvas.appendChild(svg);
    root.appendChild(canvas);

    const tooltip = htmlNode('aside', 'pto-traffic-sankey__tooltip');
    tooltip.hidden = true;
    root.appendChild(tooltip);
    const live = htmlNode('div', 'pto-traffic-sankey__sr-only');
    live.setAttribute('aria-live', 'polite');
    root.appendChild(live);
    container.replaceChildren(root);

    function applyVisualConfig() {
      root.style.setProperty('--traffic-ribbon-opacity', visualConfig.ribbonOpacity);
      root.style.setProperty('--traffic-ribbon-glow', `${visualConfig.ribbonGlow}px`);
      root.style.setProperty('--traffic-ribbon-saturation', visualConfig.ribbonSaturation);
      root.style.setProperty('--traffic-spectrum-shift', `${visualConfig.spectrumShift}deg`);
      root.style.setProperty('--traffic-trace-opacity', visualConfig.traceOpacity);
      root.style.setProperty('--traffic-structure-opacity', visualConfig.structureOpacity);
      root.style.setProperty('--traffic-gate-intensity', visualConfig.gateIntensity);
      root.style.setProperty('--traffic-field-intensity', visualConfig.fieldIntensity);
      root.classList.toggle('is-flat-spectrum', !visualConfig.spectralGradient);
      root.classList.toggle('is-signal-glyphs-hidden', !visualConfig.signalGlyphs);
      root.classList.toggle('is-flow-trace-hidden', !visualConfig.flowTrace);
    }

    applyVisualConfig();

    function formatMeasureValue(value) {
      if (data.primaryMeasure === 'tokens') return `${formatNumber(value, 0)} tokens`;
      if (data.primaryMeasure === 'exposedTime') return `${formatNumber(value, 2)} ms`;
      return formatBytes(value);
    }

    function endpointLabel(rank, child, side) {
      if (!child) return `R${rank}`;
      const rankDefinition = data.ranks.find((item) => item.rank === rank);
      const definition = childDefinitions(rankDefinition, side).find((item) => item.id === child);
      return `R${rank} / ${definition?.label || ENGINE_LABELS[child] || child}`;
    }

    function rankColor(rank) {
      const rankIndex = data.ranks.findIndex((item) => item.rank === rank);
      const rankDefinition = rankIndex >= 0 ? data.ranks[rankIndex] : null;
      const configuredSlot = rankDefinition?.colorSlot ?? rankDefinition?.slot;
      const slot = Number.isInteger(configuredSlot) ? configuredSlot : Math.max(0, rankIndex);
      return `var(--rank-${((slot % 4) + 4) % 4})`;
    }

    function positionTooltip(event) {
      const rect = root.getBoundingClientRect();
      const width = Math.min(336, rect.width - 24);
      const x = Math.min(Math.max(12, event.clientX - rect.left + 14), rect.width - width - 12);
      const y = Math.min(Math.max(12, event.clientY - rect.top + 14), rect.height - 220);
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    }

    function showLinkTooltip(event, link) {
      tooltip.replaceChildren();
      const headingRow = htmlNode('div', 'pto-traffic-sankey__tooltip-heading');
      headingRow.appendChild(htmlNode('strong', '', `${endpointLabel(link.sourceRank, link.sourceEngine, 'source')} → ${endpointLabel(link.targetRank, link.targetEngine, 'target')}`));
      tooltip.appendChild(headingRow);
      const summary = htmlNode('div', 'pto-traffic-sankey__tooltip-value');
      summary.appendChild(htmlNode('strong', '', formatMeasureValue(link.value)));
      summary.appendChild(htmlNode('span', '', `${link.eventIds.length} events`));
      tooltip.appendChild(summary);
      const facts = htmlNode('dl', 'pto-traffic-sankey__tooltip-facts');
      [
        ['Mean duration', `${formatNumber(link.duration / link.eventIds.length, 2)} ms`],
        ['Transport', [...link.transports].map(getFabricLabel).join(' / ')],
        ['Streams', [...link.streams].join(', ')],
        ['Attribution', link.hasUnattributed ? 'Partial · contains unknown' : 'Source + target correlated'],
      ].forEach(([term, value]) => {
        facts.appendChild(htmlNode('dt', '', term));
        facts.appendChild(htmlNode('dd', '', value));
      });
      tooltip.appendChild(facts);
      positionTooltip(event);
      tooltip.hidden = false;
    }

    function updateSelection() {
      const focusedLinkIds = new Set((currentAggregate?.links || [])
        .filter((link) => link.eventIds.some((id) => focusedEventIds.has(id)))
        .map((link) => link.id));
      const hasSelection = Boolean(selectedLinkId || selectedNodeId || focusedLinkIds.size);
      root.classList.toggle('has-selection', hasSelection);
      const activeNodeIds = new Set();
      svg.querySelectorAll('[data-link-id]').forEach((element) => {
        const source = element.getAttribute('data-source-id');
        const target = element.getAttribute('data-target-id');
        const active = selectedLinkId
          ? element.getAttribute('data-link-id') === selectedLinkId
          : selectedNodeId
            ? selectedNodeId === source || selectedNodeId === target
            : focusedLinkIds.has(element.getAttribute('data-link-id'));
        element.classList.toggle('is-active', active);
        if (active) {
          activeNodeIds.add(source);
          activeNodeIds.add(target);
        }
      });
      svg.querySelectorAll('[data-node-id]').forEach((element) => {
        const id = element.getAttribute('data-node-id');
        element.classList.toggle('is-active', id === selectedNodeId || activeNodeIds.has(id));
      });
    }

    function clearSelection(emit = true) {
      selectedLinkId = null;
      selectedNodeId = null;
      focusedEventIds.clear();
      tooltip.hidden = true;
      updateSelection();
      if (emit) options.onSelect?.(null);
    }

    function selectLink(link) {
      selectedLinkId = selectedLinkId === link.id ? null : link.id;
      selectedNodeId = null;
      focusedEventIds.clear();
      updateSelection();
      const state = selectedLinkId ? { type: 'link', link, timeWindow: { ...timeWindow } } : null;
      live.textContent = state
        ? `已选择 ${endpointLabel(link.sourceRank, link.sourceEngine, 'source')} 到 ${endpointLabel(link.targetRank, link.targetEngine, 'target')}，${formatMeasureValue(link.value)}`
        : '已清除选择';
      options.onSelect?.(state);
    }

    function selectNode(node, side) {
      selectedNodeId = selectedNodeId === node.id ? null : node.id;
      selectedLinkId = null;
      focusedEventIds.clear();
      updateSelection();
      options.onSelect?.(selectedNodeId ? { type: 'node', node, side, timeWindow: { ...timeWindow } } : null);
    }

    function toggleRank(side, rank) {
      const key = `${side}:${rank}`;
      expanded.has(key) ? expanded.delete(key) : expanded.add(key);
      selectedLinkId = null;
      selectedNodeId = null;
      draw();
      options.onExpand?.({ side, rank, expanded: expanded.has(key) });
    }

    function renderCompoundGroup(group, side, x, width) {
      const zone = svgNode('g', {
        class: 'pto-traffic-sankey__compound',
        'data-side': side,
        'data-rank': group.rank,
        'data-expanded': group.expanded,
        role: 'button',
        tabindex: 0,
        'aria-expanded': group.expanded,
        'aria-label': `${group.expanded ? 'Collapse' : 'Expand'} ${side} Rank ${group.rank}`,
      });
      const top = group.y - 12;
      const bottom = group.y + group.height + 12;
      const railX = side === 'source' ? x + 22 : x + width - 22;
      const inwardX = side === 'source' ? railX + 22 : railX - 22;
      const railPath = `M${inwardX},${top} H${railX} V${bottom} H${inwardX}`;
      if (group.expanded) {
        zone.appendChild(svgNode('path', { class: 'pto-traffic-sankey__compound-hit', d: railPath }));
        zone.appendChild(svgNode('path', { class: 'pto-traffic-sankey__compound-rail', d: railPath }));
      }
      const firstNode = group.nodes[0];
      const textX = side === 'source'
        ? firstNode.x - 42
        : firstNode.x + firstNode.width + 42;
      const anchor = side === 'source' ? 'end' : 'start';
      const rankDefinition = data.ranks.find((item) => item.rank === group.rank);
      const groupValue = group.nodes.reduce((sum, node) => sum + node.value, 0);
      const labelHitWidth = 214;
      zone.appendChild(svgNode('rect', {
        class: 'pto-traffic-sankey__compound-label-hit',
        x: side === 'source' ? textX - labelHitWidth + 8 : textX - 8,
        y: group.y - 38,
        width: labelHitWidth,
        height: 48,
        rx: 6,
      }));
      const label = svgNode('text', {
        class: 'pto-traffic-sankey__node-title pto-traffic-sankey__rank-title',
        x: textX,
        y: group.y - 21,
        'text-anchor': anchor,
      });
      label.textContent = `${group.expanded ? '▾' : '▸'} Rank ${group.rank}`;
      const detail = svgNode('text', {
        class: 'pto-traffic-sankey__node-detail pto-traffic-sankey__rank-detail',
        x: textX,
        y: group.y - 4,
        'text-anchor': anchor,
      });
      detail.textContent = `${rankDefinition.node.toUpperCase()} · ${formatMeasureValue(groupValue)}`;
      zone.append(label, detail);
      const activate = () => toggleRank(side, group.rank);
      zone.addEventListener('click', activate);
      zone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        }
      });
      svg.appendChild(zone);
    }

    function renderNode(layout, side, totalBytes) {
      const isCollapsedRank = !layout.engine;
      const capacityLimit = Number(layout.capacity?.limit || 0);
      const capacityRatio = capacityLimit > 0 ? layout.value / capacityLimit : 0;
      const group = svgNode('g', {
        class: 'pto-traffic-sankey__node',
        'data-node-id': layout.id,
        'data-rank': layout.rank,
        'data-engine': layout.childType || layout.engine || 'rank',
        'data-status': layout.status || (capacityRatio >= 1 ? 'overflow' : capacityRatio >= 0.9 ? 'capacity-warning' : 'normal'),
        'data-side': side,
        role: isCollapsedRank ? 'presentation' : 'button',
        tabindex: isCollapsedRank ? -1 : 0,
        'aria-label': isCollapsedRank ? undefined : `${side} ${endpointLabel(layout.rank, layout.engine, side)}，${formatMeasureValue(layout.value)}`,
      });
      group.style.setProperty('--node-color', rankColor(layout.rank));
      group.appendChild(svgNode('rect', {
        class: 'pto-traffic-sankey__node-bar',
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: Math.max(layout.height, 2),
      }));
      const glyphX = side === 'source' ? layout.x - 30 : layout.x + layout.width + 10;
      const textX = side === 'source' ? layout.x - 42 : layout.x + layout.width + 42;
      const anchor = side === 'source' ? 'end' : 'start';
      const centerY = layout.y + Math.max(layout.height, 2) / 2;
      if (!isCollapsedRank) {
        group.appendChild(svgNode('path', {
          class: 'pto-traffic-sankey__engine-glyph',
          d: signalGlyphPath(layout.childType || layout.engine, glyphX, centerY - 5),
        }));
        const title = svgNode('text', {
          class: 'pto-traffic-sankey__node-title', x: textX, y: centerY - 4, 'text-anchor': anchor,
        });
        title.textContent = layout.label || ENGINE_LABELS[layout.engine] || layout.engine;
        const detail = svgNode('text', {
          class: 'pto-traffic-sankey__node-detail', x: textX, y: centerY + 13, 'text-anchor': anchor,
        });
        detail.textContent = capacityLimit > 0
          ? `${formatNumber(layout.value, 0)} / ${formatNumber(capacityLimit, 0)} · ${formatNumber(capacityRatio * 100, 0)}%`
          : formatMeasureValue(layout.value);
        group.append(title, detail);
      }
      if (!isCollapsedRank && capacityLimit > 0) {
        const capacityWidth = 58;
        const capacityX = side === 'source' ? textX - capacityWidth : textX;
        const capacityY = centerY + 18;
        group.appendChild(svgNode('rect', {
          class: 'pto-traffic-sankey__capacity-track',
          x: capacityX,
          y: capacityY,
          width: capacityWidth,
          height: 2,
          rx: 1,
        }));
        group.appendChild(svgNode('rect', {
          class: 'pto-traffic-sankey__capacity-fill',
          x: capacityX,
          y: capacityY,
          width: capacityWidth * Math.min(1, capacityRatio),
          height: 2,
          rx: 1,
        }));
      }
      const activate = () => (isCollapsedRank ? toggleRank(side, layout.rank) : selectNode(layout, side));
      group.addEventListener('click', (event) => {
        event.stopPropagation();
        activate();
      });
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
        }
      });
      svg.appendChild(group);
    }

    function draw() {
      currentAggregate = aggregate(data, timeWindow, expanded);
      svg.replaceChildren();
      if (!currentAggregate.totalBytes) {
        const empty = svgNode('text', { class: 'pto-traffic-sankey__empty', x: 640, y: 250, 'text-anchor': 'middle' });
        empty.textContent = '当前时间窗没有通信事件';
        svg.appendChild(empty);
        return;
      }

      const sourceExtras = getLayoutExtras(currentAggregate.sources);
      const targetExtras = getLayoutExtras(currentAggregate.targets);
      const availableHeight = Math.max(388, Math.max(sourceExtras, targetExtras) + 320);
      const scale = Math.max(0.000001, (availableHeight - Math.max(sourceExtras, targetExtras)) / currentAggregate.totalBytes);
      const top = 82;
      const sourceX = 310;
      const targetX = 954;
      const nodeWidth = 18;
      const sourceColumn = layoutColumn(currentAggregate.sources, sourceX, scale, top, nodeWidth);
      const targetColumn = layoutColumn(currentAggregate.targets, targetX, scale, top, nodeWidth);
      const chartBottom = Math.max(sourceColumn.bottom, targetColumn.bottom);
      const chartHeight = Math.max(520, chartBottom + 42);
      svg.setAttribute('viewBox', `0 0 1280 ${chartHeight}`);

      const defs = svgNode('defs');
      const gateGradient = svgNode('linearGradient', {
        id: 'pto-traffic-gate-spectrum', x1: '0%', y1: '0%', x2: '100%', y2: '0%',
      });
      [
        ['0%', '#52e7c2', 0],
        ['28%', '#347cff', 0.68],
        ['50%', '#f68fc4', 0.82],
        ['72%', '#f0cf7a', 0.68],
        ['100%', '#52e7c2', 0],
      ].forEach(([offset, color, opacity]) => gateGradient.appendChild(svgNode('stop', {
        offset, 'stop-color': color, 'stop-opacity': opacity,
      })));
      defs.appendChild(gateGradient);
      svg.appendChild(defs);

      const sourceLabel = svgNode('text', { class: 'pto-traffic-sankey__column-label', x: 44, y: 42 });
      sourceLabel.textContent = data.sourceDimensionLabel || 'SOURCE · RANK / ENGINE ATTRIBUTION';
      const targetLabel = svgNode('text', { class: 'pto-traffic-sankey__column-label', x: 1236, y: 42, 'text-anchor': 'end' });
      targetLabel.textContent = data.targetDimensionLabel || 'DESTINATION · RANK / ENGINE ATTRIBUTION';
      svg.append(sourceLabel, targetLabel);

      sourceColumn.groups.forEach((group) => renderCompoundGroup(group, 'source', 56, 274));
      targetColumn.groups.forEach((group) => renderCompoundGroup(group, 'target', 936, 286));

      const fabric = svgNode('g', { class: 'pto-traffic-sankey__fabric', 'aria-hidden': 'true' });
      const fabricHeight = Math.max(422, chartBottom - 49);
      fabric.appendChild(svgNode('rect', {
        class: 'pto-traffic-sankey__fabric-halo', x: 621, y: 64, width: 38, height: fabricHeight, rx: 19,
      }));
      fabric.appendChild(svgNode('rect', {
        class: 'pto-traffic-sankey__fabric-core', x: 634, y: 64, width: 12, height: fabricHeight, rx: 6,
      }));
      fabric.appendChild(svgNode('line', {
        class: 'pto-traffic-sankey__fabric-line', x1: 640, x2: 640, y1: 64, y2: 64 + fabricHeight,
      }));
      svg.appendChild(fabric);

      const sourceOrder = new Map(currentAggregate.sources.map((node, index) => [node.id, index]));
      const targetOrder = new Map(currentAggregate.targets.map((node, index) => [node.id, index]));
      const sourceOffsets = new Map(currentAggregate.sources.map((node) => [node.id, 0]));
      const targetOffsets = new Map(currentAggregate.targets.map((node) => [node.id, 0]));
      const orderedLinks = [...currentAggregate.links].sort((a, b) => (
        sourceOrder.get(a.source) - sourceOrder.get(b.source)
        || targetOrder.get(a.target) - targetOrder.get(b.target)
      ));
      const geometries = new Map();
      orderedLinks.forEach((link) => {
        const source = sourceColumn.layouts.get(link.source);
        const target = targetColumn.layouts.get(link.target);
        const width = link.value * scale;
        const sourceTop = source.y + sourceOffsets.get(link.source);
        const targetTop = target.y + targetOffsets.get(link.target);
        sourceOffsets.set(link.source, sourceOffsets.get(link.source) + width);
        targetOffsets.set(link.target, targetOffsets.get(link.target) + width);
        geometries.set(link.id, { sourceTop, targetTop, width });
      });

      [...orderedLinks].sort((a, b) => b.value - a.value).forEach((link, linkIndex) => {
        const source = sourceColumn.layouts.get(link.source);
        const target = targetColumn.layouts.get(link.target);
        const geometry = geometries.get(link.id);
        const fabricType = getFabric(link.sourceRank, link.targetRank, new Map(data.ranks.map((rank) => [rank.rank, rank])));
        const group = svgNode('g', {
          class: 'pto-traffic-sankey__link',
          'data-link-id': link.id,
          'data-source-id': link.source,
          'data-target-id': link.target,
          'data-source-rank': link.sourceRank,
          'data-fabric': fabricType,
          'data-unattributed': link.sourceEngine === 'unattributed' || link.targetEngine === 'unattributed' ? 'true' : 'false',
          role: 'button',
          tabindex: 0,
          'aria-label': `${endpointLabel(link.sourceRank, link.sourceEngine, 'source')} 到 ${endpointLabel(link.targetRank, link.targetEngine, 'target')}，${formatMeasureValue(link.value)}`,
        });
        const sourceColor = link.sourceEngine === 'unattributed'
          ? 'var(--unattributed-signal)'
          : rankColor(link.sourceRank);
        const targetColor = link.targetEngine === 'unattributed'
          ? 'var(--unattributed-signal)'
          : rankColor(link.targetRank);
        group.style.setProperty('--link-start', sourceColor);
        group.style.setProperty('--link-end', targetColor);
        const gradientId = `pto-traffic-link-${linkIndex}`;
        const gradient = svgNode('linearGradient', {
          id: gradientId,
          gradientUnits: 'userSpaceOnUse',
          x1: source.x + source.width,
          x2: target.x,
          y1: 0,
          y2: 0,
        });
        [
          ['0%', sourceColor, 1],
          ['40%', sourceColor, 0.96],
          ['60%', targetColor, 0.96],
          ['100%', targetColor, 1],
        ].forEach(([offset, color, opacity]) => gradient.appendChild(svgNode('stop', {
          offset, 'stop-color': color, 'stop-opacity': opacity,
        })));
        defs.appendChild(gradient);
        group.style.setProperty('--link-gradient', `url(#${gradientId})`);
        const path = sankeyPath(
          source.x + source.width,
          target.x,
          geometry.sourceTop,
          geometry.sourceTop + geometry.width,
          geometry.targetTop,
          geometry.targetTop + geometry.width,
          visualConfig.curvature,
        );
        const center = centerPath(
          source.x + source.width,
          target.x,
          geometry.sourceTop + geometry.width / 2,
          geometry.targetTop + geometry.width / 2,
          visualConfig.curvature,
        );
        group.appendChild(svgNode('path', { class: 'pto-traffic-sankey__link-band', d: path }));
        group.appendChild(svgNode('path', { class: 'pto-traffic-sankey__link-trace', d: center }));
        group.appendChild(svgNode('path', {
          class: 'pto-traffic-sankey__link-hit', d: center, 'stroke-width': Math.max(13, geometry.width),
        }));
        group.addEventListener('pointerenter', (event) => showLinkTooltip(event, link));
        group.addEventListener('pointermove', positionTooltip);
        group.addEventListener('pointerleave', () => {
          if (selectedLinkId !== link.id) tooltip.hidden = true;
        });
        group.addEventListener('click', (event) => {
          event.stopPropagation();
          selectLink(link);
          showLinkTooltip(event, link);
        });
        group.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectLink(link);
          }
        });
        svg.appendChild(group);
      });

      currentAggregate.sources.forEach((node) => renderNode(sourceColumn.layouts.get(node.id), 'source', currentAggregate.totalBytes));
      currentAggregate.targets.forEach((node) => renderNode(targetColumn.layouts.get(node.id), 'target', currentAggregate.totalBytes));
      if (selectedLinkId && !currentAggregate.links.some((link) => link.id === selectedLinkId)) selectedLinkId = null;
      updateSelection();
    }

    function setWindow(start, end, emit = true) {
      const minimumWidth = data.timeRange.step || 1;
      timeWindow.start = Math.max(data.timeRange.min, Math.min(start, data.timeRange.max - minimumWidth));
      timeWindow.end = Math.min(data.timeRange.max, Math.max(end, timeWindow.start + minimumWidth));
      selectedLinkId = null;
      selectedNodeId = null;
      focusedEventIds.clear();
      draw();
      if (emit) options.onWindowChange?.({ ...timeWindow });
    }

    function focusEventIds(ids = []) {
      selectedLinkId = null;
      selectedNodeId = null;
      focusedEventIds = new Set(ids || []);
      tooltip.hidden = true;
      updateSelection();
    }

    root.addEventListener('click', (event) => {
      if (event.target === root || event.target === canvas || event.target === svg) clearSelection();
    });
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') clearSelection();
    });

    draw();

    return {
      setData(nextData) {
        data = nextData;
        timeWindow = { ...data.defaultWindow };
        expanded.clear();
        (data.defaultExpanded?.source || []).forEach((rank) => expanded.add(`source:${rank}`));
        (data.defaultExpanded?.target || []).forEach((rank) => expanded.add(`target:${rank}`));
        selectedLinkId = null;
        selectedNodeId = null;
        focusedEventIds.clear();
        draw();
      },
      setWindow,
      setVisualConfig(nextVisualConfig = {}) {
        const previousCurvature = visualConfig.curvature;
        visualConfig = normalizeVisualConfig({ ...visualConfig, ...nextVisualConfig });
        applyVisualConfig();
        if (visualConfig.curvature !== previousCurvature) draw();
        return { ...visualConfig };
      },
      toggleRank,
      focusEventIds,
      clearSelection,
      destroy() {
        container.replaceChildren();
      },
    };
  }

  const patternApi = {
    version: '1.0.0',
    defaultVisualConfig: { ...DEFAULT_VISUAL_CONFIG },
    render,
  };
  global.PtoCommunicationTrafficSankeyPattern = patternApi;
  global.PtoMemoryTrafficSankeyPattern = patternApi;
})(window);
