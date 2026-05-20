import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { VCDData, VCDSignal, DecodedEvent, binToHex, calculateSignalFrequency, convertTicksToUnit, getSignalValueAt } from '../utils/vcd';

const PROTOCOL_READ_COLOR = '#10b981';
const PROTOCOL_WRITE_COLOR = '#f27d26';

interface WaveformProps {
  data: VCDData;
  visibleSignals: string[];
  displayUnit: string;
  onChangeDisplayUnit?: (unit: string) => void;
  groups: { id: string; name: string; signalNames: string[]; collapsed?: boolean }[];
  protocolDecoders: {
    id: string;
    type: 'UART' | 'SPI' | 'Avalon';
    signals: string[];
    config: any;
    decoded: DecodedEvent[];
  }[];
  selectedEvent: { protocolId: string; index: number } | null;
  selectedSignalName: string | null;
  
  onSelectEvent: (protocolId: string, index: number) => void;
  onSelectSignal: (name: string | null) => void;
  onToggleGroup: (id: string) => void;
  onReorderSignal?: (signalName: string, toGroupId: string | null, toIndex: number) => void;
  movedSignalName?: string | null;
  selectedGroupId?: string | null;
  onSelectGroup?: (id: string | null) => void;
  onDeleteSignal?: (name: string) => void;
  onDeleteGroup?: (id: string) => void;
}

