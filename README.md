<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# VCD Protocol Analyzer

VCD Protocol Analyzer is a lightweight viewer designed to open VCD (Value Change Dump) files inside Visual Studio Code and help you inspect waveforms and protocol activity. It automatically detects common bus and serial protocols and displays them as grouped, interactive overlays on top of the waveform.

Key features
- Open .vcd files in VS Code or in the local dev server UI
- Auto-detects and decodes protocols such as Avalon-MM (Avalon memory-mapped), UART, and SPI
- Renders detected protocols as groups with event overlays and highlights
- Tooltips for protocol events and full hierarchical signal names
- Handles explicit unknown/high-impedance states (X/Z) correctly

More protocols will be added over time.

## Run Locally

Prerequisites: Node.js (and npm)

1. Install dependencies:
   `npm install`
2. Start the dev UI:
   `npm run dev`

## Usage in VS Code
- Open a `.vcd` file and run the `Open VCD Viewer` command (or open the custom editor if installed as an extension).
- Use the left panel to select signals, group them, and toggle visibility.
- Hover protocol events to see decoded information and click events to add persistent cursors.

For packaging as a VS Code extension, build the extension bundle (`npm run build:extension`) and create a VSIX (`vsce package`).

Contributions and issues are welcome — more decoders and UX improvements planned.
