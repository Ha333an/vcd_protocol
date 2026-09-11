# VCD Protocol Analyzer — Project Improvement TODO

This TODO outlines the completed and planned improvements for performance, code health, testing, architecture, and protocol features.

---

## Phase 1: High-Impact Performance & Stability Hotfixes

- [x] **Fix `JSON.stringify(vcdData)` in render loop (`src/App.tsx`)**
  - Replaced repeated full serialization with a lightweight memory/size tracking (displays loaded file size in MB and signal count).
- [x] **Optimize VCD parsing memory footprint (`src/utils/vcd.ts`)**
  - Eliminated `content.split('\n')` and intermediate `substring` duplication.
  - Implemented an index-based line iterator to parse tokens with zero redundant string allocations.
- [x] **Rendering performance & level-of-detail in `WaveformViewer.tsx`**
  - Optimized transition point and bus rendering.

---

## Phase 2: Dependency & Build Hygiene

- [x] **Prune unused & heavy dependencies from `package.json`**
  - Removed unused packages: `better-sqlite3`, `express`, `@types/express`, `dotenv`, `vcd-parser`, `@emnapi/*`, `@napi-rs/*`, `@tybys/*` (72 unneeded packages pruned from `node_modules`).
  - Removed duplicate `vite` declaration.
  - Moved `@types/d3` to `devDependencies`.
- [x] **Make build & clean scripts cross-platform**
  - Updated `"clean"` script to use Node's `fs.rmSync` for cross-platform Windows compatibility.
- [x] **Ensure clean lockfile and verify extension packaging**
  - Ran `npm install` to update `package-lock.json` and verified both `npm run lint` and `npm run vscode:prepublish`.

---

## Phase 3: Automated Testing & Decoder Verification

- [x] **Set up Vitest test runner**
  - Configured `vitest` for fast TypeScript unit testing.
  - Added test script to `package.json` (`npm test`).
- [x] **Add unit tests for VCD parsing (`test/vcd_parser.test.ts`)**
  - Tested header parsing, timescales, and bit-blasted vector reconstruction.
  - Tested with real sample files (`test/output.vcd`, `test/wave.vcd`, `test/uart_phy_tb.vcd`).
- [x] **Add unit tests for protocol decoders (`test/decoders.test.ts`)**
  - Tested UART decoding (8N1 sampling, byte extraction).
  - Tested SPI decoding (CPOL/CPHA variations).
  - Tested Avalon-MM decoding (Read, Write, waitrequest states).
  - Tested I2C decoder (START, 7-bit Address, ACK/NACK, STOP).
  - Tested bus radix formatting (`hex`, `dec`, `signed`, `bin`, `ascii`).
  - Tested signal measurements and frequency calculations.

---

## Phase 4: Modularity & Code Architecture

- [x] **Refactor `src/App.tsx` (~1,060 lines) into focused subcomponents**
  - Extracted `src/components/Sidebar/VisibleSignalsSection.tsx`
  - Extracted `src/components/Sidebar/ProtocolsSection.tsx`
  - Extracted `src/components/Sidebar/SignalGroupsSection.tsx`
  - Extracted `src/components/Measurements/MeasurementBar.tsx`
  - Created `src/types.ts` for shared TypeScript interfaces.
  - Reduced `App.tsx` from ~1,060 lines down to clean orchestrator (~370 lines).

---

## Phase 5: Protocol Decoders & UX Enhancements

- [x] **Add I2C Protocol Decoder**
  - Implemented `decodeI2C(scl, sda)` in `src/utils/vcd.ts` (handling START, Address+R/W, ACK/NACK, Data, and STOP conditions).
  - Added I2C signal selector UI in `ProtocolsSection.tsx` and auto-detection in `App.tsx`.
- [x] **Bus Radix Selection**
  - Added radix formatting function `formatBusValue` supporting Hex, Unsigned Decimal, Signed Decimal, Binary, and ASCII.
  - Added Radix selector dropdown in `WaveformViewer` toolbar.
- [x] **Export Decoded Events**
  - Added "Export CSV" button in the waveform toolbar that downloads decoded protocol transactions with timestamps, durations, labels, and packet data.
