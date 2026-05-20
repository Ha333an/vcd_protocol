# VCD Protocol Analyzer

VCD Protocol Analyzer is a lightweight viewer designed to open VCD (Value Change Dump) files inside Visual Studio Code and help you inspect waveforms and protocol activity. It automatically detects common bus and serial protocols and displays them as grouped, interactive overlays on top of the waveform.

Key features
- Open .vcd files in VS Code or in the local dev server UI
- Open .wlf files in VS Code by auto-converting them to VCD via `wlf2vcd`
- Auto-detects and decodes protocols such as Avalon-MM (Avalon memory-mapped), UART, and SPI
- Renders detected protocols as groups with event overlays and highlights
- Tooltips for protocol events and individual signals with hex/decimal values
- Handles explicit unknown/high-impedance states (X/Z) correctly
- Collapsible left sidebar for more waveform viewing space
- Search functionality to filter visible signals
- Signal measurements for clock signals (frequency, period, duty cycle)
- Interactive waveform viewer with zoom, pan, and selection capabilities

More protocols will be added over time.

## Run Locally

Prerequisites: Node.js (and npm)

1. Install dependencies:
   `npm install`
2. Start the dev UI:
   `npm run dev`

## Usage in VS Code
- For `.wlf` files, install `wlf2vcd` and ensure it is available in your system `PATH`.
- Open a `.vcd` or `.wlf` file and run the `Open VCD/WLF Viewer` command (or open the custom editor if installed as an extension).
- Use the left panel to select signals, group them, and toggle visibility.
- Search for signals using the searchbar in the "Visible Signals" section to quickly find signals in large projects.
- Click the chevron button in the top-right of the sidebar to collapse/expand it, giving more space to the waveform viewer.
- Hover over individual signal waveforms to see their values at that time point in hex and decimal format.
- Hover over protocol events to see decoded information and click events to add persistent cursors.

For packaging as a VS Code extension, build the extension bundle (`npm run build:extension`) and create a VSIX (`vsce package`).

Contributions and issues are welcome — more decoders and UX improvements planned.

## Keyboard shortcuts

- Hold `Alt` (Windows/Linux) or `Option` (macOS) and press `ArrowUp` / `ArrowDown` to move the currently selected signal up or down.
- Press `F` to fit the timeline to the view.
- Press `Delete` to remove the selected signal or selected group.

