import React from 'react';
import { Activity, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { VCDData } from '../../types';
import { calculateSignalMeasurements } from '../../utils/vcd';

interface MeasurementBarProps {
  selectedSignalName: string | null;
  vcdData: VCDData | null;
  onClose: () => void;
}

export const MeasurementBar: React.FC<MeasurementBarProps> = ({
  selectedSignalName,
  vcdData,
  onClose,
}) => {
  return (
    <AnimatePresence>
      {selectedSignalName && vcdData && vcdData.signals.get(selectedSignalName) && (
        <motion.div 
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="bg-[#1a1a1a] border border-[#f27d26]/30 rounded p-2 overflow-hidden"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex min-w-0 items-center gap-2">
              <Activity size={13} className="flex-shrink-0 text-[#f27d26]" />
              <h3 className="truncate text-[10px] font-bold uppercase font-mono text-white">
                Measurements: <span className="text-[#f27d26]">{selectedSignalName}</span>
              </h3>
            </div>
            <button 
              onClick={onClose}
              className="ml-2 text-xs text-gray-500 hover:text-white transition-colors"
            >
              ×
            </button>
          </div>
          
          {(() => {
            const signal = vcdData.signals.get(selectedSignalName)!;
            const measurements = calculateSignalMeasurements(signal, vcdData.timescale);
            
            if (measurements) {
              return (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {[
                    { label: 'Frequency', value: measurements.frequency },
                    { label: 'Period', value: measurements.avgPeriod },
                    { label: 'Pos Pulse', value: measurements.avgPosPulse },
                    { label: 'Neg Pulse', value: measurements.avgNegPulse },
                    { label: 'Duty Cycle', value: measurements.dutyCycle },
                  ].map(stat => (
                    <div key={stat.label} className="bg-[#0a0a0a] px-2 py-1 rounded border border-[#333]">
                      <div className="text-[8px] leading-tight text-gray-500 uppercase font-mono">{stat.label}</div>
                      <div className="text-xs leading-tight font-mono text-emerald-500 font-bold">{stat.value}</div>
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
  );
};
