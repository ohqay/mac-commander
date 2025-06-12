#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { mouse, screen, Region, Button, keyboard, Key, Point, getWindows, getActiveWindow, windowWithTitle } from "@nut-tree-fork/nut-js";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ErrorDetector, commonErrorPatterns } from "./error-detection.js";
import { imageToBase64, saveImage } from "./image-utils.js";
import { extractTextFromImage, getTextLocations, terminateOCR } from "./ocr-utils.js";
import { elementDetector, ElementType } from "./element-detection.js";
import { performanceMonitor } from "./performance-monitor.js";
import { enhancedOCR } from "./ocr-enhanced.js";
import { ocrCache } from "./ocr-cache.js";
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize error detector
const errorDetector = new ErrorDetector();

// Initialize circuit breakers for critical operations
const screenCaptureBreaker = new CircuitBreaker(3, 30000);
const ocrBreaker = new CircuitBreaker(5, 60000);

// Add diagnostic tool schema
const DiagnosticToolSchema = z.object({});

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

const DragDropToolSchema = z.object({
  startX: z.number().describe("Starting X coordinate"),
  startY: z.number().describe("Starting Y coordinate"),
  endX: z.number().describe("Ending X coordinate"),
  endY: z.number().describe("Ending Y coordinate"),
  duration: z.number().optional().default(1000).describe("Duration of the drag in milliseconds"),
  smooth: z.boolean().optional().default(true).describe("Whether to use smooth movement"),
  button: z.enum(["left", "right", "middle"]).default("left").describe("Mouse button to use for dragging"),
});

const ScrollToolSchema = z.object({
  direction: z.enum(["up", "down", "left", "right"]).describe("Direction to scroll"),
  amount: z.number().describe("Amount to scroll (pixels for pixelScroll, steps for normal scroll)"),
  x: z.number().optional().describe("X coordinate to scroll at (defaults to current mouse position)"),
  y: z.number().optional().describe("Y coordinate to scroll at (defaults to current mouse position)"),
  smooth: z.boolean().optional().default(false).describe("Whether to use smooth scrolling animation"),
  pixelScroll: z.boolean().optional().default(false).describe("Whether to scroll by pixels (true) or steps (false)"),
});

const HoverToolSchema = z.object({
  x: z.number().describe("X coordinate to hover at"),
  y: z.number().describe("Y coordinate to hover at"),
  duration: z.number().optional().default(1000).describe("Duration to hover in milliseconds"),
});

const ClickHoldToolSchema = z.object({
  x: z.number().describe("X coordinate to click and hold"),
  y: z.number().describe("Y coordinate to click and hold"),
  duration: z.number().describe("Duration to hold the click in milliseconds"),
  button: z.enum(["left", "right", "middle"]).default("left").describe("Mouse button to hold"),
});

const RelativeMouseMoveToolSchema = z.object({
  offsetX: z.number().describe("Relative X offset from current position"),
  offsetY: z.number().describe("Relative Y offset from current position"),
  smooth: z.boolean().optional().default(true).describe("Whether to use smooth movement"),
});

const KeyHoldToolSchema = z.object({
  key: z.string().describe("Key to hold (e.g., 'shift', 'cmd', 'a')"),
  duration: z.number().describe("Duration to hold the key in milliseconds"),
});

const TypeWithDelayToolSchema = z.object({
  text: z.string().describe("Text to type"),
  minDelay: z.number().optional().default(50).describe("Minimum delay between keystrokes in milliseconds"),
  maxDelay: z.number().optional().default(150).describe("Maximum delay between keystrokes in milliseconds"),
  mistakes: z.boolean().optional().default(false).describe("Whether to simulate occasional typos"),
});

