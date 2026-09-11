# VCD Protocol Analyzer

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**VCD Protocol Analyzer** is a high-performance waveform viewer and protocol analyzer designed to open VCD (Value Change Dump) files directly inside Visual Studio Code or as a standalone web application. It automatically detects common serial and bus protocols, rendering synchronized protocol transactions directly over the timeline.

---

## Key Features

- **Multi-Protocol Decoding & Auto-Detection**:
  - **I2C**: Decodes START, 7-bit Address, R/W direction, ACK/NACK, data payloads, and STOP conditions.
  - **UART**: Configurable baud rate, 8N1 bit extraction, framing verification, and ASCII character recovery.
  - **SPI**: Configurable CPOL / CPHA modes (0/0, 0/1, 1/0, 1/1) with SCLK, MOSI, MISO, and CS tracking.
  - **Avalon-MM**: Decodes read/write cycles, address phases, wait states (`waitrequest`), and read data valid events.
  - **One-Click Auto-Detect**: Heuristic auto-detection of protocols based on signal naming conventions.

- **Bus Radix Selection**:
  - Format multi-bit bus values instantly in **HEX**, **DEC (Unsigned)**, **DEC (Signed 2's Complement)**, **BIN**, or **ASCII**.

- **Export Decoded Transactions**:
  - Export decoded protocol packets and packet timing data directly to **CSV** for testbench verification and automated reports.

- **Fast & Memory-Optimized VCD Engine**:
  - Index-based line parser without massive array allocations (`split('\n')`), enabling smooth loading of large simulation dumps.
  - Dynamic display timescale adaptation (fs, ps, ns, us, ms, s).
  - Bit-blasted vector auto-reconstruction into composite buses.

- **Timing & Measurements**:
  - Automated measurement readout for clock and toggle signals: Frequency, Period, Positive Pulse Width, Negative Pulse Width, and Duty Cycle.
  - Arbitrary placement of timing markers/cursors with automatic delta-\( \Delta t \) time difference readouts.

- **Flexible UI & Ergonomics**:
  - Resizable and collapsible sidebar with dedicated sections for **Visible Signals**, **Protocols**, and **Signal Groups**.
  - Fast signal search/filter in the sidebar.
  - Custom signal grouping and hierarchical suffix-based auto-grouping.
  - Sticky time axis that remains pinned at the top while scrolling through signals vertically.
  - Horizontal timeline scrollbar and smooth D3-powered zoom/pan.

---

## Keyboard Shortcuts

| Key Shortcut | Action |
|---|---|
| `+` or `=` | Zoom in on timeline |
| `-` or `_` | Zoom out on timeline |
| `F` | Fit waveform to screen |
| `Alt` + `ArrowUp` / `ArrowDown` | Reorder selected signal row vertically |
| `Delete` | Remove selected signal or group from view |
| `Click` on waveform | Place timing cursor / marker |

---

## Development & Testing

### Prerequisites
- Node.js (v16+)
- npm

### Installation
```bash
npm install
```

### Run Web UI Locally
```bash
npm run dev
```

### Run Automated Unit Tests (Vitest)
```bash
npm test
```

### Type Checking & Linting
```bash
npm run lint
```

### Build Extension & Web Bundle
```bash
npm run vscode:prepublish
```

### Package Extension (`.vsix`)
```bash
npm run package
```

---

## Usage in Visual Studio Code

1. Open any `.vcd` file in VS Code.
2. The file will automatically open with the **VCD Viewer** custom editor. Alternatively, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run `Open VCD Viewer`.
3. Use the left sidebar to toggle signal visibility, group buses, or configure protocol decoders.
4. Hover over signal transitions and decoded protocol indicators to inspect values and addresses.
5. Click anywhere in the waveform canvas to add timing markers and measure intervals.
6. Click **Export CSV** in the toolbar to save decoded protocol events.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
