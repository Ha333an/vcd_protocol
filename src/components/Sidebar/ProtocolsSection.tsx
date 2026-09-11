import React from 'react';
import { Cpu, Plus, Trash2, ChevronRight, ChevronDown } from 'lucide-react';
import { ProtocolConfig, VCDData } from '../../types';

interface ProtocolsSectionProps {
  vcdData: VCDData | null;
  signalNames: string[];
  protocols: ProtocolConfig[];
  decodedProtocols: { id: string; decoded: any[] }[];
  onAddProtocol: () => void;
  onUpdateProtocol: (id: string, updates: Partial<ProtocolConfig>) => void;
  onRemoveProtocol: (id: string) => void;
  onAutoDetect: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const ProtocolsSection: React.FC<ProtocolsSectionProps> = ({
  vcdData,
  signalNames,
  protocols,
  decodedProtocols,
  onAddProtocol,
  onUpdateProtocol,
  onRemoveProtocol,
  onAutoDetect,
  collapsed,
  onToggleCollapse,
}) => {
  return (
    <section className="bg-[#141414] border border-[#333] rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-[#f27d26]">
          <button
            onClick={onToggleCollapse}
            className="p-0.5 hover:bg-[#222] rounded transition-colors"
            title={collapsed ? "Expand Protocols" : "Collapse Protocols"}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <Cpu size={16} />
          <h2 className="text-xs font-bold uppercase tracking-widest font-mono">Protocols</h2>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={onAutoDetect}
            title="Auto Detect Protocols"
            className="p-1 hover:bg-[#222] rounded text-emerald-500 hover:text-emerald-400 transition-colors text-[10px] font-mono border border-emerald-500/30 px-2"
          >
            AUTO
          </button>
          <button 
            onClick={onAddProtocol}
            className="p-1 hover:bg-[#222] rounded text-gray-400 hover:text-white transition-colors"
            title="Add Protocol"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="space-y-4">
          {protocols.length === 0 && (
            <p className="text-xs text-gray-600 italic font-mono text-center py-4">No protocols defined</p>
          )}
          {protocols.map((protocol) => (
            <div key={protocol.id} className="p-3 bg-[#0a0a0a] border border-[#333] rounded space-y-3">
              <div className="flex justify-between items-center">
                <select 
                  value={protocol.type}
                  onChange={(e) => onUpdateProtocol(protocol.id, { type: e.target.value as any })}
                  className="bg-transparent text-xs font-bold font-mono outline-none"
                >
                  <option value="UART">UART</option>
                  <option value="SPI">SPI</option>
                  <option value="Avalon">Avalon-MM</option>
                  <option value="I2C">I2C</option>
                </select>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    {decodedProtocols.find(dp => dp.id === protocol.id)?.decoded.length || 0} events
                  </span>
                  <button onClick={() => onRemoveProtocol(protocol.id)} className="text-gray-600 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] text-gray-500 uppercase font-mono">Signal Source</label>
                <select 
                  value={protocol.signals[0] || ''}
                  onChange={(e) => onUpdateProtocol(protocol.id, { signals: [e.target.value] })}
                  className="w-full bg-[#141414] border border-[#333] rounded p-1 text-xs font-mono"
                >
                  <option value="">Select Signal</option>
                  {vcdData && signalNames.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>

              {protocol.type === 'UART' && (
                <div className="space-y-2">
                  <label className="block text-[10px] text-gray-500 uppercase font-mono">Baud Rate</label>
                  <input 
                    type="number"
                    value={protocol.config.baudRate ?? 9600}
                    onChange={(e) => onUpdateProtocol(protocol.id, { config: { ...protocol.config, baudRate: parseInt(e.target.value, 10) } })}
                    className="w-full bg-[#141414] border border-[#333] rounded p-1 text-xs font-mono"
                  />
                </div>
              )}

              {protocol.type === 'SPI' && (
                <div className="space-y-3">
                  {['SCLK', 'MOSI', 'MISO', 'CS'].map((label, idx) => (
                    <div key={label} className="space-y-1">
                      <label className="block text-[10px] text-gray-500 uppercase font-mono">{label}</label>
                      <select 
                        value={protocol.signals[idx] || ''}
                        onChange={(e) => {
                          const newSignals = [...protocol.signals];
                          newSignals[idx] = e.target.value;
                          onUpdateProtocol(protocol.id, { signals: newSignals });
                        }}
                        className="w-full bg-[#141414] border border-[#333] rounded p-1 text-xs font-mono"
                      >
                        <option value="">None</option>
                        {vcdData && signalNames.map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-1">
                      <label className="block text-[10px] text-gray-500 uppercase font-mono">CPOL</label>
                      <select 
                        value={protocol.config.cpol ?? 0}
                        onChange={(e) => onUpdateProtocol(protocol.id, { config: { ...protocol.config, cpol: parseInt(e.target.value, 10) } })}
                        className="w-full bg-[#141414] border border-[#333] rounded p-1 text-xs font-mono"
                      >
                        <option value="0">0</option>
                        <option value="1">1</option>
                      </select>
                    </div>
                    <div className="flex-1 space-y-1">
                      <label className="block text-[10px] text-gray-500 uppercase font-mono">CPHA</label>
                      <select 
                        value={protocol.config.cpha ?? 0}
                        onChange={(e) => onUpdateProtocol(protocol.id, { config: { ...protocol.config, cpha: parseInt(e.target.value, 10) } })}
                        className="w-full bg-[#141414] border border-[#333] rounded p-1 text-xs font-mono"
                      >
                        <option value="0">0</option>
                        <option value="1">1</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {protocol.type === 'Avalon' && (
                <div className="space-y-3">
                  {['CLK', 'ADDR', 'READ', 'WRITE', 'WRDATA', 'RDDATA', 'WAIT', 'RDVALID'].map((label, idx) => (
                    <div key={label} className="space-y-1">
                      <label className="block text-[10px] text-gray-500 uppercase font-mono">{label}</label>
                      <select 
                        value={protocol.signals[idx] || ''}
                        onChange={(e) => {
                          const newSignals = [...protocol.signals];
                          newSignals[idx] = e.target.value;
                          onUpdateProtocol(protocol.id, { signals: newSignals });
                        }}
                        className="w-full bg-[#141414] border border-[#333] rounded p-1 text-xs font-mono"
                      >
                        <option value="">None</option>
                        {vcdData && signalNames.map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}

              {protocol.type === 'I2C' && (
                <div className="space-y-3">
                  {['SCL', 'SDA'].map((label, idx) => (
                    <div key={label} className="space-y-1">
                      <label className="block text-[10px] text-gray-500 uppercase font-mono">{label}</label>
                      <select 
                        value={protocol.signals[idx] || ''}
                        onChange={(e) => {
                          const newSignals = [...protocol.signals];
                          newSignals[idx] = e.target.value;
                          onUpdateProtocol(protocol.id, { signals: newSignals });
                        }}
                        className="w-full bg-[#141414] border border-[#333] rounded p-1 text-xs font-mono"
                      >
                        <option value="">None</option>
                        {vcdData && signalNames.map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