const FindElementToolSchema = z.object({
  text: z.string().optional().describe("Text content to search for in the element"),
  elementType: z.enum(["button", "text_field", "checkbox", "radio_button", "dropdown", "link", "label", "image", "menu_item", "tab", "switch", "slider"]).optional().describe("Type of element to find"),
  region: z.object({
    x: z.number().describe("X coordinate of the region"),
    y: z.number().describe("Y coordinate of the region"),
    width: z.number().describe("Width of the region"),
    height: z.number().describe("Height of the region"),
  }).optional().describe("Specific region to search in. If not provided, searches entire screen"),
});

const WaitForElementToolSchema = z.object({
  text: z.string().describe("Text content to wait for"),
  timeout: z.number().optional().default(30000).describe("Maximum time to wait in milliseconds"),
  checkInterval: z.number().optional().default(1000).describe("How often to check for the element in milliseconds"),
  region: z.object({
    x: z.number().describe("X coordinate of the region"),
    y: z.number().describe("Y coordinate of the region"),
    width: z.number().describe("Width of the region"),
    height: z.number().describe("Height of the region"),
  }).optional().describe("Specific region to search in. If not provided, searches entire screen"),
});

const GetPerformanceStatsToolSchema = z.object({
  operation: z.string().optional().describe("Specific operation to get stats for. If not provided, returns all stats"),
});

const ConfigureOCRToolSchema = z.object({
  language: z.string().optional().describe("OCR language to use (e.g., 'eng', 'fra', 'deu')"),
  confidenceThreshold: z.number().optional().describe("Minimum confidence threshold for OCR (0-100)"),
  preprocessing: z.object({
    contrast: z.boolean().optional(),
    sharpen: z.boolean().optional(),
    denoise: z.boolean().optional(),
    threshold: z.number().optional(),
  }).optional().describe("Image preprocessing options for better OCR accuracy"),
  cacheEnabled: z.boolean().optional().describe("Enable or disable OCR caching"),
  cacheTTL: z.number().optional().describe("Cache time-to-live in milliseconds"),
});

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

// Helper function to generate smooth path between two points
function generateSmoothPath(start: Point, end: Point, steps: number = 10): Point[] {
  const path: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Using easing function for more natural movement
    const easedT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    path.push(new Point(
      Math.round(start.x + (end.x - start.x) * easedT),
      Math.round(start.y + (end.y - start.y) * easedT)
    ));
  }
  return path;
}

// Helper function to generate random delay
function getRandomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper function to parse key string to Key enum or string
function parseKeyString(keyString: string): { modifiers: Key[], mainKey: Key | string | undefined } {
  const keys = keyString.toLowerCase().split("+");
  const modifiers: Key[] = [];
  let mainKey: Key | string | undefined;

  for (const key of keys) {
    switch (key.trim()) {
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
      default:
        mainKey = key;
    }
  }

  return { modifiers, mainKey };
}

// Helper function to press key combinations
async function pressKeys(keyString: string) {
  const { modifiers, mainKey } = parseKeyString(keyString);

  if (modifiers.length > 0 && mainKey) {
    if (typeof mainKey === "string" && mainKey.length === 1) {
      await keyboard.type(mainKey);
    } else if (typeof mainKey !== "string") {
      await keyboard.pressKey(...modifiers, mainKey);
      await keyboard.releaseKey(...modifiers, mainKey);
    }
  } else if (mainKey) {
    if (typeof mainKey === "string" && mainKey.length === 1) {
      await keyboard.type(mainKey);
    } else if (typeof mainKey !== "string") {
      await keyboard.pressKey(mainKey);
      await keyboard.releaseKey(mainKey);
    }
  }
}

