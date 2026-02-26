/**
 * Simple VCD Parser and Protocol Decoders
 */

export interface VCDSignal {
  id: string;
  name: string;
  type: 'wire' | 'reg';
  size: number;
  values: { time: number; value: string }[];
}

export interface VCDData {
  timescale: string;
  signals: Map<string, VCDSignal>;
  maxTime: number;
}

export function parseVCD(content: string): VCDData {
  const signals = new Map<string, VCDSignal>();
  const idToSignal = new Map<string, VCDSignal>();
  let timescale = '1ns';
  let currentTime = 0;
  let maxTime = 0;
  let scopeStack: string[] = [];

  // Split into header and data
  const endDefinitionsIdx = content.indexOf('$enddefinitions');
  if (endDefinitionsIdx === -1) return { timescale, signals, maxTime };

  const header = content.substring(0, endDefinitionsIdx);
  const data = content.substring(endDefinitionsIdx + '$enddefinitions'.length);

  // Parse Header more robustly
  // Extract timescale
  const timescaleMatch = header.match(/\$timescale\s+([\d\s\w]+)\s+\$end/);
  if (timescaleMatch) {
    timescale = timescaleMatch[1].trim().replace(/\s+/g, '');
  }

  // Parse scopes and vars in header
  const headerLines = header.split('\n');
  for (let line of headerLines) {
    line = line.trim();
    if (!line) continue;

    if (line.startsWith('$scope')) {
      const parts = line.split(/\s+/);
      if (parts[2]) scopeStack.push(parts[2]);
    } else if (line.startsWith('$upscope')) {
      scopeStack.pop();
    } else if (line.startsWith('$var')) {
      const parts = line.split(/\s+/);
      const type = parts[1] as 'wire' | 'reg';
      const size = parseInt(parts[2]);
      const id = parts[3];
      
      const nameParts = [];
      for (let i = 4; i < parts.length; i++) {
        if (parts[i] === '$end') break;
        nameParts.push(parts[i]);
      }
      const baseName = nameParts.join(' ');
      const fullName = scopeStack.length > 0 ? `${scopeStack.join('.')}.${baseName}` : baseName;
      
      const signal: VCDSignal = { id, name: fullName, type, size, values: [] };
      signals.set(fullName, signal);
      idToSignal.set(id, signal);
    }
  }

  // Parse Data
  const dataLines = data.split('\n');
  for (let line of dataLines) {
    line = line.trim();
    if (!line) continue;

    if (line.startsWith('#')) {
      currentTime = parseInt(line.substring(1));
      if (currentTime > maxTime) maxTime = currentTime;
    } else if (line.startsWith('$')) {
      continue; // Skip other commands in data section
    } else {
      // Value change
      if (line.startsWith('b') || line.startsWith('B')) {
        const parts = line.split(/\s+/);
        const value = parts[0].substring(1);
        const id = parts[1];
        const sig = idToSignal.get(id);
        if (sig) sig.values.push({ time: currentTime, value });
      } else {
        const value = line[0];
        const id = line.substring(1);
        const sig = idToSignal.get(id);
        if (sig) sig.values.push({ time: currentTime, value });
      }
    }
  }

  // Post-process: Detect bit-blasted vectors and merge them
  const vectorGroups = new Map<string, Map<number, VCDSignal>>();
  const bitRegex = /(.+?)\s*\[(\d+)\]$/;
  
  for (const [name, sig] of signals) {
    const match = name.match(bitRegex);
    if (match && sig.size === 1) {
      const baseName = match[1].trim();
      const bitIdx = parseInt(match[2]);
      if (!vectorGroups.has(baseName)) {
        vectorGroups.set(baseName, new Map());
      }
      vectorGroups.get(baseName)!.set(bitIdx, sig);
    }
  }
  
  for (const [baseName, bits] of vectorGroups) {
    if (bits.size > 1) {
      const maxBit = Math.max(...bits.keys());
      const minBit = Math.min(...bits.keys());
      const size = maxBit - minBit + 1;
      
      // Collect all transition times
      const allTimes = new Set<number>();
      bits.forEach(sig => sig.values.forEach(v => allTimes.add(v.time)));
      const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);
      
      const compositeValues: { time: number; value: string }[] = [];
      
      sortedTimes.forEach(time => {
        let valStr = "";
        for (let i = maxBit; i >= minBit; i--) {
          const bitSig = bits.get(i);
          if (bitSig) {
            valStr += getSignalValueAt(bitSig, time);
          } else {
            valStr += 'x';
          }
        }
        compositeValues.push({ time, value: valStr });
      });
      
      const compositeName = `${baseName}[${maxBit}:${minBit}]`;
      const composite: VCDSignal = {
        id: `composite_${baseName}`,
        name: compositeName,
        type: 'wire',
        size,
        values: compositeValues
      };
      
      signals.set(compositeName, composite);
      
      // Remove individual bits to declutter
      bits.forEach(sig => signals.delete(sig.name));
    }
  }

  return { timescale, signals, maxTime };
}

