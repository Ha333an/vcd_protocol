import React, { useState, useCallback } from 'react';
import { Upload, Cpu, Activity, Settings, Plus, Trash2, ChevronRight, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { parseVCD, VCDData, decodeUART, decodeSPI, decodeAvalon, DecodedEvent, calculateSignalFrequency, calculateSignalMeasurements, detectBestDisplayUnit } from './utils/vcd';
import { WaveformViewer } from './components/WaveformViewer';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ProtocolConfig {
  id: string;
  type: 'UART' | 'SPI' | 'Avalon';
  signals: string[];
  config: {
    baudRate?: number;
    cpol?: number;
    cpha?: number;
  };
  collapsed?: boolean;
}

interface SignalGroup {
  id: string;
  name: string;
  signalNames: string[];
  collapsed?: boolean;
}

export default function App() {
  const [vcdData, setVcdData] = useState<VCDData | null>(null);
  const [visibleSignals, setVisibleSignals] = useState<string[]>([]);
  const [groups, setGroups] = useState<SignalGroup[]>([]);
  const [protocols, setProtocols] = useState<ProtocolConfig[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<{ protocolId: string; index: number } | null>(null);
  const [selectedSignalName, setSelectedSignalName] = useState<string | null>(null);
  const [displayUnit, setDisplayUnit] = useState<string>('ns');

  const loadVcdContent = useCallback((content: string) => {
    const parsed = parseVCD(content);
    setVcdData(parsed);
    // Debug: log parsed signal summary to help track missing signals like led_out
    try {
      console.log('VCD parsed signals count:', parsed.signals.size);
      // show first 30 signal names
      console.log('First signals:', Array.from(parsed.signals.keys()).slice(0, 30));
      const ledKey = Array.from(parsed.signals.keys()).find(k => k.toLowerCase().endsWith('.led_out') || k.toLowerCase().endsWith('led_out'));
      if (ledKey) console.log('led_out signal values (first 10):', parsed.signals.get(ledKey)?.values.slice(0, 10));
    } catch (e) { console.warn('Signal debug log failed', e); }
    setVisibleSignals(Array.from(parsed.signals.keys()).slice(0, 10));

    // Auto-detect a sensible display unit based on timescale + duration
    try {
      const unit = detectBestDisplayUnit(parsed.timescale, parsed.maxTime);
      setDisplayUnit(unit);
    } catch {
      setDisplayUnit('us');
    }

    setGroups([]);
    setSelectedEvent(null);
    setSelectedSignalName(null);
    // Auto-detect protocols for convenience
    try {
      autoDetectProtocols(parsed);
    } catch {}
  }, []);

  const handleFileUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      loadVcdContent(content);
    };
    reader.readAsText(file);
  }, []);

  // If running inside a VS Code webview, listen for messages from the extension
  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = (event as any).data;
      if (msg?.type === 'openVCD' && msg.content) {
        loadVcdContent(msg.content);
      }
    };
    if (typeof window !== 'undefined') window.addEventListener('message', handler as any);
    return () => { if (typeof window !== 'undefined') window.removeEventListener('message', handler as any); };
  }, [loadVcdContent]);

  // Notify the extension that the webview is ready to receive messages.
  React.useEffect(() => {
    try {
      const anyWindow = window as any;
      if (anyWindow && typeof anyWindow.acquireVsCodeApi === 'function') {
        anyWindow.acquireVsCodeApi().postMessage({ type: 'ready' });
      }
    } catch (e) {}
  }, []);

  const addGroup = () => {
    const newGroup: SignalGroup = {
      id: Math.random().toString(36).substr(2, 9),
      name: 'New Group',
      signalNames: [],
      collapsed: false
    };
    setGroups([...groups, newGroup]);
  };

  const toggleGroupCollapse = (id: string) => {
    // If this is a protocol group (proto_<id>), toggle collapsed on protocols state
    const protoPrefix = 'proto_';
    if (id.startsWith(protoPrefix)) {
      const pid = id.substring(protoPrefix.length);
      setProtocols(protocols.map(p => p.id === pid ? { ...p, collapsed: !p.collapsed } : p));
      return;
    }

    setGroups(groups.map(g => g.id === id ? { ...g, collapsed: !g.collapsed } : g));
  };

  const updateGroup = (id: string, updates: Partial<SignalGroup>) => {
    setGroups(groups.map(g => g.id === id ? { ...g, ...updates } : g));
  };

  const removeGroup = (id: string) => {
    setGroups(groups.filter(g => g.id !== id));
  };

  const addSignalToGroup = (groupId: string, signalName: string) => {
    setGroups(groups.map(g => {
      if (g.id === groupId && !g.signalNames.includes(signalName)) {
        return { ...g, signalNames: [...g.signalNames, signalName] };
      }
      return g;
    }));
    // Remove from ungrouped visible signals if it was there
    setVisibleSignals(visibleSignals.filter(s => s !== signalName));
  };

  const removeSignalFromGroup = (groupId: string, signalName: string) => {
    setGroups(groups.map(g => {
      if (g.id === groupId) {
        return { ...g, signalNames: g.signalNames.filter(s => s !== signalName) };
      }
      return g;
    }));
    // Add back to ungrouped visible signals
    if (!visibleSignals.includes(signalName)) {
      setVisibleSignals([...visibleSignals, signalName]);
    }
  };

  const autoGroupSignals = () => {
    if (!vcdData) return;
    const allSignals = Array.from(vcdData.signals.keys());

    // 1) Suffix-based grouping (existing behavior)
    const potentialGroups = new Map<string, string[]>();
    const suffixRegex = /(.+?)(?:_(\d+)|\[(\d+)\]|(\d+))$/;
    allSignals.forEach((sig: string) => {
      const match = sig.match(suffixRegex);
      if (match) {
        const prefix = match[1];
        if (!potentialGroups.has(prefix)) potentialGroups.set(prefix, []);
        potentialGroups.get(prefix)!.push(sig);
      }
    });

    // 2) Hierarchy-based grouping using dot separators (parent path before last dot)
    const parentMap = new Map<string, string[]>();
    allSignals.forEach((sig: string) => {
      const idx = sig.lastIndexOf('.');
      if (idx !== -1) {
        const parent = sig.substring(0, idx);
        if (!parentMap.has(parent)) parentMap.set(parent, []);
        parentMap.get(parent)!.push(sig);
      }
    });

    const newGroups: SignalGroup[] = [];
    const signalsToMove = new Set<string>();

    // Create suffix groups first (keep original sorting by numeric suffix)
    potentialGroups.forEach((sigs: string[], prefix: string) => {
      if (sigs.length > 1) {
        newGroups.push({
          id: Math.random().toString(36).substr(2, 9),
          name: prefix.replace(/[._\[]$/, ''),
          signalNames: sigs.sort((a: string, b: string) => {
            const aNum = parseInt(a.match(/\d+$/)?.[0] || '0');
            const bNum = parseInt(b.match(/\d+$/)?.[0] || '0');
            return bNum - aNum;
          }),
          collapsed: true
        });
        sigs.forEach(s => signalsToMove.add(s));
      }
    });

    // Then create hierarchy groups for parent paths, but skip signals already grouped
    parentMap.forEach((sigs: string[], parent: string) => {
      const filtered = sigs.filter(s => !signalsToMove.has(s));
      if (filtered.length > 1) {
        newGroups.push({
          id: Math.random().toString(36).substr(2, 9),
          name: parent,
          signalNames: filtered.sort(),
          collapsed: true
        });
        filtered.forEach(s => signalsToMove.add(s));
      }
    });

    if (newGroups.length > 0) {
      setGroups([...groups, ...newGroups]);
      setVisibleSignals(visibleSignals.filter(s => !signalsToMove.has(s)));
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  }, [handleFileUpload]);

  const addProtocol = () => {
    const newProtocol: ProtocolConfig = {
      id: Math.random().toString(36).substr(2, 9),
      type: 'UART',
      signals: [],
      config: { baudRate: 9600 },
      collapsed: false
    };
    setProtocols([...protocols, newProtocol]);
  };

  const autoDetectProtocols = (vcd?: VCDData) => {
    const data = vcd || vcdData;
    if (!data) return;

    const detected: ProtocolConfig[] = [];

    // Helper: normalize name parts
    const leaf = (name: string) => {
      const parts = name.split('.');
      return parts[parts.length - 1].toLowerCase();
    };

    // Build parent map to group signals by common prefix
    const parentMap = new Map<string, string[]>();
    Array.from(data.signals.keys()).forEach(name => {
      const idx = name.lastIndexOf('.');
      const parent = idx === -1 ? '' : name.substring(0, idx);
      if (!parentMap.has(parent)) parentMap.set(parent, []);
      parentMap.get(parent)!.push(name);
    });

    // 1) Detect SPI: look for parent groups with sclk + (mosi|miso)
    parentMap.forEach((names, parent) => {
      const lower = new Set(names.map(n => leaf(n)));
      const hasSCLK = Array.from(lower).some(n => n.includes('sclk') || n === 'sclk' || n === 'clk_s');
      const hasMOSI = Array.from(lower).some(n => n.includes('mosi') || n === 'mosi');
      const hasMISO = Array.from(lower).some(n => n.includes('miso') || n === 'miso');
      const hasCS = Array.from(lower).some(n => n === 'cs' || n.includes('cs') || n.includes('chipselect'));
      if (hasSCLK) {
        // find signal full names
        const sclk = names.find(n => leaf(n).includes('sclk') || leaf(n) === 'sclk' || leaf(n) === 'clk_s');
        const mosi = names.find(n => leaf(n).includes('mosi') || leaf(n) === 'mosi');
        const miso = names.find(n => leaf(n).includes('miso') || leaf(n) === 'miso');
        const cs = names.find(n => leaf(n) === 'cs' || leaf(n).includes('cs') || leaf(n).includes('chipselect'));
        if (sclk) {
          detected.push({ id: Math.random().toString(36).substr(2,9), type: 'SPI', signals: [sclk, mosi || '', miso || '', cs || ''], config: { cpol: 0, cpha: 0 } });
        }
      }
    });

    // 2) Detect UART: look for signals named *rx or *tx or global names containing 'uart'
    const allNames = Array.from(data.signals.keys());
    const rx = allNames.find(n => /(^|\.|_)(rx|rxd|uart_rx)$/.test(n.toLowerCase()));
    const tx = allNames.find(n => /(^|\.|_)(tx|txd|uart_tx)$/.test(n.toLowerCase()));
    const uartCandidate = rx || tx || allNames.find(n => n.toLowerCase().includes('uart'));
    if (uartCandidate) {
      detected.push({ id: Math.random().toString(36).substr(2,9), type: 'UART', signals: [uartCandidate], config: { baudRate: 9600 } });
    }

    // 3) Detect Avalon-like bus: parent with clk + addr + read/write
    parentMap.forEach((names, parent) => {
      const lower = new Set(names.map(n => leaf(n)));
      const hasCLK = Array.from(lower).some(n => n === 'clk' || n.includes('clk') || n.includes('clock'));
      const hasADDR = Array.from(lower).some(n => n.includes('addr') || n.includes('address'));
      const hasREAD = Array.from(lower).some(n => n === 'read' || n.includes('read'));
      const hasWRITE = Array.from(lower).some(n => n === 'write' || n.includes('write'));
      if (hasCLK && (hasADDR && (hasREAD || hasWRITE))) {
        const clk = names.find(n => leaf(n) === 'clk' || leaf(n).includes('clk') || leaf(n).includes('clock'));
        const addr = names.find(n => leaf(n).includes('addr') || leaf(n).includes('address'));
        const read = names.find(n => leaf(n) === 'read' || leaf(n).includes('read'));
        const write = names.find(n => leaf(n) === 'write' || leaf(n).includes('write'));
        const wrdata = names.find(n => leaf(n).includes('wrdata') || leaf(n).includes('writedata'));
        const rddata = names.find(n => leaf(n).includes('rddata') || leaf(n).includes('readdata'));
        const wait = names.find(n => leaf(n).includes('wait') || leaf(n).includes('waitrequest'));
        const rdvalid = names.find(n => leaf(n).includes('rdvalid') || leaf(n).includes('readdatavalid'));
        if (clk) {
          detected.push({ id: Math.random().toString(36).substr(2,9), type: 'Avalon', signals: [clk, addr || '', read || '', write || '', wrdata || '', rddata || '', wait || '', rdvalid || ''], config: {}, collapsed: true });
        }
      }
    });

    if (detected.length > 0) {
      setProtocols(detected);

      // Remove detected protocol signals from visibleSignals to avoid duplicate rows
      const detectedSignals = new Set<string>();
      detected.forEach(p => p.signals.forEach(s => { if (s) detectedSignals.add(s); }));
      setVisibleSignals(prev => prev.filter(s => !detectedSignals.has(s)));
    }
  };

  const updateProtocol = (id: string, updates: Partial<ProtocolConfig>) => {
    setProtocols(protocols.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const removeProtocol = (id: string) => {
    setProtocols(protocols.filter(p => p.id !== id));
  };

  const decodedProtocols = protocols.map(p => {
    let decoded: DecodedEvent[] = [];
    if (!vcdData) return { ...p, decoded };

    if (p.type === 'UART' && p.signals[0]) {
      const sig = vcdData.signals.get(p.signals[0]);
      if (sig) {
        decoded = decodeUART(sig, p.config.baudRate || 9600, vcdData.timescale);
      }
    } else if (p.type === 'SPI' && p.signals[0]) {
      // signals: [SCLK, MOSI, MISO, CS]
      const sclk = vcdData.signals.get(p.signals[0]);
      const mosi = p.signals[1] ? vcdData.signals.get(p.signals[1]) : undefined;
      const miso = p.signals[2] ? vcdData.signals.get(p.signals[2]) : undefined;
      const cs = p.signals[3] ? vcdData.signals.get(p.signals[3]) : undefined;
      
      if (sclk) {
        decoded = decodeSPI(sclk, mosi, miso, cs, p.config.cpol || 0, p.config.cpha || 0);
      }
    } else if (p.type === 'Avalon' && p.signals[0]) {
      // signals: [CLK, ADDR, READ, WRITE, WRDATA, RDDATA, WAIT, RDDATAVALID]
      const clk = vcdData.signals.get(p.signals[0]);
      const addr = p.signals[1] ? vcdData.signals.get(p.signals[1]) : undefined;
      const read = p.signals[2] ? vcdData.signals.get(p.signals[2]) : undefined;
      const write = p.signals[3] ? vcdData.signals.get(p.signals[3]) : undefined;
      const wrdata = p.signals[4] ? vcdData.signals.get(p.signals[4]) : undefined;
      const rddata = p.signals[5] ? vcdData.signals.get(p.signals[5]) : undefined;
      const wait = p.signals[6] ? vcdData.signals.get(p.signals[6]) : undefined;
      const rdvalid = p.signals[7] ? vcdData.signals.get(p.signals[7]) : undefined;

      if (clk) {
        decoded = decodeAvalon(clk, addr, read, write, wrdata, rddata, wait, rdvalid);
      }
    }
    return { ...p, decoded };
  });

  // Represent protocols as groups so they appear in the waveform grouping area
  const protocolGroups: SignalGroup[] = decodedProtocols.map(p => ({
    id: `proto_${p.id}`,
    name: (() => {
      if (p.type === 'Avalon') {
        // try to infer module name from first signal (drop last segment)
        const s = p.signals.find(s => !!s);
        if (s && s.includes('.')) {
          const parts = s.split('.');
          if (parts.length >= 2) return `${p.type} (${parts[parts.length - 2]})`;
        }
      }
      return `${p.type}`;
    })(),
    signalNames: p.signals.filter(s => !!s),
    collapsed: p.collapsed ?? true
  }));

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e4e3e0] font-sans selection:bg-[#f27d26] selection:text-black">
      {/* Header */}
      <header className="border-bottom border-[#141414] p-6 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#f27d26] rounded flex items-center justify-center text-black">
            <Activity size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight uppercase italic font-serif">VCD Protocol Analyzer</h1>
            <p className="text-xs text-gray-500 font-mono uppercase tracking-widest">Mission Control / Signal Analysis</p>
          </div>
        </div>
        
        <div className="flex gap-4">
          <label className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-[#141414] hover:bg-[#222] border border-[#333] rounded-md transition-colors text-sm font-mono">
            <Upload size={16} />
            LOAD VCD
            <input 
              type="file" 
              className="hidden" 
              accept=".vcd" 
              onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} 
            />
          </label>
        </div>
      </header>

      <main className="p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar: Signal Selection & Protocol Config */}
        <div className="lg:col-span-1 space-y-6">
          {/* Display Scale */}
          {vcdData && (
            <section className="bg-[#141414] border border-[#333] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4 text-[#f27d26]">
                <Activity size={16} />
                <h2 className="text-xs font-bold uppercase tracking-widest font-mono">Display Scale</h2>
              </div>
              <div className="space-y-1">
                <label className="block text-[10px] text-gray-500 uppercase font-mono mb-1">Time Unit</label>
                <select 
                  value={displayUnit}
                  onChange={(e) => setDisplayUnit(e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-[#333] rounded p-1.5 text-xs font-mono text-white outline-none focus:border-[#f27d26]"
                >
                  {['fs', 'ps', 'ns', 'us', 'ms', 's'].map(u => (
                    <option key={u} value={u}>{u.toUpperCase()}</option>
                  ))}
                </select>
              </div>
            </section>
          )}

          {/* Protocols */}
          <section className="bg-[#141414] border border-[#333] rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-[#f27d26]">
                <Cpu size={16} />
                <h2 className="text-xs font-bold uppercase tracking-widest font-mono">Protocols</h2>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => autoDetectProtocols()}
                  title="Auto Detect Protocols"
                  className="p-1 hover:bg-[#222] rounded text-emerald-500 hover:text-emerald-400 transition-colors text-[10px] font-mono border border-emerald-500/30 px-2"
                >
                  AUTO
                </button>
                <button 
                  onClick={addProtocol}
                  className="p-1 hover:bg-[#222] rounded text-gray-400 hover:text-white transition-colors"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {protocols.length === 0 && (
                <p className="text-xs text-gray-600 italic font-mono text-center py-4">No protocols defined</p>
              )}
              {protocols.map((protocol) => (
                <div key={protocol.id} className="p-3 bg-[#0a0a0a] border border-[#333] rounded space-y-3">
                  <div className="flex justify-between items-center">
                    <select 
                      value={protocol.type}
                      onChange={(e) => updateProtocol(protocol.id, { type: e.target.value as any })}
                      className="bg-transparent text-xs font-bold font-mono outline-none"
                    >
                      <option value="UART">UART</option>
                      <option value="SPI">SPI</option>
                      <option value="Avalon">Avalon-MM</option>
                    </select>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded border border-emerald-500/20">
                        {decodedProtocols.find(dp => dp.id === protocol.id)?.decoded.length || 0} events
                      </span>
                      <button onClick={() => removeProtocol(protocol.id)} className="text-gray-600 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-[10px] text-gray-500 uppercase font-mono">Signal Source</label>
                    <select 
                      value={protocol.signals[0] || ''}
                      onChange={(e) => updateProtocol(protocol.id, { signals: [e.target.value] })}
                      className="w-full bg-[#141414] border border-[#333] rounded p-1 text-xs font-mono"
                    >
                      <option value="">Select Signal</option>
                      {vcdData && Array.from(vcdData.signals.keys()).map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>

                  {protocol.type === 'UART' && (
                    <div className="space-y-2">
                      <label className="block text-[10px] text-gray-500 uppercase font-mono">Baud Rate</label>
                      <input 
                        type="number"
                        value={protocol.config.baudRate}
                        onChange={(e) => updateProtocol(protocol.id, { config: { ...protocol.config, baudRate: parseInt(e.target.value) } })}
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
                              updateProtocol(protocol.id, { signals: newSignals });
                            }}
                            className="w-full bg-[#141414] border border-[#333] rounded p-1 text-xs font-mono"
                          >
                            <option value="">None</option>
                            {vcdData && Array.from(vcdData.signals.keys()).map(name => (
                              <option key={name} value={name}>{name}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <div className="flex-1 space-y-1">
                          <label className="block text-[10px] text-gray-500 uppercase font-mono">CPOL</label>
                          <select 
                            value={protocol.config.cpol}
                            onChange={(e) => updateProtocol(protocol.id, { config: { ...protocol.config, cpol: parseInt(e.target.value) } })}
                            className="w-full bg-[#141414] border border-[#333] rounded p-1 text-xs font-mono"
                          >
                            <option value="0">0</option>
                            <option value="1">1</option>
                          </select>
                        </div>
                        <div className="flex-1 space-y-1">
                          <label className="block text-[10px] text-gray-500 uppercase font-mono">CPHA</label>
                          <select 
                            value={protocol.config.cpha}
                            onChange={(e) => updateProtocol(protocol.id, { config: { ...protocol.config, cpha: parseInt(e.target.value) } })}
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
                              updateProtocol(protocol.id, { signals: newSignals });
                            }}
                            className="w-full bg-[#141414] border border-[#333] rounded p-1 text-xs font-mono"
                          >
                            <option value="">None</option>
                            {vcdData && Array.from(vcdData.signals.keys()).map(name => (
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
          </section>

          {/* Signal Groups */}
          <section className="bg-[#141414] border border-[#333] rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-emerald-500">
                <Settings size={16} />
                <h2 className="text-xs font-bold uppercase tracking-widest font-mono">Signal Groups</h2>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={autoGroupSignals}
                  title="Auto Group by Suffix"
                  className="p-1 hover:bg-[#222] rounded text-emerald-500 hover:text-emerald-400 transition-colors text-[10px] font-mono border border-emerald-500/30 px-2"
                >
                  AUTO
                </button>
                <button 
                  onClick={addGroup}
                  className="p-1 hover:bg-[#222] rounded text-gray-400 hover:text-white transition-colors"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {groups.length === 0 && (
                <p className="text-xs text-gray-600 italic font-mono text-center py-4">No groups defined</p>
              )}
              {groups.map((group) => (
                <div key={group.id} className="p-3 bg-[#0a0a0a] border border-[#333] rounded space-y-3">
                  <div className="flex justify-between items-center">
                    <input 
                      value={group.name}
                      onChange={(e) => updateGroup(group.id, { name: e.target.value })}
                      className="bg-transparent text-xs font-bold font-mono outline-none border-b border-transparent focus:border-[#f27d26] w-full mr-2"
                    />
                    <button onClick={() => removeGroup(group.id)} className="text-gray-600 hover:text-red-500">
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {group.signalNames.map(sig => (
                        <span key={sig} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#141414] border border-[#333] rounded text-[10px] font-mono">
                          {sig}
                          <button onClick={() => removeSignalFromGroup(group.id, sig)} className="hover:text-red-500">×</button>
                        </span>
                      ))}
                    </div>
                    <select 
                      onChange={(e) => {
                        if (e.target.value) addSignalToGroup(group.id, e.target.value);
                        e.target.value = '';
                      }}
                      className="w-full bg-[#141414] border border-[#333] rounded p-1 text-xs font-mono"
                    >
                      <option value="">Add Signal...</option>
                      {vcdData && Array.from(vcdData.signals.keys()).map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Signal Visibility */}
          {vcdData && (
            <section className="bg-[#141414] border border-[#333] rounded-lg p-4 max-h-[400px] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-[#f27d26]">
                  <Settings size={16} />
                  <h2 className="text-xs font-bold uppercase tracking-widest font-mono">Visible Signals</h2>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setVisibleSignals(Array.from(vcdData.signals.keys()))}
                    className="text-[10px] font-mono text-[#f27d26] hover:text-[#f27d26]/80 border border-[#f27d26]/30 px-1.5 rounded transition-colors"
                  >
                    ALL
                  </button>
                  <button 
                    onClick={() => setVisibleSignals([])}
                    className="text-[10px] font-mono text-gray-500 hover:text-gray-400 border border-gray-500/30 px-1.5 rounded transition-colors"
                  >
                    NONE
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {Array.from(vcdData.signals.keys()).map((name: string) => (
                  <label key={name} className="flex items-center gap-2 p-1 hover:bg-[#222] rounded cursor-pointer group">
                    <input 
                      type="checkbox"
                      checked={visibleSignals.includes(name)}
                      onChange={(e) => {
                        if (e.target.checked) setVisibleSignals([...visibleSignals, name]);
                        else setVisibleSignals(visibleSignals.filter(s => s !== name));
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
            </section>
          )}
        </div>

        {/* Main Viewer Area */}
        <div className="lg:col-span-3">
          {!vcdData ? (
            <div 
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              className={cn(
                "h-[600px] border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition-all duration-300",
                isDragging ? "border-[#f27d26] bg-[#f27d26]/5" : "border-[#333] bg-[#141414]"
              )}
            >
              <motion.div 
                animate={{ y: [0, -10, 0] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="mb-6 text-gray-600"
              >
                <Upload size={64} />
              </motion.div>
              <h3 className="text-xl font-serif italic mb-2">Drop VCD file here</h3>
              <p className="text-gray-500 font-mono text-sm">or click LOAD VCD in the header</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Measurement Bar */}
              <AnimatePresence>
                {selectedSignalName && vcdData.signals.get(selectedSignalName) && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="bg-[#1a1a1a] border border-[#f27d26]/30 rounded-lg p-4 overflow-hidden"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <Activity size={16} className="text-[#f27d26]" />
                        <h3 className="text-xs font-bold uppercase tracking-widest font-mono text-white">
                          Measurements: <span className="text-[#f27d26]">{selectedSignalName}</span>
                        </h3>
                      </div>
                      <button 
                        onClick={() => setSelectedSignalName(null)}
                        className="text-gray-500 hover:text-white transition-colors"
                      >
                        ×
                      </button>
                    </div>
                    
                    {(() => {
                      const signal = vcdData.signals.get(selectedSignalName)!;
                      const measurements = calculateSignalMeasurements(signal, vcdData.timescale);
                      
                      if (measurements) {
                        return (
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                            {[
                              { label: 'Frequency', value: measurements.frequency },
                              { label: 'Period', value: measurements.avgPeriod },
                              { label: 'Pos Pulse', value: measurements.avgPosPulse },
                              { label: 'Neg Pulse', value: measurements.avgNegPulse },
                              { label: 'Duty Cycle', value: measurements.dutyCycle },
                            ].map(stat => (
                              <div key={stat.label} className="bg-[#0a0a0a] p-2 rounded border border-[#333]">
                                <div className="text-[9px] text-gray-500 uppercase font-mono mb-1">{stat.label}</div>
                                <div className="text-sm font-mono text-emerald-500 font-bold">{stat.value}</div>
                              </div>
                            ))}
                          </div>
                        );
                      } else if (signal.size > 1) {
                        return (
                          <div className="text-xs text-gray-500 font-mono italic flex items-center gap-2">
                            <Settings size={14} />
                            Timing measurements are currently only available for single-bit signals (clocks, enables, etc).
                          </div>
                        );
                      } else {
                        return (
                          <div className="text-xs text-gray-500 font-mono italic flex items-center gap-2">
                            <Activity size={14} />
                            Not enough transitions detected to calculate timing measurements for this signal.
                          </div>
                        );
                      }
                    })()}
                  </motion.div>
                )}
              </AnimatePresence>

              <WaveformViewer 
                data={vcdData} 
                visibleSignals={visibleSignals}
                displayUnit={displayUnit}
                groups={[...groups, ...protocolGroups]}
                protocolDecoders={decodedProtocols}
                selectedEvent={selectedEvent}
                selectedSignalName={selectedSignalName}
                onSelectEvent={(protocolId, index) => setSelectedEvent({ protocolId, index })}
                onSelectSignal={setSelectedSignalName}
                onToggleGroup={toggleGroupCollapse}
              />

              {/* Decoded Data Table */}
              {decodedProtocols.some(p => p.decoded.length > 0) && (
                <section className="bg-[#141414] border border-[#333] rounded-lg overflow-hidden">
                  <div className="p-4 border-b border-[#333] bg-[#1a1a1a] flex items-center gap-2">
                    <ChevronRight size={16} className="text-[#f27d26]" />
                    <h2 className="text-xs font-bold uppercase tracking-widest font-mono">Decoded Transactions</h2>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    <table className="w-full text-left font-mono text-xs">
                      <thead className="sticky top-0 bg-[#141414] text-gray-500 uppercase text-[10px]">
                        <tr>
                          <th className="p-3 border-b border-[#333]">Time</th>
                          <th className="p-3 border-b border-[#333]">Protocol</th>
                          <th className="p-3 border-b border-[#333]">Data</th>
                          <th className="p-3 border-b border-[#333]">Label</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#222]">
                        {decodedProtocols.flatMap(p => p.decoded.map((event, i) => {
                          const isSelected = selectedEvent?.protocolId === p.id && selectedEvent?.index === i;
                          return (
                            <tr 
                              key={`${p.id}-${i}`} 
                              onClick={() => setSelectedEvent({ protocolId: p.id, index: i })}
                              className={cn(
                                "cursor-pointer transition-colors",
                                isSelected ? "bg-[#f27d26]/20 text-white" : "hover:bg-[#1a1a1a]"
                              )}
                            >
                              <td className="p-3 text-gray-500">{event.startTime} {vcdData.timescale}</td>
                              <td className="p-3 text-[#f27d26] font-bold">{p.type}</td>
                              <td className="p-3">{event.data}</td>
                              <td className="p-3 text-emerald-500">{event.label}</td>
                            </tr>
                          );
                        }))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Footer Status Bar */}
      <footer className="fixed bottom-0 left-0 right-0 bg-[#0a0a0a] border-t border-[#141414] px-6 py-2 flex justify-between items-center text-[10px] font-mono text-gray-600 uppercase tracking-widest">
        <div className="flex gap-4">
          <span>Status: {vcdData ? 'READY' : 'IDLE'}</span>
          {vcdData && <span>Memory: {(JSON.stringify(vcdData).length / 1024 / 1024).toFixed(2)} MB</span>}
        </div>
        <div>
          v1.0.0-BETA
        </div>
      </footer>
    </div>
  );
}
