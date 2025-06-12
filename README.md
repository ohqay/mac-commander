# macOS Simulator MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io/)
[![macOS](https://img.shields.io/badge/macOS-13+-red.svg)](https://www.apple.com/macos/)

> 🤖 **Enable AI assistants to visually interact with your macOS applications**

An MCP (Model Context Protocol) server that allows AI coding tools like **Claude Desktop**, **Claude Code**, and **Cursor** to see, control, and test macOS applications. Perfect for automated testing, UI debugging, and error detection.

**🎆 What makes this special?**
- ✨ **Visual AI**: Your AI can actually see what's on your screen
- 🗾 **Error Detection**: Automatically finds bugs and error dialogs
- 🔄 **Full Control**: Click, type, and navigate just like a human
- 📱 **App Testing**: Perfect for testing mobile apps, desktop software, or web interfaces
- 🚀 **Easy Setup**: Get started in under 5 minutes

## 🚀 Quick Start

### Option 1: Automated Install (Easiest)

```bash
# Clone and run the installer
git clone https://github.com/ohqay/macos-simulator-mcp.git
cd macos-simulator-mcp
./install.sh
```

The installer will:
- ✅ Check your Node.js version
- ✅ Install dependencies and build the project
- ✅ Show you the exact configuration to copy
- ✅ Offer to open System Settings for permissions

### Option 2: Manual Install

```bash
# 1. Clone and install
git clone https://github.com/your-username/macos-simulator-mcp.git
cd macos-simulator-mcp
npm install && npm run build

# 2. Get the full path for configuration
echo "$(pwd)/build/index.js"

# 3. Add to Claude Desktop config (see Configuration section below)
# 4. Grant Screen Recording & Accessibility permissions
# 5. Restart Claude Desktop and try: "Take a screenshot"
```

**✨ In 2 minutes, your AI will be able to see and control your Mac!**

## 📚 Table of Contents

- [✨ Features](#-features)
- [🛠️ Prerequisites](#%EF%B8%8F-prerequisites)
- [📦 Installation](#-installation)
- [⚙️ Configuration](#%EF%B8%8F-configuration)
  - [🖥️ Claude Desktop](#%EF%B8%8F-claude-desktop-setup)
  - [💻 Claude Code](#-claude-code-setup)
  - [🎯 Cursor](#-cursor-setup)
- [🚀 Usage Examples](#-usage-examples)
- [📈 Available Tools](#-available-tools)
- [⚠️ Troubleshooting](#%EF%B8%8F-limitations--troubleshooting)
- [🔒 Security](#-security--privacy)

## ✨ Features

- 📸 **Screenshot Capture**: Take full screen or region-specific screenshots with PNG export
- 🖱️ **Mouse Control**: Click, double-click, and move the mouse cursor
- ⌨️ **Keyboard Input**: Type text and press key combinations
- 🪟 **Window Management**: List, find, focus, and get information about application windows
- 🔍 **OCR Text Recognition**: Extract and find text on screen using Tesseract.js
- ⚠️ **Error Detection**: Automatically detect error dialogs and messages using OCR
- 📏 **Screen Information**: Get display dimensions and coordinates

## 🛠️ Prerequisites

### System Requirements
- **macOS 13+** (Ventura or later)
- **Node.js 18+** and npm
- AI client with MCP support:
  - [Claude Desktop](https://claude.ai/download) (recommended)
  - [Claude Code](https://claude.ai/code)
  - [Cursor](https://cursor.sh/) with MCP support
  - Any other MCP-compatible client

### Required macOS Permissions

> ⚠️ **Important**: You must grant these permissions or the server won't work!

1. **Screen Recording Permission**:
   - Go to **System Settings** → **Privacy & Security** → **Screen Recording**
   - Click the **+** button and add your AI client (Claude Desktop, Cursor, etc.)
   - ✅ Check the box next to your AI client

2. **Accessibility Permission**:
   - Go to **System Settings** → **Privacy & Security** → **Accessibility**
   - Click the **+** button and add your AI client
   - ✅ Check the box next to your AI client

> 💡 **Tip**: You might need to restart your AI client after granting permissions.

## 📦 Installation

### 💿 Automated Installation

**Recommended for beginners:**

```bash
# Clone and run the installer
git clone https://github.com/your-username/macos-simulator-mcp.git
cd macos-simulator-mcp
./install.sh
```

The installer script will guide you through everything!

### 🔧 Manual Installation

**For advanced users:**

```bash
# Clone the repository
git clone https://github.com/your-username/macos-simulator-mcp.git
cd macos-simulator-mcp

# Install dependencies and build
npm install
npm run build

# Test that it works
npm run inspector
```

### Option 2: Global Install

```bash
# Install globally via npm (coming soon)
npm install -g macos-simulator-mcp
```

### 🔧 Verify Installation

Run the test script to make sure everything works:

```bash
node test-server.js
```

You should see the server start and respond to test commands.

## ⚙️ Configuration

### 🖥️ Claude Desktop Setup

1. **Open Claude Desktop** and go to **Settings** (gear icon)
2. Click on the **Developer** tab
3. Click **Edit Config** to open the configuration file
4. Add the MCP server configuration:

```json
{
  "mcpServers": {
    "macos-simulator": {
      "command": "node",
      "args": ["/FULL/PATH/TO/macos-simulator-mcp/build/index.js"]
    }
  }
}
```

> 🚨 **Important**: Replace `/FULL/PATH/TO/` with the actual absolute path to where you cloned this repository!

**Example with real path**:
```json
{
  "mcpServers": {
    "macos-simulator": {
      "command": "node",
      "args": ["/Users/yourname/Developer/macos-simulator-mcp/build/index.js"]
    }
  }
}
```

5. **Save** the file and **restart Claude Desktop**
6. Start a new chat - you should see a 🔨 hammer icon indicating MCP is active

### 💻 Claude Code Setup

1. **Navigate to your project folder** in terminal
2. **Create or edit** `.claude/config.json` in your project root:

```bash
mkdir -p .claude
echo '{
  "mcpServers": {
    "macos-simulator": {
      "command": "node",
      "args": ["/FULL/PATH/TO/macos-simulator-mcp/build/index.js"]
    }
  }
}' > .claude/config.json
```

3. **Start Claude Code** in that project folder:

```bash
claude
```

### 🎯 Cursor Setup

1. **Open Cursor** and go to **Settings** → **Cursor Settings** → **MCP**
2. **Click "Add new global MCP server"**
3. **Add the configuration**:
   - **Name**: `macos-simulator`
   - **Command**: `node`
   - **Args**: `/FULL/PATH/TO/macos-simulator-mcp/build/index.js`

Or create `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "macos-simulator": {
      "command": "node",
      "args": ["/FULL/PATH/TO/macos-simulator-mcp/build/index.js"]
    }
  }
}
```

### 🔍 Finding Your Full Path

Not sure what your full path is? Run this in the project directory:

```bash
echo "$(pwd)/build/index.js"
```

**Example output**: `/Users/yourname/Developer/macos-simulator-mcp/build/index.js`

Copy this exact path and use it in your configuration files above.

### ✅ Verify It's Working

After configuration:
1. **Restart your AI client** (Claude Desktop, Cursor, etc.)
2. **Start a new chat/session**
3. **Look for the MCP indicator** (hammer icon in Claude Desktop)
4. **Try a test command**: "Take a screenshot of my screen"

If it works, you'll see the AI successfully take a screenshot! 🎉

## 📈 Available Tools

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

## 🚀 Usage Examples

### 🎯 Basic Commands

Once configured, you can ask your AI assistant to:

**Screenshots & Visual Inspection**:
- "Take a screenshot of my app"
- "Capture just the top-left corner of the screen"
- "Save a screenshot to ~/Desktop/app-screenshot.png"

**Mouse & Keyboard Control**:
- "Click the button at coordinates 100, 200"
- "Double-click on the center of the screen"
- "Type 'Hello World' in the current field"
- "Press cmd+s to save the file"
- "Press Enter to submit"

**Window Management**:
- "List all open windows"
- "Focus the Safari window"
- "Get information about the active window"
- "Find the window with 'Calculator' in the title"

**Text Recognition & Search**:
- "Extract all text from the screen"
- "Find the 'Submit' button on screen"
- "Look for any text containing 'error' on screen"
- "Read the text in the dialog box"

**Error Detection**:
- "Check if there are any error dialogs on screen"
- "Look for error messages in my app"
- "Scan for any warning or error indicators"

### 🔧 Advanced Automation Examples

**UI Testing Workflow**:
```
"Please help me test my app:
1. Take a screenshot first
2. Click the 'Start' button
3. Wait 2 seconds
4. Check if any errors appeared
5. Take another screenshot to compare"
```

**Bug Investigation**:
```
"I'm having issues with my app:
1. Focus the MyApp window
2. Extract all visible text
3. Look for any error messages
4. Take a screenshot of the current state"
```

**Automated Form Filling**:
```
"Help me fill out this form:
1. Click at coordinates 300, 150 (username field)
2. Type 'testuser'
3. Press Tab to move to next field
4. Type 'password123'
5. Find and click the Submit button"
```

## Development

- Run in development mode: `npm run dev`
- Test with MCP Inspector: `npm run inspector`

## ⚠️ Limitations & Troubleshooting

### Known Limitations
- **OCR Accuracy**: Text recognition depends on font size, contrast, and clarity
- **Permission Requirements**: Must manually grant Screen Recording and Accessibility permissions
- **First OCR Run**: Initial text extraction may be slower due to model loading
- **macOS Only**: This server only works on macOS systems

### 🐛 Common Issues

**"Permission denied" or "Screen recording not allowed"**
- ✅ Grant Screen Recording permission to your AI client
- ✅ Grant Accessibility permission to your AI client
- 🔄 Restart your AI client after granting permissions

**"Command not found" or "Cannot find module"**
- ✅ Make sure you ran `npm install` and `npm run build`
- ✅ Use the absolute path to `build/index.js` in your config
- ✅ Verify Node.js is installed: `node --version`

**"MCP server not showing up"**
- ✅ Check your configuration JSON syntax is valid
- ✅ Restart your AI client completely
- ✅ Try the test script: `node test-server.js`

**"Screenshots are black or empty"**
- ✅ Grant Screen Recording permission
- ✅ Make sure the app you're screenshotting is visible (not minimized)

### 🆘 Getting Help

If you're still having issues:
1. **Run the test script**: `node test-server.js` to verify basic functionality
2. **Check the console**: Look for error messages in your AI client
3. **Open an issue**: [Create a GitHub issue](https://github.com/ohqay/macos-simulator-mcp/issues) with:
   - Your macOS version
   - Your AI client (Claude Desktop, Cursor, etc.)
   - The exact error message
   - Your configuration file (with paths anonymized)

## 🔒 Security & Privacy

### Important Security Notes

> ⚠️ **This server has powerful capabilities and requires significant system permissions.**

**What this server can access**:
- ✅ **Screen content**: Can take screenshots of anything visible
- ✅ **Keyboard input**: Can type any text or key combinations
- ✅ **Mouse control**: Can click anywhere on screen
- ✅ **Window information**: Can see and control application windows
- ✅ **Text recognition**: Can read any text visible on screen

**Security best practices**:
- 🏠 **Only use in trusted environments**: Don't use on shared or public computers
- 🤝 **Review AI requests**: Be mindful of what you ask the AI to do
- 🔐 **Sensitive data**: Avoid using when sensitive information is visible
- 🚫 **Revoke access**: You can remove permissions anytime in System Settings

### Privacy Notes

- **No data is sent externally** by this MCP server itself
- **Your AI client** (Claude Desktop, etc.) may process screenshots/data according to their privacy policies
- **Screenshots are temporary** and not permanently stored unless you specify a save path
- **OCR processing** happens locally on your machine

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- Uses [@nut-tree-fork/nut-js](https://github.com/nut-tree-fork/nut-js) for system automation
- OCR powered by [Tesseract.js](https://tesseract.projectnaptha.com/)
- Image processing with [node-canvas](https://github.com/Automattic/node-canvas)

---

**Made with ❤️ for the MCP community**

*Having issues? [Open a GitHub issue](https://github.com/ohqay/macos-simulator-mcp/issues) • Want to contribute? [Check our contributing guide](#-contributing)*