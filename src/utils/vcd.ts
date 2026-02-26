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
  const lines = content.split('\n');
  const signals = new Map<string, VCDSignal>();
  const idToSignal = new Map<string, VCDSignal>();
  let timescale = '1ns';
  let currentTime = 0;
  let maxTime = 0;

  let inHeader = true;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    if (inHeader) {
      if (line.startsWith('$timescale')) {
        timescale = line.split('$timescale')[1].replace('$end', '').trim();
      } else if (line.startsWith('$var')) {
        const parts = line.split(/\s+/);
        // $var wire 1 ! clk $end
        const type = parts[1] as 'wire' | 'reg';
        const size = parseInt(parts[2]);
        const id = parts[3];
        const name = parts[4];
        const signal: VCDSignal = { id, name, type, size, values: [] };
        signals.set(name, signal);
        idToSignal.set(id, signal);
      } else if (line.startsWith('$enddefinitions')) {
        inHeader = false;
      }
      continue;
    }

    if (line.startsWith('#')) {
      currentTime = parseInt(line.substring(1));
      if (currentTime > maxTime) maxTime = currentTime;
    } else {
      // Value change
      // Single bit: 0! or 1!
      // Multi bit: b0010 !
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

function binToHex(bin: string): string {
  if (!bin || bin.match(/[xXzZ]/)) return bin || 'X';
  try {
    return BigInt('0b' + bin).toString(16).toUpperCase();
  } catch {
    return bin;
  }
}