export const WaveformViewer: React.FC<WaveformProps> = ({
  data,
  visibleSignals,
  displayUnit,
  onChangeDisplayUnit,
  groups,
  protocolDecoders,
  selectedEvent,
  selectedSignalName,
  onSelectEvent,
  onSelectSignal,
  onToggleGroup,
  selectedGroupId,
  onSelectGroup,
  onDeleteSignal,
  onDeleteGroup,
  onReorderSignal,
  movedSignalName,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const axisContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<null | { x: number; y: number; title: string; body: string; accentColor?: string }>(null);
  const [zoom, setZoom] = useState({ start: 0, end: data.maxTime });
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const horizontalScrollRef = useRef<HTMLDivElement>(null);
  const horizontalScrollSpacerRef = useRef<HTMLDivElement>(null);
  const horizontalScrollContentWidthRef = useRef(0);
  const isSyncingHorizontalScrollRef = useRef(false);
  const currentXRef = useRef<d3.ScaleLinear<number, number> | null>(null);
  const zoomRef = useRef({ start: 0, end: data.maxTime });
  const previousDataRef = useRef<VCDData | null>(null);
  const cursorsRef = useRef<Array<{id:number; time:number; color:string}>>([]);
  const cursorIdRef = useRef(0);
  const clearCursorsRef = useRef<() => void>(() => {});
  const zoomInRef = useRef<() => void>(() => {});
  const zoomOutRef = useRef<() => void>(() => {});
  const fitToScreenRef = useRef<() => void>(() => {});

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = (width: number) => {
      setContainerWidth(prev => Math.abs(prev - width) < 1 ? prev : width);
    };

    updateWidth(container.clientWidth);

    const resizeObserver = new ResizeObserver(entries => {
      const nextWidth = entries[0]?.contentRect.width ?? container.clientWidth;
      updateWidth(nextWidth);
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current || !data) return;

    if (previousDataRef.current !== data) {
      zoomRef.current = { start: 0, end: data.maxTime };
      previousDataRef.current = data;
      setZoom(zoomRef.current);
    }

    const margin = { top: 40, right: 40, bottom: 40, left: 150 };
    const outerWidth = containerWidth || containerRef.current.clientWidth;
    const width = Math.max(1, outerWidth - margin.left - margin.right);
    const signalHeight = 30;
    const signalSpacing = 10;
    const groupPadding = 10;
    const bottomPadding = signalHeight;

    // Calculate inner waveform content height.
    let innerHeight = 0;
    
    // Ungrouped signals
    innerHeight += visibleSignals.length * (signalHeight + signalSpacing);
    
    // Groups
    groups.forEach(g => {
      innerHeight += signalHeight; // Group header
      if (!g.collapsed) {
        innerHeight += g.signalNames.length * (signalHeight + signalSpacing);
      } else {
        innerHeight += (signalHeight + signalSpacing); // Bus view
      }
      innerHeight += groupPadding;
    });
    innerHeight += bottomPadding;

    const totalHeight = margin.top + innerHeight + margin.bottom;

    d3.select(containerRef.current).selectAll('svg').remove();
    if (axisContainerRef.current) d3.select(axisContainerRef.current).selectAll('svg').remove();

    const svg = d3.select(containerRef.current)
      .append('svg')
      .attr('width', outerWidth)
      .attr('height', totalHeight)
      .style('cursor', 'crosshair');
    
    svgRef.current = svg.node();

    const stickyAxisSvg = d3.select(axisContainerRef.current)
      .append('svg')
      .attr('width', outerWidth)
      .attr('height', margin.top)
      .attr('class', 'time-axis')
      .style('display', 'block')
      .style('background', '#141414')
      .style('pointer-events', 'none');

    const stickyAxisG = stickyAxisSvg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top - 1})`);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const activeZoom = zoomRef.current;
    const x = d3.scaleLinear()
      .domain([activeZoom.start, activeZoom.end])
      .range([0, width]);

    // Grid lines
    const grid = g.append('g')
      .attr('class', 'grid')
      .attr('transform', `translate(0,${innerHeight})`);

    const stickyXAxis = stickyAxisG.append('g')
      .attr('class', 'x-axis');

    const cursorLine = g.append('line')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#f27d26')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4')
      .style('opacity', 0)
      .attr('pointer-events', 'none');

    // shared between render and event handlers
    let signalPositions: Array<any> = [];
    let markerGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

    const lowerBoundByTime = (values: { time: number; value: string }[], time: number) => {
      let low = 0;
      let high = values.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (values[mid].time < time) low = mid + 1;
        else high = mid;
      }
      return low;
    };

    const getVisibleTimes = (signal: VCDSignal, xMin: number, xMax: number) => {
      const visibleTimes: number[] = [xMin];
      const values = signal.values || [];
      let lastTime = xMin;

      for (let i = lowerBoundByTime(values, xMin); i < values.length; i++) {
        const time = values[i].time;
        if (time >= xMax) break;
        if (time > xMin && time !== lastTime) {
          visibleTimes.push(time);
          lastTime = time;
        }
      }

      if (xMax !== lastTime) visibleTimes.push(xMax);
      return visibleTimes;
    };

    const hasExplicitUnknownAtTime = (signal: VCDSignal, time: number) => {
      const values = signal.values || [];
      let index = lowerBoundByTime(values, time);
      while (index < values.length && values[index].time === time) {
        const value = values[index].value.toLowerCase();
        if (value === 'x' || value === 'z') return true;
        index++;
      }
      return false;
    };

    const getDisplaySignalValueAt = (signal: VCDSignal, time: number): string => (
      getSignalValueAt(signal, time, signal.values?.[0]?.value ?? 'x')
    );

    const updateHorizontalScrollbar = (domain: [number, number]) => {
      const scrollEl = horizontalScrollRef.current;
      const spacerEl = horizontalScrollSpacerRef.current;
      if (!scrollEl || !spacerEl) return;

      const viewportWidth = Math.max(1, scrollEl.clientWidth);
      const maxTime = Math.max(1, data.maxTime);
      const visibleSpan = Math.max(1, Math.min(maxTime, domain[1] - domain[0]));
      const contentWidth = visibleSpan >= maxTime
        ? viewportWidth
        : Math.min(1_000_000, Math.max(viewportWidth + 1, viewportWidth * (maxTime / visibleSpan)));

      horizontalScrollContentWidthRef.current = contentWidth;
      spacerEl.style.width = `${contentWidth}px`;

      const maxScroll = Math.max(0, contentWidth - viewportWidth);
      const maxStart = Math.max(0, maxTime - visibleSpan);
      const targetScrollLeft = maxStart > 0 ? (domain[0] / maxStart) * maxScroll : 0;

      isSyncingHorizontalScrollRef.current = true;
      scrollEl.scrollLeft = targetScrollLeft;
      requestAnimationFrame(() => {
        isSyncingHorizontalScrollRef.current = false;
      });
    };

    const getTooltipPosition = (event: MouseEvent) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        x: event.clientX - rect.left + 8,
        y: event.clientY - rect.top + 8
      };
    };

    const setZoomDomain = (start: number, end: number) => {
      const maxTime = Math.max(1, data.maxTime);
      const span = Math.max(1, Math.min(maxTime, end - start));
      const maxStart = Math.max(0, maxTime - span);
      const nextStart = Math.max(0, Math.min(maxStart, start));
      const nextEnd = nextStart + span;
      const nextZoom = { start: nextStart, end: nextEnd };
      const nextX = d3.scaleLinear()
        .domain([nextStart, nextEnd])
        .range([0, width]);

      zoomRef.current = nextZoom;
      setZoom(nextZoom);
      x.domain([nextStart, nextEnd]);
      svg.property('__zoom', d3.zoomIdentity);
      updateHorizontalScrollbar([nextStart, nextEnd]);
      render(nextX);
    };

    const zoomAroundCenter = (factor: number) => {
      const { start, end } = zoomRef.current;
      const center = (start + end) / 2;
      const nextSpan = Math.max(1, Math.min(Math.max(1, data.maxTime), (end - start) * factor));
      setZoomDomain(center - nextSpan / 2, center + nextSpan / 2);
    };

    zoomInRef.current = () => zoomAroundCenter(0.5);
    zoomOutRef.current = () => zoomAroundCenter(2);
    fitToScreenRef.current = () => setZoomDomain(0, Math.max(1, data.maxTime));

    const render = (currentX: d3.ScaleLinear<number, number>) => {
      currentXRef.current = currentX;
      signalPositions = [];
      // marker group for clicks
      if (!markerGroup || markerGroup.empty()) markerGroup = g.append('g').attr('class', 'marker-group');
      // draw persisted cursors
      const drawCursors = () => {
        if (!markerGroup) return;
        markerGroup.selectAll('*').remove();
        // labels at top: create/select a dedicated group on svg (not the waveform group)
        let labelsGroup = svg.select<SVGGElement>('.cursor-labels');
        if (labelsGroup.empty()) {
          labelsGroup = svg.append('g').attr('class', 'cursor-labels').attr('transform', `translate(${margin.left},${8})`);
        }
        labelsGroup.selectAll('*').remove();

        const cs = cursorsRef.current;
        const markerLabels = cs
          .map(c => ({
            cursor: c,
            xPos: currentXRef.current ? currentXRef.current(c.time) : 0,
            text: `${convertTicksToUnit(c.time, data.timescale, displayUnit).toFixed(3)} ${displayUnit}`
          }))
          .sort((a, b) => a.xPos - b.xPos);
        const labelLaneRight = [-Infinity, -Infinity];
        const labelPlacements = new Map<number, { lane: number; text: string; width: number } | null>();

        for (const label of markerLabels) {
          const labelWidth = Math.max(76, label.text.length * 7 + 12);
          const labelLeft = label.xPos + 4;
          const lane = labelLaneRight.findIndex(right => labelLeft > right + 4);

          if (lane === -1) {
            labelPlacements.set(label.cursor.id, null);
            continue;
          }

          labelLaneRight[lane] = labelLeft + labelWidth;
          labelPlacements.set(label.cursor.id, { lane, text: label.text, width: labelWidth });
        }

        for (let idx = 0; idx < cs.length; idx++) {
          const c = cs[idx];
          if (!currentXRef.current) continue;
          const xPos = currentXRef.current(c.time);
          const label = labelPlacements.get(c.id);
          const labelY = label ? -8 + label.lane * 20 : -6;
          const labelHeight = label ? 18 : 10;
          const labelWidth = label?.width ?? 8;
          // dashed vertical line in waveform area
          markerGroup.append('line')
            .attr('x1', xPos)
            .attr('x2', xPos)
            .attr('y1', 0)
            .attr('y2', innerHeight)
            .attr('stroke', c.color)
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '6,4')
            .attr('pointer-events', 'none');

          // label on top timeline for readability
          labelsGroup.append('rect')
            .attr('x', xPos + 4)
            .attr('y', labelY)
            .attr('width', labelWidth)
            .attr('height', labelHeight)
            .attr('rx', 3)
            .attr('fill', '#000')
            .attr('fill-opacity', label ? 0.45 : 0.75);

          if (label) {
            labelsGroup.append('text')
              .attr('x', xPos + 8)
              .attr('y', 6 + label.lane * 20)
              .attr('fill', c.color)
              .style('font-size', '11px')
              .style('font-family', 'var(--font-mono)')
              .text(label.text);
          }

          // interactive hit area for marker tooltip (shows distances to other markers)
          labelsGroup.append('rect')
            .attr('x', xPos + 4)
            .attr('y', labelY)
            .attr('width', labelWidth)
            .attr('height', labelHeight)
            .attr('fill', 'transparent')
            .style('cursor', 'pointer')
            .on('mousemove', (e: any) => {
              try {
                const pos = getTooltipPosition(e as MouseEvent);
                if (!pos) return;
                const others = cs.filter(o => o.id !== c.id);
                if (others.length === 0) {
                  setTooltip({ ...pos, title: 'Marker', body: 'No other markers' });
                  return;
                }
                const distances = others.map(o => ({ id: o.id, time: o.time, delta: Math.abs(o.time - c.time) }));
                distances.sort((a, b) => a.delta - b.delta);
                const lines = distances.map(d => {
                  const deltaUnit = convertTicksToUnit(d.delta, data.timescale, displayUnit).toFixed(3);
                  const tUnit = convertTicksToUnit(d.time, data.timescale, displayUnit).toFixed(3);
                  return `${deltaUnit} ${displayUnit} → ${tUnit} ${displayUnit}`;
                });
                setTooltip({ ...pos, title: 'Distances', body: lines.join('\n') });
              } catch { /* ignore */ }
            })
            .on('mouseout', () => setTooltip(null));
        }

        // show delta between last two cursors on top timeline
        if (cs.length >= 2 && currentXRef.current) {
          const a = cs[cs.length - 2];
          const b = cs[cs.length - 1];
          const xa = currentXRef.current(a.time);
          const xb = currentXRef.current(b.time);
          const midX = (xa + xb) / 2;
          const delta = Math.abs(b.time - a.time);

          // horizontal double-arrow
          const yArrow = 20;
          labelsGroup.append('line')
            .attr('x1', xa)
            .attr('x2', xb)
            .attr('y1', yArrow)
            .attr('y2', yArrow)
            .attr('stroke', '#9ae6b4')
            .attr('stroke-width', 1.5)
            .attr('pointer-events', 'none');

          const headSize = 6;
          // left arrowhead (pointing left)
          labelsGroup.append('path')
            .attr('d', `M ${xa} ${yArrow} L ${xa + headSize} ${yArrow - headSize/2} L ${xa + headSize} ${yArrow + headSize/2} Z`)
            .attr('fill', '#9ae6b4')
            .attr('pointer-events', 'none');

          // right arrowhead (pointing right)
          labelsGroup.append('path')
            .attr('d', `M ${xb} ${yArrow} L ${xb - headSize} ${yArrow - headSize/2} L ${xb - headSize} ${yArrow + headSize/2} Z`)
            .attr('fill', '#9ae6b4')
            .attr('pointer-events', 'none');

          labelsGroup.append('rect')
            .attr('x', midX + 2)
            .attr('y', -8)
            .attr('height', 18)
            .attr('width', 140)
            .attr('rx', 3)
            .attr('fill', '#000')
            .attr('fill-opacity', 0.3)
            .attr('pointer-events', 'none');

          labelsGroup.append('text')
            .attr('x', midX + 8)
            .attr('y', 6)
            .attr('fill', '#9ae6b4')
            .style('font-size', '11px')
            .style('font-family', 'var(--font-mono)')
            .attr('pointer-events', 'none')
            .text(`${convertTicksToUnit(delta, data.timescale, displayUnit).toFixed(3)} ${displayUnit}`);
        }
      };
      grid.call(d3.axisBottom(currentX).ticks(10).tickSize(-innerHeight).tickFormat(() => ''))
        .style('stroke', '#333')
        .style('stroke-opacity', 0.2);

      stickyXAxis.call(d3.axisTop(currentX).ticks(10).tickFormat(d => {
        const val = convertTicksToUnit(Number(d), data.timescale, displayUnit);
        return `${val.toFixed(1)}${displayUnit}`;
      }));

      g.selectAll('.waveform-group').remove();
      const waveG = g.append('g').attr('class', 'waveform-group');

      let currentY = 0;

      const renderSignal = (sigName: string, y: number, color: string = '#00ff00', labelColor: string = '#888', groupId: string | null = null) => {
        const signal = data.signals.get(sigName);
        if (!signal) return;
          signalPositions.push({ type: 'signal', name: signal.name, y, height: signalHeight, signal, groupId });

        const [xMin, xMax] = currentX.domain();
        const isSelected = selectedSignalName === signal.name;

        // Signal Label
        const label = signal.name.split('.').pop() || signal.name;
        const freq = (label.toLowerCase().includes('clk') || label.toLowerCase().includes('clock')) 
          ? calculateSignalFrequency(signal, data.timescale) 
          : null;

        const labelGroup = waveG.append('g')
          .style('cursor', 'pointer')
          .on('click', (e: any) => {
            e.stopPropagation();
            onSelectSignal(isSelected ? null : signal.name);
          })
          .on('mousemove', (e: any) => {
            try {
              const pos = getTooltipPosition(e as MouseEvent);
              if (!pos) return;
              const short = label;
              const full = signal.name;
              setTooltip({ ...pos, title: short, body: full });
            } catch { /* ignore */ }
          })
          .on('mouseout', () => setTooltip(null));

        const labelText = labelGroup.append('text')
          .attr('x', -10)
          .attr('y', y + signalHeight / 2)
          .attr('text-anchor', 'end')
          .attr('alignment-baseline', 'middle')
          .attr('fill', isSelected ? '#f27d26' : labelColor)
          .style('font-size', '11px')
          .style('font-family', 'var(--font-mono)')
          .style('font-weight', isSelected ? 'bold' : 'normal');

        labelText.append('tspan')
          .text(label);

        // Debug badge: show number of recorded values for this signal (helps diagnose empty rows)
        labelText.append('tspan')
          .attr('x', -10)
          .attr('dy', '1.2em')
          .attr('fill', '#6b7280')
          .style('font-size', '8px')
          .style('opacity', 0.7)
          .text(`(${signal.values.length})`);

        if (freq) {
          labelText.append('tspan')
            .attr('x', -10)
            .attr('dy', '1.2em')
            .attr('fill', isSelected ? '#f27d26' : '#10b981')
            .style('font-size', '8px')
            .style('opacity', 0.6)
            .text(` (${freq})`);
        }

        // (Removed up/down buttons) drag-to-reorder is used instead.

        if (isSelected) {
          waveG.append('rect')
            .attr('x', 0)
            .attr('y', y - 5)
            .attr('width', width)
            .attr('height', signalHeight + 10)
            .attr('fill', '#f27d26')
            .attr('fill-opacity', 0.05)
            .attr('pointer-events', 'none');
        }

        if (signal.size > 1) {
          // Render as bus
          const visibleTimes = getVisibleTimes(signal, xMin, xMax);

          for (let i = 0; i < visibleTimes.length - 1; i++) {
            const tStart = visibleTimes[i];
            const tEnd = visibleTimes[i+1];
            const xStart = currentX(tStart);
            const xEnd = currentX(tEnd);
            const rectWidth = xEnd - xStart;

            if (rectWidth < 0.5) continue;

            const val = getDisplaySignalValueAt(signal, tStart);
            const hex = binToHex(val);

            const busG = waveG.append('g');

            busG.append('rect')
              .attr('x', xStart)
              .attr('y', y)
              .attr('width', rectWidth)
              .attr('height', signalHeight)
              .attr('fill', isSelected ? '#2a1a0a' : '#1a1a1a')
              .attr('stroke', isSelected ? '#f27d26' : '#555')
              .attr('stroke-width', isSelected ? 1.5 : 1);

            if (rectWidth > 30) {
              busG.append('text')
                .attr('x', xStart + rectWidth / 2)
                .attr('y', y + signalHeight / 2)
                .attr('text-anchor', 'middle')
                .attr('alignment-baseline', 'middle')
                .attr('fill', isSelected ? '#f27d26' : color)
                .style('font-size', '10px')
                .style('font-family', 'var(--font-mono)')
                .text(`0x${hex}`);
            }
          }
          return;
        }

        // Render X/Z states as colored rectangles, and draw waveform path only for 0/1 values
        const visibleTimes = getVisibleTimes(signal, xMin, xMax);

        // Draw X/Z background segments first
        for (let i = 0; i < visibleTimes.length - 1; i++) {
          const tStart = visibleTimes[i];
          const tEnd = visibleTimes[i+1];
          const xStart = currentX(tStart);
          const xEnd = currentX(tEnd);
          const rectWidth = xEnd - xStart;
          if (rectWidth < 0.5) continue;

          const valRaw = getDisplaySignalValueAt(signal, tStart);
          const val = (valRaw || '').toLowerCase();

          // Only render X/Z if it's actually present in the signal's recorded values
          // at this exact time, or if the first recorded value itself is X/Z
          // (treat initial explicit unknowns as valid to show)
          const hasExplicitAtTime = hasExplicitUnknownAtTime(signal, tStart);
          const firstIsUnknown = signal.values.length > 0 && (signal.values[0].value.toLowerCase() === 'x' || signal.values[0].value.toLowerCase() === 'z') && tStart <= signal.values[0].time;

          if ((val === 'x' || val === 'z') && (hasExplicitAtTime || firstIsUnknown)) {
            const fillColor = val === 'x' ? '#ef4444' : '#3b82f6';
            waveG.append('rect')
              .attr('x', xStart)
              .attr('y', y)
              .attr('width', rectWidth)
              .attr('height', signalHeight)
              .attr('fill', fillColor)
              .attr('fill-opacity', 0.12)
              .attr('pointer-events', 'none');

            // optional small label for visibility
            if (rectWidth > 18) {
              waveG.append('text')
                .attr('x', xStart + rectWidth / 2)
                .attr('y', y + signalHeight / 2)
                .attr('text-anchor', 'middle')
                .attr('alignment-baseline', 'middle')
                .attr('fill', fillColor)
                .style('font-size', '10px')
                .style('font-family', 'var(--font-mono)')
                .attr('pointer-events', 'none')
                .text(val.toUpperCase());
            }
          }
        }

        // Build waveform path using only '0' and '1' intervals
        const pathPoints: [number, number][] = [];
        let haveStarted = false;
        let lastY = 0;

        for (let i = 0; i < visibleTimes.length - 1; i++) {
          const tStart = visibleTimes[i];
          const tEnd = visibleTimes[i+1];
          const xStart = currentX(tStart);
          const xEnd = currentX(tEnd);

          const val = getDisplaySignalValueAt(signal, tStart);
          if (val === '0' || val === '1') {
            const valY = (val === '1' ? 0 : signalHeight) + y;
            if (!haveStarted) {
              // start path at left edge
              pathPoints.push([currentX(xMin), valY]);
              lastY = valY;
              haveStarted = true;
            }
            // vertical transition at tStart
            pathPoints.push([xStart, lastY]);
            pathPoints.push([xStart, valY]);
            lastY = valY;
            // continue to end of interval
            pathPoints.push([xEnd, lastY]);
          }
        }

        if (pathPoints.length > 0) {
          waveG.append('path')
            .datum(pathPoints)
            .attr('fill', 'none')
            .attr('stroke', isSelected ? '#f27d26' : color)
            .attr('stroke-width', isSelected ? 2 : 1.5)
            .attr('stroke-linejoin', 'round')
            .attr('d', d3.line());
        }
      };

      const renderBus = (group: { name: string; signalNames: string[] }, y: number) => {
        const [xMin, xMax] = currentX.domain();
        
        // Signal Label
        waveG.append('text')
          .attr('x', -10)
          .attr('y', y + signalHeight / 2)
          .attr('text-anchor', 'end')
          .attr('alignment-baseline', 'middle')
          .attr('fill', '#f27d26')
          .style('font-size', '11px')
          .style('font-family', 'var(--font-mono)')
          .style('font-weight', 'bold')
          .text(group.name);

        // Find visible transition times for all signals in the group
        const transitionTimes = new Set<number>();
        group.signalNames.forEach(name => {
          const sig = data.signals.get(name);
          if (!sig) return;
          const values = sig.values || [];
          for (let i = lowerBoundByTime(values, xMin); i < values.length; i++) {
            const time = values[i].time;
            if (time >= xMax) break;
            if (time > xMin) transitionTimes.add(time);
          }
        });
        
        const sortedTimes = Array.from(transitionTimes).sort((a, b) => a - b);
        const visibleTimes = [xMin, ...sortedTimes.filter(t => t > xMin && t < xMax), xMax];

        // record bus position for click alignment
        signalPositions.push({ type: 'bus', name: group.name, y, height: signalHeight, signalNames: group.signalNames });

        for (let i = 0; i < visibleTimes.length - 1; i++) {
          const tStart = visibleTimes[i];
          const tEnd = visibleTimes[i+1];
          const xStart = currentX(tStart);
          const xEnd = currentX(tEnd);
          const rectWidth = xEnd - xStart;

          if (rectWidth < 0.5) continue;

          // Calculate hex value at this time
          let binStr = "";
          group.signalNames.forEach((name) => {
            const sig = data.signals.get(name);
            if (sig) {
              binStr += getDisplaySignalValueAt(sig, tStart);
            } else {
              binStr += 'x';
            }
          });

          const hex = binToHex(binStr);

          const busG = waveG.append('g');
          
          // Bus diamond shape (simplified as rect for now but with bus styling)
          busG.append('rect')
            .attr('x', xStart)
            .attr('y', y)
            .attr('width', rectWidth)
            .attr('height', signalHeight)
            .attr('fill', '#1a1a1a')
            .attr('stroke', '#555')
            .attr('stroke-width', 1);

          if (rectWidth > 30) {
            busG.append('text')
              .attr('x', xStart + rectWidth / 2)
              .attr('y', y + signalHeight / 2)
              .attr('text-anchor', 'middle')
              .attr('alignment-baseline', 'middle')
              .attr('fill', '#00ff00')
              .style('font-size', '10px')
              .style('font-family', 'var(--font-mono)')
              .text(`0x${hex}`);
          }
        }
      };

      // 1. Render Groups
      groups.forEach(group => {
        // Group Header
          const headerG = waveG.append('g')
            .style('cursor', 'pointer')
            .on('click', (event: any) => { event.stopPropagation(); onToggleGroup(group.id); if (onSelectGroup) onSelectGroup(group.id); });

        const headerHeight = signalHeight; // make header same height as a signal row
        headerG.append('text')
          .attr('x', -140)
          .attr('y', currentY + headerHeight / 2)
          .attr('fill', '#10b981') // emerald-500 hex
          .style('font-size', '10px')
          .style('font-weight', 'bold')
          .style('font-family', 'var(--font-mono)')
          .style('text-transform', 'uppercase')
          .attr('alignment-baseline', 'middle')
          .text(`${group.collapsed ? '▶' : '▼'} ${group.name}`);

        headerG.append('line')
          .attr('x1', -140)
          .attr('y1', currentY + headerHeight)
          .attr('x2', width)
          .attr('y2', currentY + headerHeight)
          .attr('stroke', '#333')
          .attr('stroke-dasharray', '2,2');

        // header click already handled above (toggle + select)

        // If this group corresponds to a protocol group (id prefixed with 'proto_'),
        // render its decoded events on the header row so they remain visible when collapsed.
        try {
          const protoPrefix = 'proto_';
          const protoId = group.id && group.id.startsWith(protoPrefix) ? group.id.substring(protoPrefix.length) : null;
          if (protoId && protocolDecoders && protocolDecoders.length > 0) {
            const decoder = protocolDecoders.find(p => p.id === protoId);
            if (decoder && decoder.decoded && decoder.decoded.length > 0) {
              const headerEventsY = currentY + (headerHeight - 12) / 2; // vertically center a 12px tall event
              const [xMin, xMax] = currentX.domain();
              decoder.decoded.forEach((event, eIdx) => {
                if (event.endTime < xMin || event.startTime > xMax) return;
                const xStart = Math.max(currentX(event.startTime), 0);
                const xEnd = Math.min(currentX(event.endTime), width);
                let rectWidth = xEnd - xStart;
                if (rectWidth < 2 && rectWidth > -width) rectWidth = 2;
                if (rectWidth < 0.5) return;

                  const eventG = waveG.append('g')
                    .style('cursor', 'pointer')
                    .on('click', (e: any) => { e.stopPropagation(); onSelectEvent(decoder.id, eIdx); })
                    .on('mousemove', (e: any) => {
                      try {
                        const pos = getTooltipPosition(e as MouseEvent);
                        if (!pos) return;
                        const labelUpper = (event.label || '').toString().toUpperCase();
                        const dataUpper = (event.data || '').toString().toUpperCase();
                        const isWrite = labelUpper.startsWith('WR') || dataUpper.includes('WRITE');
                        const isRead = labelUpper.startsWith('RD') || dataUpper.includes('READ');

                        let title = `${decoder.type} ${event.label || ''}`.trim();
                        let bodyLines: string[] = [];

                        // concise tooltip: show RD/WR, Address, then Data
                        if (decoder.type === 'Avalon') {
                          const extractHex = (s: string | undefined) => {
                            if (!s) return null;
                            const m = s.match(/0x([0-9A-Fa-f]+)/);
                            return m ? `0x${m[1].toUpperCase()}` : null;
                          };

                          const thisHex = extractHex(event.data);
                          if (isRead) title = 'RD';
                          else if (isWrite) title = 'WR';

                          if (labelUpper.startsWith('RD DATA')) {
                            const prior = decoder.decoded.slice().reverse().find(ev => ev.endTime <= event.startTime && (ev.label || '').toString().toUpperCase().startsWith('RD REQ'));
                            const addrHex = extractHex(prior?.data);
                            if (addrHex) bodyLines.push(`Addr: ${addrHex}`);
                            if (thisHex) bodyLines.push(`Data: ${thisHex}`);
                          } else if (labelUpper.startsWith('RD REQ')) {
                            const next = decoder.decoded.find(ev => ev.startTime >= event.startTime && (ev.label || '').toString().toUpperCase().startsWith('RD DATA'));
                            const dataHex = extractHex(next?.data) || thisHex;
                            const addrHex = extractHex(event.data) || extractHex(event.label);
                            if (addrHex) bodyLines.push(`Addr: ${addrHex}`);
                            if (dataHex) bodyLines.push(`Data: ${dataHex}`);
                          } else if (isWrite) {
                            // try extract addr/data from event.data
                            const addrHex = extractHex(event.data) || extractHex(event.label);
                            if (addrHex) bodyLines.push(`Addr: ${addrHex}`);
                            if (thisHex) bodyLines.push(`Data: ${thisHex}`);
                          } else {
                            if (thisHex) bodyLines.push(`Data: ${thisHex}`);
                          }
                        } else {
                          // non-Avalon: show label and data compactly
                          title = (event.label || decoder.type).toString();
                          if (event.data) bodyLines.push(event.data.toString());
                        }

                        const body = bodyLines.join('\n');
                        const accentColor = isRead ? PROTOCOL_READ_COLOR : (isWrite ? PROTOCOL_WRITE_COLOR : undefined);
                        setTooltip({ ...pos, title, body, accentColor });
                      } catch { /* ignore */ }
                    })
                    .on('mouseout', () => setTooltip(null));

                const eventHeight = Math.max(12, headerHeight - 8);
                const eventY = currentY + (headerHeight - eventHeight) / 2;

                const labelUpper = (event.label || '').toString().toUpperCase();
                const dataUpper = (event.data || '').toString().toUpperCase();
                const isWrite = labelUpper.startsWith('WR') || dataUpper.includes('WRITE');
                const isRead = labelUpper.startsWith('RD') || dataUpper.includes('READ');
                const eventColor = isRead ? PROTOCOL_READ_COLOR : (isWrite ? PROTOCOL_WRITE_COLOR : PROTOCOL_WRITE_COLOR);

                eventG.append('rect')
                  .attr('x', xStart)
                  .attr('y', eventY)
                  .attr('width', rectWidth)
                  .attr('height', eventHeight)
                  .attr('fill', eventColor)
                  .attr('fill-opacity', 0.25)
                  .attr('stroke', eventColor)
                  .attr('stroke-width', 1);

                if (rectWidth > 30) {
                  eventG.append('text')
                    .attr('x', xStart + rectWidth / 2)
                    .attr('y', eventY + eventHeight / 2 + 2)
                    .attr('text-anchor', 'middle')
                    .attr('alignment-baseline', 'middle')
                    .attr('fill', '#fff')
                    .style('font-size', '10px')
                    .style('font-family', 'var(--font-mono)')
                      .text(event.label);
                }
              });
            }
          }
        } catch (err) { /* ignore render errors for protocols */ }

        currentY += headerHeight;

        if (!group.collapsed) {
          // draw a faint box behind the group's signal rows to indicate membership
          const signalsCount = group.signalNames.length;
          const boxY = currentY;
          const boxHeight = Math.max(0, signalsCount * (signalHeight + signalSpacing) - signalSpacing);
          const groupAccent = '#3b82f6'; // light blue
          waveG.append('rect')
            .attr('x', 0)
            .attr('y', boxY - 4)
            .attr('width', width)
            .attr('height', boxHeight + 8)
            .attr('rx', 6)
            .attr('fill', groupAccent)
            .attr('fill-opacity', 0.04)
            .attr('stroke', groupAccent)
            .attr('stroke-opacity', 0.22)
            .attr('stroke-width', 1.2)
            .attr('pointer-events', 'none');

          group.signalNames.forEach(sigName => {
            renderSignal(sigName, currentY, '#60a5fa', '#60a5fa', group.id);
            currentY += signalHeight + signalSpacing;
          });
        } else {
          renderBus(group, currentY);
          currentY += signalHeight + signalSpacing;
        }

        currentY += groupPadding;
      });

      // 2. Render Ungrouped Signals
      visibleSignals.forEach(sigName => {
        renderSignal(sigName, currentY, '#00ff00', '#888', null);
        currentY += signalHeight + signalSpacing;
      });

      // draw persisted cursors after rendering waveforms
      try { drawCursors(); } catch { /* ignore */ }
    };

    const findNearestTransition = (signal: VCDSignal, time: number) => {
      if (!signal || signal.values.length === 0) return null;
      let nearest = signal.values[0];
      let minDiff = Math.abs(signal.values[0].time - time);
      for (let i = 1; i < signal.values.length; i++) {
        const diff = Math.abs(signal.values[i].time - time);
        if (diff < minDiff) { minDiff = diff; nearest = signal.values[i]; }
      }
      // find previous value if exists
      let prevVal = 'x';
      for (let i = 0; i < signal.values.length; i++) {
        if (signal.values[i].time >= nearest.time) {
          prevVal = i > 0 ? signal.values[i-1].value : 'x';
          break;
        }
      }
      return { time: nearest.time, prevVal, nextVal: nearest.value };
    };

    svg.on('click', (e) => {
      if (!currentXRef.current) return;
      const [mx, my] = d3.pointer(e);
      // only allow adding markers when clicking inside the waveform area (not on the left labels)
      if (mx <= margin.left) return;
      const clickTime = currentXRef.current.invert(mx - margin.left);
      const innerY = my - margin.top;

      // find vertically aligned signal row
      let row = signalPositions.find(p => innerY >= p.y && innerY <= p.y + p.height);
      if (!row) {
        // pick closest by vertical distance
        let best: any = null; let bestD = Infinity;
        for (const p of signalPositions) {
          const cy = p.y + p.height / 2;
          const d = Math.abs(cy - innerY);
          if (d < bestD) { bestD = d; best = p; }
        }
        row = best;
      }

      if (!row) return;

      // Use exact clicked time for cursor (do not snap to transitions)
      const cursorTime = clickTime;

      // Add cursor (do not remove previous)
      const color = (cursorIdRef.current % 2 === 0) ? '#3b82f6' : '#10b981';
      cursorsRef.current.push({ id: cursorIdRef.current++, time: cursorTime, color });

      // redraw cursors
      if (markerGroup) {
        // drawCursors is defined in render scope; call via re-render
        // invoke render with same X to ensure cursors are drawn
        if (currentXRef.current) render(currentXRef.current);
      }
    });

    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 10000])
      .translateExtent([[0, 0], [width, totalHeight]])
      .on('zoom', (event) => {
        const newX = event.transform.rescaleX(x);
        const [start, end] = newX.domain();
        zoomRef.current = { start, end };
        setZoom(zoomRef.current);
        updateHorizontalScrollbar([start, end]);
        render(newX);
      });

    svg.call(zoomBehavior);

    const handleHorizontalScroll = () => {
      if (isSyncingHorizontalScrollRef.current) return;

      const scrollEl = horizontalScrollRef.current;
      if (!scrollEl) return;

      const { start, end } = zoomRef.current;
      const maxTime = Math.max(1, data.maxTime);
      const visibleSpan = Math.max(1, Math.min(maxTime, end - start));
      const maxStart = Math.max(0, maxTime - visibleSpan);
      if (maxStart <= 0) return;

      const contentWidth = horizontalScrollContentWidthRef.current || scrollEl.scrollWidth;
      const maxScroll = Math.max(1, contentWidth - scrollEl.clientWidth);
      const nextStart = Math.max(0, Math.min(maxStart, (scrollEl.scrollLeft / maxScroll) * maxStart));
      setZoomDomain(nextStart, nextStart + visibleSpan);
    };

    const horizontalScrollEl = horizontalScrollRef.current;
    horizontalScrollEl?.addEventListener('scroll', handleHorizontalScroll, { passive: true });

    // If a protocol event is selected, add a marker for it (avoid duplicates).
    if (selectedEvent && protocolDecoders) {
      const key = `${selectedEvent.protocolId}-${selectedEvent.index}`;
      const decoder = protocolDecoders.find(d => d.id === selectedEvent.protocolId);
      if (decoder && decoder.decoded && decoder.decoded[selectedEvent.index]) {
        const evt = decoder.decoded[selectedEvent.index];
        const exists = cursorsRef.current.find(c => (c as any).eventKey === key);
        if (!exists) {
          const color = '#f27d26';
          cursorsRef.current.push({ id: cursorIdRef.current++, time: evt.startTime, color, eventKey: key } as any);
        }
      }
    } else if (!selectedEvent) {
      // remove any event markers when deselected
      cursorsRef.current = cursorsRef.current.filter(c => !(c as any).eventKey);
      cursorIdRef.current = cursorsRef.current.length > 0 ? Math.max(...cursorsRef.current.map(c => c.id)) + 1 : 0;
    }

    render(x);
    updateHorizontalScrollbar([activeZoom.start, activeZoom.end]);

    // If a movedSignalName is provided, animate a highlight on that row
    try {
      if (movedSignalName && movedSignalName.length > 0) {
        const target = signalPositions.find(p => p.type === 'signal' && p.name === movedSignalName);
        if (target) {
          const highlight = g.append('rect')
            .attr('x', 0)
            .attr('y', target.y - 5)
            .attr('width', width)
            .attr('height', target.height + 10)
            .attr('fill', '#f27d26')
            .attr('fill-opacity', 0.6)
            .attr('pointer-events', 'none');

          highlight.transition().duration(900).attr('fill-opacity', 0).remove();
        }
      }
    } catch { /* ignore animation errors */ }

    // expose clear function to UI
    clearCursorsRef.current = () => {
      cursorsRef.current = [];
      cursorIdRef.current = 0;
      if (markerGroup) markerGroup.selectAll('*').remove();
      const labels = svg.select('.cursor-labels');
      if (!labels.empty()) labels.remove();
      if (currentXRef.current) render(currentXRef.current);
    };

    // Fit to screen shortcut (F key) + move selected with Alt+ArrowUp/Down
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTypingTarget = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;

      if (!isTypingTarget && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        zoomInRef.current();
      }
      if (!isTypingTarget && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        zoomOutRef.current();
      }
      if (!isTypingTarget && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        fitToScreenRef.current();
      }
      if (e.key === 'Delete') {
        if (selectedSignalName && onDeleteSignal) {
          onDeleteSignal(selectedSignalName);
        } else if (selectedGroupId && onDeleteGroup) {
          onDeleteGroup(selectedGroupId);
        }
      }

      // Move selected signal with Alt+ArrowUp/ArrowDown
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey && selectedSignalName && onReorderSignal) {
        const rows = signalPositions.filter(p => p.type === 'signal');
        const idx = rows.findIndex(r => r.name === selectedSignalName);
        if (idx === -1) return;

        const curr = rows[idx];
        const currGroupId = curr.groupId || null;

        // determine destination index within same group
        let destIdx = idx + (e.key === 'ArrowUp' ? -1 : 1);
        if (destIdx < 0) destIdx = 0;
        if (destIdx > rows.length - 1) destIdx = rows.length - 1;

        // if moving across group boundaries, compute destGroupId and index
        const destRow = rows[destIdx];
        const destGroupId = destRow ? (destRow.groupId || null) : null;

        // compute index among rows in dest group
        const rowsInDest = rows.filter(r => (r.groupId || null) === destGroupId);
        let destIndexInGroup = rowsInDest.length;
        if (destRow) {
          destIndexInGroup = rowsInDest.findIndex(r => r.name === destRow.name);
        }

        onReorderSignal(selectedSignalName, destGroupId, destIndexInGroup);
      }
    }

    // attach keyboard handler
    window.addEventListener('keydown', handleKeyDown);

    // Hover tooltip and cursor line
    svg.on('mousemove', (e: any) => {
      if (!currentXRef.current) return;
      const [mx, my] = d3.pointer(e);
      const time = currentXRef.current.invert(mx - margin.left);
      const [xStart, xEnd] = currentXRef.current.domain();
      if (time >= xStart && time <= xEnd) {
        setHoverTime(time);
        cursorLine.attr('x1', currentXRef.current(time)).attr('x2', currentXRef.current(time)).style('opacity', 1);

        if (mx > margin.left) {
          const innerY = my - margin.top;
          let row = signalPositions.find(p => innerY >= p.y && innerY <= p.y + p.height);
          if (!row) {
            let best: any = null; let bestD = Infinity;
            for (const p of signalPositions) {
              const cy = p.y + p.height / 2;
              const d = Math.abs(cy - innerY);
              if (d < bestD) { bestD = d; best = p; }
            }
            row = best;
          }

          if (row && row.type === 'signal') {
            try {
              const timeUnit = convertTicksToUnit(time, data.timescale, displayUnit).toFixed(3);
              const sig: VCDSignal = row.signal;
              const val = getDisplaySignalValueAt(sig, time);
              let hex = 'X';
              let dec: string | number = 'X';

              if (sig.size > 1) {
                hex = binToHex(val);
                if (hex !== 'X') dec = BigInt('0x' + hex).toString();
              } else {
                hex = val === '1' ? '0x1' : (val === '0' ? '0x0' : 'X');
                dec = val === '1' ? 1 : (val === '0' ? 0 : 'X');
              }
              const short = (sig.name.split('.').pop() || sig.name);
              const pos = getTooltipPosition(e as MouseEvent);
              if (pos) {
                setTooltip({ ...pos, title: short, body: `Time: ${timeUnit} ${displayUnit}\nHex: ${hex}\nDec: ${dec}` });
              }
            } catch { /* ignore */ }
          }
        }
      } else {
        setHoverTime(null);
        cursorLine.style('opacity', 0);
        setTooltip(null);
      }
    });

    svg.on('mouseleave', () => {
      setHoverTime(null);
      cursorLine.style('opacity', 0);
      setTooltip(null);
    });

    return () => {
      svg.on('.zoom', null);
      horizontalScrollEl?.removeEventListener('scroll', handleHorizontalScroll);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [data, visibleSignals, displayUnit, protocolDecoders, selectedEvent, selectedSignalName, groups, onToggleGroup, onSelectEvent, onSelectSignal, movedSignalName, onReorderSignal, containerWidth]);

  return (
    <div ref={rootRef} className="relative h-full min-h-0 w-full overflow-hidden bg-[#141414] rounded-lg border border-[#333] p-4 flex flex-col gap-4">
      <div className="flex-shrink-0 flex justify-between items-center">
        <div className="flex gap-4 text-[10px] text-gray-500 font-mono uppercase tracking-widest">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#00ff00]"></div>
            <span>Signal</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#f27d26]"></div>
            <span>Protocol</span>
          </div>
          <span className="ml-4">Scroll to Zoom • Drag to Pan • Click to Select</span>
        </div>
        
        <div className="flex items-center gap-4 text-[10px] font-mono">
          <div className="flex items-center gap-1">
            <button
              onClick={() => zoomInRef.current()}
              className="p-1 bg-[#0b1220] border border-[#333] rounded text-gray-300 hover:bg-[#111827] hover:text-[#f27d26] transition-colors"
              title="Zoom in (+)"
            >
              <ZoomIn size={14} />
            </button>
            <button
              onClick={() => zoomOutRef.current()}
              className="p-1 bg-[#0b1220] border border-[#333] rounded text-gray-300 hover:bg-[#111827] hover:text-[#f27d26] transition-colors"
              title="Zoom out (-)"
            >
              <ZoomOut size={14} />
            </button>
            <button
              onClick={() => fitToScreenRef.current()}
              className="p-1 bg-[#0b1220] border border-[#333] rounded text-gray-300 hover:bg-[#111827] hover:text-[#f27d26] transition-colors"
              title="Fit to screen (F)"
            >
              <Maximize2 size={14} />
            </button>
          </div>
          <div className="flex items-center gap-2 text-gray-500">
            <span className="uppercase tracking-widest opacity-50">Cursor:</span>
            <span className="text-[#f27d26] font-bold min-w-[80px]">
              {hoverTime !== null 
                ? `${convertTicksToUnit(hoverTime, data.timescale, displayUnit).toFixed(3)} ${displayUnit}`
                : '---'}
            </span>
          </div>
          {onChangeDisplayUnit && (
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-gray-400">Unit</label>
              <select value={displayUnit} onChange={e => onChangeDisplayUnit(e.target.value)} className="bg-[#0b1220] border border-[#333] rounded p-1 text-xs font-mono text-white outline-none">
                <option value="s">s</option>
                <option value="ms">ms</option>
                <option value="us">us</option>
                <option value="ns">ns</option>
                <option value="ps">ps</option>
              </select>
            </div>
          )}
          <div>
            <button
              onClick={() => clearCursorsRef.current()}
              className="ml-2 px-2 py-1 bg-[#0b1220] border border-[#333] text-xs rounded text-gray-300 hover:bg-[#111827]"
            >
              Clear Cursors
            </button>
          </div>
        </div>
      </div>

      <div ref={axisContainerRef} className="flex-shrink-0 w-full border-t border-[#333]" />

      <div className="w-full flex-1 min-h-0 overflow-auto custom-scrollbar">
        <div ref={containerRef} className="w-full" />
      </div>

      <div
        ref={horizontalScrollRef}
        className="flex-shrink-0 h-4 overflow-x-auto overflow-y-hidden custom-scrollbar"
        title="Scroll horizontally through the zoomed waveform"
      >
        <div ref={horizontalScrollSpacerRef} className="h-px w-full" />
      </div>

      {tooltip && (
        <div style={{ left: tooltip.x, top: tooltip.y }} className="absolute z-50 pointer-events-none">
          <div className="bg-black text-white p-2 rounded text-xs font-mono whitespace-pre-line max-w-[320px] border border-[#333]">
            <div className="font-bold mb-1" style={{ color: tooltip.accentColor }}>{tooltip.title}</div>
            <div style={{ color: tooltip.accentColor }}>{tooltip.body}</div>
          </div>
        </div>
      )}

    </div>
  );
};
