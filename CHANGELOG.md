# Changelog

All notable changes to this project will be documented in this file.

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
