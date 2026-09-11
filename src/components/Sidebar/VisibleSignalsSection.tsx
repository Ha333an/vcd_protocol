import React, { useState, useMemo } from 'react';
import { Settings, ChevronRight, ChevronDown } from 'lucide-react';
import { VCDData } from '../../types';
import { calculateSignalFrequency } from '../../utils/vcd';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface VisibleSignalsSectionProps {
  vcdData: VCDData;
  signalNames: string[];
  visibleSignals: string[];
  onVisibleSignalsChange: (signals: string[]) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const VisibleSignalsSection: React.FC<VisibleSignalsSectionProps> = ({
  vcdData,
  signalNames,
  visibleSignals,
  onVisibleSignalsChange,
  collapsed,
  onToggleCollapse,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredSignalNames = useMemo(() => {
    const search = searchTerm.toLowerCase();
    if (!search) return signalNames;
    return signalNames.filter(name => name.toLowerCase().includes(search));
  }, [signalNames, searchTerm]);

  return (
    <section className={cn("bg-[#141414] border border-[#333] rounded-lg p-4", !collapsed && "max-h-[400px] overflow-y-auto")}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-[#f27d26]">
          <button
            onClick={onToggleCollapse}
            className="p-0.5 hover:bg-[#222] rounded transition-colors"
            title={collapsed ? "Expand Visible Signals" : "Collapse Visible Signals"}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <Settings size={16} />
          <h2 className="text-xs font-bold uppercase tracking-widest font-mono">Visible Signals</h2>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => onVisibleSignalsChange(signalNames)}
            className="text-[10px] font-mono text-[#f27d26] hover:text-[#f27d26]/80 border border-[#f27d26]/30 px-1.5 rounded transition-colors"
          >
            ALL
          </button>
          <button 
            onClick={() => onVisibleSignalsChange([])}
            className="text-[10px] font-mono text-gray-500 hover:text-gray-400 border border-gray-500/30 px-1.5 rounded transition-colors"
          >
            NONE
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          <input
            type="text"
            placeholder="Search signals..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#0a0a0a] border border-[#333] rounded px-2 py-1.5 text-xs font-mono text-gray-400 placeholder-gray-600 mb-3 focus:outline-none focus:border-[#f27d26] transition-colors"
          />
          <div className="space-y-1">
            {filteredSignalNames.map((name: string) => (
              <label key={name} className="flex items-center gap-2 p-1 hover:bg-[#222] rounded cursor-pointer group">
                <input 
                  type="checkbox"
                  checked={visibleSignals.includes(name)}
                  onChange={(e) => {
                    if (e.target.checked) onVisibleSignalsChange([...visibleSignals, name]);
                    else onVisibleSignalsChange(visibleSignals.filter(s => s !== name));
                  }}
                  className="accent-[#f27d26]"
                />
                <div className="flex flex-col">
                  <span className="text-xs font-mono text-gray-400 group-hover:text-white transition-colors">{name}</span>
                  {vcdData.signals.get(name) && (name.toLowerCase().includes('clk') || name.toLowerCase().includes('clock')) && (
                    <span className="text-[9px] text-emerald-500 font-mono opacity-60">
                      {calculateSignalFrequency(vcdData.signals.get(name)!, vcdData.timescale)}
                    </span>
                  )}
                </div>
              </label>
            ))}
          </div>
        </>
      )}
    </section>
  );
};
