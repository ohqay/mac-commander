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

// Helper function to parse key combinations
async function pressKeys(keyString: string) {
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