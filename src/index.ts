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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize error detector
const errorDetector = new ErrorDetector();

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
  try {
    switch (request.params.name) {
      case "screenshot": {
        const args = ScreenshotToolSchema.parse(request.params.arguments);
        
        let captureRegion: Region | undefined;
        if (args.region) {
          captureRegion = new Region(
            args.region.x,
            args.region.y,
            args.region.width,
            args.region.height
          );
        }

        const screenshot = captureRegion ? await screen.grabRegion(captureRegion) : await screen.grab();
        
        if (args.outputPath) {
          await fs.mkdir(dirname(args.outputPath), { recursive: true });
          await saveImage(screenshot, args.outputPath);
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
        const args = ClickToolSchema.parse(request.params.arguments);
        await mouse.setPosition(new Point(args.x, args.y));
        
        const button = getMouseButton(args.button);
        
        if (args.doubleClick) {
          await mouse.doubleClick(button);
        } else {
          await mouse.click(button);
        }
        
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
        const args = TypeTextToolSchema.parse(request.params.arguments);
        keyboard.config.autoDelayMs = args.delay || 50;
        await keyboard.type(args.text);
        
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
        const args = MouseMoveToolSchema.parse(request.params.arguments);
        await mouse.setPosition(new Point(args.x, args.y));
        
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
        const args = KeyPressToolSchema.parse(request.params.arguments);
        await pressKeys(args.key);
        
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
        const args = FindWindowToolSchema.parse(request.params.arguments);
        try {
          const window = await screen.find(windowWithTitle(args.title));
          const region = await window.getRegion();
          
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
          return {
            content: [
              {
                type: "text",
                text: `Window with title "${args.title}" not found`,
              },
            ],
          };
        }
      }

      case "focus_window": {
        const args = FocusWindowToolSchema.parse(request.params.arguments);
        try {
          const window = await screen.find(windowWithTitle(args.title));
          await window.focus();
          
          return {
            content: [
              {
                type: "text",
                text: `Focused window: "${args.title}"`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to focus window "${args.title}": ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
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
        const args = ExtractTextToolSchema.parse(request.params.arguments);
        try {
          let captureRegion: Region | undefined;
          if (args.region) {
            captureRegion = new Region(
              args.region.x,
              args.region.y,
              args.region.width,
              args.region.height
            );
          }
          
          const screenshot = captureRegion ? await screen.grabRegion(captureRegion) : await screen.grab();
          const extractedText = await extractTextFromImage(screenshot);
          
          return {
            content: [
              {
                type: "text",
                text: extractedText || "No text found in the specified region",
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to extract text: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "find_text": {
        const args = FindTextToolSchema.parse(request.params.arguments);
        try {
          let searchRegion: Region | undefined;
          if (args.region) {
            searchRegion = new Region(
              args.region.x,
              args.region.y,
              args.region.width,
              args.region.height
            );
          }
          
          const screenshot = searchRegion ? await screen.grabRegion(searchRegion) : await screen.grab();
          const textLocations = await getTextLocations(screenshot);
          
          const foundLocations = textLocations.filter(loc => 
            loc.text.toLowerCase().includes(args.text.toLowerCase())
          );
          
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
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to find text: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("macOS Simulator MCP server running on stdio");
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