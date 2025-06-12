#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { mouse, screen, Region, Button, keyboard, Key, Point, getWindows, getActiveWindow, windowWithTitle } from "@nut-tree-fork/nut-js";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { ErrorDetector, commonErrorPatterns } from "./error-detection.js";
import { imageToBase64, saveImage } from "./image-utils.js";
import { extractTextFromImage, getTextLocations, terminateOCR } from "./ocr-utils.js";
import { logger } from "./logger.js";
import { 
  MCPError, 
  PermissionError, 
  ScreenCaptureError, 
  WindowNotFoundError, 
  OCRError, 
  ValidationError, 
  TimeoutError, 
  CoordinateOutOfBoundsError,
  FileSystemError,
  AutomationError,
  getUserFriendlyErrorMessage 
} from "./errors.js";
import { checkAllPermissions, ensurePermissions, getPermissionInstructions } from "./permissions.js";
import { withRetry, CircuitBreaker } from "./retry.js";
import { 
  validateToolInput, 
  validateCoordinates, 
  validateRegion, 
  EnhancedScreenshotToolSchema,
  EnhancedClickToolSchema,
  EnhancedTypeTextToolSchema,
  EnhancedWaitToolSchema,
  EnhancedKeyPressToolSchema
} from "./validation.js";
import { performHealthCheck, getDiagnosticReport } from "./health-check.js";
import { screenshotAnalyzer, ScreenshotAnalysis, UIElement } from "./screenshot-analysis.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Screenshot temporary folder management
const TEMP_SCREENSHOTS_FOLDER = join(tmpdir(), 'mcp-screenshots');
let screenshotCounter = 0;

// Initialize temp folder
async function initTempFolder() {
  try {
    await fs.mkdir(TEMP_SCREENSHOTS_FOLDER, { recursive: true });
    logger.info(`Screenshot temp folder initialized: ${TEMP_SCREENSHOTS_FOLDER}`);
  } catch (error) {
    logger.error('Failed to initialize temp folder', error as Error);
  }
}

// Generate timestamp-based filename
function generateScreenshotFilename(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5); // Remove milliseconds and 'Z'
  screenshotCounter++;
  return `screenshot-${timestamp}-${screenshotCounter.toString().padStart(3, '0')}.png`;
}

