import { z } from 'zod';
import { screen, Region } from '@nut-tree-fork/nut-js';
import { ToolHandler, ToolResult, ExecutionContext } from '../core/types.js';
import { logger } from '../logger.js';
import { ensurePermissions } from '../permissions.js';
import { withRetry } from '../retry.js';
import { getDiagnosticReport } from '../health-check.js';
import { ErrorDetector } from '../error-detection.js';

// Schema definitions
const WaitToolSchema = z.object({
  milliseconds: z.number().describe("Number of milliseconds to wait"),
});

const DiagnosticToolSchema = z.object({});

const CheckForErrorsToolSchema = z.object({
  region: z.object({
    x: z.number().describe("X coordinate of the region"),
    y: z.number().describe("Y coordinate of the region"),
    width: z.number().describe("Width of the region"),
    height: z.number().describe("Height of the region"),
  }).optional().describe("Optional specific region to check for errors"),
});

const GetScreenInfoToolSchema = z.object({});

// Initialize error detector
const errorDetector = new ErrorDetector();

/**
 * Wait tool handler
 */
export const waitHandler: ToolHandler = {
  name: 'wait',
  description: 'Pause execution for a specified duration in milliseconds to allow time for UI updates, animations, network requests, or application responses. Critical for reliable automation timing - prevents race conditions and ensures UI elements have time to load or respond. Use between actions when applications need time to process (e.g., after clicking a button that triggers loading, before taking a screenshot of updated content, or while waiting for dialogs to appear). Typical values: 500-1000ms for UI updates, 2000-5000ms for network operations. Essential tool for stable, reliable automation workflows.',
  schema: WaitToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    await new Promise(resolve => setTimeout(resolve, args.milliseconds));
    
    return {
      content: [{
        type: "text",
        text: `Waited for ${args.milliseconds}ms`,
      }],
    };
  }
};

/**
 * Diagnostic tool handler
 */
export const diagnosticHandler: ToolHandler = {
  name: 'diagnostic',
  description: 'Comprehensive system diagnostic tool that checks permissions status, verifies tool availability, and provides detailed health information for troubleshooting. Returns JSON report including permission states (screen recording, accessibility, etc.), system information, tool readiness status, and any detected issues. Essential first step when experiencing problems or setting up the MCP server for the first time. Use to verify all required permissions are granted and identify any configuration issues. Helps diagnose why certain tools might not be working as expected. No parameters required - performs full system scan.',
  schema: DiagnosticToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    const report = await getDiagnosticReport();
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify(report, null, 2),
      }],
    };
  }
};

/**
 * Check for errors tool handler
 */
export const checkForErrorsHandler: ToolHandler = {
  name: 'check_for_errors',
  description: 'Intelligent visual error detection system that scans the screen for common error patterns including red notification badges, error dialog boxes, crash messages, warning symbols, and failure indicators. Uses advanced pattern recognition to identify UI elements that typically signal problems or require user attention. Can scan entire screen or specific regions. Essential for automation reliability - use after critical operations to ensure they completed successfully. Returns detailed information about detected errors including their type and location. Helps prevent cascading failures in automation workflows by catching issues early. Requires screen recording permission on macOS.',
  schema: CheckForErrorsToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
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
        context.performanceTracker.startTimer('check_errors');
        try {
          return await errorDetector.detectErrors(checkRegion);
        } finally {
          context.performanceTracker.endTimer('check_errors');
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
        content: [{
          type: "text",
          text: "No errors detected on screen",
        }],
      };
    } else {
      return {
        content: [{
          type: "text",
          text: `Detected ${errors.length} potential error(s):\n${errors.map(e => `- ${e.pattern.name}: ${e.pattern.description}`).join("\n")}`,
        }],
      };
    }
  },
  
  async validatePermissions() {
    await ensurePermissions({ screenRecording: true });
  }
};

/**
 * Get screen info tool handler
 */
export const getScreenInfoHandler: ToolHandler = {
  name: 'get_screen_info',
  description: 'Retrieve current screen dimensions (width and height) in pixels. Essential for coordinate validation, calculating relative positions, and ensuring clicks/screenshots stay within screen bounds. Returns JSON with screen width and height. Use before automation workflows to understand available screen space, validate coordinates, or calculate positions for multi-monitor setups. Critical for responsive automation that adapts to different screen sizes. No parameters required.',
  schema: GetScreenInfoToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    const screenWidth = await screen.width();
    const screenHeight = await screen.height();
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          width: screenWidth,
          height: screenHeight,
        }, null, 2),
      }],
    };
  }
};

// Export all handlers
export const utilityToolHandlers: ToolHandler[] = [
  waitHandler,
  diagnosticHandler,
  checkForErrorsHandler,
  getScreenInfoHandler,
];