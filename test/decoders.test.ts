import { describe, it, expect } from 'vitest';
import {
  VCDSignal,
  decodeUART,
  decodeSPI,
  decodeAvalon,
  decodeI2C,
  formatBusValue,
  calculateSignalFrequency,
  calculateSignalMeasurements
} from '../src/utils/vcd';

describe('Protocol Decoders', () => {
  describe('UART Decoder', () => {
    it('decodes 8N1 byte correctly (e.g. 0x55 / "U")', () => {
      // 9600 baud, 1ns timescale -> 1 bit = 104167 ns
      // Byte 0x55 = binary 01010101 (LSB first: 1, 0, 1, 0, 1, 0, 1, 0)
      const bitTicks = 104167;
      let t = 0;
      const values: { time: number; value: string }[] = [];

      // Idle high
      values.push({ time: t, value: '1' });
      t += bitTicks * 2;

      // Start bit (0)
      values.push({ time: t, value: '0' });
      t += bitTicks;

      // 8 data bits: 0x55 -> bits: 1, 0, 1, 0, 1, 0, 1, 0
      const bits = [1, 0, 1, 0, 1, 0, 1, 0];
      for (const b of bits) {
        values.push({ time: t, value: b.toString() });
        t += bitTicks;
      }

      // Stop bit (1)
      values.push({ time: t, value: '1' });
      t += bitTicks * 2;

      const signal: VCDSignal = {
        id: '1',
        name: 'uart_tx',
        type: 'wire',
        size: 1,
        values
      };

      const events = decodeUART(signal, 9600, '1ns');
      expect(events.length).toBe(1);
      expect(events[0].data).toBe('0x55');
      expect(events[0].label).toBe('U');
    });

    it('returns empty when no transitions present', () => {
      const signal: VCDSignal = {
        id: '1',
        name: 'idle_tx',
        type: 'wire',
        size: 1,
        values: [{ time: 0, value: '1' }]
      };
      const events = decodeUART(signal, 9600, '1ns');
      expect(events.length).toBe(0);
    });
  });

  describe('SPI Decoder', () => {
    it('decodes SPI byte (CPOL=0, CPHA=0)', () => {
      // 8 clock cycles with CS low
      const sclkValues: { time: number; value: string }[] = [];
      const mosiValues: { time: number; value: string }[] = [];
      const csValues: { time: number; value: string }[] = [
        { time: 0, value: '1' },
        { time: 10, value: '0' },
        { time: 100, value: '1' }
      ];

      // MOSI transmits 0xA5 = 10100101 (MSB first)
      const mosiBits = [1, 0, 1, 0, 0, 1, 0, 1];
      let t = 10;
      sclkValues.push({ time: 0, value: '0' });

      for (let i = 0; i < 8; i++) {
        t += 5;
        mosiValues.push({ time: t - 2, value: mosiBits[i].toString() });
        // Rising edge (sampling edge for CPOL=0, CPHA=0)
        sclkValues.push({ time: t, value: '1' });
        t += 5;
        // Falling edge
        sclkValues.push({ time: t, value: '0' });
      }

      const sclk: VCDSignal = { id: 'sclk', name: 'sclk', type: 'wire', size: 1, values: sclkValues };
      const mosi: VCDSignal = { id: 'mosi', name: 'mosi', type: 'wire', size: 1, values: mosiValues };
      const cs: VCDSignal = { id: 'cs', name: 'cs', type: 'wire', size: 1, values: csValues };

      const events = decodeSPI(sclk, mosi, undefined, cs, 0, 0);
      expect(events.length).toBe(1);
      expect(events[0].data).toContain('MOSI: 0xA5');
    });
  });

  describe('Avalon Decoder', () => {
    it('decodes Avalon-MM write and read transactions', () => {
      // Clock with 10ns period (5ns half-period)
      const clkValues: { time: number; value: string }[] = [];
      for (let t = 0; t <= 100; t += 5) {
        clkValues.push({ time: t, value: (t % 10 === 0) ? '0' : '1' });
      }

      // Write at cycle 2 (rising edge at t=15, setup before edge)
      const addrValues = [
        { time: 0, value: '00000000' },
        { time: 10, value: '00000100' }, // Addr 0x4
        { time: 30, value: '00001000' }  // Addr 0x8
      ];
      const writeValues = [
        { time: 0, value: '0' },
        { time: 10, value: '1' },
        { time: 20, value: '0' }
      ];
      const wrdataValues = [
        { time: 10, value: '11110000' } // Data 0xF0
      ];

      // Read at cycle 4 (rising edge at t=35)
      const readValues = [
        { time: 0, value: '0' },
        { time: 30, value: '1' },
        { time: 40, value: '0' }
      ];

      const clk: VCDSignal = { id: 'clk', name: 'clk', type: 'wire', size: 1, values: clkValues };
      const addr: VCDSignal = { id: 'addr', name: 'addr', type: 'wire', size: 8, values: addrValues };
      const read: VCDSignal = { id: 'read', name: 'read', type: 'wire', size: 1, values: readValues };
      const write: VCDSignal = { id: 'write', name: 'write', type: 'wire', size: 1, values: writeValues };
      const wrdata: VCDSignal = { id: 'wrdata', name: 'wrdata', type: 'wire', size: 8, values: wrdataValues };

      const events = decodeAvalon(clk, addr, read, write, wrdata, undefined, undefined, undefined);
      expect(events.length).toBe(2);
      expect(events[0].data).toContain('WRITE Addr: 0x4, Data: 0xF0');
      expect(events[1].data).toContain('READ REQ Addr: 0x8');
    });
  });

  describe('I2C Decoder', () => {
    it('decodes I2C START, address byte with ACK, data byte, and STOP', () => {
      // Create I2C transaction:
      // START: SDA drops while SCL is high
      // Address byte: 0x50 << 1 | 0 = 0xA0 (write to address 0x50)
      // Bits: 1, 0, 1, 0, 0, 0, 0, 0, ACK (0)
      // STOP: SDA rises while SCL is high
      const sclValues: { time: number; value: string }[] = [{ time: 0, value: '1' }];
      const sdaValues: { time: number; value: string }[] = [{ time: 0, value: '1' }];

      let t = 10;
      // START: SDA goes 0 while SCL is 1
      sdaValues.push({ time: t, value: '0' });

      // 9 clock pulses for address byte 0xA0 + ACK (0)
      const addrBits = [1, 0, 1, 0, 0, 0, 0, 0, 0]; // 8 bits + ACK=0
      for (const bit of addrBits) {
        t += 5;
        // SCL falls to 0
        sclValues.push({ time: t, value: '0' });
        // SDA sets data bit
        sdaValues.push({ time: t + 1, value: bit.toString() });
        t += 5;
        // SCL rises to 1 (sampling edge)
        sclValues.push({ time: t, value: '1' });
      }

      t += 5;
      sclValues.push({ time: t, value: '0' });
      sdaValues.push({ time: t + 1, value: '0' });
      t += 5;
      sclValues.push({ time: t, value: '1' });
      t += 5;
      // STOP: SDA rises to 1 while SCL is 1
      sdaValues.push({ time: t, value: '1' });

      const scl: VCDSignal = { id: 'scl', name: 'scl', type: 'wire', size: 1, values: sclValues };
      const sda: VCDSignal = { id: 'sda', name: 'sda', type: 'wire', size: 1, values: sdaValues };

      const events = decodeI2C(scl, sda);
      expect(events.length).toBe(3); // START, Addr, STOP
      expect(events[0].label).toBe('START');
      expect(events[1].data).toContain('Addr: 0x50 (WR), ACK');
      expect(events[2].label).toBe('STOP');
    });
  });

  describe('Bus Radix Formatter', () => {
    it('formats hexadecimal, decimal, signed, binary, and ascii correctly', () => {
      expect(formatBusValue('11111111', 'hex')).toBe('0xFF');
      expect(formatBusValue('11111111', 'dec')).toBe('255');
      expect(formatBusValue('11111111', 'signed')).toBe('-1');
      expect(formatBusValue('00000001', 'signed')).toBe('1');
      expect(formatBusValue('1010', 'bin')).toBe('b1010');
      expect(formatBusValue('01000001', 'ascii')).toBe('A');
    });
  });

  describe('Signal Frequency & Measurements', () => {
    it('calculates 50 MHz frequency on 20ns clock', () => {
      const values: { time: number; value: string }[] = [];
      for (let i = 0; i < 10; i++) {
        values.push({ time: i * 20, value: '0' });
        values.push({ time: i * 20 + 10, value: '1' });
      }

      const clk: VCDSignal = { id: 'clk', name: 'clk', type: 'wire', size: 1, values };
      const freq = calculateSignalFrequency(clk, '1ns');
      expect(freq).toBe('50.00 MHz');

      const measurements = calculateSignalMeasurements(clk, '1ns');
      expect(measurements).not.toBeNull();
      expect(measurements?.frequency).toBe('50.00 MHz');
      expect(measurements?.dutyCycle).toBe('50.0%');
    });
  });
});
