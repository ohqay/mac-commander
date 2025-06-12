#!/bin/bash

# macOS Simulator MCP Server Installation Script
# This script helps you install and configure the MCP server

set -e

echo "🤖 macOS Simulator MCP Server Installer"
echo "========================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed!"
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version $NODE_VERSION detected, but version 18+ is required!"
    echo "Please update Node.js from https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js $(node --version) detected"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Build project
echo ""
echo "🔨 Building project..."
npm run build

# Get full path
FULL_PATH="$(pwd)/build/index.js"
echo ""
echo "✅ Installation complete!"
echo ""
echo "📋 Next steps:"
echo "1. Copy this path: $FULL_PATH"
echo ""
echo "2. Add to your AI client configuration:"
echo ""
echo "   For Claude Desktop (~/.config/claude/claude_desktop_config.json):"
echo '   {'
echo '     "mcpServers": {'
echo '       "macos-simulator": {'
echo '         "command": "node",'
echo "         \"args\": [\"$FULL_PATH\"]"
echo '       }'
echo '     }'
echo '   }'
echo ""
echo "3. Grant permissions in System Settings:"
echo "   - Privacy & Security → Screen Recording → Add your AI client"
echo "   - Privacy & Security → Accessibility → Add your AI client"
echo ""
echo "4. Restart your AI client and try: 'Take a screenshot'"
echo ""
echo "🎉 You're all set! Check the README.md for detailed configuration."

# Offer to open System Settings
echo ""
read -p "🔐 Open System Settings to grant permissions now? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Opening Privacy & Security settings..."
    open "x-apple.systempreferences:com.apple.preference.security?Privacy"
fi

echo ""
echo "💡 Need help? Check the README.md or open an issue on GitHub"
echo "🚀 Happy automating!"