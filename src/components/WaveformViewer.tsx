import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { VCDData, VCDSignal, DecodedEvent, binToHex, calculateSignalFrequency, convertTicksToUnit } from '../utils/vcd';

interface WaveformProps {
  data: VCDData;
  visibleSignals: string[];
  displayUnit: string;
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
}

export const WaveformViewer: React.FC<WaveformProps> = ({ 
  data, 
  visibleSignals, 
  displayUnit,
  groups,
  protocolDecoders,
  selectedEvent,
  selectedSignalName,
  onSelectEvent,
  onSelectSignal,
  onToggleGroup
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState({ start: 0, end: data.maxTime });
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const currentXRef = useRef<d3.ScaleLinear<number, number> | null>(null);
  const cursorsRef = useRef<Array<{id:number; time:number; color:string}>>([]);
  const cursorIdRef = useRef(0);
  const clearCursorsRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!containerRef.current || !data) return;

    const margin = { top: 40, right: 40, bottom: 40, left: 150 };
    const width = containerRef.current.clientWidth - margin.left - margin.right;
    const signalHeight = 30;
    const signalSpacing = 10;
    const groupPadding = 10;

    // Calculate total height
    let totalHeight = margin.top + margin.bottom;
    
    // Ungrouped signals
    totalHeight += visibleSignals.length * (signalHeight + signalSpacing);
    
    // Groups
    groups.forEach(g => {
      totalHeight += 20; // Group header
      if (!g.collapsed) {
        totalHeight += g.signalNames.length * (signalHeight + signalSpacing);
      } else {
        totalHeight += (signalHeight + signalSpacing); // Bus view
      }
      totalHeight += groupPadding;
    });

    // Protocols
    totalHeight += protocolDecoders.length * (signalHeight + signalSpacing);

    d3.select(containerRef.current).selectAll('svg').remove();

    const svg = d3.select(containerRef.current)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', totalHeight)
      .style('cursor', 'crosshair');
    
    svgRef.current = svg.node();

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
      .domain([zoom.start, zoom.end])
      .range([0, width]);

    // Grid lines
    const grid = g.append('g')
      .attr('class', 'grid')
      .attr('transform', `translate(0,${totalHeight - margin.top - margin.bottom})`);

    const xAxis = g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,0)`);

    const cursorLine = g.append('line')
      .attr('y1', 0)
      .attr('y2', totalHeight - margin.top - margin.bottom)
      .attr('stroke', '#f27d26')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4')
      .style('opacity', 0)
      .attr('pointer-events', 'none');

    // shared between render and event handlers
    let signalPositions: Array<any> = [];
    let markerGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

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

        const innerHeight = totalHeight - margin.top - margin.bottom;
        const cs = cursorsRef.current;

        for (let idx = 0; idx < cs.length; idx++) {
          const c = cs[idx];
          if (!currentXRef.current) continue;
          const xPos = currentXRef.current(c.time);
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
            .attr('y', -8)
            .attr('height', 18)
            .attr('rx', 3)
            .attr('fill', '#000')
            .attr('fill-opacity', 0.45)
            .attr('pointer-events', 'none');

          labelsGroup.append('text')
            .attr('x', xPos + 8)
            .attr('y', 6)
            .attr('fill', c.color)
            .style('font-size', '11px')
            .style('font-family', 'var(--font-mono)')
            .attr('pointer-events', 'none')
            .text(`${convertTicksToUnit(c.time, data.timescale, displayUnit).toFixed(3)} ${displayUnit}`);
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
      grid.call(d3.axisBottom(currentX).ticks(10).tickSize(-totalHeight + margin.top + margin.bottom).tickFormat(() => ''))
        .style('stroke', '#333')
        .style('stroke-opacity', 0.2);

      xAxis.call(d3.axisTop(currentX).ticks(10).tickFormat(d => {
        const val = convertTicksToUnit(Number(d), data.timescale, displayUnit);
        return `${val.toFixed(1)}${displayUnit}`;
      }));

      g.selectAll('.waveform-group').remove();
      const waveG = g.append('g').attr('class', 'waveform-group');

      let currentY = 0;

      const renderSignal = (sigName: string, y: number, color: string = '#00ff00', labelColor: string = '#888') => {
        const signal = data.signals.get(sigName);
        if (!signal) return;
        signalPositions.push({ type: 'signal', name: signal.name, y, height: signalHeight, signal });

        const [xMin, xMax] = currentX.domain();
        const isSelected = selectedSignalName === signal.name;

        // Signal Label
        const label = signal.name.split('.').pop() || signal.name;
        const freq = (label.toLowerCase().includes('clk') || label.toLowerCase().includes('clock')) 
          ? calculateSignalFrequency(signal, data.timescale) 
          : null;

        const labelGroup = waveG.append('g')
          .style('cursor', 'pointer')
          .on('click', (e) => {
            e.stopPropagation();
            onSelectSignal(isSelected ? null : signal.name);
          });

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

        if (freq) {
          labelText.append('tspan')
            .attr('x', -10)
            .attr('dy', '1.2em')
            .attr('fill', isSelected ? '#f27d26' : '#10b981')
            .style('font-size', '8px')
            .style('opacity', 0.6)
            .text(` (${freq})`);
        }

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
          const transitionTimes = new Set<number>();
          signal.values.forEach(v => transitionTimes.add(v.time));
          const sortedTimes = Array.from(transitionTimes).sort((a, b) => a - b);
          const visibleTimes = [xMin, ...sortedTimes.filter(t => t > xMin && t < xMax), xMax];

          for (let i = 0; i < visibleTimes.length - 1; i++) {
            const tStart = visibleTimes[i];
            const tEnd = visibleTimes[i+1];
            const xStart = currentX(tStart);
            const xEnd = currentX(tEnd);
            const rectWidth = xEnd - xStart;

            if (rectWidth < 0.5) continue;

            const val = getSignalValueAt(signal, tStart);
            const hex = binToHex(val);

            const busG = waveG.append('g')
              .style('cursor', 'pointer')
              .on('click', (e) => {
                e.stopPropagation();
                onSelectSignal(isSelected ? null : signal.name);
              });

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

        const points: [number, number][] = [];
        
        let currentVal = '0';
        for (const v of signal.values) {
          if (v.time <= xMin) currentVal = v.value;
          else break;
        }

        let lastY = (currentVal === '1' ? 0 : signalHeight) + y;
        points.push([currentX(xMin), lastY]);

        signal.values.forEach((v) => {
          if (v.time < xMin) return;
          if (v.time > xMax) return;

          const valY = (v.value === '1' ? 0 : signalHeight) + y;
          points.push([currentX(v.time), lastY]);
          points.push([currentX(v.time), valY]);
          lastY = valY;
        });
        
        points.push([currentX(xMax), lastY]);

        waveG.append('path')
          .datum(points)
          .attr('fill', 'none')
          .attr('stroke', isSelected ? '#f27d26' : color)
          .attr('stroke-width', isSelected ? 2 : 1.5)
          .attr('stroke-linejoin', 'round')
          .attr('d', d3.line())
          .style('cursor', 'pointer')
          .on('click', (e) => {
            e.stopPropagation();
            onSelectSignal(isSelected ? null : signal.name);
          });
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

        // Find all transition times for all signals in the group
        const transitionTimes = new Set<number>();
        group.signalNames.forEach(name => {
          const sig = data.signals.get(name);
          if (sig) sig.values.forEach(v => transitionTimes.add(v.time));
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
              binStr += getSignalValueAt(sig, tStart);
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
          .on('click', () => onToggleGroup(group.id));

        headerG.append('text')
          .attr('x', -140)
          .attr('y', currentY + 10)
          .attr('fill', '#10b981') // emerald-500 hex
          .style('font-size', '10px')
          .style('font-weight', 'bold')
          .style('font-family', 'var(--font-mono)')
          .style('text-transform', 'uppercase')
          .text(`${group.collapsed ? '▶' : '▼'} ${group.name}`);

        headerG.append('line')
          .attr('x1', -140)
          .attr('y1', currentY + 15)
          .attr('x2', width)
          .attr('y2', currentY + 15)
          .attr('stroke', '#333')
          .attr('stroke-dasharray', '2,2');

        currentY += 20;

        if (!group.collapsed) {
          group.signalNames.forEach(sigName => {
            renderSignal(sigName, currentY, '#00ff00', '#aaa');
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
        renderSignal(sigName, currentY);
        currentY += signalHeight + signalSpacing;
      });

      // 3. Render Protocol Decoders
      protocolDecoders.forEach((decoder, dIdx) => {
        const yOffset = currentY;
        const [xMin, xMax] = currentX.domain();

        // register protocol row for click alignment
        signalPositions.push({ type: 'protocol', name: decoder.type, y: yOffset, height: signalHeight, decoder });

        waveG.append('text')
          .attr('x', -10)
          .attr('y', yOffset + signalHeight / 2)
          .attr('text-anchor', 'end')
          .attr('alignment-baseline', 'middle')
          .attr('fill', '#f27d26')
          .style('font-weight', 'bold')
          .style('font-size', '11px')
          .text(`${decoder.type}`);

        decoder.decoded.forEach((event, eIdx) => {
          if (event.endTime < xMin || event.startTime > xMax) return;

          const xStart = Math.max(currentX(event.startTime), 0);
          const xEnd = Math.min(currentX(event.endTime), width);
          let rectWidth = xEnd - xStart;

          // Ensure minimum visibility
          if (rectWidth < 2 && rectWidth > -width) {
            rectWidth = 2;
          }

          if (rectWidth < 0.5) return;

          const isSelected = selectedEvent?.protocolId === decoder.id && selectedEvent?.index === eIdx;

          const eventG = waveG.append('g')
            .style('cursor', 'pointer')
            .on('click', (e) => {
              e.stopPropagation();
              onSelectEvent(decoder.id, eIdx);
            });

          eventG.append('rect')
            .attr('x', xStart)
            .attr('y', yOffset)
            .attr('width', rectWidth)
            .attr('height', signalHeight)
            .attr('fill', '#f27d26')
            .attr('fill-opacity', isSelected ? 0.6 : 0.2)
            .attr('stroke', '#f27d26')
            .attr('stroke-width', isSelected ? 2 : 1);

          if (rectWidth > 20) {
            eventG.append('text')
              .attr('x', xStart + rectWidth / 2)
              .attr('y', yOffset + signalHeight / 2)
              .attr('text-anchor', 'middle')
              .attr('alignment-baseline', 'middle')
              .attr('fill', '#fff')
              .style('font-size', '10px')
              .style('font-family', 'var(--font-mono)')
              .text(event.label);
          }
        });

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

    const getSignalValueAt = (signal: VCDSignal, time: number): string => {
      let lastVal = 'x';
      for (const v of signal.values) {
        if (v.time > time) return lastVal;
        lastVal = v.value;
      }
      return lastVal;
    };

    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 10000])
      .translateExtent([[0, 0], [width, totalHeight]])
      .on('zoom', (event) => {
        const newX = event.transform.rescaleX(x);
        render(newX);
      });

    svg.call(zoomBehavior);
    render(x);

    // expose clear function to UI
    clearCursorsRef.current = () => {
      cursorsRef.current = [];
      cursorIdRef.current = 0;
      if (markerGroup) markerGroup.selectAll('*').remove();
      const labels = svg.select('.cursor-labels');
      if (!labels.empty()) labels.remove();
      if (currentXRef.current) render(currentXRef.current);
    };

    // Fit to screen shortcut (F key)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'f') {
        svg.transition()
          .duration(500)
          .call(zoomBehavior.transform, d3.zoomIdentity);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Initial render
    svg.on('mousemove', (e) => {
      if (!currentXRef.current) return;
      const [mx] = d3.pointer(e);
      const time = currentXRef.current.invert(mx - margin.left);
      if (time >= zoom.start && time <= zoom.end) {
        setHoverTime(time);
        cursorLine.attr('x1', currentXRef.current(time)).attr('x2', currentXRef.current(time)).style('opacity', 1);
      } else {
        setHoverTime(null);
        cursorLine.style('opacity', 0);
      }
    });

    svg.on('mouseleave', () => {
      setHoverTime(null);
      cursorLine.style('opacity', 0);
    });

    return () => {
      svg.on('.zoom', null);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [data, visibleSignals, displayUnit, protocolDecoders, selectedEvent, selectedSignalName, groups, onToggleGroup, onSelectEvent, onSelectSignal, zoom]);

  return (
    <div className="w-full bg-[#141414] rounded-lg border border-[#333] p-4 flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-4 text-[10px] text-gray-500 font-mono uppercase tracking-widest">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#00ff00]"></div>
            <span>Signal</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#f27d26]"></div>
            <span>Protocol</span>
          </div>
          <span className="ml-4">Scroll to Zoom • Drag to Pan • Click to Select • Press 'F' to Fit</span>
        </div>
        
        <div className="flex items-center gap-4 text-[10px] font-mono">
          <div className="flex items-center gap-2 text-gray-500">
            <span className="uppercase tracking-widest opacity-50">Cursor:</span>
            <span className="text-[#f27d26] font-bold min-w-[80px]">
              {hoverTime !== null 
                ? `${convertTicksToUnit(hoverTime, data.timescale, displayUnit).toFixed(3)} ${displayUnit}`
                : '---'}
            </span>
          </div>
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

      <div className="w-full overflow-y-auto max-h-[600px] custom-scrollbar border-t border-[#333] pt-4">
        <div ref={containerRef} className="w-full" />
      </div>

      <div className="flex justify-between items-center px-2 py-1 bg-[#0a0a0a] rounded border border-[#333] text-[9px] font-mono text-gray-500">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="opacity-50 uppercase">Visible Range:</span>
            <span className="text-gray-300">
              {convertTicksToUnit(zoom.start, data.timescale, displayUnit).toFixed(1)} - {convertTicksToUnit(zoom.end, data.timescale, displayUnit).toFixed(1)} {displayUnit}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
