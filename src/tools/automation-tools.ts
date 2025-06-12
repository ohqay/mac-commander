import { z } from 'zod';
import { mouse, keyboard, Key, Button, Point, screen } from '@nut-tree-fork/nut-js';
import { join } from 'path';
import { ToolHandler, ToolResult, ExecutionContext } from '../core/types.js';
import { logger } from '../logger.js';
import { ensurePermissions } from '../permissions.js';
import { withRetry } from '../retry.js';
import { AutomationError } from '../errors.js';
import { saveImage } from '../image-utils.js';
import { TEMP_SCREENSHOTS_FOLDER, generateScreenshotFilename } from '../screenshot-utils.js';

// Schema definitions
const ClickToolSchema = z.object({
  x: z.number().describe("X coordinate to click"),
  y: z.number().describe("Y coordinate to click"),
  button: z.enum(["left", "right", "middle"]).default("left").describe("Mouse button to use"),
  doubleClick: z.boolean().default(false).describe("Whether to double-click"),
  verify: z.boolean().default(false).describe("Take a screenshot after clicking to verify the action"),
});

const TypeTextToolSchema = z.object({
  text: z.string().describe("Text to type"),
  delay: z.number().default(50).describe("Delay between keystrokes in milliseconds"),
});

const KeyPressToolSchema = z.object({
  key: z.string().describe("Key or key combination to press (e.g., 'enter', 'cmd+a', 'ctrl+shift+tab')"),
});

const MouseMoveToolSchema = z.object({
  x: z.number().describe("X coordinate to move to"),
  y: z.number().describe("Y coordinate to move to"),
});

const DragToolSchema = z.object({
  startX: z.number().describe("Starting X coordinate"),
  startY: z.number().describe("Starting Y coordinate"),
  endX: z.number().describe("Ending X coordinate"),
  endY: z.number().describe("Ending Y coordinate"),
  button: z.enum(["left", "right", "middle"]).default("left").describe("Mouse button to use for dragging"),
});

const ScrollToolSchema = z.object({
  direction: z.enum(["up", "down", "left", "right"]).describe("Direction to scroll"),
  amount: z.number().default(5).describe("Number of scroll units"),
  x: z.number().optional().describe("X coordinate to scroll at (default: current mouse position)"),
  y: z.number().optional().describe("Y coordinate to scroll at (default: current mouse position)"),
});

const HoverToolSchema = z.object({
  x: z.number().describe("X coordinate to hover at"),
  y: z.number().describe("Y coordinate to hover at"),
  duration: z.number().default(1000).describe("How long to hover in milliseconds"),
});

const RightClickToolSchema = z.object({
  x: z.number().describe("X coordinate to right-click"),
  y: z.number().describe("Y coordinate to right-click"),
});

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
          // For special characters or unsupported keys, log a warning
          logger.warn(`Unsupported key "${trimmedKey}" in combination "${keyString}"`);
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
      // Single key press
      await keyboard.pressKey(mainKey);
      await keyboard.releaseKey(mainKey);
    }
  } catch (error) {
    throw new Error(`Failed to press keys "${keyString}": ${error}`);
  }
}

/**
 * Click tool handler
 */
export const clickHandler: ToolHandler = {
  name: 'click',
  description: 'Click at specific screen coordinates with configurable mouse button and optional double-click. Essential for UI interaction and automation. Supports left/right/middle mouse buttons. Can optionally take a verification screenshot after clicking to confirm the action was successful. Use with coordinates obtained from find_text, find_window, or get_window_info tools. Small delay added after clicking to ensure UI responds. Requires accessibility permission on macOS.',
  schema: ClickToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    await ensurePermissions({ accessibility: true });
    
    const button = getMouseButton(args.button);
    
    await withRetry(
      async () => {
        context.performanceTracker.startTimer('click');
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
          context.performanceTracker.endTimer('click');
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
        const filename = generateScreenshotFilename('click-verify');
        const filepath = join(TEMP_SCREENSHOTS_FOLDER, filename);
        await saveImage(screenshot, filepath);
        verificationScreenshot = filename;
      } catch (error) {
        logger.warn('Failed to take verification screenshot', error as Error);
      }
    }
    
    return {
      content: [{
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
      }],
    };
  },
  
  async validatePermissions() {
    await ensurePermissions({ accessibility: true });
  }
};

/**
 * Type text tool handler
 */