// Helper function to hold key combinations
async function holdKeys(keyString: string): Promise<() => Promise<void>> {
  const { modifiers, mainKey } = parseKeyString(keyString);
  const allKeys = [...modifiers];
  
  if (mainKey && typeof mainKey !== "string") {
    allKeys.push(mainKey);
  }
  
  if (allKeys.length > 0) {
    await keyboard.pressKey(...allKeys);
    
    // Return release function
    return async () => {
      await keyboard.releaseKey(...allKeys);
    };
  } else if (mainKey && typeof mainKey === "string") {
    // For single character keys, we'll simulate holding by rapid typing
    const interval = setInterval(() => keyboard.type(mainKey), 50);
    return async () => {
      clearInterval(interval);
    };
  }
  
  return async () => {}; // No-op if no valid keys
}

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "diagnostic",
        description: "Run a comprehensive health check and get diagnostic information about the MCP server",
        inputSchema: DiagnosticToolSchema,
      },
      {
        name: "screenshot",
        description: "Capture a screenshot of the screen or a specific region",
        inputSchema: ScreenshotToolSchema,
      },
      {
        name: "click",
        description: "Click at specific coordinates on the screen",
        inputSchema: ClickToolSchema,
      },
      {
        name: "type_text",
        description: "Type text using the keyboard",
        inputSchema: TypeTextToolSchema,
      },
      {
        name: "mouse_move",
        description: "Move the mouse to specific coordinates",
        inputSchema: MouseMoveToolSchema,
      },
      {
        name: "get_screen_info",
        description: "Get information about the screen dimensions",
        inputSchema: GetScreenInfoToolSchema,
      },
      {
        name: "key_press",
        description: "Press a key or key combination",
        inputSchema: KeyPressToolSchema,
      },
      {
        name: "check_for_errors",
        description: "Check the screen for common error indicators like red badges, error dialogs, or crash messages",
        inputSchema: CheckForErrorsToolSchema,
      },
      {
        name: "wait",
        description: "Wait for a specified amount of time",
        inputSchema: WaitToolSchema,
      },
      {
        name: "list_windows",
        description: "List all open windows",
        inputSchema: ListWindowsToolSchema,
      },
      {
        name: "get_active_window",
        description: "Get information about the currently active window",
        inputSchema: GetActiveWindowToolSchema,
      },
      {
        name: "find_window",
        description: "Find a window by its title",
        inputSchema: FindWindowToolSchema,
      },
      {
        name: "focus_window",
        description: "Focus/activate a window by its title",
        inputSchema: FocusWindowToolSchema,
      },
      {
        name: "get_window_info",
        description: "Get detailed information about a window",
        inputSchema: GetWindowInfoToolSchema,
      },
      {
        name: "extract_text",
        description: "Extract text from the screen using OCR",
        inputSchema: ExtractTextToolSchema,
      },
      {
        name: "find_text",
        description: "Find specific text on the screen and get its location",
        inputSchema: FindTextToolSchema,
      },
      {
        name: "drag_drop",
        description: "Drag from one point to another with customizable duration and smoothness",
        inputSchema: DragDropToolSchema,
      },
      {
        name: "scroll",
        description: "Scroll in any direction by steps or pixels with optional smooth animation",
        inputSchema: ScrollToolSchema,
      },
      {
        name: "hover",
        description: "Hover the mouse at a specific position for a duration",
        inputSchema: HoverToolSchema,
      },
      {
        name: "click_hold",
        description: "Click and hold a mouse button at specific coordinates for a duration",
        inputSchema: ClickHoldToolSchema,
      },
      {
        name: "relative_mouse_move",
        description: "Move the mouse relative to its current position",
        inputSchema: RelativeMouseMoveToolSchema,
      },
      {
        name: "key_hold",
        description: "Hold a key or key combination for a specific duration",
        inputSchema: KeyHoldToolSchema,
      },
      {
        name: "type_with_delay",
        description: "Type text with realistic human-like delays between keystrokes",
        inputSchema: TypeWithDelayToolSchema,
      },
      {
        name: "find_element",
        description: "Find UI elements on screen by text or type (button, text field, checkbox, etc.)",
        inputSchema: FindElementToolSchema,
      },
      {
        name: "wait_for_element",
        description: "Wait for a UI element with specific text to appear on screen",
        inputSchema: WaitForElementToolSchema,
      },
      {
        name: "get_performance_stats",
        description: "Get performance statistics for MCP operations",
        inputSchema: GetPerformanceStatsToolSchema,
      },
      {
        name: "configure_ocr",
        description: "Configure OCR settings for better accuracy and performance",
        inputSchema: ConfigureOCRToolSchema,
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
        
        logger.info(`Clicked at (${args.x}, ${args.y})`, { button: args.button, doubleClick: args.doubleClick });
        
        return {
          content: [
            {
              type: "text",
              text: `Clicked at (${args.x}, ${args.y}) with ${args.button} button${args.doubleClick ? " (double-click)" : ""}`,
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
        
        logger.info('Text typed successfully', { length: args.text.length });
        
        return {
          content: [
            {
              type: "text",
              text: `Typed: "${args.text}"`,
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
        
        logger.info('Key(s) pressed', { key: args.key });
        
        return {
          content: [
            {
              type: "text",
              text: `Pressed key(s): ${args.key}`,
            },
          ],
        };
      }

      case "check_for_errors": {
        const args = CheckForErrorsToolSchema.parse(request.params.arguments);
        
        let checkRegion: Region | undefined;
        if (args.region) {
          checkRegion = new Region(
            args.region.x,
            args.region.y,
            args.region.width,
            args.region.height
          );
        }
        
        const errors = await errorDetector.detectErrors(checkRegion);
        
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

      case "drag_drop": {
        const args = DragDropToolSchema.parse(request.params.arguments);
        
        const start = new Point(args.startX, args.startY);
        const end = new Point(args.endX, args.endY);
        
        // Move to start position
        await mouse.setPosition(start);
        
        // Press the mouse button
        const button = getMouseButton(args.button);
        await mouse.pressButton(button);
        
        // Generate path and move along it
        if (args.smooth) {
          const steps = Math.max(10, Math.floor(args.duration / 50)); // More steps for longer duration
          const path = generateSmoothPath(start, end, steps);
          const stepDelay = args.duration / steps;
          
          for (const point of path) {
            await mouse.setPosition(point);
            await new Promise(resolve => setTimeout(resolve, stepDelay));
          }
        } else {
          // Simple linear drag
          await new Promise(resolve => setTimeout(resolve, args.duration / 2));
          await mouse.setPosition(end);
          await new Promise(resolve => setTimeout(resolve, args.duration / 2));
        }
        
        // Release the mouse button
        await mouse.releaseButton(button);
        
        return {
          content: [
            {
              type: "text",
              text: `Dragged from (${args.startX}, ${args.startY}) to (${args.endX}, ${args.endY}) over ${args.duration}ms`,
            },
          ],
        };
      }

      case "scroll": {
        const args = ScrollToolSchema.parse(request.params.arguments);
        
        // Move to scroll position if specified
        if (args.x !== undefined && args.y !== undefined) {
          await mouse.setPosition(new Point(args.x, args.y));
        }
        
        // Perform scrolling
        if (args.smooth && args.pixelScroll) {
          // Smooth pixel scrolling - break into smaller steps
          const steps = Math.min(args.amount, 20); // Max 20 steps
          const amountPerStep = Math.ceil(args.amount / steps);
          
          for (let i = 0; i < steps; i++) {
            switch (args.direction) {
              case "up":
                await mouse.scrollUp(amountPerStep);
                break;
              case "down":
                await mouse.scrollDown(amountPerStep);
                break;
              case "left":
                await mouse.scrollLeft(amountPerStep);
                break;
              case "right":
                await mouse.scrollRight(amountPerStep);
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        } else {
          // Regular scrolling
          switch (args.direction) {
            case "up":
              await mouse.scrollUp(args.amount);
              break;
            case "down":
              await mouse.scrollDown(args.amount);
              break;
            case "left":
              await mouse.scrollLeft(args.amount);
              break;
            case "right":
              await mouse.scrollRight(args.amount);
              break;
          }
        }
        
        return {
          content: [
            {
              type: "text",
              text: `Scrolled ${args.direction} by ${args.amount} ${args.pixelScroll ? 'pixels' : 'steps'}${args.smooth ? ' (smooth)' : ''}`,
            },
          ],
        };
      }

      case "hover": {
        const args = HoverToolSchema.parse(request.params.arguments);
        
        await mouse.setPosition(new Point(args.x, args.y));
        await new Promise(resolve => setTimeout(resolve, args.duration));
        
        return {
          content: [
            {
              type: "text",
              text: `Hovered at (${args.x}, ${args.y}) for ${args.duration}ms`,
            },
          ],
        };
      }

      case "click_hold": {
        const args = ClickHoldToolSchema.parse(request.params.arguments);
        
        await mouse.setPosition(new Point(args.x, args.y));
        const button = getMouseButton(args.button);
        
        await mouse.pressButton(button);
        await new Promise(resolve => setTimeout(resolve, args.duration));
        await mouse.releaseButton(button);
        
        return {
          content: [
            {
              type: "text",
              text: `Held ${args.button} click at (${args.x}, ${args.y}) for ${args.duration}ms`,
            },
          ],
        };
      }

      case "relative_mouse_move": {
        const args = RelativeMouseMoveToolSchema.parse(request.params.arguments);
        
        const currentPos = await mouse.getPosition();
        const targetPos = new Point(
          currentPos.x + args.offsetX,
          currentPos.y + args.offsetY
        );
        
        if (args.smooth) {
          const path = generateSmoothPath(currentPos, targetPos, 10);
          for (const point of path) {
            await mouse.setPosition(point);
            await new Promise(resolve => setTimeout(resolve, 20));
          }
        } else {
          await mouse.setPosition(targetPos);
        }
        
        return {
          content: [
            {
              type: "text",
              text: `Moved mouse by (${args.offsetX}, ${args.offsetY}) from (${currentPos.x}, ${currentPos.y}) to (${targetPos.x}, ${targetPos.y})`,
            },
          ],
        };
      }

      case "key_hold": {
        const args = KeyHoldToolSchema.parse(request.params.arguments);
        
        const releaseFunction = await holdKeys(args.key);
        await new Promise(resolve => setTimeout(resolve, args.duration));
        await releaseFunction();
        
        return {
          content: [
            {
              type: "text",
              text: `Held key(s) "${args.key}" for ${args.duration}ms`,
            },
          ],
        };
      }

      case "type_with_delay": {
        const args = TypeWithDelayToolSchema.parse(request.params.arguments);
        
        for (let i = 0; i < args.text.length; i++) {
          const char = args.text[i];
          
          // Simulate occasional typos
          if (args.mistakes && Math.random() < 0.02) { // 2% chance of typo
            const typoChar = String.fromCharCode(char.charCodeAt(0) + (Math.random() > 0.5 ? 1 : -1));
            await keyboard.type(typoChar);
            await new Promise(resolve => setTimeout(resolve, getRandomDelay(100, 200)));
            await keyboard.pressKey(Key.Backspace);
            await keyboard.releaseKey(Key.Backspace);
            await new Promise(resolve => setTimeout(resolve, getRandomDelay(50, 100)));
          }
          
          await keyboard.type(char);
          
          // Human-like variable delay
          const delay = getRandomDelay(args.minDelay, args.maxDelay);
          
          // Occasionally add longer pauses (thinking)
          if (Math.random() < 0.05) { // 5% chance of longer pause
            await new Promise(resolve => setTimeout(resolve, delay * 3));
          } else {
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
        
        return {
          content: [
            {
              type: "text",
              text: `Typed "${args.text}" with human-like delays (${args.minDelay}-${args.maxDelay}ms)${args.mistakes ? ' and occasional typos' : ''}`,
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
  await terminateOCR();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await terminateOCR();
  process.exit(0);
});