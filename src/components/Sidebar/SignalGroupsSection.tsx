import React from 'react';
import { Settings, Plus, Trash2, ChevronRight, ChevronDown } from 'lucide-react';
import { SignalGroup, VCDData } from '../../types';

interface SignalGroupsSectionProps {
  vcdData: VCDData | null;
  signalNames: string[];
  groups: SignalGroup[];
  onAddGroup: () => void;
  onUpdateGroup: (id: string, updates: Partial<SignalGroup>) => void;
  onRemoveGroup: (id: string) => void;
  onAddSignalToGroup: (groupId: string, signalName: string) => void;
  onRemoveSignalFromGroup: (groupId: string, signalName: string) => void;
  onAutoGroup: () => void;
  onClearAllSignals: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const SignalGroupsSection: React.FC<SignalGroupsSectionProps> = ({
  vcdData,
  signalNames,
  groups,
  onAddGroup,
  onUpdateGroup,
  onRemoveGroup,
  onAddSignalToGroup,
  onRemoveSignalFromGroup,
  onAutoGroup,
  onClearAllSignals,
  collapsed,
  onToggleCollapse,
}) => {
  return (
    <section className="bg-[#141414] border border-[#333] rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-emerald-500">
          <button
            onClick={onToggleCollapse}
            className="p-0.5 hover:bg-[#222] rounded transition-colors"
            title={collapsed ? "Expand Signal Groups" : "Collapse Signal Groups"}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <Settings size={16} />
          <h2 className="text-xs font-bold uppercase tracking-widest font-mono">Signal Groups</h2>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={onAutoGroup}
            title="Auto Group by Suffix & Hierarchy"
            className="p-1 hover:bg-[#222] rounded text-emerald-500 hover:text-emerald-400 transition-colors text-[10px] font-mono border border-emerald-500/30 px-2"
          >
            AUTO
          </button>
          <button 
            onClick={onAddGroup}
            className="p-1 hover:bg-[#222] rounded text-gray-400 hover:text-white transition-colors"
            title="Add Signal Group"
          >
            <Plus size={16} />
          </button>
          <button 
            onClick={onClearAllSignals}
            title="Clear all signals and groups"
            className="p-1 hover:bg-[#222] rounded text-gray-400 hover:text-red-400 transition-colors"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="space-y-4">
          {groups.length === 0 && (
            <p className="text-xs text-gray-600 italic font-mono text-center py-4">No groups defined</p>
          )}
          {groups.map((group) => (
            <div key={group.id} className="p-3 bg-[#0a0a0a] border border-[#333] rounded space-y-3">
              <div className="flex justify-between items-center">
                <input 
                  value={group.name}
                  onChange={(e) => onUpdateGroup(group.id, { name: e.target.value })}
                  className="bg-transparent text-xs font-bold font-mono outline-none border-b border-transparent focus:border-[#f27d26] w-full mr-2"
                />
                <button onClick={() => onRemoveGroup(group.id)} className="text-gray-600 hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {group.signalNames.map(sig => (
                    <span key={sig} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#141414] border border-[#333] rounded text-[10px] font-mono">
                      {sig}
                      <button onClick={() => onRemoveSignalFromGroup(group.id, sig)} className="hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <select 
                  onChange={(e) => {
                    if (e.target.value) onAddSignalToGroup(group.id, e.target.value);
                    e.target.value = '';
                  }}
                  className="w-full bg-[#141414] border border-[#333] rounded p-1 text-xs font-mono"
                >
                  <option value="">Add Signal...</option>
                  {vcdData && signalNames.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
