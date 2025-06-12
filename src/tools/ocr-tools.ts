import { z } from 'zod';
import { screen, Region } from '@nut-tree-fork/nut-js';
import { ToolHandler, ToolResult, ExecutionContext } from '../core/types.js';
import { logger } from '../logger.js';
import { ensurePermissions } from '../permissions.js';
import { screenCaptureBreaker, ocrBreaker } from '../circuit-breakers.js';
import { ScreenCaptureError, OCRError, TimeoutError } from '../errors.js';
import { extractTextFromImage, getTextLocations } from '../ocr-utils.js';
import { screenshotAnalyzer, UIElement } from '../screenshot-analysis.js';
import { saveImage } from '../image-utils.js';
import { TEMP_SCREENSHOTS_FOLDER, generateScreenshotFilename } from '../screenshot-utils.js';
import { join } from 'path';

// Schema definitions
const ExtractTextToolSchema = z.object({
  region: z.object({
    x: z.number().describe("X coordinate of the region"),
    y: z.number().describe("Y coordinate of the region"),
    width: z.number().describe("Width of the region"),
    height: z.number().describe("Height of the region"),
  }).optional().describe("Optional specific region to extract text from"),
});

const FindTextToolSchema = z.object({
  text: z.string().describe("Text to search for (case-insensitive)"),
  region: z.object({
    x: z.number().describe("X coordinate of the region"),
    y: z.number().describe("Y coordinate of the region"),
    width: z.number().describe("Width of the region"),
    height: z.number().describe("Height of the region"),
  }).optional().describe("Optional specific region to search in"),
});

const WaitForElementToolSchema = z.object({
  text: z.string().describe("Text to wait for on screen"),
  timeout: z.number().default(10000).describe("Maximum wait time in milliseconds"),
  pollInterval: z.number().default(500).describe("How often to check in milliseconds"),
  region: z.object({
    x: z.number().describe("X coordinate of the region"),
    y: z.number().describe("Y coordinate of the region"),
    width: z.number().describe("Width of the region"),
    height: z.number().describe("Height of the region"),
  }).optional().describe("Optional specific region to search in"),
});

const FindUIElementsToolSchema = z.object({
  autoSave: z.boolean().default(true).describe("Whether to save the screenshot"),
  elementTypes: z.array(z.enum(['button', 'text_field', 'link', 'image', 'icon', 'dialog', 'menu', 'window', 'other']))
    .optional()
    .describe("Specific UI element types to look for"),
  region: z.object({
    x: z.number().describe("X coordinate of the region"),
    y: z.number().describe("Y coordinate of the region"),
    width: z.number().describe("Width of the region"),
    height: z.number().describe("Height of the region"),
  }).optional().describe("Optional specific region to analyze"),
});

/**
 * Extract text tool handler
 */
export const extractTextHandler: ToolHandler = {
  name: 'extract_text',
  description: 'Extract and read text from the screen or specific regions using advanced Optical Character Recognition (OCR). Capable of recognizing text in various fonts, sizes, and styles from screenshots, UI elements, dialogs, and any visible text content. Can process entire screen or focus on specific rectangular regions for better accuracy and performance. Essential for reading dynamic content, form values, error messages, or any text that changes programmatically. Returns plain text string of all recognized text. Use with specific regions when possible for faster processing and better accuracy. Commonly paired with screenshot for visual verification. Requires screen recording permission on macOS.',
  schema: ExtractTextToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
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
        context.performanceTracker.startTimer('ocr_extract');
        try {
          const text = await extractTextFromImage(screenshot);
          return text;
        } catch (error) {
          throw new OCRError(
            `Text extraction failed: ${error}`,
            { region: args.region }
          );
        } finally {
          context.performanceTracker.endTimer('ocr_extract');
        }
      },
      'extract_text_ocr'
    );
    
    logger.info('Text extracted', { 
      textLength: extractedText.length,
      region: args.region 
    });
    
    return {
      content: [{
        type: "text",
        text: extractedText || "No text found",
      }],
    };
  },
  
  async validatePermissions() {
    await ensurePermissions({ screenRecording: true });
  }
};