// Clean up old screenshots (keep last 20)
async function cleanupOldScreenshots() {
  try {
    const files = await fs.readdir(TEMP_SCREENSHOTS_FOLDER);
    const screenshots = files
      .filter(f => f.startsWith('screenshot-') && f.endsWith('.png'))
      .map(f => ({ name: f, path: join(TEMP_SCREENSHOTS_FOLDER, f) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    
    if (screenshots.length > 20) {
      const toDelete = screenshots.slice(0, screenshots.length - 20);
      for (const file of toDelete) {
        await fs.unlink(file.path);
        logger.debug(`Cleaned up old screenshot: ${file.name}`);
      }
    }
  } catch (error) {
    logger.warn('Failed to cleanup old screenshots', error as Error);
  }
}

// Initialize error detector
const errorDetector = new ErrorDetector();

// Initialize circuit breakers for critical operations
const screenCaptureBreaker = new CircuitBreaker(3, 30000);
const ocrBreaker = new CircuitBreaker(5, 60000);

// Add diagnostic tool schema
const DiagnosticToolSchema = z.object({});

// Screenshot management schemas
const ListScreenshotsToolSchema = z.object({});

const ViewScreenshotToolSchema = z.object({
  filename: z.string().describe("Filename of the screenshot to view (from list_screenshots)")
});

const CleanupScreenshotsToolSchema = z.object({
  keepLast: z.number().optional().default(5).describe("Number of recent screenshots to keep (default: 5)")
});

// Tool schemas
const ScreenshotToolSchema = z.object({
  outputPath: z.string().optional().describe("Path to save the screenshot. If not provided, returns base64 encoded image"),
  region: z.object({
    x: z.number().describe("X coordinate of the region"),
    y: z.number().describe("Y coordinate of the region"),
    width: z.number().describe("Width of the region"),
    height: z.number().describe("Height of the region"),
  }).optional().describe("Specific region to capture. If not provided, captures entire screen"),
});

const ClickToolSchema = z.object({
  x: z.number().describe("X coordinate to click"),
  y: z.number().describe("Y coordinate to click"),
  button: z.enum(["left", "right", "middle"]).default("left").describe("Mouse button to click"),
  doubleClick: z.boolean().default(false).describe("Whether to double-click"),
  verify: z.boolean().default(false).describe("Take screenshot after click to verify action"),
});

const TypeTextToolSchema = z.object({
  text: z.string().describe("Text to type"),
  delay: z.number().optional().default(50).describe("Delay between keystrokes in milliseconds"),
});

const MouseMoveToolSchema = z.object({
  x: z.number().describe("X coordinate to move to"),
  y: z.number().describe("Y coordinate to move to"),
  smooth: z.boolean().default(true).describe("Whether to use smooth movement"),
});

const GetScreenInfoToolSchema = z.object({});

const KeyPressToolSchema = z.object({
  key: z.string().describe("Key to press (e.g., 'Enter', 'Escape', 'Tab', 'cmd+a')"),
});

const CheckForErrorsToolSchema = z.object({
  region: z.object({
    x: z.number().describe("X coordinate of the region"),
    y: z.number().describe("Y coordinate of the region"),
    width: z.number().describe("Width of the region"),
    height: z.number().describe("Height of the region"),
  }).optional().describe("Specific region to check for errors. If not provided, checks entire screen"),
});

const WaitToolSchema = z.object({
  milliseconds: z.number().describe("Time to wait in milliseconds"),
});

const ListWindowsToolSchema = z.object({});

const GetActiveWindowToolSchema = z.object({});

const FindWindowToolSchema = z.object({
  title: z.string().describe("Window title to search for (partial match)"),
});

const FocusWindowToolSchema = z.object({
  title: z.string().describe("Window title to focus (partial match)"),
});

const GetWindowInfoToolSchema = z.object({
  title: z.string().describe("Window title to get info for (partial match)"),
});

const ExtractTextToolSchema = z.object({
  region: z.object({
    x: z.number().describe("X coordinate of the region"),
    y: z.number().describe("Y coordinate of the region"),
    width: z.number().describe("Width of the region"),
    height: z.number().describe("Height of the region"),
  }).optional().describe("Specific region to extract text from. If not provided, extracts from entire screen"),
});

const FindTextToolSchema = z.object({
  text: z.string().describe("Text to search for on screen"),
  region: z.object({
    x: z.number().describe("X coordinate of the region"),
    y: z.number().describe("Y coordinate of the region"),
    width: z.number().describe("Width of the region"),
    height: z.number().describe("Height of the region"),
  }).optional().describe("Specific region to search in. If not provided, searches entire screen"),
});

// Screenshot analysis tool schemas
const DescribeScreenshotToolSchema = z.object({
  autoSave: z.boolean().default(true).describe("Whether to save the screenshot for later analysis (default: true)"),
  includeOCR: z.boolean().default(true).describe("Whether to extract text using OCR (default: true)"),
  detectElements: z.boolean().default(true).describe("Whether to detect UI elements (default: true)"),
});

const ListRecentScreenshotsToolSchema = z.object({
  limit: z.number().default(10).describe("Maximum number of recent screenshots to list (default: 10)"),
});

const ExtractTextFromScreenshotToolSchema = z.object({
  filename: z.string().describe("Filename of the saved screenshot to extract text from"),
});

const FindUIElementsToolSchema = z.object({
  autoSave: z.boolean().default(true).describe("Whether to save the screenshot (default: true)"),
  elementTypes: z.array(z.enum(['button', 'text_field', 'link', 'image', 'icon', 'dialog', 'menu', 'window', 'other'])).optional().describe("Specific UI element types to look for. If not provided, detects all types"),
  region: z.object({
    x: z.number().describe("X coordinate of the region"),
    y: z.number().describe("Y coordinate of the region"),
    width: z.number().describe("Width of the region"),
    height: z.number().describe("Height of the region"),
  }).optional().describe("Specific region to analyze. If not provided, analyzes entire screen"),
});

const CompareScreenshotsToolSchema = z.object({
  filename1: z.string().describe("Filename of the first screenshot to compare"),
  filename2: z.string().describe("Filename of the second screenshot to compare"),
});

// New essential tool schemas for better reliability
const WaitForElementToolSchema = z.object({
  text: z.string().describe("Text to wait for on screen"),
  timeout: z.number().default(10000).describe("Maximum wait time in milliseconds (default: 10000)"),
  pollInterval: z.number().default(500).describe("How often to check in milliseconds (default: 500)"),
  region: z.object({
    x: z.number().describe("X coordinate of the region"),
    y: z.number().describe("Y coordinate of the region"),
    width: z.number().describe("Width of the region"),
    height: z.number().describe("Height of the region"),
  }).optional().describe("Specific region to search in. If not provided, searches entire screen"),
});

const ScrollToolSchema = z.object({
  direction: z.enum(["up", "down", "left", "right"]).describe("Direction to scroll"),
  amount: z.number().default(5).describe("Number of scroll units (default: 5)"),
  x: z.number().optional().describe("X coordinate to scroll at (default: current mouse position)"),
  y: z.number().optional().describe("Y coordinate to scroll at (default: current mouse position)"),
});

const HoverToolSchema = z.object({
  x: z.number().describe("X coordinate to hover at"),
  y: z.number().describe("Y coordinate to hover at"),
  duration: z.number().default(1000).describe("How long to hover in milliseconds (default: 1000)"),
});

const RightClickToolSchema = z.object({
  x: z.number().describe("X coordinate to right-click"),
  y: z.number().describe("Y coordinate to right-click"),
});

// Temporary screenshot directory
const tempScreenshotDir = join(tmpdir(), 'mcp-screenshots');

// Create server instance
const server = new Server(
  {
    name: "macos-simulator-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Helper function to convert button string to Button enum
function getMouseButton(button: string): Button {
  switch (button) {
    case "right":
      return Button.RIGHT;
    case "middle":
      return Button.MIDDLE;
    default:
      return Button.LEFT;
  }
}

// Helper function to convert string to Key enum
function stringToKey(keyStr: string): Key | undefined {
  const keyMap: { [key: string]: Key } = {
    'a': Key.A, 'b': Key.B, 'c': Key.C, 'd': Key.D, 'e': Key.E, 'f': Key.F,
    'g': Key.G, 'h': Key.H, 'i': Key.I, 'j': Key.J, 'k': Key.K, 'l': Key.L,
    'm': Key.M, 'n': Key.N, 'o': Key.O, 'p': Key.P, 'q': Key.Q, 'r': Key.R,
    's': Key.S, 't': Key.T, 'u': Key.U, 'v': Key.V, 'w': Key.W, 'x': Key.X,
    'y': Key.Y, 'z': Key.Z,
    '0': Key.Num0, '1': Key.Num1, '2': Key.Num2, '3': Key.Num3, '4': Key.Num4,
    '5': Key.Num5, '6': Key.Num6, '7': Key.Num7, '8': Key.Num8, '9': Key.Num9,
    '-': Key.Minus, '=': Key.Equal, '[': Key.LeftBracket, ']': Key.RightBracket,
    '\\': Key.Backslash, ';': Key.Semicolon, "'": Key.Quote, ',': Key.Comma,
    '.': Key.Period, '/': Key.Slash, '`': Key.Grave
  };
  
  return keyMap[keyStr.toLowerCase()];
}

// Helper function to parse key combinations
async function pressKeys(keyString: string) {
  const keys = keyString.toLowerCase().split("+");
  const modifiers: Key[] = [];
  let mainKey: Key | undefined;

  for (const key of keys) {
    const trimmedKey = key.trim();
    switch (trimmedKey) {
      case "cmd":
      case "command":
        modifiers.push(Key.LeftCmd);
        break;
      case "ctrl":
      case "control":
        modifiers.push(Key.LeftControl);
        break;
      case "alt":
      case "option":
        modifiers.push(Key.LeftAlt);
        break;
      case "shift":
        modifiers.push(Key.LeftShift);
        break;
      case "enter":
      case "return":
        mainKey = Key.Enter;
        break;
      case "escape":
      case "esc":
        mainKey = Key.Escape;
        break;
      case "tab":
        mainKey = Key.Tab;
        break;
      case "space":
        mainKey = Key.Space;
        break;
      case "delete":
      case "backspace":
        mainKey = Key.Backspace;
        break;
      case "up":
        mainKey = Key.Up;
        break;
      case "down":
        mainKey = Key.Down;
        break;
      case "left":
        mainKey = Key.Left;
        break;
      case "right":
        mainKey = Key.Right;
        break;
      case "home":
        mainKey = Key.Home;
        break;
      case "end":
        mainKey = Key.End;
        break;
      case "pageup":
        mainKey = Key.PageUp;
        break;
      case "pagedown":
        mainKey = Key.PageDown;
        break;
      case "insert":
        mainKey = Key.Insert;
        break;
      default:
        // Try to convert string to Key enum
        const convertedKey = stringToKey(trimmedKey);
        if (convertedKey) {
          mainKey = convertedKey;
        } else {
          // For special characters or unsupported keys, log a warning but don't fail
          console.warn(`Warning: Unsupported key "${trimmedKey}" in combination "${keyString}"`);
        }
    }
  }

  if (!mainKey) {
    throw new Error(`Invalid key combination: ${keyString}`);
  }

  try {
    if (modifiers.length > 0) {
      // Press modifiers first, then main key, then release in reverse order
      await keyboard.pressKey(...modifiers);
      await keyboard.pressKey(mainKey);
      await keyboard.releaseKey(mainKey);
      await keyboard.releaseKey(...modifiers);
    } else {
      // Simple key press without modifiers
      await keyboard.pressKey(mainKey);
      await keyboard.releaseKey(mainKey);
    }
  } catch (error) {
    throw new Error(`Failed to press key combination "${keyString}": ${error}`);
  }
}

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "diagnostic",
        description: "Run a comprehensive system health check and get detailed diagnostic information about the MCP server. This tool provides essential system status including permissions (screen recording, accessibility), dependencies, and performance metrics. Use this first when troubleshooting issues or before starting automation workflows to ensure all required permissions and components are properly configured. Returns detailed JSON report with system status, warnings, and recommendations.",
        inputSchema: zodToJsonSchema(DiagnosticToolSchema),
      },
      {
        name: "screenshot",
        description: "Capture a high-quality screenshot of the entire screen or a specific rectangular region. Essential for visual inspection, debugging UI issues, and documenting current screen state. Can save to file (specify outputPath) or return as base64 string for immediate use. When capturing regions, use coordinates from get_screen_info or window information. Supports precise pixel-perfect captures. Commonly used with other tools like extract_text for OCR workflows or find_text for visual element location. Requires screen recording permission on macOS.",
        inputSchema: zodToJsonSchema(ScreenshotToolSchema),
      },
      {
        name: "click",
        description: "Perform mouse clicks at precise screen coordinates with support for left, right, or middle mouse buttons. Essential for interacting with UI elements, buttons, menus, and any clickable interface components. Supports both single clicks and double-clicks. Use coordinates from screenshot analysis, find_text results, or window information. Always validate coordinates are within screen bounds using get_screen_info first. Consider using find_text to locate clickable text elements dynamically rather than hardcoded coordinates. Automatically moves mouse to target location before clicking. Requires accessibility permission on macOS.",
        inputSchema: zodToJsonSchema(ClickToolSchema),
      },
      {
        name: "type_text",
        description: "Simulate keyboard typing to input text into the currently focused application or text field. Supports all standard characters, numbers, symbols, and Unicode text. Use adjustable delay between keystrokes (default 50ms) to ensure reliable input in different applications. Essential for form filling, search queries, code input, and any text entry tasks. Make sure to click on target input field first or use focus_window to ensure text goes to intended destination. For special keys or key combinations, use key_press instead. Supports newlines and special characters. Requires accessibility permission on macOS.",
        inputSchema: zodToJsonSchema(TypeTextToolSchema),
      },
      {
        name: "mouse_move",
        description: "Move the mouse cursor to precise screen coordinates without clicking. Useful for hover actions, preparing for subsequent clicks, or triggering hover-based UI elements like tooltips and menus. Supports smooth movement animation (default) or instant positioning. Often used before click operations or to reveal hidden UI elements that appear on hover. Validate coordinates with get_screen_info to ensure they're within screen bounds. Commonly combined with screenshot to visually confirm cursor positioning. Less commonly used alone - usually part of larger interaction workflows. Requires accessibility permission on macOS.",
        inputSchema: zodToJsonSchema(MouseMoveToolSchema),
      },
      {
        name: "get_screen_info",
        description: "Retrieve essential screen dimension information including total width and height in pixels. Critical for coordinate validation before performing clicks, mouse movements, or defining screenshot regions. Returns JSON with screen width and height properties. Use this as the first step in automation workflows to understand the display boundaries and ensure all coordinates stay within valid ranges. Essential for responsive automation that works across different screen sizes and resolutions. No parameters required - works on primary display.",
        inputSchema: zodToJsonSchema(GetScreenInfoToolSchema),
      },
      {
        name: "key_press",
        description: "Execute keyboard shortcuts and special key combinations essential for system navigation and application control. Supports single keys (Enter, Escape, Tab, Arrow keys) and modifier combinations (Cmd+C, Cmd+A, Ctrl+Alt+key). Use for shortcuts, navigation, window management, and triggering application-specific commands. Examples: 'cmd+c' for copy, 'cmd+tab' for app switching, 'enter' for confirmation, 'escape' for canceling dialogs. Perfect for keyboard-driven workflows and accessing menu items via shortcuts. For regular text input, use type_text instead. Requires accessibility permission on macOS.",
        inputSchema: zodToJsonSchema(KeyPressToolSchema),
      },
      {
        name: "check_for_errors",
        description: "Intelligent visual error detection system that scans the screen for common error patterns including red notification badges, error dialog boxes, crash messages, warning symbols, and failure indicators. Uses advanced pattern recognition to identify UI elements that typically signal problems or require user attention. Can scan entire screen or specific regions. Essential for automation reliability - use after critical operations to ensure they completed successfully. Returns detailed information about detected errors including their type and location. Helps prevent cascading failures in automation workflows by catching issues early. Requires screen recording permission on macOS.",
        inputSchema: zodToJsonSchema(CheckForErrorsToolSchema),
      },
      {
        name: "wait",
        description: "Pause execution for a specified duration in milliseconds to allow time for UI updates, animations, network requests, or application responses. Critical for reliable automation timing - prevents race conditions and ensures UI elements have time to load or respond. Use between actions when applications need time to process (e.g., after clicking a button that triggers loading, before taking a screenshot of updated content, or while waiting for dialogs to appear). Typical values: 500-1000ms for UI updates, 2000-5000ms for network operations. Essential tool for stable, reliable automation workflows.",
        inputSchema: zodToJsonSchema(WaitToolSchema),
      },
      {
        name: "list_windows",
        description: "Enumerate all currently open windows across all applications with detailed information including window titles, positions, and dimensions. Essential for discovering available applications and windows before interaction. Returns comprehensive JSON array with each window's title, x/y coordinates, width/height, and center point calculations. Use to find target applications, understand current desktop layout, or locate specific windows by title. Perfect starting point for window management workflows. Helps identify exact window titles needed for find_window and focus_window operations. No parameters required - scans entire system.",
        inputSchema: zodToJsonSchema(ListWindowsToolSchema),
      },
      {
        name: "get_active_window",
        description: "Retrieve detailed information about the currently focused/active window including its title, position, dimensions, and calculated center point. Essential for understanding current user context and determining which application is receiving input. Returns JSON with window title, x/y coordinates, width/height, and center coordinates for precise interaction. Useful for confirming correct window focus before automation actions, or for getting coordinates relative to the active window. Commonly used before click or type_text operations to ensure actions target the intended application. No parameters required.",
        inputSchema: zodToJsonSchema(GetActiveWindowToolSchema),
      },
      {
        name: "find_window",
        description: "Search for and locate a specific window using partial title matching, returning detailed window information if found. Supports flexible partial matching - you don't need the exact full title. Essential for locating target applications before interaction. Returns JSON with found status, window title, position (x/y), dimensions (width/height), and center coordinates. Use list_windows first to discover available window titles, then use this tool to get precise information about your target window. Commonly followed by focus_window to bring the window to front, or used to get coordinates for region-specific screenshots or clicks. Requires accessibility permission on macOS.",
        inputSchema: zodToJsonSchema(FindWindowToolSchema),
      },
      {
        name: "focus_window",
        description: "Bring a specific window to the foreground and make it the active/focused window using partial title matching. Essential for directing keyboard and mouse input to the correct application. Supports flexible partial matching - you don't need the exact full title. After focusing, the target window will receive all subsequent keyboard input from type_text and key_press operations. Critical first step in most automation workflows to ensure actions target the intended application. Use list_windows or find_window first to identify available windows and their titles. Common workflow: list_windows → focus_window → interact with application. Requires accessibility permission on macOS.",
        inputSchema: zodToJsonSchema(FocusWindowToolSchema),
      },
      {
        name: "get_window_info",
        description: "Retrieve comprehensive information about a specific window using partial title matching, including precise positioning data and calculated center coordinates. Returns detailed JSON with window title, position (x/y), dimensions (width/height), and center point coordinates for precise interaction planning. More detailed than find_window, providing center coordinates which are essential for reliable clicking on window elements. Use when you need exact positioning data for clicking within a specific window, or for calculating relative coordinates for UI elements. Perfect for planning multi-step interactions within a particular application window. Supports partial title matching for flexibility.",
        inputSchema: zodToJsonSchema(GetWindowInfoToolSchema),
      },
      {
        name: "extract_text",
        description: "Extract and read text from the screen or specific regions using advanced Optical Character Recognition (OCR). Capable of recognizing text in various fonts, sizes, and styles from screenshots, UI elements, dialogs, and any visible text content. Can process entire screen or focus on specific rectangular regions for better accuracy and performance. Essential for reading dynamic content, form values, error messages, or any text that changes programmatically. Returns plain text string of all recognized text. Use with specific regions when possible for faster processing and better accuracy. Commonly paired with screenshot for visual verification. Requires screen recording permission on macOS.",
        inputSchema: zodToJsonSchema(ExtractTextToolSchema),
      },
      {
        name: "find_text",
        description: "Locate specific text on the screen using OCR and return precise coordinates for clicking or interaction. Searches for text content (case-insensitive partial matching) and returns detailed location information including x/y coordinates, width/height, and confidence scores. Essential for dynamic UI automation where button or element positions change but text content remains consistent. Can search entire screen or specific regions for better performance. Returns JSON with found status, matching text, precise coordinates, and confidence levels. Perfect for clicking on buttons, menu items, or links identified by their text content rather than fixed coordinates. Enables robust automation that adapts to UI changes. Requires screen recording permission on macOS.",
        inputSchema: zodToJsonSchema(FindTextToolSchema),
      },
      {
        name: "list_screenshots",
        description: "List all screenshots saved in the temporary folder",
        inputSchema: zodToJsonSchema(ListScreenshotsToolSchema),
      },
      {
        name: "view_screenshot",
        description: "View/display a specific screenshot from the temporary folder",
        inputSchema: zodToJsonSchema(ViewScreenshotToolSchema),
      },
      {
        name: "cleanup_screenshots",
        description: "Clean up old screenshots from temporary folder",
        inputSchema: zodToJsonSchema(CleanupScreenshotsToolSchema),
      },
      {
        name: "describe_screenshot",
        description: "Capture and comprehensively analyze a screenshot with AI-powered insights. Combines screen capture with OCR text extraction, UI element detection, and intelligent content analysis. Automatically saves screenshots for later reference and provides detailed descriptions of visual content, detected UI elements (buttons, links, dialogs, etc.), and actionable insights. Perfect for understanding screen content, documenting UI states, debugging interface issues, and enabling AI to comprehend visual context. Returns structured analysis including extracted text, clickable elements, element positions, and human-readable summary of screen contents.",
        inputSchema: zodToJsonSchema(DescribeScreenshotToolSchema),
      },
      {
        name: "list_recent_screenshots",
        description: "List recently captured and saved screenshots with metadata including timestamps, file sizes, and basic information. Essential for accessing previously captured screenshots for comparison, analysis, or review. Returns chronologically sorted list of screenshot files with details like filename, capture time, file size, and dimensions when available. Use this to find specific screenshots by timestamp or to see what visual data is available for analysis. Commonly used before view_screenshot or extract_text_from_screenshot operations.",
        inputSchema: zodToJsonSchema(ListRecentScreenshotsToolSchema),
      },
      {
        name: "extract_text_from_screenshot", 
        description: "Extract text content from a previously saved screenshot file using advanced OCR (Optical Character Recognition). Perfect for retrieving text from screenshots taken earlier without needing to recapture the screen. Useful for analyzing text content from past screen states, extracting data from images, or processing visual text for further analysis. Use list_recent_screenshots first to find available screenshot files. Returns extracted text content with confidence levels and positioning information.",
        inputSchema: zodToJsonSchema(ExtractTextFromScreenshotToolSchema),
      },
      {
        name: "find_ui_elements",
        description: "Capture a screenshot and intelligently detect and analyze UI elements including buttons, text fields, links, dialogs, menus, and other interactive components. Uses AI-powered element detection to identify clickable elements, determine their purposes, and provide precise coordinates for automation. Essential for understanding interface layouts, finding interactive elements, and planning automation workflows. Returns detailed information about each detected element including type, position, text content, clickability, and descriptive analysis. Perfect for dynamic UI exploration and automation planning.",
        inputSchema: zodToJsonSchema(FindUIElementsToolSchema),
      },
      {
        name: "compare_screenshots",
        description: "Compare two previously saved screenshots to identify differences, changes, or similarities between screen states. Useful for detecting UI changes, verifying automation results, monitoring application state changes, or debugging interface issues. Provides similarity metrics and identifies key differences between the compared images. Use list_recent_screenshots to find available screenshots for comparison. Returns detailed comparison results including similarity percentage and description of detected differences.",
        inputSchema: zodToJsonSchema(CompareScreenshotsToolSchema),
      },
      {
        name: "wait_for_element",
        description: "Wait for specific text or UI element to appear on screen before continuing. Essential for handling dynamic content, loading screens, and asynchronous UI updates. Polls the screen at regular intervals until the target text appears or timeout is reached. Use this before interacting with elements that may take time to load. Returns success/failure status and location of found element if successful.",
        inputSchema: zodToJsonSchema(WaitForElementToolSchema),
      },
      {
        name: "scroll",
        description: "Scroll in any direction within the current window or a specific region. Essential for navigating long documents, lists, or web pages. Supports both mouse wheel scrolling and trackpad-style scrolling. Use this to bring off-screen content into view before interacting with it.",
        inputSchema: zodToJsonSchema(ScrollToolSchema),
      },
      {
        name: "hover",
        description: "Hover the mouse over specific coordinates for a duration. Useful for triggering tooltips, dropdown menus, or hover states in UI elements. The mouse will remain at the specified position for the given duration before returning control.",
        inputSchema: zodToJsonSchema(HoverToolSchema),
      },
      {
        name: "right_click",
        description: "Right-click at specific coordinates to open context menus. Equivalent to click with button='right' but more intuitive. Use this for accessing context menus, additional options, or right-click specific functionality in applications.",
        inputSchema: zodToJsonSchema(RightClickToolSchema),
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const startTime = Date.now();
  logger.info(`Executing tool: ${request.params.name}`);
  
  try {
    // Validate input first
    const validation = await validateToolInput(request.params.name, request.params.arguments);
    if (!validation.valid) {
      throw new ValidationError(validation.error || 'Invalid input', request.params.name);
    }
    
    const args = validation.parsedInput || request.params.arguments;
    
    switch (request.params.name) {
      case "diagnostic": {
        const report = await getDiagnosticReport();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(report, null, 2),
            },
          ],
        };
      }

      case "screenshot": {
        // Ensure screen recording permission
        await ensurePermissions({ screenRecording: true });
        
        let captureRegion: Region | undefined;
        if (args.region) {
          captureRegion = new Region(
            args.region.x,
            args.region.y,
            args.region.width,
            args.region.height
          );
        }

        // Use circuit breaker for screen capture
        const screenshot = await screenCaptureBreaker.execute(
          async () => {
            logger.startTimer('screenshot');
            try {
              const result = captureRegion 
                ? await screen.grabRegion(captureRegion) 
                : await screen.grab();
              
              if (!result) {
                throw new ScreenCaptureError('Screenshot returned null');
              }
              
              return result;
            } finally {
              logger.endTimer('screenshot');
            }
          },
          'screenshot'
        );
        
        if (args.outputPath) {
          try {
            await fs.mkdir(dirname(args.outputPath), { recursive: true });
            await saveImage(screenshot, args.outputPath);
            logger.info(`Screenshot saved to: ${args.outputPath}`);
          } catch (error) {
            throw new FileSystemError(
              `Failed to save screenshot: ${error}`,
              args.outputPath
            );
          }
          
          return {
            content: [
              {
                type: "text",
                text: `Screenshot saved to: ${args.outputPath}`,
              },
            ],
          };
        } else {
          // Save to temp folder by default and return both base64 and temp path
          const filename = generateScreenshotFilename();
          const tempPath = join(TEMP_SCREENSHOTS_FOLDER, filename);
          
          try {
            await saveImage(screenshot, tempPath);
            await cleanupOldScreenshots();
            logger.info(`Screenshot saved to temp folder: ${tempPath}`);
            
            const base64 = await imageToBase64(screenshot);
            return {
              content: [
                {
                  type: "text",
                  text: `Screenshot captured and saved to temporary folder: ${filename}\n\nBase64 data: ${base64}`,
                },
              ],
            };
          } catch (error) {
            // Fallback to base64 only if temp save fails
            logger.warn('Failed to save to temp folder, returning base64 only', error as Error);
            const base64 = await imageToBase64(screenshot);
            return {
              content: [
                {
                  type: "text",
                  text: base64,
                },
              ],
            };
          }
        }
      }

      case "click": {
        // Ensure accessibility permission
        await ensurePermissions({ accessibility: true });
        
        const button = getMouseButton(args.button);
        
        await withRetry(
          async () => {
            logger.startTimer('click');
            try {
              await mouse.setPosition(new Point(args.x, args.y));
              
              if (args.doubleClick) {
                await mouse.doubleClick(button);
              } else {
                await mouse.click(button);
              }
            } catch (error) {
              throw new AutomationError(
                `Failed to click: ${error}`,
                'click',
                { x: args.x, y: args.y, button: args.button }
              );
            } finally {
              logger.endTimer('click');
            }
          },
          'click',
          { maxAttempts: 2, delayMs: 500 }
        );
        
        // Add small delay to ensure UI responds
        await new Promise(resolve => setTimeout(resolve, 100));
        
        logger.info(`Clicked at (${args.x}, ${args.y})`, { button: args.button, doubleClick: args.doubleClick });
        
        // Take verification screenshot if requested
        let verificationScreenshot: string | undefined;
        if (args.verify) {
          try {
            const screenshot = await screen.grab();
            const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
            const filename = `click-verify-${timestamp}.png`;
            const filepath = join(tempScreenshotDir, filename);
            await saveImage(screenshot, filepath);
            verificationScreenshot = filename;
          } catch (error) {
            logger.warn('Failed to take verification screenshot', error as Error);
          }
        }
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                action: "click",
                coordinates: { x: args.x, y: args.y },
                button: args.button,
                doubleClick: args.doubleClick,
                message: `Clicked at (${args.x}, ${args.y}) with ${args.button} button${args.doubleClick ? " (double-click)" : ""}`,
                verificationScreenshot
              }, null, 2),
            },
          ],
        };
      }

      case "type_text": {
        // Ensure accessibility permission
        await ensurePermissions({ accessibility: true });
        
        keyboard.config.autoDelayMs = args.delay || 50;
        
        await withRetry(
          async () => {
            logger.startTimer('type_text');
            try {
              await keyboard.type(args.text);
            } catch (error) {
              throw new AutomationError(
                `Failed to type text: ${error}`,
                'type_text',
                { textLength: args.text.length }
              );
            } finally {
              logger.endTimer('type_text');
            }
          },
          'type_text',
          { maxAttempts: 2, delayMs: 500 }
        );
        
        // Add small delay to ensure text is processed
        await new Promise(resolve => setTimeout(resolve, 50));
        
        logger.info('Text typed successfully', { length: args.text.length });
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                action: "type_text",
                text: args.text,
                characterCount: args.text.length,
                estimatedDuration: args.text.length * (args.delay || 50),
                message: `Successfully typed ${args.text.length} characters`
              }, null, 2),
            },
          ],
        };
      }

      case "mouse_move": {
        // Ensure accessibility permission
        await ensurePermissions({ accessibility: true });
        
        await withRetry(
          async () => {
            logger.startTimer('mouse_move');
            try {
              await mouse.setPosition(new Point(args.x, args.y));
            } catch (error) {
              throw new AutomationError(
                `Failed to move mouse: ${error}`,
                'mouse_move',
                { x: args.x, y: args.y }
              );
            } finally {
              logger.endTimer('mouse_move');
            }
          },
          'mouse_move',
          { maxAttempts: 2, delayMs: 500 }
        );
        
        logger.info(`Mouse moved to (${args.x}, ${args.y})`);
        
        return {
          content: [
            {
              type: "text",
              text: `Moved mouse to (${args.x}, ${args.y})`,
            },
          ],
        };
      }

      case "get_screen_info": {
        const screenSize = await screen.width();
        const screenHeight = await screen.height();
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                width: screenSize,
                height: screenHeight,
              }, null, 2),
            },
          ],
        };
      }

      case "key_press": {
        // Ensure accessibility permission
        await ensurePermissions({ accessibility: true });
        
        await withRetry(
          async () => {
            logger.startTimer('key_press');
            try {
              await pressKeys(args.key);
            } catch (error) {
              throw new AutomationError(
                `Failed to press key(s): ${error}`,
                'key_press',
                { key: args.key }
              );
            } finally {
              logger.endTimer('key_press');
            }
          },
          'key_press',
          { maxAttempts: 2, delayMs: 500 }
        );
        
        // Add delay for key combinations to register
        await new Promise(resolve => setTimeout(resolve, 150));
        
        logger.info('Key(s) pressed', { key: args.key });
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                action: "key_press",
                keys: args.key,
                message: `Successfully pressed: ${args.key}`
              }, null, 2),
            },
          ],
        };
      }

      case "check_for_errors": {
        // Ensure screen recording permission
        await ensurePermissions({ screenRecording: true });
        
        let checkRegion: Region | undefined;
        if (args.region) {
          checkRegion = new Region(
            args.region.x,
            args.region.y,
            args.region.width,
            args.region.height
          );
        }
        
        const errors = await withRetry(
          async () => {
            logger.startTimer('check_errors');
            try {
              return await errorDetector.detectErrors(checkRegion);
            } finally {
              logger.endTimer('check_errors');
            }
          },
          'check_for_errors',
          { maxAttempts: 2, delayMs: 1000 }
        );
        
        logger.info('Error check completed', { 
          errorsFound: errors.length,
          region: args.region 
        });
        
        if (errors.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No errors detected on screen",
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Detected ${errors.length} potential error(s):\n${errors.map(e => `- ${e.pattern.name}: ${e.pattern.description}`).join("\n")}`,
              },
            ],
          };
        }
      }

      case "wait": {
        const args = WaitToolSchema.parse(request.params.arguments);
        await new Promise(resolve => setTimeout(resolve, args.milliseconds));
        
        return {
          content: [
            {
              type: "text",
              text: `Waited for ${args.milliseconds}ms`,
            },
          ],
        };
      }

      case "list_windows": {
        try {
          const windows = await getWindows();
          const windowList = await Promise.all(
            windows.map(async (w) => {
              try {
                const title = await w.getTitle();
                const region = await w.getRegion();
                return {
                  title,
                  x: region.left,
                  y: region.top,
                  width: region.width,
                  height: region.height,
                };
              } catch (e) {
                return {
                  title: "Unknown",
                  error: e instanceof Error ? e.message : String(e),
                };
              }
            })
          );
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(windowList, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to list windows: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "get_active_window": {
        try {
          const activeWindow = await getActiveWindow();
          const title = await activeWindow.getTitle();
          const region = await activeWindow.getRegion();
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  title,
                  x: region.left,
                  y: region.top,
                  width: region.width,
                  height: region.height,
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get active window: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "find_window": {
        await ensurePermissions({ accessibility: true });
        
        try {
          const window = await withRetry(
            async () => {
              const result = await screen.find(windowWithTitle(args.title));
              if (!result) {
                throw new WindowNotFoundError(args.title);
              }
              return result;
            },
            'find_window',
            { maxAttempts: 2, delayMs: 1000 }
          );
          
          const region = await window.getRegion();
          
          logger.info('Window found', { title: args.title, region });
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  found: true,
                  title: args.title,
                  x: region.left,
                  y: region.top,
                  width: region.width,
                  height: region.height,
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          if (error instanceof WindowNotFoundError) {
            return {
              content: [
                {
                  type: "text",
                  text: error.message,
                },
              ],
            };
          }
          throw error;
        }
      }

      case "focus_window": {
        await ensurePermissions({ accessibility: true });
        
        const window = await withRetry(
          async () => {
            const result = await screen.find(windowWithTitle(args.title));
            if (!result) {
              throw new WindowNotFoundError(args.title);
            }
            return result;
          },
          'focus_window_find',
          { maxAttempts: 2, delayMs: 1000 }
        );
        
        await withRetry(
          async () => {
            await window.focus();
          },
          'focus_window_action',
          { maxAttempts: 3, delayMs: 500 }
        );
        
        logger.info('Window focused', { title: args.title });
        
        return {
          content: [
            {
              type: "text",
              text: `Focused window: "${args.title}"`,
            },
          ],
        };
      }

      case "get_window_info": {
        const args = GetWindowInfoToolSchema.parse(request.params.arguments);
        try {
          const window = await screen.find(windowWithTitle(args.title));
          const region = await window.getRegion();
          const title = await window.getTitle();
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  title,
                  x: region.left,
                  y: region.top,
                  width: region.width,
                  height: region.height,
                  center: {
                    x: region.left + region.width / 2,
                    y: region.top + region.height / 2,
                  },
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to get window info for "${args.title}": ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "extract_text": {
        // Ensure screen recording permission
        await ensurePermissions({ screenRecording: true });
        
        let captureRegion: Region | undefined;
        if (args.region) {
          captureRegion = new Region(
            args.region.x,
            args.region.y,
            args.region.width,
            args.region.height
          );
        }
        
        const screenshot = await screenCaptureBreaker.execute(
          async () => {
            const result = captureRegion 
              ? await screen.grabRegion(captureRegion) 
              : await screen.grab();
            
            if (!result) {
              throw new ScreenCaptureError('Screenshot returned null');
            }
            
            return result;
          },
          'extract_text_capture'
        );
        
        const extractedText = await ocrBreaker.execute(
          async () => {
            logger.startTimer('ocr_extract');
            try {
              const text = await extractTextFromImage(screenshot);
              return text;
            } catch (error) {
              throw new OCRError(
                `Text extraction failed: ${error}`,
                { region: args.region }
              );
            } finally {
              logger.endTimer('ocr_extract');
            }
          },
          'extract_text_ocr'
        );
        
        logger.info('Text extracted successfully', { 
          textLength: extractedText?.length || 0,
          hasRegion: !!args.region 
        });
        
        return {
          content: [
            {
              type: "text",
              text: extractedText || "No text found in the specified region",
            },
          ],
        };
      }

      case "find_text": {
        // Ensure screen recording permission
        await ensurePermissions({ screenRecording: true });
        
        let searchRegion: Region | undefined;
        if (args.region) {
          searchRegion = new Region(
            args.region.x,
            args.region.y,
            args.region.width,
            args.region.height
          );
        }
        
        const screenshot = await screenCaptureBreaker.execute(
          async () => {
            const result = searchRegion 
              ? await screen.grabRegion(searchRegion) 
              : await screen.grab();
            
            if (!result) {
              throw new ScreenCaptureError('Screenshot returned null');
            }
            
            return result;
          },
          'find_text_capture'
        );
        
        const textLocations = await ocrBreaker.execute(
          async () => {
            logger.startTimer('ocr_find');
            try {
              const locations = await getTextLocations(screenshot);
              return locations;
            } catch (error) {
              throw new OCRError(
                `Text location search failed: ${error}`,
                { searchText: args.text, region: args.region }
              );
            } finally {
              logger.endTimer('ocr_find');
            }
          },
          'find_text_ocr'
        );
        
        const foundLocations = textLocations.filter(loc => 
          loc.text.toLowerCase().includes(args.text.toLowerCase())
        );
        
        logger.info('Text search completed', { 
          searchText: args.text,
          found: foundLocations.length > 0,
          matches: foundLocations.length 
        });
        
        if (foundLocations.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  found: true,
                  searchText: args.text,
                  locations: foundLocations.map(loc => ({
                    text: loc.text,
                    x: loc.x + (searchRegion?.left || 0),
                    y: loc.y + (searchRegion?.top || 0),
                    width: loc.width,
                    height: loc.height,
                    confidence: loc.confidence,
                  })),
                }, null, 2),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Text "${args.text}" not found on screen`,
              },
            ],
          };
        }
      }

      case "list_screenshots": {
        try {
          const files = await fs.readdir(TEMP_SCREENSHOTS_FOLDER);
          const screenshots = files
            .filter(f => f.startsWith('screenshot-') && f.endsWith('.png'))
            .sort((a, b) => b.localeCompare(a)); // Most recent first
          
          const screenshotInfo = await Promise.all(
            screenshots.map(async (filename) => {
              const filepath = join(TEMP_SCREENSHOTS_FOLDER, filename);
              try {
                const stats = await fs.stat(filepath);
                return {
                  filename,
                  filepath,
                  size: stats.size,
                  created: stats.birthtime.toISOString(),
                  modified: stats.mtime.toISOString(),
                };
              } catch (error) {
                return {
                  filename,
                  filepath,
                  error: `Failed to get file stats: ${error}`,
                };
              }
            })
          );
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  tempFolder: TEMP_SCREENSHOTS_FOLDER,
                  count: screenshots.length,
                  screenshots: screenshotInfo,
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to list screenshots: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "view_screenshot": {
        try {
          const filepath = join(TEMP_SCREENSHOTS_FOLDER, args.filename);
          
          // Validate filename for security
          if (!args.filename.startsWith('screenshot-') || !args.filename.endsWith('.png')) {
            throw new ValidationError('Invalid screenshot filename format', 'view_screenshot');
          }
          
          // Check if file exists
          await fs.access(filepath);
          
          // Read and convert to base64
          const imageBuffer = await fs.readFile(filepath);
          const base64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;
          
          const stats = await fs.stat(filepath);
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  filename: args.filename,
                  filepath,
                  size: stats.size,
                  created: stats.birthtime.toISOString(),
                  modified: stats.mtime.toISOString(),
                  base64Data: base64,
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          if ((error as any).code === 'ENOENT') {
            return {
              content: [
                {
                  type: "text",
                  text: `Screenshot not found: ${args.filename}. Use list_screenshots to see available files.`,
                },
              ],
              isError: true,
            };
          } else {
            return {
              content: [
                {
                  type: "text",
                  text: `Failed to view screenshot: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }
      }

      case "cleanup_screenshots": {
        try {
          const files = await fs.readdir(TEMP_SCREENSHOTS_FOLDER);
          const screenshots = files
            .filter(f => f.startsWith('screenshot-') && f.endsWith('.png'))
            .sort((a, b) => b.localeCompare(a)); // Most recent first
          
          const keepCount = args.keepLast || 5;
          const toDelete = screenshots.slice(keepCount);
          
          let deletedCount = 0;
          for (const filename of toDelete) {
            try {
              await fs.unlink(join(TEMP_SCREENSHOTS_FOLDER, filename));
              deletedCount++;
            } catch (error) {
              logger.warn(`Failed to delete screenshot: ${filename}`, error as Error);
            }
          }
          
          return {
            content: [
              {
                type: "text",
                text: `Cleanup completed: deleted ${deletedCount} screenshots, kept ${Math.min(keepCount, screenshots.length)} most recent ones.`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to cleanup screenshots: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "describe_screenshot": {
        // Ensure screen recording permission
        await ensurePermissions({ screenRecording: true });
        
        const screenshot = await screenCaptureBreaker.execute(
          async () => {
            logger.startTimer('describe_screenshot_capture');
            try {
              const result = await screen.grab();
              if (!result) {
                throw new ScreenCaptureError('Screenshot returned null');
              }
              return result;
            } finally {
              logger.endTimer('describe_screenshot_capture');
            }
          },
          'describe_screenshot'
        );
        
        try {
          logger.startTimer('analyze_screenshot');
          const analysis = await screenshotAnalyzer.analyzeScreenshot(screenshot);
          logger.endTimer('analyze_screenshot');
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  analysis: {
                    summary: analysis.summary,
                    extractedText: args.includeOCR ? analysis.extractedText : 'OCR disabled',
                    textLength: analysis.extractedText.length,
                    detectedElements: args.detectElements ? analysis.detectedElements : [],
                    clickableElements: analysis.detectedElements.filter(e => e.clickable).length,
                    metadata: analysis.metadata
                  }
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error('Screenshot analysis failed', error as Error);
          throw new OCRError(`Screenshot analysis failed: ${error}`);
        }
      }

      case "list_recent_screenshots": {
        try {
          const screenshots = await screenshotAnalyzer.listRecentScreenshots(args.limit || 10);
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  count: screenshots.length,
                  screenshots: screenshots.map(s => ({
                    filename: s.filename,
                    timestamp: s.timestamp.toISOString(),
                    size: s.size,
                    dimensions: s.dimensions,
                    format: s.format,
                    hasOCRData: s.hasOCRData,
                    textLength: s.textLength
                  }))
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to list recent screenshots: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "extract_text_from_screenshot": {
        try {
          // For now, return a message that this feature requires implementation
          // In a full implementation, we'd need to load the image file and process it
          return {
            content: [
              {
                type: "text",
                text: "Text extraction from saved screenshot files is not yet fully implemented. Use 'extract_text' to extract text from live screen captures instead.",
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to extract text from screenshot: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "find_ui_elements": {
        // Ensure screen recording permission
        await ensurePermissions({ screenRecording: true });
        
        let captureRegion: Region | undefined;
        if (args.region) {
          captureRegion = new Region(
            args.region.x,
            args.region.y,
            args.region.width,
            args.region.height
          );
        }
        
        const screenshot = await screenCaptureBreaker.execute(
          async () => {
            logger.startTimer('find_ui_elements_capture');
            try {
              const result = captureRegion 
                ? await screen.grabRegion(captureRegion) 
                : await screen.grab();
              
              if (!result) {
                throw new ScreenCaptureError('Screenshot returned null');
              }
              
              return result;
            } finally {
              logger.endTimer('find_ui_elements_capture');
            }
          },
          'find_ui_elements'
        );
        
        try {
          logger.startTimer('analyze_ui_elements');
          const analysis = await screenshotAnalyzer.analyzeScreenshot(screenshot);
          logger.endTimer('analyze_ui_elements');
          
          // Filter by requested element types if specified
          let filteredElements = analysis.detectedElements;
          if (args.elementTypes && args.elementTypes.length > 0) {
            filteredElements = analysis.detectedElements.filter(e => 
              args.elementTypes!.includes(e.type)
            );
          }
          
          // Adjust coordinates if region was specified
          if (captureRegion) {
            filteredElements = filteredElements.map(element => ({
              ...element,
              x: element.x + captureRegion.left,
              y: element.y + captureRegion.top
            }));
          }
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  region: args.region,
                  totalElements: filteredElements.length,
                  clickableElements: filteredElements.filter(e => e.clickable).length,
                  elementTypes: [...new Set(filteredElements.map(e => e.type))],
                  elements: filteredElements,
                  metadata: args.autoSave ? analysis.metadata : undefined
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error('UI element detection failed', error as Error);
          throw new OCRError(`UI element detection failed: ${error}`);
        }
      }

      case "compare_screenshots": {
        try {
          const comparison = await screenshotAnalyzer.compareScreenshots(
            args.filename1, 
            args.filename2
          );
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  file1: args.filename1,
                  file2: args.filename2,
                  similarity: comparison.similarity,
                  differences: comparison.differences,
                  summary: comparison.summary
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to compare screenshots: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "wait_for_element": {
        const startWaitTime = Date.now();
        const endTime = startWaitTime + args.timeout;
        let found = false;
        let foundLocation: any = null;
        
        logger.info(`Waiting for element with text: "${args.text}"`, { timeout: args.timeout, region: args.region });
        
        while (Date.now() < endTime && !found) {
          try {
            // Take screenshot of the region or full screen
            let screenshot;
            if (args.region) {
              const region = new Region(args.region.x, args.region.y, args.region.width, args.region.height);
              screenshot = await screen.grabRegion(region);
            } else {
              screenshot = await screen.grab();
            }
            
            // Use existing find_text logic
            const textLocations = await getTextLocations(screenshot);
            const matches = textLocations.filter(loc => 
              loc.text.toLowerCase().includes(args.text.toLowerCase())
            );
            
            if (matches.length > 0) {
              found = true;
              foundLocation = matches[0];
              // Adjust coordinates if region was specified
              if (args.region) {
                foundLocation.x += args.region.x;
                foundLocation.y += args.region.y;
              }
            }
          } catch (error) {
            logger.warn('Error during wait_for_element check', error as Error);
          }
          
          if (!found) {
            // Wait before next check
            await new Promise(resolve => setTimeout(resolve, args.pollInterval));
          }
        }
        
        const waitDuration = Date.now() - startWaitTime;
        
        if (found) {
          logger.info(`Element found after ${waitDuration}ms`, { text: args.text, location: foundLocation });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  found: true,
                  waitTime: waitDuration,
                  text: args.text,
                  location: {
                    text: foundLocation.text,
                    x: foundLocation.x,
                    y: foundLocation.y,
                    width: foundLocation.width,
                    height: foundLocation.height,
                    center: {
                      x: foundLocation.x + foundLocation.width / 2,
                      y: foundLocation.y + foundLocation.height / 2
                    }
                  },
                  message: `Found "${args.text}" after ${waitDuration}ms`
                }, null, 2),
              },
            ],
          };
        } else {
          logger.warn(`Element not found after timeout`, { text: args.text, timeout: args.timeout });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  found: false,
                  waitTime: waitDuration,
                  text: args.text,
                  message: `"${args.text}" not found after ${args.timeout}ms timeout`
                }, null, 2),
              },
            ],
          };
        }
      }

      case "scroll": {
        await ensurePermissions({ accessibility: true });
        
        // Move to position if specified, otherwise use current position
        if (args.x !== undefined && args.y !== undefined) {
          await mouse.setPosition(new Point(args.x, args.y));
        }
        
        logger.startTimer('scroll');
        try {
          // Use nut-js scroll functionality
          const scrollAmount = args.amount;
          
          if (args.direction === "up") {
            await mouse.scrollUp(scrollAmount);
          } else if (args.direction === "down") {
            await mouse.scrollDown(scrollAmount);
          } else if (args.direction === "left") {
            await mouse.scrollLeft(scrollAmount);
          } else if (args.direction === "right") {
            await mouse.scrollRight(scrollAmount);
          }
          
          // Small delay to let scroll complete
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          throw new AutomationError(
            `Failed to scroll: ${error}`,
            'scroll',
            { direction: args.direction, amount: args.amount }
          );
        } finally {
          logger.endTimer('scroll');
        }
        
        logger.info('Scrolled successfully', { direction: args.direction, amount: args.amount });
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                action: "scroll",
                direction: args.direction,
                amount: args.amount,
                position: args.x !== undefined && args.y !== undefined ? { x: args.x, y: args.y } : "current",
                message: `Scrolled ${args.direction} by ${args.amount} units`
              }, null, 2),
            },
          ],
        };
      }

      case "hover": {
        await ensurePermissions({ accessibility: true });
        
        await withRetry(
          async () => {
            logger.startTimer('hover');
            try {
              // Move to position
              await mouse.setPosition(new Point(args.x, args.y));
              
              // Hold position for duration
              await new Promise(resolve => setTimeout(resolve, args.duration));
              
            } catch (error) {
              throw new AutomationError(
                `Failed to hover: ${error}`,
                'hover',
                { x: args.x, y: args.y, duration: args.duration }
              );
            } finally {
              logger.endTimer('hover');
            }
          },
          'hover',
          { maxAttempts: 2, delayMs: 500 }
        );
        
        logger.info(`Hovered at (${args.x}, ${args.y}) for ${args.duration}ms`);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                action: "hover",
                position: { x: args.x, y: args.y },
                duration: args.duration,
                message: `Hovered at (${args.x}, ${args.y}) for ${args.duration}ms`
              }, null, 2),
            },
          ],
        };
      }

      case "right_click": {
        await ensurePermissions({ accessibility: true });
        
        await withRetry(
          async () => {
            logger.startTimer('right_click');
            try {
              await mouse.setPosition(new Point(args.x, args.y));
              await mouse.click(Button.RIGHT);
            } catch (error) {
              throw new AutomationError(
                `Failed to right-click: ${error}`,
                'right_click',
                { x: args.x, y: args.y }
              );
            } finally {
              logger.endTimer('right_click');
            }
          },
          'right_click',
          { maxAttempts: 2, delayMs: 500 }
        );
        
        // Add small delay to ensure context menu appears
        await new Promise(resolve => setTimeout(resolve, 150));
        
        logger.info(`Right-clicked at (${args.x}, ${args.y})`);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                action: "right_click",
                position: { x: args.x, y: args.y },
                message: `Right-clicked at (${args.x}, ${args.y})`
              }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Tool execution failed: ${request.params.name}`, error as Error, { duration });
    
    // Get user-friendly error message
    const errorMessage = error instanceof Error 
      ? getUserFriendlyErrorMessage(error)
      : String(error);
    
    // Include additional context for certain error types
    let errorContent = errorMessage;
    if (error instanceof PermissionError) {
      errorContent += "\n\n" + getPermissionInstructions();
    } else if (error instanceof ValidationError && error.details) {
      errorContent += "\n\nDetails: " + JSON.stringify(error.details, null, 2);
    }
    
    return {
      content: [
        {
          type: "text",
          text: errorContent,
        },
      ],
      isError: true,
    };
  } finally {
    const duration = Date.now() - startTime;
    logger.debug(`Tool ${request.params.name} completed in ${duration}ms`);
  }
});

// Start the server
async function main() {
  try {
    logger.info('Starting macOS Simulator MCP server...');
    
    // Initialize temp folder for screenshots
    await initTempFolder();
    
    // Run initial health check
    const healthCheck = await performHealthCheck();
    
    if (healthCheck.status === 'unhealthy') {
      logger.error('Server health check failed', undefined, { healthCheck });
      console.error('\n⚠️  Critical issues detected:\n');
      healthCheck.errors.forEach(error => console.error(`  • ${error}`));
      console.error('\n' + getPermissionInstructions() + '\n');
      
      // Still start the server but warn about limited functionality
      console.error('⚠️  Starting server with limited functionality...\n');
    } else if (healthCheck.status === 'degraded') {
      logger.warn('Server health check shows degraded status', { healthCheck });
      console.error('\n⚠️  Some features may not work properly:\n');
      healthCheck.warnings.forEach(warning => console.error(`  • ${warning}`));
      console.error('');
    } else {
      logger.info('Health check passed');
      console.error('✅ All systems operational\n');
    }
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    logger.info('macOS Simulator MCP server is running');
    console.error('macOS Simulator MCP server running on stdio');
    
    // Log performance stats periodically in debug mode
    if (process.env.MCP_LOG_LEVEL === 'DEBUG') {
      setInterval(() => {
        const stats = {
          screenshot: logger.getPerformanceStats('screenshot'),
          click: logger.getPerformanceStats('click'),
          type_text: logger.getPerformanceStats('type_text'),
          ocr_extract: logger.getPerformanceStats('ocr_extract'),
          ocr_find: logger.getPerformanceStats('ocr_find')
        };
        logger.debug('Performance statistics', stats);
      }, 60000); // Every minute
    }
  } catch (error) {
    logger.error('Failed to start server', error as Error);
    throw error;
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// Cleanup on exit
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  try {
    await terminateOCR();
    logger.info('Cleanup completed');
  } catch (error) {
    logger.error('Error during cleanup', error as Error);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  try {
    await terminateOCR();
    logger.info('Cleanup completed');
  } catch (error) {
    logger.error('Error during cleanup', error as Error);
  }
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', reason as Error, { promise });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});