# VCD Protocol Analyzer

VCD Protocol Analyzer is a lightweight viewer designed to open VCD (Value Change Dump) files inside Visual Studio Code and help you inspect waveforms and protocol activity. It automatically detects common bus and serial protocols and displays them as grouped, interactive overlays on top of the waveform.

Key features
- Open .vcd files in VS Code or in the local dev server UI
- Auto-detects and decodes protocols such as Avalon-MM (Avalon memory-mapped), UART, and SPI
- Renders detected protocols as groups with event overlays and highlights
- Tooltips for protocol events and individual signals with hex/decimal values
- Handles explicit unknown/high-impedance states (X/Z) correctly
- Resizable/collapsible left sidebar with collapsible Visible Signals, Protocols, and Signal Groups panels
- Search functionality to filter visible signals
- Signal measurements for clock signals (frequency, period, duty cycle)
- Compact signal measurement panel for selected signals
- Interactive waveform viewer with zoom, pan, horizontal scrolling, and selection capabilities
- Sticky timing axis that remains visible while scrolling through waveform rows

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
- Collapse individual sidebar sections to keep the control panel compact.
- Search for signals using the searchbar in the "Visible Signals" section to quickly find signals in large projects.
- Click the chevron button in the top-right of the sidebar to collapse/expand it, giving more space to the waveform viewer.
- Drag the sidebar edge to resize it; its scrollbar is placed on the left to avoid the resize handle.
- Hover over individual signal waveforms to see their values at that time point in hex and decimal format.
- Hover over protocol events to see decoded information and click events to add persistent cursors.
- Use the toolbar zoom buttons or mouse wheel to zoom the waveform, then use the horizontal scrollbar to pan across the zoomed time range.

For packaging as a VS Code extension, build the extension bundle (`npm run build:extension`) and create a VSIX (`vsce package`).

Contributions and issues are welcome — more decoders and UX improvements planned.

## Keyboard shortcuts

- Hold `Alt` (Windows/Linux) or `Option` (macOS) and press `ArrowUp` / `ArrowDown` to move the currently selected signal up or down.
- Press `+` or `=` to zoom in.
- Press `-` to zoom out.
- Press `F` to fit the timeline to the view.
- Press `Delete` to remove the selected signal or selected group.