/**
 * Find text tool handler
 */
export const findTextHandler: ToolHandler = {
  name: 'find_text',
  description: 'Locate specific text on the screen using OCR and return precise coordinates for clicking or interaction. Searches for text content (case-insensitive partial matching) and returns detailed location information including x/y coordinates, width/height, and confidence scores. Essential for dynamic UI automation where button or element positions change but text content remains consistent. Can search entire screen or specific regions for better performance. Returns JSON with found status, matching text, precise coordinates, and confidence levels. Perfect for clicking on buttons, menu items, or links identified by their text content rather than fixed coordinates. Enables robust automation that adapts to UI changes. Requires screen recording permission on macOS.',
  schema: FindTextToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
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
      'find_text_capture'
    );
    
    const textLocations = await ocrBreaker.execute(
      async () => {
        context.performanceTracker.startTimer('ocr_find');
        try {
          const locations = await getTextLocations(screenshot, args.text);
          return locations;
        } catch (error) {
          throw new OCRError(
            `Text search failed: ${error}`,
            { searchText: args.text, region: args.region }
          );
        } finally {
          context.performanceTracker.endTimer('ocr_find');
        }
      },
      'find_text_ocr'
    );
    
    logger.info('Text search completed', { 
      searchText: args.text,
      found: textLocations.length > 0,
      matches: textLocations.length 
    });
    
    if (textLocations.length === 0) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            found: false,
            searchText: args.text,
            message: `Text "${args.text}" not found on screen`,
          }, null, 2),
        }],
      };
    }
    
    // Return all matches with coordinates
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          found: true,
          searchText: args.text,
          matches: textLocations.map(loc => ({
            text: loc.text,
            x: captureRegion ? captureRegion.left + loc.x : loc.x,
            y: captureRegion ? captureRegion.top + loc.y : loc.y,
            width: loc.width,
            height: loc.height,
            confidence: loc.confidence,
            center: {
              x: (captureRegion ? captureRegion.left + loc.x : loc.x) + loc.width / 2,
              y: (captureRegion ? captureRegion.top + loc.y : loc.y) + loc.height / 2,
            },
          })),
          bestMatch: textLocations[0] ? {
            text: textLocations[0].text,
            x: captureRegion ? captureRegion.left + textLocations[0].x : textLocations[0].x,
            y: captureRegion ? captureRegion.top + textLocations[0].y : textLocations[0].y,
            width: textLocations[0].width,
            height: textLocations[0].height,
            center: {
              x: (captureRegion ? captureRegion.left + textLocations[0].x : textLocations[0].x) + textLocations[0].width / 2,
              y: (captureRegion ? captureRegion.top + textLocations[0].y : textLocations[0].y) + textLocations[0].height / 2,
            },
          } : null,
        }, null, 2),
      }],
    };
  },
  
  async validatePermissions() {
    await ensurePermissions({ screenRecording: true });
  }
};

/**
 * Wait for element tool handler
 */
