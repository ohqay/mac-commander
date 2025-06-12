import { z } from 'zod';
import { screen, getWindows, getActiveWindow, windowWithTitle } from '@nut-tree-fork/nut-js';
import { ToolHandler, ToolResult, ExecutionContext } from '../core/types.js';
import { logger } from '../logger.js';
import { ensurePermissions } from '../permissions.js';
import { withRetry } from '../retry.js';
import { WindowNotFoundError } from '../errors.js';

// Schema definitions
const ListWindowsToolSchema = z.object({});

const GetActiveWindowToolSchema = z.object({});

const FindWindowToolSchema = z.object({
  title: z.string().describe("Partial window title to search for"),
});

const FocusWindowToolSchema = z.object({
  title: z.string().describe("Partial window title to focus"),
});

const GetWindowInfoToolSchema = z.object({
  title: z.string().describe("Partial window title to get info for"),
});

/**
 * List windows tool handler
 */
export const listWindowsHandler: ToolHandler = {
  name: 'list_windows',
  description: 'Enumerate all currently open windows across all applications with detailed information including window titles, positions, and dimensions. Essential for discovering available applications and windows before interaction. Returns comprehensive JSON array with each window\'s title, x/y coordinates, width/height, and center point calculations. Use to find target applications, understand current desktop layout, or locate specific windows by title. Perfect starting point for window management workflows. Helps identify exact window titles needed for find_window and focus_window operations. No parameters required - scans entire system.',
  schema: ListWindowsToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
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
              center: {
                x: region.left + region.width / 2,
                y: region.top + region.height / 2,
              },
            };
          } catch (e) {
            return {
              title: "Unknown",
              error: e instanceof Error ? e.message : String(e),
            };
          }
        })
      );
      
      const validWindows = windowList.filter(w => !w.error && w.title !== "Unknown");
      
      logger.info(`Listed ${validWindows.length} windows`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(validWindows, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Failed to list windows: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }
};

/**
 * Get active window tool handler
 */
export const getActiveWindowHandler: ToolHandler = {
  name: 'get_active_window',
  description: 'Retrieve detailed information about the currently focused/active window including its title, position, dimensions, and calculated center point. Essential for understanding current user context and determining which application is receiving input. Returns JSON with window title, x/y coordinates, width/height, and center coordinates for precise interaction. Useful for confirming correct window focus before automation actions, or for getting coordinates relative to the active window. Commonly used before click or type_text operations to ensure actions target the intended application. No parameters required.',
  schema: GetActiveWindowToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    try {
      const activeWindow = await getActiveWindow();
      const title = await activeWindow.getTitle();
      const region = await activeWindow.getRegion();
      
      return {
        content: [{
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
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Failed to get active window: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }
};

/**
 * Find window tool handler
 */
export const findWindowHandler: ToolHandler = {
  name: 'find_window',
  description: 'Search for and locate a specific window using partial title matching, returning detailed window information if found. Supports flexible partial matching - you don\'t need the exact full title. Essential for locating target applications before interaction. Returns JSON with found status, window title, position (x/y), dimensions (width/height), and center coordinates. Use list_windows first to discover available window titles, then use this tool to get precise information about your target window. Commonly followed by focus_window to bring the window to front, or used to get coordinates for region-specific screenshots or clicks. Requires accessibility permission on macOS.',
  schema: FindWindowToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
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
        content: [{
          type: "text",
          text: JSON.stringify({
            found: true,
            title: args.title,
            x: region.left,
            y: region.top,
            width: region.width,
            height: region.height,
            center: {
              x: region.left + region.width / 2,
              y: region.top + region.height / 2,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      if (error instanceof WindowNotFoundError) {
        return {
          content: [{
            type: "text",
            text: error.message,
          }],
        };
      }
      throw error;
    }
  },
  
  async validatePermissions() {
    await ensurePermissions({ accessibility: true });
  }
};

/**
 * Focus window tool handler
 */
export const focusWindowHandler: ToolHandler = {
  name: 'focus_window',
  description: 'Bring a specific window to the foreground and make it the active/focused window using partial title matching. Essential for directing keyboard and mouse input to the correct application. Supports flexible partial matching - you don\'t need the exact full title. After focusing, the target window will receive all subsequent keyboard input from type_text and key_press operations. Critical first step in most automation workflows to ensure actions target the intended application. Use list_windows or find_window first to identify available windows and their titles. Common workflow: list_windows → focus_window → interact with application. Requires accessibility permission on macOS.',
  schema: FocusWindowToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
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
      content: [{
        type: "text",
        text: `Focused window: "${args.title}"`,
      }],
    };
  },
  
  async validatePermissions() {
    await ensurePermissions({ accessibility: true });
  }
};

/**
 * Get window info tool handler
 */
export const getWindowInfoHandler: ToolHandler = {
  name: 'get_window_info',
  description: 'Retrieve comprehensive information about a specific window using partial title matching, including precise positioning data and calculated center coordinates. Returns detailed JSON with window title, position (x/y), dimensions (width/height), and center point coordinates for precise interaction planning. More detailed than find_window, providing center coordinates which are essential for reliable clicking on window elements. Use when you need exact positioning data for clicking within a specific window, or for calculating relative coordinates for UI elements. Perfect for planning multi-step interactions within a particular application window. Supports partial title matching for flexibility.',
  schema: GetWindowInfoToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    try {
      const window = await screen.find(windowWithTitle(args.title));
      if (!window) {
        throw new WindowNotFoundError(args.title);
      }
      
      const region = await window.getRegion();
      const title = await window.getTitle();
      
      return {
        content: [{
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
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Failed to get window info for "${args.title}": ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }
};

// Export all handlers
export const windowToolHandlers: ToolHandler[] = [
  listWindowsHandler,
  getActiveWindowHandler,
  findWindowHandler,
  focusWindowHandler,
  getWindowInfoHandler,
];