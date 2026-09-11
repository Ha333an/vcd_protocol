import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseVCD,
  binToHex,
  getSignalValueAt,
  detectBestDisplayUnit,
  convertTicksToUnit,
  getTimeScaleInfo
} from '../src/utils/vcd';

describe('VCD Parser', () => {
  it('parses empty or invalid header safely', () => {
    const res = parseVCD('invalid content without enddefinitions');
    expect(res.signals.size).toBe(0);
    expect(res.maxTime).toBe(0);
  });

  it('parses timescale properly', () => {
    const vcd = `
$timescale 10 ps $end
$scope module top $end
$var wire 1 ! clk $end
$upscope $end
$enddefinitions $end
#0
0!
#100
1!
`;
    const res = parseVCD(vcd);
    expect(res.timescale).toBe('10ps');
    expect(res.maxTime).toBe(100);
    expect(res.signals.has('top.clk')).toBe(true);
    const clk = res.signals.get('top.clk')!;
    expect(clk.values).toEqual([
      { time: 0, value: '0' },
      { time: 100, value: '1' }
    ]);
  });

  it('parses sample file output.vcd', () => {
    const filePath = path.join(__dirname, 'output.vcd');
    const content = fs.readFileSync(filePath, 'utf8');
    const res = parseVCD(content);
    expect(res.signals.size).toBeGreaterThan(0);
    expect(res.maxTime).toBeGreaterThan(0);
  });

  it('parses sample file uart_phy_tb.vcd with scopes and multi-bit signals', () => {
    const filePath = path.join(__dirname, 'uart_phy_tb.vcd');
    const content = fs.readFileSync(filePath, 'utf8');
    const res = parseVCD(content);
    expect(res.timescale).toBe('1fs');
    expect(res.signals.size).toBeGreaterThan(10);
    expect(res.signals.has('uart_phy_tb.clk')).toBe(true);
    expect(res.signals.has('uart_phy_tb.uut.tx')).toBe(true);
  });

  it('parses sample file wave.vcd', () => {
    const filePath = path.join(__dirname, 'wave.vcd');
    const content = fs.readFileSync(filePath, 'utf8');
    const res = parseVCD(content);
    expect(res.signals.size).toBeGreaterThan(0);
  });

  it('merges bit-blasted vectors correctly', () => {
    const vcd = `
$timescale 1ns $end
$scope module top $end
$var wire 1 ! data[0] $end
$var wire 1 " data[1] $end
$upscope $end
$enddefinitions $end
#0
0!
0"
#10
1!
0"
#20
0!
1"
#30
1!
1"
`;
    const res = parseVCD(vcd);
    expect(res.signals.has('top.data[1:0]')).toBe(true);
    const composite = res.signals.get('top.data[1:0]')!;
    expect(composite.size).toBe(2);
    expect(composite.values).toEqual([
      { time: 0, value: '00' },
      { time: 10, value: '01' },
      { time: 20, value: '10' },
      { time: 30, value: '11' }
    ]);
  });
});

describe('Helper Functions', () => {
  it('binToHex converts binary and handles X/Z', () => {
    expect(binToHex('1010')).toBe('A');
    expect(binToHex('11111111')).toBe('FF');
    expect(binToHex('0')).toBe('0');
    expect(binToHex('1')).toBe('1');
    expect(binToHex('x')).toBe('X');
    expect(binToHex('z')).toBe('Z');
    expect(binToHex('10x1')).toBe('X');
  });

  it('getSignalValueAt returns correct value at given timestamps', () => {
    const sig = {
      id: '1',
      name: 'clk',
      type: 'wire' as const,
      size: 1,
      values: [
        { time: 10, value: '0' },
        { time: 20, value: '1' },
        { time: 30, value: '0' }
      ]
    };
    expect(getSignalValueAt(sig, 5)).toBe('x');
    expect(getSignalValueAt(sig, 10)).toBe('0');
    expect(getSignalValueAt(sig, 15)).toBe('0');
    expect(getSignalValueAt(sig, 20)).toBe('1');
    expect(getSignalValueAt(sig, 25)).toBe('1');
    expect(getSignalValueAt(sig, 30)).toBe('0');
    expect(getSignalValueAt(sig, 50)).toBe('0');
  });

  it('getTimeScaleInfo and convertTicksToUnit handle scaling', () => {
    const info = getTimeScaleInfo('10ns');
    expect(info.value).toBe(10);
    expect(info.unit).toBe('ns');
    expect(info.factor).toBe(1e-8);

    const converted = convertTicksToUnit(100, '1ns', 'us');
    expect(converted).toBeCloseTo(0.1);
  });

  it('detectBestDisplayUnit selects sensible units', () => {
    expect(detectBestDisplayUnit('1ns', 500)).toBe('ns');
    expect(detectBestDisplayUnit('1ns', 5000)).toBe('us');
    expect(detectBestDisplayUnit('1ns', 5000000)).toBe('ms');
  });
});
