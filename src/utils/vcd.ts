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
  // Some VCDs reuse short ids across scopes; map id -> array of signals to handle duplicates
  const idToSignals = new Map<string, VCDSignal[]>();
  let timescale = '1ns';
  let currentTime = 0;
  let maxTime = 0;
  let scopeStack: string[] = [];

  // Split into header and data
  const endDefinitionsIdx = content.indexOf('$enddefinitions');
  if (endDefinitionsIdx === -1) return { timescale, signals, maxTime };

  // Parse Header more robustly
  // Extract timescale
  const timescaleMatch = content.slice(0, endDefinitionsIdx).match(/\$timescale\s+([\d\s\w]+)\s+\$end/);
  if (timescaleMatch) {
    timescale = timescaleMatch[1].trim().replace(/\s+/g, '');
  }

  // Parse scopes and vars in header
  let headerPos = 0;
  while (headerPos < endDefinitionsIdx) {
    let nextNewline = content.indexOf('\n', headerPos);
    if (nextNewline === -1 || nextNewline > endDefinitionsIdx) {
      nextNewline = endDefinitionsIdx;
    }
    const line = content.slice(headerPos, nextNewline).trim();
    headerPos = nextNewline + 1;
    if (!line) continue;

    if (line.startsWith('$scope')) {
      const parts = line.split(/\s+/);
      if (parts[2]) scopeStack.push(parts[2]);
    } else if (line.startsWith('$upscope')) {
      scopeStack.pop();
    } else if (line.startsWith('$var')) {
      const parts = line.split(/\s+/);
      const type = parts[1] as 'wire' | 'reg';
      const size = parseInt(parts[2], 10);
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
      if (!idToSignals.has(id)) idToSignals.set(id, []);
      idToSignals.get(id)!.push(signal);
    }
  }

  // Parse Data directly from content without duplicating data string or allocating millions of array elements
  let dataPos = endDefinitionsIdx + '$enddefinitions'.length;
  const contentLen = content.length;

  while (dataPos < contentLen) {
    let nextNewline = content.indexOf('\n', dataPos);
    if (nextNewline === -1) nextNewline = contentLen;
    const line = content.slice(dataPos, nextNewline).trim();
    dataPos = nextNewline + 1;
    if (!line) continue;

    const firstChar = line.charCodeAt(0);
    if (firstChar === 35 /* '#' */) {
      currentTime = parseInt(line.substring(1), 10);
      if (currentTime > maxTime) maxTime = currentTime;
    } else if (firstChar === 36 /* '$' */) {
      continue; // Skip other commands in data section
    } else if (firstChar === 98 || firstChar === 66 /* 'b' or 'B' */) {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx !== -1) {
        const value = line.substring(1, spaceIdx);
        const id = line.substring(spaceIdx + 1).trim();
        const sigs = idToSignals.get(id);
        if (sigs) {
          for (let s = 0; s < sigs.length; s++) {
            sigs[s].values.push({ time: currentTime, value });
          }
        }
      }
    } else {
      const value = line[0];
      const id = line.substring(1).trim();
      const sigs = idToSignals.get(id);
      if (sigs) {
        for (let s = 0; s < sigs.length; s++) {
          sigs[s].values.push({ time: currentTime, value });
        }
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

export function getSignalValueAt(signal: VCDSignal, time: number, beforeFirstValue = 'x'): string {
  const values = signal.values;
  if (!values || values.length === 0) return beforeFirstValue;

  let low = 0;
  let high = values.length - 1;
  let resultIndex = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (values[mid].time <= time) {
      resultIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return resultIndex === -1 ? beforeFirstValue : values[resultIndex].value;
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
  let lastReadSeen = false;
  let lastWriteSeen = false;

  for (let i = 1; i < clk.values.length; i++) {
    const prev = clk.values[i - 1];
    const curr = clk.values[i];

    const isRising = prev.value === '0' && curr.value === '1';
    if (!isRising) continue;

    const time = curr.time;

    // Check waitrequest at the edge
    const isWaiting = waitrequest ? getSignalValueAt(waitrequest, time) === '1' : false;
    if (isWaiting) continue;

    // Sample read/write slightly before the rising edge to capture setup-time assertions
    const setupOffset = Math.max(1, Math.floor(clockPeriod / 4));
    const sampleTime = Math.max(0, time - setupOffset);

    const sampledRead = read ? getSignalValueAt(read, sampleTime) === '1' : false;
    const sampledWrite = write ? getSignalValueAt(write, sampleTime) === '1' : false;

    // Emit write when asserted at sample time and wasn't asserted previously
    if (sampledWrite && !lastWriteSeen) {
      const addr = address ? getSignalValueAt(address, sampleTime) : 'X';
      const data = writedata ? getSignalValueAt(writedata, sampleTime) : 'X';
      events.push({
        startTime: time,
        endTime: time + clockPeriod,
        data: `WRITE Addr: 0x${binToHex(addr)}, Data: 0x${binToHex(data)}`,
        label: `WR 0x${binToHex(addr)}`
      });
    }

    // Emit read request when asserted at sample time and wasn't asserted previously
    if (sampledRead && !lastReadSeen) {
      const addr = address ? getSignalValueAt(address, sampleTime) : 'X';
      events.push({
        startTime: time,
        endTime: time + clockPeriod,
        data: `READ REQ Addr: 0x${binToHex(addr)}`,
        label: `RD REQ 0x${binToHex(addr)}`
      });
    }

    lastReadSeen = sampledRead;
    lastWriteSeen = sampledWrite;

    // Handle readdatavalid at the edge (data valid may appear later)
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

export function getTimeScaleInfo(timescaleStr: string) {
  const normalized = timescaleStr.replace(/\s+/g, '');
  const match = normalized.match(/(\d+)([a-zA-Z]+)/);
  if (!match) return { value: 1, unit: 'ns', factor: 1e-9 };
  
  const val = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const units: Record<string, number> = {
    's': 1, 'ms': 1e-3, 'us': 1e-6, 'ns': 1e-9, 'ps': 1e-12, 'fs': 1e-15
  };
  return { value: val, unit, factor: val * (units[unit] || 1e-9) };
}

export function detectBestDisplayUnit(timescaleStr: string, maxTicks: number) {
  const units: Record<string, number> = {
    's': 1, 'ms': 1e-3, 'us': 1e-6, 'ns': 1e-9, 'ps': 1e-12, 'fs': 1e-15
  };

  // Guard
  if (!timescaleStr || !isFinite(maxTicks) || maxTicks <= 0) return 'us';

  const info = getTimeScaleInfo(timescaleStr);
  const totalSec = maxTicks * info.factor;

  // Prefer largest unit that gives a value >= 1
  const order = ['s', 'ms', 'us', 'ns', 'ps', 'fs'];
  for (const u of order) {
    const v = totalSec / (units[u] || 1e-9);
    if (v >= 1) return u;
  }

  // If nothing matched, try to use the timescale's unit if valid
  if (info.unit && order.includes(info.unit)) return info.unit;

  // Fallback to microseconds as a sensible default
  return 'us';
}

export function convertTicksToUnit(ticks: number, fromTimescale: string, toUnit: string): number {
  const fromInfo = getTimeScaleInfo(fromTimescale);
  const units: Record<string, number> = {
    's': 1, 'ms': 1e-3, 'us': 1e-6, 'ns': 1e-9, 'ps': 1e-12, 'fs': 1e-15
  };
  const toFactor = units[toUnit.toLowerCase()] || 1e-9;
  return (ticks * fromInfo.factor) / toFactor;
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

export function formatBusValue(
  bin: string,
  radix: 'hex' | 'dec' | 'signed' | 'bin' | 'ascii' = 'hex'
): string {
  if (!bin) return 'X';
  if (bin.match(/[uUxXzZwWl LhH-]/)) {
    return binToHex(bin);
  }
  try {
    const val = BigInt('0b' + bin);
    switch (radix) {
      case 'bin':
        return 'b' + bin;
      case 'dec':
        return val.toString(10);
      case 'signed': {
        const bitLen = bin.length;
        if (bitLen > 1 && bin[0] === '1') {
          const maxVal = BigInt(1) << BigInt(bitLen);
          return (val - maxVal).toString(10);
        }
        return val.toString(10);
      }
      case 'ascii': {
        let str = '';
        for (let i = 0; i < bin.length; i += 8) {
          const slice = bin.slice(i, i + 8);
          if (slice.length === 8) {
            const code = parseInt(slice, 2);
            str += (code >= 32 && code <= 126) ? String.fromCharCode(code) : '.';
          }
        }
        return str || `0x${val.toString(16).toUpperCase()}`;
      }
      case 'hex':
      default:
        return '0x' + val.toString(16).toUpperCase();
    }
  } catch {
    return 'X';
  }
}

export function decodeI2C(
  scl: VCDSignal,
  sda: VCDSignal
): DecodedEvent[] {
  const events: DecodedEvent[] = [];
  if (!scl || !sda || scl.values.length < 2 || sda.values.length < 2) return [];

  const timeSet = new Set<number>();
  for (let i = 0; i < scl.values.length; i++) timeSet.add(scl.values[i].time);
  for (let i = 0; i < sda.values.length; i++) timeSet.add(sda.values[i].time);
  const sortedTimes = Array.from(timeSet).sort((a, b) => a - b);

  let inTransaction = false;
  let byteBits: number[] = [];
  let byteStartTime = -1;
  let isFirstByteInPacket = true;
  let lastSclVal = getSignalValueAt(scl, sortedTimes[0]);
  let lastSdaVal = getSignalValueAt(sda, sortedTimes[0]);

  for (let i = 1; i < sortedTimes.length; i++) {
    const t = sortedTimes[i];
    const currScl = getSignalValueAt(scl, t);
    const currSda = getSignalValueAt(sda, t);

    // Check for Start Condition: SDA falling edge while SCL is high ('1')
    if (lastSclVal === '1' && currScl === '1' && lastSdaVal === '1' && currSda === '0') {
      events.push({
        startTime: t,
        endTime: t + 1,
        data: 'START',
        label: 'START'
      });
      inTransaction = true;
      byteBits = [];
      byteStartTime = -1;
      isFirstByteInPacket = true;
    }
    // Check for Stop Condition: SDA rising edge while SCL is high ('1')
    else if (lastSclVal === '1' && currScl === '1' && lastSdaVal === '0' && currSda === '1') {
      events.push({
        startTime: t,
        endTime: t + 1,
        data: 'STOP',
        label: 'STOP'
      });
      inTransaction = false;
      byteBits = [];
      byteStartTime = -1;
      isFirstByteInPacket = true;
    }
    // Check for SCL Rising Edge to sample SDA data bit
    else if (inTransaction && lastSclVal === '0' && currScl === '1') {
      if (byteStartTime === -1) byteStartTime = t;
      const bitVal = currSda === '1' ? 1 : 0;
      byteBits.push(bitVal);

      if (byteBits.length === 9) {
        // 8 data bits (MSB first) + 1 ACK/NACK bit (bit 8: 0 = ACK, 1 = NACK)
        let byte = 0;
        for (let b = 0; b < 8; b++) {
          if (byteBits[b]) byte |= (1 << (7 - b));
        }
        const ack = byteBits[8] === 0;
        const ackStr = ack ? 'ACK' : 'NACK';
        const hexByte = byte.toString(16).toUpperCase().padStart(2, '0');

        if (isFirstByteInPacket) {
          const addr = (byte >> 1).toString(16).toUpperCase().padStart(2, '0');
          const rw = (byte & 1) ? 'RD' : 'WR';
          events.push({
            startTime: byteStartTime,
            endTime: t,
            data: `Addr: 0x${addr} (${rw}), ${ackStr}`,
            label: `@0x${addr} ${rw} [${ackStr}]`
          });
          isFirstByteInPacket = false;
        } else {
          events.push({
            startTime: byteStartTime,
            endTime: t,
            data: `Data: 0x${hexByte}, ${ackStr}`,
            label: `0x${hexByte} [${ackStr}]`
          });
        }

        byteBits = [];
        byteStartTime = -1;
      }
    }

    lastSclVal = currScl;
    lastSdaVal = currSda;
  }

  return events;
}
