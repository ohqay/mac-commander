# macOS Simulator MCP Server

An MCP (Model Context Protocol) server that enables AI coding tools like Claude Code or Claude Desktop to interact with macOS applications. This server provides tools for taking screenshots, simulating user input, and detecting UI errors.

## Features

- **Screenshot Capture**: Take full screen or region-specific screenshots with PNG export
- **Mouse Control**: Click, double-click, and move the mouse cursor
- **Keyboard Input**: Type text and press key combinations
- **Window Management**: List, find, focus, and get information about application windows
- **OCR Text Recognition**: Extract and find text on screen using Tesseract.js
- **Error Detection**: Automatically detect error dialogs and messages using OCR
- **Screen Information**: Get display dimensions

## Prerequisites

- Node.js 18+ and npm
- macOS (tested on macOS 13+)
- Required permissions:
  - **Screen Recording**: System Preferences → Privacy & Security → Screen Recording
  - **Accessibility**: System Preferences → Privacy & Security → Accessibility

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

## Configuration

### For Claude Desktop

Add the following to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "macos-simulator": {
      "command": "node",
      "args": ["/path/to/macos-simulator-mcp/build/index.js"]
    }
  }
}
```

### For Claude Code

Add to your project's `.claude/config.json`:

```json
{
  "mcpServers": {
    "macos-simulator": {
      "command": "node",
      "args": ["./path/to/macos-simulator-mcp/build/index.js"]
    }
  }
}
```

## Available Tools

### screenshot
Capture a screenshot of the screen or a specific region.

Parameters:
- `outputPath` (optional): Path to save the screenshot as PNG
- `region` (optional): Object with `x`, `y`, `width`, `height` to capture specific area

### click
Click at specific coordinates on the screen.

Parameters:
- `x`: X coordinate
- `y`: Y coordinate
- `button`: "left", "right", or "middle" (default: "left")
- `doubleClick`: boolean (default: false)

### type_text
Type text using the keyboard.

Parameters:
- `text`: Text to type
- `delay`: Delay between keystrokes in milliseconds (default: 50)

### mouse_move
Move the mouse to specific coordinates.

Parameters:
- `x`: X coordinate
- `y`: Y coordinate
- `smooth`: Whether to use smooth movement (default: true)

### key_press
Press a key or key combination.

Parameters:
- `key`: Key to press (e.g., "Enter", "Escape", "cmd+a")

### check_for_errors
Check the screen for common error indicators.

Parameters:
- `region` (optional): Specific region to check

### wait
Wait for a specified amount of time.

Parameters:
- `milliseconds`: Time to wait

### get_screen_info
Get information about the screen dimensions.

No parameters required.

### list_windows
List all open windows with their titles and positions.

No parameters required.

### get_active_window
Get information about the currently active window.

No parameters required.

### find_window
Find a window by its title (partial match supported).

Parameters:
- `title`: Window title to search for

### focus_window
Focus/activate a window by its title.

Parameters:
- `title`: Window title to focus

### get_window_info
Get detailed information about a specific window.

Parameters:
- `title`: Window title to get info for

### extract_text
Extract text from the screen using OCR (Optical Character Recognition).

Parameters:
- `region` (optional): Specific region to extract text from

### find_text
Find specific text on the screen and get its location.

Parameters:
- `text`: Text to search for
- `region` (optional): Specific region to search in

## Usage Examples

Once configured, you can ask Claude to:

- "Take a screenshot of my app"
- "Click the button at coordinates 100, 200"
- "Check if there are any error dialogs on screen"
- "Type 'Hello World' in the current field"
- "Press cmd+s to save"
- "Extract all text from the screen"
- "Find the 'Submit' button on screen"
- "Check if there's an error message in the app window"

## Development

- Run in development mode: `npm run dev`
- Test with MCP Inspector: `npm run inspector`

## Limitations

- OCR accuracy depends on text clarity and font size
- Window management may require additional permissions on macOS
- Requires manual permission grants for Screen Recording and Accessibility
- First OCR operation may be slower due to model initialization

## Security Notes

This server requires significant system permissions. Only use it in trusted environments and be cautious about what actions you allow it to perform.

## License

MIT