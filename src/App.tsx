import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Upload, ChevronRight, ChevronLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { parseVCD, decodeUART, decodeSPI, decodeAvalon, decodeI2C, detectBestDisplayUnit } from './utils/vcd';
import { ProtocolConfig, SignalGroup, VCDData, DecodedEvent } from './types';
import { WaveformViewer } from './components/WaveformViewer';
import { VisibleSignalsSection } from './components/Sidebar/VisibleSignalsSection';
import { ProtocolsSection } from './components/Sidebar/ProtocolsSection';
import { SignalGroupsSection } from './components/Sidebar/SignalGroupsSection';
import { MeasurementBar } from './components/Measurements/MeasurementBar';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [vcdData, setVcdData] = useState<VCDData | null>(null);
  const [visibleSignals, setVisibleSignals] = useState<string[]>([]);
  const [groups, setGroups] = useState<SignalGroup[]>([]);
  const [protocols, setProtocols] = useState<ProtocolConfig[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<{ protocolId: string; index: number } | null>(null);
  const [selectedSignalName, setSelectedSignalName] = useState<string | null>(null);
  const [movedSignalName, setMovedSignalName] = useState<string | null>(null);
  const [displayUnit, setDisplayUnit] = useState<string>('ns');
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [visibleSignalsCollapsed, setVisibleSignalsCollapsed] = useState(false);
  const [protocolsCollapsed, setProtocolsCollapsed] = useState(false);
  const [signalGroupsCollapsed, setSignalGroupsCollapsed] = useState(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    setIsSidebarResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (me: MouseEvent) => {
      const delta = me.clientX - startX;
      const maxWidth = Math.min(720, Math.floor(window.innerWidth * 0.6));
      const newWidth = Math.max(220, Math.min(maxWidth, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsSidebarResizing(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth]);

  const loadVcdContent = useCallback((content: string, byteSize?: number) => {
    setFileSizeBytes(byteSize ?? (typeof content === 'string' ? content.length : null));
    const parsed = parseVCD(content);
    setVcdData(parsed);
    setVisibleSignals(Array.from(parsed.signals.keys()).slice(0, 10));

    try {
      const unit = detectBestDisplayUnit(parsed.timescale, parsed.maxTime);
      setDisplayUnit(unit);
    } catch {
      setDisplayUnit('us');
    }

    setGroups([]);
    setSelectedEvent(null);
    setSelectedSignalName(null);

    try {
      autoDetectProtocols(parsed);
    } catch {}
  }, []);

  const handleFileUpload = useCallback((file: File) => {
    const size = file.size;
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      loadVcdContent(content, size);
    };
    reader.readAsText(file);
  }, [loadVcdContent]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = (event as any).data;
      if (msg?.type === 'openVCD' && msg.content) {
        loadVcdContent(msg.content, typeof msg.content === 'string' ? msg.content.length : undefined);
      }
    };
    if (typeof window !== 'undefined') window.addEventListener('message', handler as any);
    return () => { if (typeof window !== 'undefined') window.removeEventListener('message', handler as any); };
  }, [loadVcdContent]);

  useEffect(() => {
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
    setGroups(prev => [...prev, newGroup]);
  };

  const toggleGroupCollapse = (id: string) => {
    const protoPrefix = 'proto_';
    if (id.startsWith(protoPrefix)) {
      const pid = id.substring(protoPrefix.length);
      setProtocols(prev => prev.map(p => p.id === pid ? { ...p, collapsed: !p.collapsed } : p));
      return;
    }
    setGroups(prev => prev.map(g => g.id === id ? { ...g, collapsed: !g.collapsed } : g));
  };

  const handleSelectGroup = (id: string | null) => {
    setSelectedGroupId(prev => prev === id ? null : id);
    setSelectedSignalName(null);
  };

  const handleDeleteSignal = (name: string) => {
    setVisibleSignals(prev => prev.filter(s => s !== name));
    setGroups(prev => prev.map(g => ({ ...g, signalNames: g.signalNames.filter(n => n !== name) })));
    if (selectedSignalName === name) setSelectedSignalName(null);
  };

  const handleDeleteGroup = (id: string) => {
    removeGroup(id);
    if (selectedGroupId === id) setSelectedGroupId(null);
  };

  const handleClearAllSignals = () => {
    setVisibleSignals([]);
    setGroups([]);
    setSelectedSignalName(null);
    setSelectedGroupId(null);
  };

  const updateGroup = (id: string, updates: Partial<SignalGroup>) => {
    setGroups(prev => prev.map(g => g.id === id ? { ...g, ...updates } : g));
  };

  const removeGroup = (id: string) => {
    setGroups(prev => prev.filter(g => g.id !== id));
  };

  const addSignalToGroup = (groupId: string, signalName: string) => {
    setGroups(prev => prev.map(g => {
      if (g.id === groupId && !g.signalNames.includes(signalName)) {
        return { ...g, signalNames: [...g.signalNames, signalName] };
      }
      return g;
    }));
    setVisibleSignals(prev => prev.filter(s => s !== signalName));
  };

  const removeSignalFromGroup = (groupId: string, signalName: string) => {
    setGroups(prev => prev.map(g => {
      if (g.id === groupId) {
        return { ...g, signalNames: g.signalNames.filter(s => s !== signalName) };
      }
      return g;
    }));
    if (!visibleSignals.includes(signalName)) {
      setVisibleSignals(prev => [...prev, signalName]);
    }
  };

  const handleReorderSignal = (signalName: string, toGroupId: string | null, toIndex: number) => {
    const oldGroup = groups.find(g => g.signalNames.includes(signalName));
    const oldGroupId = oldGroup ? oldGroup.id : null;

    if (oldGroupId === toGroupId) {
      if (toGroupId === null) {
        const arr = [...visibleSignals.filter(s => s !== signalName)];
        const idx = Math.max(0, Math.min(toIndex, arr.length));
        arr.splice(idx, 0, signalName);
        setVisibleSignals(arr);
      } else {
        setGroups(prev => prev.map(g => {
          if (g.id !== toGroupId) return g;
          const arr = g.signalNames.filter(s => s !== signalName);
          const idx = Math.max(0, Math.min(toIndex, arr.length));
          arr.splice(idx, 0, signalName);
          return { ...g, signalNames: arr };
        }));
      }
      return;
    }

    if (oldGroupId === null) {
      setVisibleSignals(prev => prev.filter(s => s !== signalName));
    } else {
      setGroups(prev => prev.map(g => g.id === oldGroupId ? { ...g, signalNames: g.signalNames.filter(s => s !== signalName) } : g));
    }

    if (toGroupId === null) {
      setVisibleSignals(prev => {
        const arr = [...prev];
        const idx = Math.max(0, Math.min(toIndex, arr.length));
        arr.splice(idx, 0, signalName);
        setMovedSignalName(signalName);
        setTimeout(() => setMovedSignalName(null), 1100);
        return arr;
      });
    } else {
      setGroups(prev => prev.map(g => {
        if (g.id !== toGroupId) return g;
        const arr = [...g.signalNames];
        const idx = Math.max(0, Math.min(toIndex, arr.length));
        arr.splice(idx, 0, signalName);
        setMovedSignalName(signalName);
        setTimeout(() => setMovedSignalName(null), 1100);
        return { ...g, signalNames: arr };
      }));
    }
  };

  const autoGroupSignals = () => {
    if (!vcdData) return;
    const allSignals = Array.from(vcdData.signals.keys());

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

    potentialGroups.forEach((sigs: string[], prefix: string) => {
      if (sigs.length > 1) {
        newGroups.push({
          id: Math.random().toString(36).substr(2, 9),
          name: prefix.replace(/[._\[]$/, ''),
          signalNames: sigs.sort((a: string, b: string) => {
            const aNum = parseInt(a.match(/\d+$/)?.[0] || '0', 10);
            const bNum = parseInt(b.match(/\d+$/)?.[0] || '0', 10);
            return bNum - aNum;
          }),
          collapsed: true
        });
        sigs.forEach(s => signalsToMove.add(s));
      }
    });

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
      setGroups(prev => [...prev, ...newGroups]);
      setVisibleSignals(prev => prev.filter(s => !signalsToMove.has(s)));
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
    setProtocols(prev => [...prev, newProtocol]);
  };

  const autoDetectProtocols = (vcd?: VCDData) => {
    const data = vcd || vcdData;
    if (!data) return;

    const detected: ProtocolConfig[] = [];
    const leaf = (name: string) => {
      const parts = name.split('.');
      return parts[parts.length - 1].toLowerCase();
    };

    const parentMap = new Map<string, string[]>();
    Array.from(data.signals.keys()).forEach((name: string) => {
      const idx = name.lastIndexOf('.');
      const parent = idx === -1 ? '' : name.substring(0, idx);
      if (!parentMap.has(parent)) parentMap.set(parent, []);
      parentMap.get(parent)!.push(name);
    });

    // 1) Detect SPI
    parentMap.forEach((names) => {
      const lower = new Set(names.map(n => leaf(n)));
      const hasSCLK = Array.from(lower).some(n => n.includes('sclk') || n === 'sclk' || n === 'clk_s');
      if (hasSCLK) {
        const sclk = names.find(n => leaf(n).includes('sclk') || leaf(n) === 'sclk' || leaf(n) === 'clk_s');
        const mosi = names.find(n => leaf(n).includes('mosi') || leaf(n) === 'mosi');
        const miso = names.find(n => leaf(n).includes('miso') || leaf(n) === 'miso');
        const cs = names.find(n => leaf(n) === 'cs' || leaf(n).includes('cs') || leaf(n).includes('chipselect'));
        if (sclk) {
          detected.push({ id: Math.random().toString(36).substr(2,9), type: 'SPI', signals: [sclk, mosi || '', miso || '', cs || ''], config: { cpol: 0, cpha: 0 } });
        }
      }
    });

    // 2) Detect UART
    const allNames = Array.from(data.signals.keys()) as string[];
    const rx = allNames.find(n => /(^|\.|_)(rx|rxd|uart_rx)$/.test(n.toLowerCase()));
    const tx = allNames.find(n => /(^|\.|_)(tx|txd|uart_tx)$/.test(n.toLowerCase()));
    const uartCandidate = rx || tx || allNames.find(n => n.toLowerCase().includes('uart'));
    if (uartCandidate) {
      detected.push({ id: Math.random().toString(36).substr(2,9), type: 'UART', signals: [uartCandidate], config: { baudRate: 9600 } });
    }

    // 3) Detect Avalon-like bus
    parentMap.forEach((names) => {
      const lower = new Set(names.map(n => leaf(n)));
      const hasCLK = Array.from(lower).some(n => n === 'clk' || n.includes('clk') || n.includes('clock'));
      const hasADDR = Array.from(lower).some(n => n.includes('addr') || n.includes('address'));
      const hasREAD = Array.from(lower).some(n => (n === 'read' || n === 'rd' || /(^|_|\.)read($|_|\.)/.test(n)) && !n.includes('data') && !n.includes('valid'));
      const hasWRITE = Array.from(lower).some(n => (n === 'write' || n === 'wr' || /(^|_|\.)write($|_|\.)/.test(n)) && !n.includes('data') && !n.includes('valid'));
      if (hasCLK && hasADDR && (hasREAD || hasWRITE)) {
        const clk = names.find(n => leaf(n) === 'clk' || leaf(n).includes('clk') || leaf(n).includes('clock'));
        const addr = names.find(n => leaf(n).includes('addr') || leaf(n).includes('address'));
        const read = names.find(n => {
          const l = leaf(n);
          return (l === 'read' || l === 'rd' || /(^|_|\.)read($|_|\.)/.test(l)) && !l.includes('data') && !l.includes('valid');
        });
        const write = names.find(n => {
          const l = leaf(n);
          return (l === 'write' || l === 'wr' || /(^|_|\.)write($|_|\.)/.test(l)) && !l.includes('data') && !l.includes('valid');
        });
        const wrdata = names.find(n => leaf(n).includes('wrdata') || leaf(n).includes('writedata'));
        const rddataCandidates = names.filter(n => {
          const l = leaf(n);
          return (l.includes('rddata') || l.includes('readdata')) && !l.includes('valid') && !l.includes('vld');
        });
        const rddata = rddataCandidates.length > 0 ? rddataCandidates[0] : names.find(n => leaf(n).includes('rddata') || leaf(n).includes('readdata'));
        const wait = names.find(n => leaf(n).includes('wait') || leaf(n).includes('waitrequest'));
        const rdvalid = names.find(n => {
          const l = leaf(n);
          return l === 'rdvalid' || l.includes('readdatavalid') || (l.includes('valid') && l.includes('read'));
        });
        const byteEnable = names.find(n => leaf(n).includes('byteenable') || leaf(n).includes('byte_en') || leaf(n).includes('byteenable_n'));
        if (clk) {
          detected.push({ id: Math.random().toString(36).substr(2,9), type: 'Avalon', signals: [clk, addr || '', read || '', write || '', wrdata || '', rddata || '', wait || '', rdvalid || '', byteEnable || ''], config: {}, collapsed: true });
        }
      }
    });

    // 4) Detect I2C: look for scl and sda signals
    const scl = allNames.find(n => /(^|\.|_)(scl|i2c_scl)$/.test(n.toLowerCase()));
    const sda = allNames.find(n => /(^|\.|_)(sda|i2c_sda)$/.test(n.toLowerCase()));
    if (scl && sda) {
      detected.push({ id: Math.random().toString(36).substr(2,9), type: 'I2C', signals: [scl, sda], config: {}, collapsed: false });
    }

    if (detected.length > 0) {
      setProtocols(detected);
      const detectedSignals = new Set<string>();
      detected.forEach(p => p.signals.forEach(s => { if (s) detectedSignals.add(s); }));
      setVisibleSignals(prev => prev.filter(s => !detectedSignals.has(s)));
    }
  };

  const updateProtocol = (id: string, updates: Partial<ProtocolConfig>) => {
    setProtocols(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const removeProtocol = (id: string) => {
    setProtocols(prev => prev.filter(p => p.id !== id));
  };

  const signalNames = useMemo(() => (
    vcdData ? Array.from(vcdData.signals.keys()) : []
  ), [vcdData]);

  const decodedProtocols = useMemo(() => protocols.map(p => {
    let decoded: DecodedEvent[] = [];
    if (!vcdData) return { ...p, decoded };

    if (p.type === 'UART' && p.signals[0]) {
      const sig = vcdData.signals.get(p.signals[0]);
      if (sig) {
        decoded = decodeUART(sig, p.config.baudRate || 9600, vcdData.timescale);
      }
    } else if (p.type === 'SPI' && p.signals[0]) {
      const sclk = vcdData.signals.get(p.signals[0]);
      const mosi = p.signals[1] ? vcdData.signals.get(p.signals[1]) : undefined;
      const miso = p.signals[2] ? vcdData.signals.get(p.signals[2]) : undefined;
      const cs = p.signals[3] ? vcdData.signals.get(p.signals[3]) : undefined;
      if (sclk) {
        decoded = decodeSPI(sclk, mosi, miso, cs, p.config.cpol || 0, p.config.cpha || 0);
      }
    } else if (p.type === 'Avalon' && p.signals[0]) {
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
    } else if (p.type === 'I2C' && p.signals[0] && p.signals[1]) {
      const scl = vcdData.signals.get(p.signals[0]);
      const sda = vcdData.signals.get(p.signals[1]);
      if (scl && sda) {
        decoded = decodeI2C(scl, sda);
      }
    }
    return { ...p, decoded };
  }), [protocols, vcdData]);

  const protocolGroups: SignalGroup[] = useMemo(() => decodedProtocols.map(p => ({
    id: `proto_${p.id}`,
    name: (() => {
      if (p.type === 'Avalon') {
        const s = p.signals.find(s => !!s);
        if (s && s.includes('.')) {
          const parts = s.split('.');
          if (parts.length >= 2) return `${p.type} (${parts[parts.length - 2]})`;
        }
      }
      return `${p.type}`;
    })(),
    signalNames: (() => {
      const sigs = p.signals.filter(Boolean) as string[];
      const leaf = (name: string) => name.split('.').pop()!.toLowerCase();
      const ordered: string[] = [];
      const used = new Set<string>();

      const findAndAdd = (pred: (l: string) => boolean) => {
        const found = sigs.find(s => !used.has(s) && pred(leaf(s)));
        if (found) { ordered.push(found); used.add(found); }
      };

      findAndAdd(l => l.includes('addr') || l.includes('address'));
      findAndAdd(l => (l === 'read' || l === 'rd' || l.includes('read')) && !l.includes('data') && !l.includes('valid'));
      findAndAdd(l => l.includes('rddata') || l.includes('readdata'));
      findAndAdd(l => l === 'rdvalid' || l.includes('readdatavalid') || (l.includes('valid') && l.includes('read')));
      findAndAdd(l => (l === 'write' || l === 'wr' || l.includes('write')) && !l.includes('data') && !l.includes('valid'));
      findAndAdd(l => l.includes('wrdata') || l.includes('writedata'));
      findAndAdd(l => l.includes('wait') || l.includes('waitrequest'));
      findAndAdd(l => l.includes('byteenable') || l.includes('byte_en'));

      sigs.forEach(s => { if (!used.has(s) && leaf(s) !== 'clk') { ordered.push(s); used.add(s); } });
      return ordered;
    })(),
    collapsed: p.collapsed ?? true
  })), [decodedProtocols]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e4e3e0] font-sans selection:bg-[#f27d26] selection:text-black">
      <main className="flex h-[calc(100vh-28px)]">
        {/* Resizable Left Sidebar */}
        <div
          className={cn(
            "relative flex flex-col flex-shrink-0 border-r border-[#333] bg-[#0a0a0a]",
            isSidebarResizing ? "" : "transition-all duration-300"
          )}
          style={{ width: sidebarCollapsed ? '50px' : `${sidebarWidth}px` }}
        >
          <div className="flex-shrink-0 p-2 flex justify-end border-b border-[#333]">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1 hover:bg-[#222] rounded text-gray-400 hover:text-[#f27d26] transition-colors"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
          </div>
          
          {!sidebarCollapsed && (
            <div className="sidebar-scroll-left flex-1 overflow-y-auto p-6 space-y-6">
              {vcdData && (
                <VisibleSignalsSection
                  vcdData={vcdData}
                  signalNames={signalNames}
                  visibleSignals={visibleSignals}
                  onVisibleSignalsChange={setVisibleSignals}
                  collapsed={visibleSignalsCollapsed}
                  onToggleCollapse={() => setVisibleSignalsCollapsed(prev => !prev)}
                />
              )}

              <ProtocolsSection
                vcdData={vcdData}
                signalNames={signalNames}
                protocols={protocols}
                decodedProtocols={decodedProtocols}
                onAddProtocol={addProtocol}
                onUpdateProtocol={updateProtocol}
                onRemoveProtocol={removeProtocol}
                onAutoDetect={() => autoDetectProtocols()}
                collapsed={protocolsCollapsed}
                onToggleCollapse={() => setProtocolsCollapsed(prev => !prev)}
              />

              <SignalGroupsSection
                vcdData={vcdData}
                signalNames={signalNames}
                groups={groups}
                onAddGroup={addGroup}
                onUpdateGroup={updateGroup}
                onRemoveGroup={removeGroup}
                onAddSignalToGroup={addSignalToGroup}
                onRemoveSignalFromGroup={removeSignalFromGroup}
                onAutoGroup={autoGroupSignals}
                onClearAllSignals={handleClearAllSignals}
                collapsed={signalGroupsCollapsed}
                onToggleCollapse={() => setSignalGroupsCollapsed(prev => !prev)}
              />
            </div>
          )}

          {!sidebarCollapsed && (
            <div
              onMouseDown={handleResizeStart}
              className={cn(
                "absolute right-[-3px] top-0 z-20 h-full w-2 cursor-col-resize transition-colors",
                isSidebarResizing ? "bg-[#f27d26]" : "bg-transparent hover:bg-[#f27d26]"
              )}
              title="Drag to resize sidebar"
            />
          )}
        </div>

        {/* Main Viewer Area */}
        <div className={cn("flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col", sidebarCollapsed ? "p-3" : "p-6")}>
          {!vcdData ? (
            <div 
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              className={cn(
                "h-full border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition-all duration-300",
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
              <label className="mt-3 cursor-pointer flex items-center gap-2 px-4 py-2 bg-[#141414] hover:bg-[#222] border border-[#333] rounded-md transition-colors text-sm font-mono text-gray-300">
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
          ) : (
            <div className={cn("flex-1 min-w-0 min-h-0 flex flex-col", sidebarCollapsed ? "space-y-2" : "space-y-6")}>
              <div className="flex-shrink-0">
                <MeasurementBar
                  selectedSignalName={selectedSignalName}
                  vcdData={vcdData}
                  onClose={() => setSelectedSignalName(null)}
                />
              </div>

              <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
                <WaveformViewer 
                  data={vcdData} 
                  visibleSignals={visibleSignals}
                  displayUnit={displayUnit}
                  groups={[...groups, ...protocolGroups]}
                  protocolDecoders={decodedProtocols}
                  selectedEvent={selectedEvent}
                  selectedSignalName={selectedSignalName}
                  onSelectEvent={(protocolId, index) => setSelectedEvent({ protocolId, index })}
                  onSelectSignal={(name) => setSelectedSignalName(name)}
                  onReorderSignal={handleReorderSignal}
                  onToggleGroup={toggleGroupCollapse}
                  selectedGroupId={selectedGroupId}
                  onSelectGroup={handleSelectGroup}
                  onDeleteSignal={handleDeleteSignal}
                  onDeleteGroup={handleDeleteGroup}
                  movedSignalName={movedSignalName}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer Status Bar */}
      <footer className="fixed bottom-0 left-0 right-0 bg-[#0a0a0a] border-t border-[#141414] px-6 py-2 flex justify-between items-center text-[10px] font-mono text-gray-600 uppercase tracking-widest">
        <div className="flex gap-4">
          <span>Status: {vcdData ? 'READY' : 'IDLE'}</span>
          {vcdData && (
            <>
              {fileSizeBytes !== null && <span>Size: {(fileSizeBytes / 1024 / 1024).toFixed(2)} MB</span>}
              <span>Signals: {vcdData.signals.size}</span>
            </>
          )}
        </div>
        <div>
          v1.1.0
        </div>
      </footer>
    </div>
  );
}