export const typeTextHandler: ToolHandler = {
  name: 'type_text',
  description: 'Type text at the current cursor position with configurable typing speed. Essential for form filling, text input, and automated data entry. Simulates realistic human typing with customizable delays between keystrokes. Use after focusing on the target input field with click or focus_window. Handles all standard characters and maintains consistent timing. Small delay added after typing to ensure text is processed. Requires accessibility permission on macOS.',
  schema: TypeTextToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    await ensurePermissions({ accessibility: true });
    
    keyboard.config.autoDelayMs = args.delay || 50;
    
    await withRetry(
      async () => {
        context.performanceTracker.startTimer('type_text');
        try {
          await keyboard.type(args.text);
        } catch (error) {
          throw new AutomationError(
            `Failed to type text: ${error}`,
            'type_text',
            { textLength: args.text.length }
          );
        } finally {
          context.performanceTracker.endTimer('type_text');
        }
      },
      'type_text',
      { maxAttempts: 2, delayMs: 500 }
    );
    
    // Add small delay to ensure text is processed
    await new Promise(resolve => setTimeout(resolve, 50));
    
    logger.info('Text typed successfully', { length: args.text.length });
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          action: "type_text",
          text: args.text,
          characterCount: args.text.length,
          estimatedDuration: args.text.length * (args.delay || 50),
          message: `Successfully typed ${args.text.length} characters`
        }, null, 2),
      }],
    };
  },
  
  async validatePermissions() {
    await ensurePermissions({ accessibility: true });
  }
};

/**
 * Key press tool handler
 */
export const keyPressHandler: ToolHandler = {
  name: 'key_press',
  description: 'Press a key or key combination (keyboard shortcuts). Supports single keys and complex combinations with modifiers (cmd, ctrl, alt, shift). Essential for triggering keyboard shortcuts, navigating applications, and controlling system functions. Examples: "cmd+a" (select all), "ctrl+shift+tab" (previous tab), "escape" (cancel), "enter" (confirm). Handles proper key press/release sequencing for reliable shortcut execution. Small delay added after key press to ensure registration. Requires accessibility permission on macOS.',
  schema: KeyPressToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    await ensurePermissions({ accessibility: true });
    
    await withRetry(
      async () => {
        context.performanceTracker.startTimer('key_press');
        try {
          await pressKeys(args.key);
        } catch (error) {
          throw new AutomationError(
            `Failed to press key(s): ${error}`,
            'key_press',
            { key: args.key }
          );
        } finally {
          context.performanceTracker.endTimer('key_press');
        }
      },
      'key_press',
      { maxAttempts: 2, delayMs: 500 }
    );
    
    // Add delay for key combinations to register
    await new Promise(resolve => setTimeout(resolve, 150));
    
    logger.info('Key(s) pressed', { key: args.key });
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          action: "key_press",
          keys: args.key,
          message: `Successfully pressed: ${args.key}`
        }, null, 2),
      }],
    };
  },
  
  async validatePermissions() {
    await ensurePermissions({ accessibility: true });
  }
};

/**
 * Mouse move tool handler
 */
export const mouseMoveHandler: ToolHandler = {
  name: 'mouse_move',
  description: 'Move the mouse cursor to specific coordinates without clicking. Useful for hovering over elements, positioning before complex operations, or triggering hover states. Use before drag operations or when precise cursor positioning is needed. Can be combined with hover for timed hover effects. Requires accessibility permission on macOS.',
  schema: MouseMoveToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    await ensurePermissions({ accessibility: true });
    
    await withRetry(
      async () => {
        context.performanceTracker.startTimer('mouse_move');
        try {
          await mouse.setPosition(new Point(args.x, args.y));
        } catch (error) {
          throw new AutomationError(
            `Failed to move mouse: ${error}`,
            'mouse_move',
            { x: args.x, y: args.y }
          );
        } finally {
          context.performanceTracker.endTimer('mouse_move');
        }
      },
      'mouse_move',
      { maxAttempts: 2, delayMs: 500 }
    );
    
    logger.info(`Mouse moved to (${args.x}, ${args.y})`);
    
    return {
      content: [{
        type: "text",
        text: `Moved mouse to (${args.x}, ${args.y})`,
      }],
    };
  },
  
  async validatePermissions() {
    await ensurePermissions({ accessibility: true });
  }
};

/**
 * Drag tool handler
 */