export const waitForElementHandler: ToolHandler = {
  name: 'wait_for_element',
  description: 'Wait for specific text or UI element to appear on screen before continuing. Essential for handling dynamic content, loading screens, and asynchronous UI updates. Polls the screen at regular intervals until the target text appears or timeout is reached. Use this before interacting with elements that may take time to load. Returns success/failure status and location of found element if successful.',
  schema: WaitForElementToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    await ensurePermissions({ screenRecording: true });
    
    const startTime = Date.now();
    let found = false;
    let lastLocation: any = null;
    
    while (!found && (Date.now() - startTime) < args.timeout) {
      try {
        // Take screenshot
        let captureRegion: Region | undefined;
        if (args.region) {
          captureRegion = new Region(
            args.region.x,
            args.region.y,
            args.region.width,
            args.region.height
          );
        }
        
        const screenshot = await screen.grab();
        if (!screenshot) {
          throw new ScreenCaptureError('Screenshot returned null');
        }
        
        // Search for text
        const locations = await getTextLocations(screenshot, args.text);
        
        if (locations.length > 0) {
          found = true;
          lastLocation = locations[0];
          break;
        }
      } catch (error) {
        logger.warn('Error during wait_for_element check', error as Error);
      }
      
      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, args.pollInterval));
    }
    
    const waitDuration = Date.now() - startTime;
    
    if (found && lastLocation) {
      logger.info('Element found', { text: args.text, waitTime: waitDuration });
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            found: true,
            waitTime: waitDuration,
            text: args.text,
            location: {
              x: lastLocation.x,
              y: lastLocation.y,
              width: lastLocation.width,
              height: lastLocation.height,
              center: {
                x: lastLocation.x + lastLocation.width / 2,
                y: lastLocation.y + lastLocation.height / 2,
              },
            },
            message: `Found "${args.text}" after ${waitDuration}ms`,
          }, null, 2),
        }],
      };
    } else {
      logger.warn(`Element not found after timeout`, { text: args.text, timeout: args.timeout });
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            found: false,
            waitTime: waitDuration,
            text: args.text,
            message: `"${args.text}" not found after ${args.timeout}ms timeout`,
          }, null, 2),
        }],
      };
    }
  },
  
  async validatePermissions() {
    await ensurePermissions({ screenRecording: true });
  }
};

/**
 * Find UI elements tool handler
 */
export const findUIElementsHandler: ToolHandler = {
  name: 'find_ui_elements',
  description: 'Capture a screenshot and intelligently detect and analyze UI elements including buttons, text fields, links, dialogs, menus, and other interactive components. Uses AI-powered element detection to identify clickable elements, determine their purposes, and provide precise coordinates for automation. Essential for understanding interface layouts, finding interactive elements, and planning automation workflows. Returns detailed information about each detected element including type, position, text content, clickability, and descriptive analysis. Perfect for dynamic UI exploration and automation planning.',
  schema: FindUIElementsToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
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
      'find_ui_elements'
    );
    
    // Save screenshot if requested
    let filename: string | undefined;
    if (args.autoSave) {
      filename = generateScreenshotFilename('ui-analysis');
      const filepath = join(TEMP_SCREENSHOTS_FOLDER, filename);
      await saveImage(screenshot, filepath);
    }
    
    // Analyze UI elements
    const analysis = await screenshotAnalyzer.analyzeScreenshot(screenshot);
    
    // Filter by element types if specified
    let elements = analysis.detectedElements;
    if (args.elementTypes && args.elementTypes.length > 0) {
      elements = elements.filter((elem: UIElement) => 
        args.elementTypes!.includes(elem.type as any)
      );
    }
    
    logger.info('UI elements analyzed', { 
      totalElements: analysis.detectedElements.length,
      filteredElements: elements.length,
      savedAs: filename 
    });
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          screenshotSaved: filename,
          totalElementsFound: elements.length,
          elements: elements.map((elem: UIElement) => ({
            type: elem.type,
            text: elem.text,
            description: elem.description,
            position: {
              x: elem.x + (captureRegion?.left || 0),
              y: elem.y + (captureRegion?.top || 0),
              width: elem.width,
              height: elem.height,
              center: {
                x: elem.x + elem.width / 2 + (captureRegion?.left || 0),
                y: elem.y + elem.height / 2 + (captureRegion?.top || 0),
              },
            },
            clickable: elem.clickable,
            confidence: elem.confidence,
          })),
          summary: analysis.summary,
        }, null, 2),
      }],
    };
  },
  
  async validatePermissions() {
    await ensurePermissions({ screenRecording: true });
  }
};

// Export all handlers
export const ocrToolHandlers: ToolHandler[] = [
  extractTextHandler,
  findTextHandler,
  waitForElementHandler,
  findUIElementsHandler,
];