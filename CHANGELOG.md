# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-09-11

### Added
- **I2C Protocol Decoder**: Full decoding support for I2C (START, 7-bit Address, R/W, ACK/NACK, data bytes, STOP) with auto-detection.
- **Bus Radix Selection**: Ability to toggle bus value formats between HEX, Unsigned Decimal, Signed Decimal, Binary, and ASCII.
- **Export Decoded Transactions**: Toolbar button to export decoded protocol packets directly to CSV.
- **Automated Unit Testing**: Integrated Vitest test runner with 17 unit tests covering parsers, decoders, and measurement routines.
- **Modular Component Architecture**: Decomposed UI into specialized sidebar components (`VisibleSignalsSection`, `ProtocolsSection`, `SignalGroupsSection`) and `MeasurementBar`.

### Changed
- **Major VCD Parser Optimization**: Switched to an index-based line iterator in `parseVCD`, eliminating millions of string allocations and intermediate file duplications.
- **Memory & Performance Hotfix**: Replaced repeated `JSON.stringify` in the render loop with raw file byte size tracking and signal counts.
- **Cross-Platform Build**: Updated clean and build scripts to be cross-platform compatible with Windows PowerShell / Command Prompt.

### Removed
- Pruned 72 unneeded dependencies from `package.json` and `node_modules` (`better-sqlite3`, `express`, `dotenv`, `vcd-parser`, and WASM runtime packages).

## [1.0.6] - 2026-05-20

### Added
- Independent collapse controls for the Visible Signals, Protocols, and Signal Groups sidebar panels.
- Horizontal waveform scrollbar for panning across a zoomed-in waveform.
- Toolbar zoom controls for zoom in, zoom out, and fit-to-screen actions.
- Keyboard shortcuts for zooming: `+`/`=` to zoom in, `-` to zoom out, and `F` to fit.
- Persistent timing axis above the waveform rows while vertically scrolling.

### Changed
- Removed the top application header to give the waveform more usable space.
- Moved the file load button into the empty drop zone.
- Reduced extra nested scrolling so the waveform area uses a single primary vertical scrollbar.
- Moved the sidebar scrollbar to the left side to avoid conflict with the resize handle.
- Increased scrollbar width for easier grabbing.
- Made the Measurements panel more compact.

### Removed
- Removed WLF file registration and automatic `wlf2vcd` conversion from the extension.

### Fixed
- Corrected hover tooltip positioning after vertical waveform scrolling.
- Added bottom padding so the last waveform row is fully visible.

## [1.0.5] - 2026-05-20

### Added
- Support for opening `.wlf` files in the custom viewer.

### Changed
- `.wlf` files are converted to VCD using `wlf2vcd` before rendering.
- `Open VCD Viewer` command renamed to `Open VCD/WLF Viewer`.
- Improved waveform performance for large traces and protocol decoding.
- Sidebar collapse and resize behavior now expands the waveform correctly.
- Marker labels use staggered rows to avoid unreadable overlap.

### Fixed
- Clicking RD/WR protocol indicators no longer resets the waveform zoom.
- RD/WR hover text now matches the protocol indicator colors.

## [1.0.3] - 2024-03-02

### Added
- Collapsible left sidebar with toggle button for expanded waveform viewing space
- Search functionality to filter visible signals quickly
- Signal value tooltips showing hex and decimal values on hover

### Changed
- Protocol groups are now integrated into the main waveform viewer
- Improved tooltip behavior - only shows for individual signals, not groups
- Waveform viewer expands to fill available space when sidebar is collapsed
- Better responsive layout with dynamic padding based on sidebar state

### Removed
- Separate "Decoded Transactions" table at the bottom of the waveform
- Duplicate protocol event visualization in separate rows below waveform
- Beta designation from version number

### Fixed
- Tooltip information consistency for signals vs groups

## [1.0.2] - 2024-02-28

### Added
- Signal grouping functionality
- Protocol auto-detection for Avalon-MM, UART, and SPI
- Waveform viewer with zoom and pan capabilities
- Measurement display for clock signals

## [1.0.1] - 2024-02-20

### Added
- Initial release of VCD Protocol Analyzer
- Basic VCD file parsing
- Waveform visualization
- Protocol decoding framework

## [1.0.0] - 2024-02-15

### Initial Release
