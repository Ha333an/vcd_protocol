import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { VCDData, VCDSignal, DecodedEvent, binToHex } from '../utils/vcd';

interface WaveformProps {
  data: VCDData;
  visibleSignals: string[];
  groups: { id: string; name: string; signalNames: string[]; collapsed?: boolean }[];
  protocolDecoders: {
    id: string;
    type: 'UART' | 'SPI' | 'Avalon';
    signals: string[];
    config: any;
    decoded: DecodedEvent[];
  }[];
  selectedEvent: { protocolId: string; index: number } | null;
  onSelectEvent: (protocolId: string, index: number) => void;
  onToggleGroup: (id: string) => void;
}

export const WaveformViewer: React.FC<WaveformProps> = ({ 
  data, 
  visibleSignals, 
  groups,
  protocolDecoders,
  selectedEvent,
  onSelectEvent,
  onToggleGroup
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState({ start: 0, end: data.maxTime });
  const svgRef = useRef<SVGSVGElement | null>(null);

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

    const render = (currentX: d3.ScaleLinear<number, number>) => {
      grid.call(d3.axisBottom(currentX).ticks(10).tickSize(-totalHeight + margin.top + margin.bottom).tickFormat(() => ''))
        .style('stroke', '#333')
        .style('stroke-opacity', 0.2);

      xAxis.call(d3.axisTop(currentX).ticks(10).tickFormat(d => `${Math.round(Number(d))}${data.timescale}`));

      g.selectAll('.waveform-group').remove();
      const waveG = g.append('g').attr('class', 'waveform-group');

      let currentY = 0;

      const renderSignal = (sigName: string, y: number, color: string = '#00ff00', labelColor: string = '#888') => {
        const signal = data.signals.get(sigName);
        if (!signal) return;

        const [xMin, xMax] = currentX.domain();

        // Signal Label
        waveG.append('text')
          .attr('x', -10)
          .attr('y', y + signalHeight / 2)
          .attr('text-anchor', 'end')
          .attr('alignment-baseline', 'middle')
          .attr('fill', labelColor)
          .style('font-size', '11px')
          .style('font-family', 'var(--font-mono)')
          .text(signal.name.split('.').pop() || signal.name);

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

            const busG = waveG.append('g');
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
                .attr('fill', color)
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
          .attr('stroke', color)
          .attr('stroke-width', 1.5)
          .attr('stroke-linejoin', 'round')
          .attr('d', d3.line());
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
    };

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
    return () => {
      svg.on('.zoom', null);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [data, visibleSignals, protocolDecoders, selectedEvent, groups, onToggleGroup, onSelectEvent, zoom]);

  return (
    <div className="w-full bg-[#141414] rounded-lg border border-[#333] p-4">
      <div className="flex justify-between items-center mb-4">
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
      </div>
      <div ref={containerRef} className="w-full overflow-hidden" />
    </div>
  );
};