// Protocol Decoders

export interface DecodedEvent {
  startTime: number;
  endTime: number;
  data: string;
  label: string;
}

export function decodeUART(
  signal: VCDSignal,
  baudRate: number,
  timescaleStr: string
): DecodedEvent[] {
  // Convert timescale to seconds
  // e.g. "1ns" -> 1e-9
  const match = timescaleStr.match(/(\d+)\s*(\w+)/);
  if (!match) return [];
  const val = parseInt(match[1]);
  const unit = match[2];
  const units: Record<string, number> = {
    's': 1,
    'ms': 1e-3,
    'us': 1e-6,
    'ns': 1e-9,
    'ps': 1e-12,
    'fs': 1e-15
  };
  const tickInSec = val * (units[unit] || 1e-9);
  const bitDurationTicks = Math.max(1, Math.round(1 / (baudRate * tickInSec)));

  const events: DecodedEvent[] = [];
  const values = signal.values;
  if (values.length < 2) return [];

  let i = 1;
  while (i < values.length) {
    // Look for start bit (falling edge for idle-high UART)
    const prev = values[i - 1];
    const curr = values[i];

    if (prev.value === '1' && curr.value === '0') {
      const startTime = curr.time;
      const dataBits: number[] = [];
      
      // Sample 8 bits + stop bit
      // We sample at middle of each bit
      let possible = true;
      for (let b = 0; b < 8; b++) {
        const sampleTime = startTime + bitDurationTicks * (b + 1.5);
        const valAtSample = getSignalValueAt(signal, sampleTime);
        if (valAtSample === 'x' || valAtSample === 'z') {
          possible = false;
          break;
        }
        dataBits.push(parseInt(valAtSample));
      }

      if (possible) {
        // Convert bits to byte (LSB first)
        let byte = 0;
        for (let b = 0; b < 8; b++) {
          if (dataBits[b]) byte |= (1 << b);
        }
        const char = String.fromCharCode(byte);
        const hex = byte.toString(16).toUpperCase().padStart(2, '0');
        
        events.push({
          startTime,
          endTime: startTime + bitDurationTicks * 10, // Start + 8 data + Stop
          data: `0x${hex}`,
          label: char.match(/[ -~]/) ? char : `\\x${hex}`
        });
        
        // Skip ahead
        const nextTime = startTime + bitDurationTicks * 10;
        while (i < values.length && values[i].time < nextTime) i++;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return events;
}

function getSignalValueAt(signal: VCDSignal, time: number): string {
  // Binary search or simple find
  let lastVal = 'x';
  for (const v of signal.values) {
    if (v.time > time) return lastVal;
    lastVal = v.value;
  }
  return lastVal;
}

export function decodeSPI(
  sclk: VCDSignal,
  mosi: VCDSignal | undefined,
  miso: VCDSignal | undefined,
  cs: VCDSignal | undefined,
  cpol: number = 0,
  cpha: number = 0
): DecodedEvent[] {
  const events: DecodedEvent[] = [];
  if (!sclk) return [];

  // 1. Find CS active regions (if CS exists)
  // If no CS, assume always active
  const csValues = cs ? cs.values : [{ time: 0, value: '0' }];
  
  let mosiBits: number[] = [];
  let misoBits: number[] = [];
  let byteStartTime = -1;

  // We iterate through SCLK edges
  for (let i = 1; i < sclk.values.length; i++) {
    const prev = sclk.values[i-1];
    const curr = sclk.values[i];
    
    // Check if CS is active (0) at this time
    if (cs && getSignalValueAt(cs, curr.time) !== '0') {
      // CS is high, reset byte accumulation
      mosiBits = [];
      misoBits = [];
      byteStartTime = -1;
      continue;
    }

    // Determine if this is a sampling edge
    // CPOL=0: Idle low. Leading edge=Rising, Trailing edge=Falling
    // CPOL=1: Idle high. Leading edge=Falling, Trailing edge=Rising
    // CPHA=0: Sample on Leading edge
    // CPHA=1: Sample on Trailing edge
    
    const isRising = prev.value === '0' && curr.value === '1';
    const isFalling = prev.value === '1' && curr.value === '0';
    
    let isSampleEdge = false;
    if (cpol === 0) {
      if (cpha === 0) isSampleEdge = isRising;
      else isSampleEdge = isFalling;
    } else {
      if (cpha === 0) isSampleEdge = isFalling;
      else isSampleEdge = isRising;
    }

    if (isSampleEdge) {
      if (byteStartTime === -1) byteStartTime = curr.time;

      if (mosi) {
        const v = getSignalValueAt(mosi, curr.time);
        mosiBits.push(v === '1' ? 1 : 0);
      }
      if (miso) {
        const v = getSignalValueAt(miso, curr.time);
        misoBits.push(v === '1' ? 1 : 0);
      }

      if (mosiBits.length === 8 || misoBits.length === 8) {
        // Process byte
        let mosiByte = 0;
        let misoByte = 0;
        for (let b = 0; b < 8; b++) {
          if (mosiBits[b]) mosiByte |= (1 << (7 - b)); // MSB first
          if (misoBits[b]) misoByte |= (1 << (7 - b));
        }

        const mosiHex = mosiByte.toString(16).toUpperCase().padStart(2, '0');
        const misoHex = misoByte.toString(16).toUpperCase().padStart(2, '0');

        events.push({
          startTime: byteStartTime,
          endTime: curr.time,
          data: `MOSI: 0x${mosiHex}, MISO: 0x${misoHex}`,
          label: `M:${mosiHex} S:${misoHex}`
        });

        mosiBits = [];
        misoBits = [];
        byteStartTime = -1;
      }
    }
  }

  return events;
}

export function decodeAvalon(
  clk: VCDSignal,
  address: VCDSignal | undefined,
  read: VCDSignal | undefined,
  write: VCDSignal | undefined,
  writedata: VCDSignal | undefined,
  readdata: VCDSignal | undefined,
  waitrequest: VCDSignal | undefined,
  readdatavalid: VCDSignal | undefined
): DecodedEvent[] {
  const events: DecodedEvent[] = [];
  if (!clk || clk.values.length < 2) return [];

  // Estimate clock period
  let clockPeriod = 1;
  if (clk.values.length >= 3) {
    // Find first two rising edges
    let firstRising = -1;
    let secondRising = -1;
    for (let i = 1; i < clk.values.length; i++) {
      if (clk.values[i-1].value === '0' && clk.values[i].value === '1') {
        if (firstRising === -1) firstRising = clk.values[i].time;
        else {
          secondRising = clk.values[i].time;
          clockPeriod = Math.max(1, secondRising - firstRising);
          break;
        }
      }
    }
  }

  // We iterate through CLK rising edges
  for (let i = 1; i < clk.values.length; i++) {
    const prev = clk.values[i - 1];
    const curr = clk.values[i];

    const isRising = prev.value === '0' && curr.value === '1';
    if (!isRising) continue;

    const time = curr.time;

    // Check waitrequest
    const isWaiting = waitrequest ? getSignalValueAt(waitrequest, time) === '1' : false;
    if (isWaiting) continue;

    const isRead = read ? getSignalValueAt(read, time) === '1' : false;
    const isWrite = write ? getSignalValueAt(write, time) === '1' : false;

    if (isWrite) {
      const addr = address ? getSignalValueAt(address, time) : 'X';
      const data = writedata ? getSignalValueAt(writedata, time) : 'X';
      events.push({
        startTime: time,
        endTime: time + clockPeriod,
        data: `WRITE Addr: 0x${binToHex(addr)}, Data: 0x${binToHex(data)}`,
        label: `WR 0x${binToHex(addr)}`
      });
    }

    if (isRead) {
      const addr = address ? getSignalValueAt(address, time) : 'X';
      // For read, we might need to wait for readdatavalid
      // For now, just log the request
      events.push({
        startTime: time,
        endTime: time + clockPeriod,
        data: `READ REQ Addr: 0x${binToHex(addr)}`,
        label: `RD REQ 0x${binToHex(addr)}`
      });
    }

    // Handle readdatavalid separately if it's a different cycle
    const isDataValid = readdatavalid ? getSignalValueAt(readdatavalid, time) === '1' : false;
    if (isDataValid) {
      const data = readdata ? getSignalValueAt(readdata, time) : 'X';
      events.push({
        startTime: time,
        endTime: time + clockPeriod,
        data: `READ DATA: 0x${binToHex(data)}`,
        label: `RD DATA 0x${binToHex(data)}`
      });
    }
  }

  return events;
}

export function calculateSignalMeasurements(signal: VCDSignal, timescaleStr: string) {
  if (signal.size > 1 || signal.values.length < 2) return null;

  // Normalize timescale string (e.g. "1 fs" -> "1fs")
  const normalizedTimescale = timescaleStr.replace(/\s+/g, '');
  const match = normalizedTimescale.match(/(\d+)([a-zA-Z]+)/);
  if (!match) return null;
  
  const val = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const units: Record<string, number> = {
    's': 1, 'ms': 1e-3, 'us': 1e-6, 'ns': 1e-9, 'ps': 1e-12, 'fs': 1e-15
  };
  const tickInSec = val * (units[unit] || 1e-9);

  let posPulseWidths: number[] = [];
  let negPulseWidths: number[] = [];
  let periods: number[] = [];

  const isHigh = (v: string) => v === '1' || v === 'H' || v === 'h';
  const isLow = (v: string) => v === '0' || v === 'L' || v === 'l';

  for (let i = 1; i < signal.values.length; i++) {
    const prev = signal.values[i-1];
    const curr = signal.values[i];
    const duration = curr.time - prev.time;

    if (isHigh(prev.value)) posPulseWidths.push(duration);
    else if (isLow(prev.value)) negPulseWidths.push(duration);
  }

  // Calculate periods (rising to rising)
  let lastRising = -1;
  for (let i = 1; i < signal.values.length; i++) {
    if (isLow(signal.values[i-1].value) && isHigh(signal.values[i].value)) {
      if (lastRising !== -1) periods.push(signal.values[i].time - lastRising);
      lastRising = signal.values[i].time;
    }
  }

  const formatTime = (ticks: number) => {
    const sec = ticks * tickInSec;
    if (sec >= 1) return sec.toFixed(2) + ' s';
    if (sec >= 1e-3) return (sec * 1e3).toFixed(2) + ' ms';
    if (sec >= 1e-6) return (sec * 1e6).toFixed(2) + ' us';
    if (sec >= 1e-9) return (sec * 1e9).toFixed(2) + ' ns';
    if (sec >= 1e-12) return (sec * 1e12).toFixed(2) + ' ps';
    return (sec * 1e15).toFixed(2) + ' fs';
  };

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const avgPeriod = avg(periods);
  if (avgPeriod === 0) return null;

  const freqHz = 1 / (avgPeriod * tickInSec);
  
  const formatFreq = (hz: number) => {
    if (!isFinite(hz) || hz <= 0) return 'N/A';
    if (hz >= 1e9) return (hz / 1e9).toFixed(2) + ' GHz';
    if (hz >= 1e6) return (hz / 1e6).toFixed(2) + ' MHz';
    if (hz >= 1e3) return (hz / 1e3).toFixed(2) + ' kHz';
    return hz.toFixed(2) + ' Hz';
  };

  return {
    avgPosPulse: formatTime(avg(posPulseWidths)),
    avgNegPulse: formatTime(avg(negPulseWidths)),
    avgPeriod: formatTime(avgPeriod),
    frequency: formatFreq(freqHz),
    dutyCycle: avgPeriod > 0 ? (avg(posPulseWidths) / avgPeriod * 100).toFixed(1) + '%' : 'N/A'
  };
}

export function calculateSignalFrequency(signal: VCDSignal, timescaleStr: string): string | null {
  if (signal.size > 1 || signal.values.length < 3) return null;

  // Convert timescale to seconds
  const match = timescaleStr.match(/(\d+)\s*(\w+)/);
  if (!match) return null;
  const val = parseInt(match[1]);
  const unit = match[2];
  const units: Record<string, number> = {
    's': 1, 'ms': 1e-3, 'us': 1e-6, 'ns': 1e-9, 'ps': 1e-12, 'fs': 1e-15
  };
  const tickInSec = val * (units[unit] || 1e-9);

  const risingEdges: number[] = [];
  for (let i = 1; i < signal.values.length; i++) {
    if (signal.values[i-1].value === '0' && signal.values[i].value === '1') {
      risingEdges.push(signal.values[i].time);
    }
  }

  if (risingEdges.length < 2) return null;

  // Calculate average period
  let totalPeriod = 0;
  for (let i = 1; i < risingEdges.length; i++) {
    totalPeriod += (risingEdges[i] - risingEdges[i-1]);
  }
  const avgPeriodTicks = totalPeriod / (risingEdges.length - 1);
  const avgPeriodSec = avgPeriodTicks * tickInSec;

  if (avgPeriodSec === 0) return null;

  const freqHz = 1 / avgPeriodSec;

  if (freqHz >= 1e9) return (freqHz / 1e9).toFixed(2) + ' GHz';
  if (freqHz >= 1e6) return (freqHz / 1e6).toFixed(2) + ' MHz';
  if (freqHz >= 1e3) return (freqHz / 1e3).toFixed(2) + ' kHz';
  return freqHz.toFixed(2) + ' Hz';
}

export function binToHex(bin: string): string {
  if (!bin) return 'X';
  
  // Handle strings with non-binary characters (U, X, Z, W, L, H, -)
  if (bin.match(/[uUxXzZwWl LhH-]/)) {
    // If it's all the same character, just return that
    const uniqueChars = new Set(bin.split(''));
    if (uniqueChars.size === 1) return bin[0].toUpperCase();
    // Otherwise, it's a mix, return 'X'
    return 'X';
  }

  try {
    // For very long strings, BigInt is necessary
    return BigInt('0b' + bin).toString(16).toUpperCase();
  } catch {
    return 'X';
  }
}