export const dragHandler: ToolHandler = {
  name: 'drag',
  description: 'Drag from one point to another using mouse button hold. Essential for drag-and-drop operations, selecting text regions, resizing windows, or moving UI elements. Performs smooth mouse movement from start to end coordinates while holding the specified mouse button. Commonly used for file management, UI arrangement, and selection operations. Requires accessibility permission on macOS.',
  schema: DragToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    await ensurePermissions({ accessibility: true });
    
    const button = getMouseButton(args.button);
    
    await withRetry(
      async () => {
        context.performanceTracker.startTimer('drag');
        try {
          // Move to start position
          await mouse.setPosition(new Point(args.startX, args.startY));
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Press and hold button
          await mouse.pressButton(button);
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Move to end position
          await mouse.setPosition(new Point(args.endX, args.endY));
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Release button
          await mouse.releaseButton(button);
        } catch (error) {
          throw new AutomationError(
            `Failed to drag: ${error}`,
            'drag',
            { start: { x: args.startX, y: args.startY }, end: { x: args.endX, y: args.endY } }
          );
        } finally {
          context.performanceTracker.endTimer('drag');
        }
      },
      'drag',
      { maxAttempts: 2, delayMs: 500 }
    );
    
    logger.info(`Dragged from (${args.startX}, ${args.startY}) to (${args.endX}, ${args.endY})`);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          action: "drag",
          start: { x: args.startX, y: args.startY },
          end: { x: args.endX, y: args.endY },
          button: args.button,
          message: `Dragged from (${args.startX}, ${args.startY}) to (${args.endX}, ${args.endY})`
        }, null, 2),
      }],
    };
  },
  
  async validatePermissions() {
    await ensurePermissions({ accessibility: true });
  }
};

/**
 * Scroll tool handler
 */
export const scrollHandler: ToolHandler = {
  name: 'scroll',
  description: 'Scroll in any direction within the current window or a specific region. Essential for navigating long documents, lists, or web pages. Supports both mouse wheel scrolling and trackpad-style scrolling. Use this to bring off-screen content into view before interacting with it.',
  schema: ScrollToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    await ensurePermissions({ accessibility: true });
    
    // Move to position if specified
    if (args.x !== undefined && args.y !== undefined) {
      await mouse.setPosition(new Point(args.x, args.y));
    }
    
    context.performanceTracker.startTimer('scroll');
    try {
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
      context.performanceTracker.endTimer('scroll');
    }
    
    logger.info('Scrolled successfully', { direction: args.direction, amount: args.amount });
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          action: "scroll",
          direction: args.direction,
          amount: args.amount,
          position: args.x !== undefined && args.y !== undefined ? { x: args.x, y: args.y } : "current",
          message: `Scrolled ${args.direction} by ${args.amount} units`
        }, null, 2),
      }],
    };
  },
  
  async validatePermissions() {
    await ensurePermissions({ accessibility: true });
  }
};

/**
 * Hover tool handler
 */
export const hoverHandler: ToolHandler = {
  name: 'hover',
  description: 'Hover the mouse over specific coordinates for a duration. Useful for triggering tooltips, dropdown menus, or hover states in UI elements. The mouse will remain at the specified position for the given duration before returning control.',
  schema: HoverToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    await ensurePermissions({ accessibility: true });
    
    await withRetry(
      async () => {
        context.performanceTracker.startTimer('hover');
        try {
          await mouse.setPosition(new Point(args.x, args.y));
          await new Promise(resolve => setTimeout(resolve, args.duration));
        } catch (error) {
          throw new AutomationError(
            `Failed to hover: ${error}`,
            'hover',
            { x: args.x, y: args.y, duration: args.duration }
          );
        } finally {
          context.performanceTracker.endTimer('hover');
        }
      },
      'hover',
      { maxAttempts: 2, delayMs: 500 }
    );
    
    logger.info(`Hovered at (${args.x}, ${args.y}) for ${args.duration}ms`);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          action: "hover",
          position: { x: args.x, y: args.y },
          duration: args.duration,
          message: `Hovered at (${args.x}, ${args.y}) for ${args.duration}ms`
        }, null, 2),
      }],
    };
  },
  
  async validatePermissions() {
    await ensurePermissions({ accessibility: true });
  }
};

/**
 * Right-click tool handler
 */
export const rightClickHandler: ToolHandler = {
  name: 'right_click',
  description: 'Right-click at specific coordinates to open context menus. Equivalent to click with button="right" but more intuitive. Use this for accessing context menus, additional options, or right-click specific functionality in applications.',
  schema: RightClickToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    await ensurePermissions({ accessibility: true });
    
    await withRetry(
      async () => {
        context.performanceTracker.startTimer('right_click');
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
          context.performanceTracker.endTimer('right_click');
        }
      },
      'right_click',
      { maxAttempts: 2, delayMs: 500 }
    );
    
    // Add small delay to ensure context menu appears
    await new Promise(resolve => setTimeout(resolve, 150));
    
    logger.info(`Right-clicked at (${args.x}, ${args.y})`);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          action: "right_click",
          position: { x: args.x, y: args.y },
          message: `Right-clicked at (${args.x}, ${args.y})`
        }, null, 2),
      }],
    };
  },
  
  async validatePermissions() {
    await ensurePermissions({ accessibility: true });
  }
};

// Export all handlers
export const automationToolHandlers: ToolHandler[] = [
  clickHandler,
  typeTextHandler,
  keyPressHandler,
  mouseMoveHandler,
  dragHandler,
  scrollHandler,
  hoverHandler,
  rightClickHandler,
];