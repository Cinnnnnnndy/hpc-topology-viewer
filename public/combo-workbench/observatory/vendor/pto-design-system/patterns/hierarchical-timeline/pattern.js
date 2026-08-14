(function registerPtoHierarchicalTimelinePattern(global) {
  'use strict';

  const swimlane = global.PtoSwimlaneTaskPattern;
  const ZOOM_STEPS = [1, 2, 4, 8, 16, 32, 64];
  const DEFAULTS = {
    gutterWidth: 176,
    rulerHeight: 28,
    rowHeight: 28,
    barHeight: 16,
    minimumCanvasWidth: 520,
    minimumEventWidth: 3,
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function numeric(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cssValue(styles, name, fallback) {
    return styles.getPropertyValue(name).trim() || fallback;
  }

  function formatTime(value, unit) {
    const decimals = Math.abs(value - Math.round(value)) < 0.001 ? 0 : 1;
    return `${value.toFixed(decimals)} ${unit}`;
  }

  function normalizedData(input = {}) {
    const timeRange = input.timeRange || {};
    const min = numeric(timeRange.min, 0);
    const max = Math.max(min + 1, numeric(timeRange.max, min + 1));
    const step = Math.max(0.001, numeric(timeRange.step, 1));
    const requestedWindow = input.window || {};
    const windowStart = clamp(numeric(requestedWindow.start, min), min, max - step);
    const windowEnd = clamp(numeric(requestedWindow.end, max), windowStart + step, max);
    return {
      id: input.id || 'hierarchical-timeline',
      ariaLabel: input.ariaLabel || 'Hierarchical timeline',
      emptyLabel: input.emptyLabel || 'No timeline events',
      unit: input.unit || 'ms',
      timeRange: { min, max, step },
      window: { start: windowStart, end: windowEnd },
      rows: Array.isArray(input.rows) ? input.rows : [],
      defaultExpandedIds: Array.isArray(input.defaultExpandedIds) ? input.defaultExpandedIds : [],
    };
  }

  function render(container, options = {}) {
    if (!container) throw new Error('PtoHierarchicalTimelinePattern.render requires a container.');
    if (!swimlane?.drawTaskBar) throw new Error('PtoHierarchicalTimelinePattern requires PtoSwimlaneTaskPattern.');

    container.replaceChildren();
    const root = document.createElement('div');
    root.className = 'pto-hierarchical-timeline';
    root.innerHTML = `
      <div class="pto-hierarchical-timeline__toolbar">
        <span class="pto-hierarchical-timeline__window"></span>
        <div class="pto-hierarchical-timeline__controls" aria-label="Timeline zoom controls">
          <button class="pto-hierarchical-timeline__button" type="button" data-action="zoom-out" aria-label="Zoom out">−</button>
          <span class="pto-hierarchical-timeline__zoom-readout">1×</span>
          <button class="pto-hierarchical-timeline__button" type="button" data-action="zoom-in" aria-label="Zoom in">+</button>
          <button class="pto-hierarchical-timeline__button" type="button" data-action="fit">Fit</button>
        </div>
      </div>
      <div class="pto-hierarchical-timeline__viewport" tabindex="0">
        <canvas class="pto-hierarchical-timeline__canvas"></canvas>
      </div>
      <div class="pto-hierarchical-timeline__empty" hidden></div>
      <div class="pto-hierarchical-timeline__live" aria-live="polite"></div>`;
    container.appendChild(root);

    const viewport = root.querySelector('.pto-hierarchical-timeline__viewport');
    const canvas = root.querySelector('.pto-hierarchical-timeline__canvas');
    const windowReadout = root.querySelector('.pto-hierarchical-timeline__window');
    const zoomReadout = root.querySelector('.pto-hierarchical-timeline__zoom-readout');
    const empty = root.querySelector('.pto-hierarchical-timeline__empty');
    const live = root.querySelector('.pto-hierarchical-timeline__live');
    const zoomOutButton = root.querySelector('[data-action="zoom-out"]');
    const zoomInButton = root.querySelector('[data-action="zoom-in"]');
    const fitButton = root.querySelector('[data-action="fit"]');
    const tooltip = swimlane.createTooltip();
    root.appendChild(tooltip);

    const state = {
      data: normalizedData(options.data),
      zoomIndex: 0,
      expandedIds: new Set(),
      activeRowIds: new Set(),
      relatedEventIds: new Set(),
      selectedEventId: null,
      selectedRowId: null,
      visibleRows: [],
      rowMap: new Map(),
      hitRegions: [],
      handleRegions: [],
      drag: null,
      raf: 0,
      destroyed: false,
    };

    state.data.defaultExpandedIds.forEach((id) => state.expandedIds.add(id));

    function rebuildRows() {
      state.rowMap = new Map(state.data.rows.map((row) => [row.id, row]));
      const children = new Map();
      state.data.rows.forEach((row) => {
        if (!row.parentId) return;
        const list = children.get(row.parentId) || [];
        list.push(row.id);
        children.set(row.parentId, list);
      });
      state.visibleRows = state.data.rows.filter((row) => {
        let parentId = row.parentId;
        while (parentId) {
          if (!state.expandedIds.has(parentId)) return false;
          parentId = state.rowMap.get(parentId)?.parentId;
        }
        return true;
      }).map((row) => ({ ...row, hasChildren: children.has(row.id) }));
    }

    function scheduleDraw() {
      if (state.destroyed || state.raf) return;
      state.raf = requestAnimationFrame(() => {
        state.raf = 0;
        draw();
      });
    }

    function dimensions() {
      const width = Math.max(0, viewport.clientWidth);
      const height = Math.max(0, viewport.clientHeight);
      const range = state.data.timeRange.max - state.data.timeRange.min;
      const fitPlotWidth = Math.max(240, width - DEFAULTS.gutterWidth - 24);
      const fitPixelsPerUnit = fitPlotWidth / range;
      const plotWidth = Math.max(fitPlotWidth, range * fitPixelsPerUnit * ZOOM_STEPS[state.zoomIndex]);
      return {
        viewportWidth: width,
        viewportHeight: height,
        canvasWidth: Math.max(DEFAULTS.minimumCanvasWidth, Math.ceil(DEFAULTS.gutterWidth + plotWidth + 24)),
        canvasHeight: Math.max(height, DEFAULTS.rulerHeight + state.visibleRows.length * DEFAULTS.rowHeight + 12),
        plotWidth,
        pixelsPerUnit: plotWidth / range,
      };
    }

    function eventX(value, metrics) {
      return DEFAULTS.gutterWidth + (value - state.data.timeRange.min) * metrics.pixelsPerUnit;
    }

    function valueFromCanvasX(x, metrics) {
      const raw = state.data.timeRange.min + (x - DEFAULTS.gutterWidth) / metrics.pixelsPerUnit;
      const step = state.data.timeRange.step;
      return Math.round(raw / step) * step;
    }

    function rowIsActive(row) {
      if (state.activeRowIds.has(row.id)) return true;
      let parentId = row.parentId;
      while (parentId) {
        if (state.activeRowIds.has(parentId)) return true;
        parentId = state.rowMap.get(parentId)?.parentId;
      }
      return false;
    }

    function eventIsRelated(event) {
      if (state.relatedEventIds.has(event.id)) return true;
      return (event.sourceEventIds || []).some((id) => state.relatedEventIds.has(id));
    }

    function theme() {
      const styles = getComputedStyle(root);
      return {
        background: cssValue(styles, '--background', '#101114'),
        surface: cssValue(styles, '--surface-1', '#15171b'),
        surface2: cssValue(styles, '--surface-2', '#1b1e24'),
        foreground: cssValue(styles, '--foreground', '#f2f3f5'),
        secondary: cssValue(styles, '--foreground-secondary', '#b5bac4'),
        muted: cssValue(styles, '--foreground-muted', '#777e8b'),
        border: cssValue(styles, '--border-subtle', 'rgba(127,127,127,.2)'),
        borderStrong: cssValue(styles, '--border-strong', 'rgba(127,127,127,.38)'),
        primary: cssValue(styles, '--primary', '#5b8def'),
        fontSans: cssValue(styles, '--font-sans', 'sans-serif'),
        fontMono: cssValue(styles, '--font-mono', 'monospace'),
      };
    }

    function tickStep(metrics) {
      const targetUnits = 92 / metrics.pixelsPerUnit;
      const magnitude = 10 ** Math.floor(Math.log10(Math.max(targetUnits, 0.0001)));
      return [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= targetUnits) || 10 * magnitude;
    }

    function roundedRect(context, x, y, width, height, radius) {
      context.beginPath();
      if (context.roundRect) context.roundRect(x, y, width, height, radius);
      else context.rect(x, y, width, height);
    }

    function drawChevron(context, x, y, expanded, colors) {
      context.save();
      context.translate(x, y);
      context.beginPath();
      if (expanded) {
        context.moveTo(-4, -2);
        context.lineTo(0, 2);
        context.lineTo(4, -2);
      } else {
        context.moveTo(-2, -4);
        context.lineTo(2, 0);
        context.lineTo(-2, 4);
      }
      context.strokeStyle = colors.secondary;
      context.lineWidth = 1.4;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.stroke();
      context.restore();
    }

    function draw() {
      rebuildRows();
      const metrics = dimensions();
      if (!metrics.viewportWidth || !metrics.viewportHeight) return;
      const ratio = Math.max(1, global.devicePixelRatio || 1);
      canvas.style.width = `${metrics.canvasWidth}px`;
      canvas.style.height = `${metrics.canvasHeight}px`;
      const pixelWidth = Math.round(metrics.canvasWidth * ratio);
      const pixelHeight = Math.round(metrics.canvasHeight * ratio);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      const context = canvas.getContext('2d');
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, metrics.canvasWidth, metrics.canvasHeight);
      const colors = theme();
      const scrollLeft = viewport.scrollLeft;
      const scrollTop = viewport.scrollTop;
      const stickyRulerY = scrollTop;
      const fixedGutterX = scrollLeft;
      const rowTop = DEFAULTS.rulerHeight;
      state.hitRegions = [];
      state.handleRegions = [];

      context.fillStyle = colors.background;
      context.fillRect(0, 0, metrics.canvasWidth, metrics.canvasHeight);

      const step = tickStep(metrics);
      const firstTick = Math.ceil(state.data.timeRange.min / step) * step;
      for (let value = firstTick; value <= state.data.timeRange.max + step * 0.01; value += step) {
        const x = eventX(value, metrics);
        context.strokeStyle = colors.border;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(Math.round(x) + 0.5, rowTop);
        context.lineTo(Math.round(x) + 0.5, metrics.canvasHeight);
        context.stroke();
      }

      const windowStartX = eventX(state.data.window.start, metrics);
      const windowEndX = eventX(state.data.window.end, metrics);
      context.save();
      context.globalAlpha = 0.55;
      context.fillStyle = colors.surface2;
      context.fillRect(DEFAULTS.gutterWidth, rowTop, Math.max(0, windowStartX - DEFAULTS.gutterWidth), metrics.canvasHeight - rowTop);
      context.fillRect(windowEndX, rowTop, Math.max(0, metrics.canvasWidth - windowEndX), metrics.canvasHeight - rowTop);
      context.restore();

      state.visibleRows.forEach((row, index) => {
        const y = rowTop + index * DEFAULTS.rowHeight;
        const active = rowIsActive(row);
        if (active) {
          context.fillStyle = colors.surface2;
          context.fillRect(DEFAULTS.gutterWidth, y, metrics.canvasWidth - DEFAULTS.gutterWidth, DEFAULTS.rowHeight);
        }
        context.strokeStyle = colors.border;
        context.beginPath();
        context.moveTo(DEFAULTS.gutterWidth, y + DEFAULTS.rowHeight - 0.5);
        context.lineTo(metrics.canvasWidth, y + DEFAULTS.rowHeight - 0.5);
        context.stroke();

        const events = Array.isArray(row.events) ? row.events : [];
        events.forEach((event) => {
          const start = clamp(numeric(event.start, state.data.timeRange.min), state.data.timeRange.min, state.data.timeRange.max);
          const end = clamp(numeric(event.end, start), start, state.data.timeRange.max);
          const x = eventX(start, metrics);
          const width = Math.max(DEFAULTS.minimumEventWidth, eventX(end, metrics) - x);
          const barY = y + (DEFAULTS.rowHeight - DEFAULTS.barHeight) / 2;
          const insideWindow = end >= state.data.window.start && start <= state.data.window.end;
          context.save();
          context.globalAlpha = insideWindow ? 1 : 0.28;
          swimlane.drawTaskBar(context, {
            x,
            y: barY,
            width,
            height: DEFAULTS.barHeight,
            radius: 2,
            baseColor: event.color || colors.primary,
            task: {
              ...event,
              duration: end - start,
              lane: row.label,
              laneId: row.id,
            },
            isSelected: state.selectedEventId === event.id,
            isRelated: eventIsRelated(event),
            isEmphasized: active,
            fontFamily: colors.fontSans,
          });
          context.restore();
          state.hitRegions.push({ type: 'event', x, y: barY, width, height: DEFAULTS.barHeight, row, event });
        });
      });

      context.save();
      context.fillStyle = colors.surface2;
      context.fillRect(fixedGutterX, stickyRulerY, DEFAULTS.gutterWidth, metrics.viewportHeight);
      context.fillStyle = colors.surface;
      context.fillRect(fixedGutterX, stickyRulerY, DEFAULTS.gutterWidth, DEFAULTS.rulerHeight);
      context.fillRect(fixedGutterX + DEFAULTS.gutterWidth, stickyRulerY, metrics.viewportWidth - DEFAULTS.gutterWidth, DEFAULTS.rulerHeight);
      context.strokeStyle = colors.borderStrong;
      context.beginPath();
      context.moveTo(fixedGutterX + DEFAULTS.gutterWidth - 0.5, stickyRulerY);
      context.lineTo(fixedGutterX + DEFAULTS.gutterWidth - 0.5, stickyRulerY + metrics.viewportHeight);
      context.moveTo(fixedGutterX, stickyRulerY + DEFAULTS.rulerHeight - 0.5);
      context.lineTo(fixedGutterX + metrics.viewportWidth, stickyRulerY + DEFAULTS.rulerHeight - 0.5);
      context.stroke();
      context.font = `600 10px ${colors.fontSans}`;
      context.textBaseline = 'middle';
      context.textAlign = 'left';
      context.fillStyle = colors.muted;
      context.fillText('LANE', fixedGutterX + 12, stickyRulerY + DEFAULTS.rulerHeight / 2);

      context.font = `10px ${colors.fontMono}`;
      context.fillStyle = colors.muted;
      context.textAlign = 'left';
      for (let value = firstTick; value <= state.data.timeRange.max + step * 0.01; value += step) {
        const x = eventX(value, metrics);
        if (x < fixedGutterX + DEFAULTS.gutterWidth || x > fixedGutterX + metrics.viewportWidth) continue;
        context.fillText(formatTime(value, state.data.unit), x + 4, stickyRulerY + DEFAULTS.rulerHeight / 2);
      }

      state.visibleRows.forEach((row, index) => {
        const y = rowTop + index * DEFAULTS.rowHeight;
        if (y + DEFAULTS.rowHeight < stickyRulerY + DEFAULTS.rulerHeight || y > stickyRulerY + metrics.viewportHeight) return;
        const depth = Math.max(0, numeric(row.depth, row.parentId ? 1 : 0));
        const labelX = fixedGutterX + 14 + depth * 14;
        if (rowIsActive(row)) {
          context.fillStyle = colors.surface2;
          context.fillRect(fixedGutterX, y, DEFAULTS.gutterWidth, DEFAULTS.rowHeight);
        }
        context.fillStyle = rowIsActive(row) ? colors.foreground : colors.secondary;
        context.font = `${row.hasChildren ? '600' : '500'} 11px ${colors.fontSans}`;
        if (row.hasChildren) drawChevron(context, labelX + 4, y + DEFAULTS.rowHeight / 2, state.expandedIds.has(row.id), colors);
        const textX = labelX + (row.hasChildren ? 16 : 8);
        context.save();
        context.beginPath();
        context.rect(textX, y, Math.max(0, fixedGutterX + DEFAULTS.gutterWidth - textX - 8), DEFAULTS.rowHeight);
        context.clip();
        context.fillText(row.label || row.id, textX, y + DEFAULTS.rowHeight / 2 + 0.5);
        context.restore();
        state.hitRegions.push({
          type: 'row',
          x: fixedGutterX,
          y,
          width: DEFAULTS.gutterWidth,
          height: DEFAULTS.rowHeight,
          row,
        });
      });
      context.restore();

      [
        { edge: 'start', x: windowStartX },
        { edge: 'end', x: windowEndX },
      ].forEach((handle) => {
        context.save();
        context.strokeStyle = colors.primary;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(handle.x, rowTop);
        context.lineTo(handle.x, metrics.canvasHeight);
        context.stroke();
        context.fillStyle = colors.background;
        context.strokeStyle = colors.primary;
        roundedRect(context, handle.x - 4, stickyRulerY + 6, 8, 16, 3);
        context.fill();
        context.stroke();
        context.restore();
        state.handleRegions.push({ edge: handle.edge, x: handle.x });
      });

      windowReadout.textContent = `${formatTime(state.data.window.start, state.data.unit)} – ${formatTime(state.data.window.end, state.data.unit)}`;
      zoomReadout.textContent = `${ZOOM_STEPS[state.zoomIndex]}×`;
      zoomOutButton.disabled = state.zoomIndex === 0;
      zoomInButton.disabled = state.zoomIndex === ZOOM_STEPS.length - 1;
      empty.hidden = state.visibleRows.length > 0;
      empty.textContent = state.data.emptyLabel;
      viewport.setAttribute('aria-label', state.data.ariaLabel);
    }

    function pointerPosition(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function regionAt(point, type = null) {
      return [...state.hitRegions].reverse().find((region) => {
        if (type && region.type !== type) return false;
        return point.x >= region.x && point.x <= region.x + region.width && point.y >= region.y && point.y <= region.y + region.height;
      }) || null;
    }

    function handleAt(point) {
      if (point.y > viewport.scrollTop + DEFAULTS.rulerHeight + 12) return null;
      return state.handleRegions.find((handle) => Math.abs(point.x - handle.x) <= 7) || null;
    }

    function showEventTooltip(region, event) {
      const duration = numeric(region.event.end) - numeric(region.event.start);
      swimlane.showTooltip(tooltip, region.event, event, {
        bounds: root,
        durationUnit: state.data.unit,
        getTooltipHtml(task) {
          return [
            `<div class="pto-swimlane-task-tooltip__title">${escapeHtml(task.displayName || task.label || task.id)}</div>`,
            `<div class="pto-swimlane-task-tooltip__row"><span class="pto-swimlane-task-tooltip__key">lane</span><span class="pto-swimlane-task-tooltip__value">${escapeHtml(region.row.label)}</span></div>`,
            `<div class="pto-swimlane-task-tooltip__row"><span class="pto-swimlane-task-tooltip__key">range</span><span class="pto-swimlane-task-tooltip__value">${escapeHtml(`${formatTime(task.start, state.data.unit)} – ${formatTime(task.end, state.data.unit)}`)}</span></div>`,
            `<div class="pto-swimlane-task-tooltip__row"><span class="pto-swimlane-task-tooltip__key">duration</span><span class="pto-swimlane-task-tooltip__value">${escapeHtml(formatTime(duration, state.data.unit))}</span></div>`,
          ].join('');
        },
      });
    }

    function setZoomIndex(nextIndex, anchorClientX = null) {
      const next = clamp(nextIndex, 0, ZOOM_STEPS.length - 1);
      if (next === state.zoomIndex) return;
      const before = dimensions();
      const anchor = anchorClientX == null ? viewport.clientWidth / 2 : anchorClientX;
      const timelineCanvasX = viewport.scrollLeft + anchor;
      const anchorValue = valueFromCanvasX(timelineCanvasX, before);
      state.zoomIndex = next;
      rebuildRows();
      draw();
      const after = dimensions();
      const nextCanvasX = eventX(anchorValue, after);
      viewport.scrollLeft = Math.max(0, nextCanvasX - anchor);
      scheduleDraw();
      options.onZoomChange?.({ zoom: ZOOM_STEPS[state.zoomIndex] });
    }

    function setWindow(start, end, emit = false) {
      const range = state.data.timeRange;
      const nextStart = clamp(numeric(start, state.data.window.start), range.min, range.max - range.step);
      const nextEnd = clamp(numeric(end, state.data.window.end), nextStart + range.step, range.max);
      state.data.window = { start: nextStart, end: nextEnd };
      scheduleDraw();
      if (emit) options.onWindowChange?.({ ...state.data.window });
    }

    function toggleRow(row) {
      if (!row?.hasChildren) return;
      if (state.expandedIds.has(row.id)) state.expandedIds.delete(row.id);
      else state.expandedIds.add(row.id);
      rebuildRows();
      scheduleDraw();
      options.onExpand?.({ row, expanded: state.expandedIds.has(row.id) });
    }

    function selectEvent(region) {
      state.selectedEventId = region.event.id;
      state.selectedRowId = region.row.id;
      scheduleDraw();
      const selection = { type: 'timeline', event: region.event, row: region.row };
      options.onSelect?.(selection);
      live.textContent = `${region.event.displayName || region.event.label || region.event.id}, ${formatTime(region.event.start, state.data.unit)} to ${formatTime(region.event.end, state.data.unit)}`;
    }

    function onPointerMove(event) {
      const point = pointerPosition(event);
      if (state.drag) {
        const metrics = dimensions();
        const value = valueFromCanvasX(point.x, metrics);
        if (state.drag.edge === 'start') setWindow(value, state.data.window.end, true);
        else setWindow(state.data.window.start, value, true);
        canvas.classList.add('is-resizing-window');
        swimlane.hideTooltip(tooltip);
        return;
      }
      const handle = handleAt(point);
      const region = regionAt(point, 'event');
      canvas.classList.toggle('is-resizing-window', Boolean(handle));
      canvas.classList.toggle('is-interactive', Boolean(region || regionAt(point, 'row')));
      if (region) showEventTooltip(region, event);
      else swimlane.hideTooltip(tooltip);
    }

    function onPointerDown(event) {
      const handle = handleAt(pointerPosition(event));
      if (!handle) return;
      event.preventDefault();
      state.drag = { edge: handle.edge, pointerId: event.pointerId };
      canvas.setPointerCapture?.(event.pointerId);
    }

    function onPointerUp(event) {
      if (!state.drag) return;
      canvas.releasePointerCapture?.(event.pointerId);
      state.drag = null;
      canvas.classList.remove('is-resizing-window');
      scheduleDraw();
    }

    function onClick(event) {
      if (state.drag) return;
      const point = pointerPosition(event);
      if (handleAt(point)) return;
      const eventRegion = regionAt(point, 'event');
      if (eventRegion) {
        selectEvent(eventRegion);
        return;
      }
      const rowRegion = regionAt(point, 'row');
      if (rowRegion?.row.hasChildren) {
        toggleRow(rowRegion.row);
        return;
      }
      state.selectedEventId = null;
      state.selectedRowId = null;
      scheduleDraw();
      options.onSelect?.(null);
    }

    function onKeyDown(event) {
      if ((event.key === 'Enter' || event.key === ' ') && state.selectedEventId) {
        const region = state.hitRegions.find((item) => item.type === 'event' && item.event.id === state.selectedEventId);
        if (region) {
          event.preventDefault();
          selectEvent(region);
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === '+' || event.key === '=' || event.key === '-')) {
        event.preventDefault();
        setZoomIndex(state.zoomIndex + (event.key === '-' ? -1 : 1));
      }
    }

    function onWheel(event) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      setZoomIndex(state.zoomIndex + (event.deltaY > 0 ? -1 : 1), event.clientX - rect.left);
    }

    function setData(nextData) {
      const previousExpanded = new Set(state.expandedIds);
      const previousWindow = state.data.window;
      state.data = normalizedData(nextData);
      const nextIds = new Set(state.data.rows.map((row) => row.id));
      state.expandedIds = new Set([...previousExpanded].filter((id) => nextIds.has(id)));
      if (!state.expandedIds.size) state.data.defaultExpandedIds.forEach((id) => state.expandedIds.add(id));
      if (previousWindow.start >= state.data.timeRange.min && previousWindow.end <= state.data.timeRange.max) {
        state.data.window = { ...previousWindow };
      }
      if (!nextIds.has(state.selectedRowId)) {
        state.selectedRowId = null;
        state.selectedEventId = null;
      }
      rebuildRows();
      scheduleDraw();
    }

    function focusRelatedEventIds(ids = []) {
      state.relatedEventIds = new Set(ids || []);
      root.dataset.relatedEventCount = String(state.relatedEventIds.size);
      if (state.relatedEventIds.size) {
        for (const [index, row] of state.visibleRows.entries()) {
          if ((row.events || []).some(eventIsRelated)) {
            const targetTop = DEFAULTS.rulerHeight + index * DEFAULTS.rowHeight;
            if (targetTop < viewport.scrollTop + DEFAULTS.rulerHeight || targetTop > viewport.scrollTop + viewport.clientHeight - DEFAULTS.rowHeight) {
              viewport.scrollTop = Math.max(0, targetTop - DEFAULTS.rulerHeight);
            }
            break;
          }
        }
      }
      scheduleDraw();
    }

    function setActiveRows(ids = []) {
      state.activeRowIds = new Set(ids || []);
      scheduleDraw();
    }

    function clearSelection(emit = true) {
      state.selectedEventId = null;
      state.selectedRowId = null;
      state.relatedEventIds.clear();
      root.dataset.relatedEventCount = '0';
      swimlane.hideTooltip(tooltip);
      scheduleDraw();
      if (emit) options.onSelect?.(null);
    }

    function fit() {
      state.zoomIndex = 0;
      viewport.scrollLeft = 0;
      scheduleDraw();
      options.onZoomChange?.({ zoom: 1 });
    }

    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleDraw) : null;
    resizeObserver?.observe(root);
    viewport.addEventListener('scroll', scheduleDraw, { passive: true });
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerleave', () => swimlane.hideTooltip(tooltip));
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerUp);
    viewport.addEventListener('click', onClick);
    viewport.addEventListener('keydown', onKeyDown);
    viewport.addEventListener('wheel', onWheel, { passive: false });
    zoomOutButton.addEventListener('click', () => setZoomIndex(state.zoomIndex - 1));
    zoomInButton.addEventListener('click', () => setZoomIndex(state.zoomIndex + 1));
    fitButton.addEventListener('click', fit);

    rebuildRows();
    root.dataset.relatedEventCount = '0';
    scheduleDraw();

    return {
      setData,
      setWindow,
      setActiveRows,
      focusRelatedEventIds,
      clearSelection,
      resize: scheduleDraw,
      fit,
      zoomIn() { setZoomIndex(state.zoomIndex + 1); },
      zoomOut() { setZoomIndex(state.zoomIndex - 1); },
      getState() {
        return {
          zoom: ZOOM_STEPS[state.zoomIndex],
          window: { ...state.data.window },
          expandedIds: [...state.expandedIds],
          selectedEventId: state.selectedEventId,
        };
      },
      destroy() {
        state.destroyed = true;
        if (state.raf) cancelAnimationFrame(state.raf);
        resizeObserver?.disconnect();
        root.remove();
      },
    };
  }

  global.PtoHierarchicalTimelinePattern = {
    defaults: DEFAULTS,
    zoomSteps: ZOOM_STEPS,
    render,
  };
})(window);
