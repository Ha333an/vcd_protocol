import { VCDData, VCDSignal, DecodedEvent } from './utils/vcd';

export type { VCDData, VCDSignal, DecodedEvent };

export type RadixType = 'hex' | 'dec' | 'signed' | 'bin' | 'ascii';

export interface ProtocolConfig {
  id: string;
  type: 'UART' | 'SPI' | 'Avalon' | 'I2C';
  signals: string[];
  config: {
    baudRate?: number;
    cpol?: number;
    cpha?: number;
  };
  collapsed?: boolean;
}

export interface SignalGroup {
  id: string;
  name: string;
  signalNames: string[];
  collapsed?: boolean;
}
