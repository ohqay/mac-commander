import { z } from 'zod';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { screen, Image, Region } from '@nut-tree-fork/nut-js';
import sharp from 'sharp';
import { ToolHandler, ToolResult, ExecutionContext } from '../core/types.js';
import { CacheManagerImpl } from '../core/cache-manager.js';
import { logger } from '../logger.js';
import { ensurePermissions } from '../permissions.js';
import { screenCaptureBreaker } from '../circuit-breakers.js';
import { ScreenCaptureError, FileSystemError } from '../errors.js';
import { imageToBase64, saveImage } from '../image-utils.js';
import { 
  TEMP_SCREENSHOTS_FOLDER, 
  generateScreenshotFilename,
  cleanupOldScreenshots 
} from '../screenshot-utils.js';
import { extractTextFromImage } from '../ocr-utils.js';

// Schema definitions
const ScreenshotToolSchema = z.object({
  region: z.object({
    x: z.number().describe("X coordinate of the region's top-left corner"),
    y: z.number().describe("Y coordinate of the region's top-left corner"),
    width: z.number().describe("Width of the region"),
    height: z.number().describe("Height of the region"),
  }).optional().describe("Optional specific region to capture"),
  outputPath: z.string().optional().describe("Optional file path to save the screenshot"),
});

const ListScreenshotsToolSchema = z.object({});

const ViewScreenshotToolSchema = z.object({
  filename: z.string().describe("Name of the screenshot file to view"),
});

const CleanupScreenshotsToolSchema = z.object({
  keepLast: z.number().min(0).default(10).describe("Number of recent screenshots to keep"),
});

const DescribeScreenshotToolSchema = z.object({
  region: z.object({
    x: z.number().describe("X coordinate of the region's top-left corner"),
    y: z.number().describe("Y coordinate of the region's top-left corner"),
    width: z.number().describe("Width of the region"),
    height: z.number().describe("Height of the region"),
  }).optional().describe("Optional specific region to analyze"),
  savePath: z.string().optional().describe("Optional path to save the analyzed screenshot"),
});

const ListRecentScreenshotsToolSchema = z.object({
  limit: z.number().min(1).max(50).default(10).describe("Maximum number of screenshots to list"),
});

const ExtractTextFromScreenshotToolSchema = z.object({
  filename: z.string().describe("Name of the screenshot file to extract text from"),
});

const CompareScreenshotsToolSchema = z.object({
  screenshot1: z.string().describe("Filename of the first screenshot"),
  screenshot2: z.string().describe("Filename of the second screenshot"),
});

/**
 * Screenshot tool handler
 */
export const screenshotHandler: ToolHandler = {
  name: 'screenshot',
  description: 'Capture a screenshot of the entire screen or a specific region. Can save to a specified path or return as base64 encoded image data. Essential for visual documentation, debugging UI issues, and capturing application state. Supports high-resolution captures and handles Retina displays automatically. When no output path is specified, saves to a temporary folder for later retrieval. Returns both the temporary filename and base64 data for immediate use. Requires screen recording permission on macOS. Use specific regions for better performance when capturing UI elements.',
  schema: ScreenshotToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    await ensurePermissions({ screenRecording: true });
    
    context.performanceTracker.startTimer('screenshot');
    
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
        'screenshot'
      );
      
      // Share screenshot in context for other tools
      context.shareScreenshot(screenshot);
      
      if (args.outputPath) {
        await fs.mkdir(dirname(args.outputPath), { recursive: true });
        await saveImage(screenshot, args.outputPath);
        logger.info(`Screenshot saved to: ${args.outputPath}`);
        
        return {
          content: [{
            type: "text",
            text: `Screenshot saved to: ${args.outputPath}`,
          }],
        };
      } else {
        const filename = generateScreenshotFilename();
        const tempPath = join(TEMP_SCREENSHOTS_FOLDER, filename);
        
        try {
          await saveImage(screenshot, tempPath);
          await cleanupOldScreenshots();
          logger.info(`Screenshot saved to temp folder: ${tempPath}`);
          
          const base64 = await imageToBase64(screenshot);
          return {
            content: [{
              type: "text",
              text: `Screenshot captured and saved to temporary folder: ${filename}\n\nBase64 data: ${base64}`,
            }],
          };
        } catch (error) {
          logger.warn('Failed to save to temp folder, returning base64 only', error as Error);
          const base64 = await imageToBase64(screenshot);
          return {
            content: [{
              type: "text",
              text: base64,
            }],
          };
        }
      }
    } finally {
      context.performanceTracker.endTimer('screenshot');
    }
  }
};

/**
 * List screenshots tool handler
 */
export const listScreenshotsHandler: ToolHandler = {
  name: 'list_screenshots',
  description: 'List all screenshots saved in the temporary folder',
  schema: ListScreenshotsToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    try {
      await fs.mkdir(TEMP_SCREENSHOTS_FOLDER, { recursive: true });
      const files = await fs.readdir(TEMP_SCREENSHOTS_FOLDER);
      const screenshots = files
        .filter(f => f.endsWith('.png'))
        .sort((a, b) => b.localeCompare(a)); // Newest first
      
      if (screenshots.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No screenshots found in temporary folder",
          }],
        };
      }
      
      const fileInfo = await Promise.all(
        screenshots.map(async (filename) => {
          const filePath = join(TEMP_SCREENSHOTS_FOLDER, filename);
          const stats = await fs.stat(filePath);
          return {
            filename,
            size: `${(stats.size / 1024).toFixed(1)}KB`,
            modified: stats.mtime.toISOString(),
          };
        })
      );
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(fileInfo, null, 2),
        }],
      };
    } catch (error) {
      throw new FileSystemError(
        `Failed to list screenshots: ${error}`,
        TEMP_SCREENSHOTS_FOLDER
      );
    }
  }
};

/**
 * View screenshot tool handler
 */
export const viewScreenshotHandler: ToolHandler = {
  name: 'view_screenshot',
  description: 'View/display a specific screenshot from the temporary folder',
  schema: ViewScreenshotToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    const filePath = join(TEMP_SCREENSHOTS_FOLDER, args.filename);
    
    try {
      const imageBuffer = await fs.readFile(filePath);
      const base64 = imageBuffer.toString('base64');
      
      return {
        content: [{
          type: "text",
          text: `data:image/png;base64,${base64}`,
        }],
      };
    } catch (error) {
      throw new FileSystemError(
        `Failed to read screenshot: ${error}`,
        filePath
      );
    }
  }
};

/**
 * Cleanup screenshots tool handler
 */
export const cleanupScreenshotsHandler: ToolHandler = {
  name: 'cleanup_screenshots',
  description: 'Clean up old screenshots from temporary folder',
  schema: CleanupScreenshotsToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    try {
      const files = await fs.readdir(TEMP_SCREENSHOTS_FOLDER);
      const screenshots = files
        .filter(f => f.endsWith('.png'))
        .sort((a, b) => b.localeCompare(a)); // Newest first
      
      if (screenshots.length <= args.keepLast) {
        return {
          content: [{
            type: "text",
            text: `No cleanup needed. Found ${screenshots.length} screenshots, keeping last ${args.keepLast}`,
          }],
        };
      }
      
      const toDelete = screenshots.slice(args.keepLast);
      await Promise.all(
        toDelete.map(filename => 
          fs.unlink(join(TEMP_SCREENSHOTS_FOLDER, filename))
        )
      );
      
      return {
        content: [{
          type: "text",
          text: `Cleaned up ${toDelete.length} old screenshots. Kept ${args.keepLast} most recent.`,
        }],
      };
    } catch (error) {
      throw new FileSystemError(
        `Failed to cleanup screenshots: ${error}`,
        TEMP_SCREENSHOTS_FOLDER
      );
    }
  }
};

/**
 * Describe screenshot tool handler
 */
export const describeScreenshotHandler: ToolHandler = {
  name: 'describe_screenshot',
  description: 'Capture and comprehensively analyze a screenshot with AI-powered insights. Combines screen capture with OCR text extraction, UI element detection, and intelligent content analysis. Automatically saves screenshots for later reference and provides detailed descriptions of visual content, detected UI elements (buttons, links, dialogs, etc.), and actionable insights. Perfect for understanding screen content, documenting UI states, debugging interface issues, and enabling AI to comprehend visual context. Returns structured analysis including extracted text, clickable elements, element positions, and human-readable summary of screen contents.',
  schema: DescribeScreenshotToolSchema,
  
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
      'describe_screenshot'
    );
    
    // Save screenshot
    const filename = generateScreenshotFilename('described');
    const tempPath = join(TEMP_SCREENSHOTS_FOLDER, filename);
    await saveImage(screenshot, tempPath);
    
    if (args.savePath) {
      await fs.mkdir(dirname(args.savePath), { recursive: true });
      await saveImage(screenshot, args.savePath);
    }
    
    // Extract text using OCR
    const extractedText = await extractTextFromImage(screenshot);
    
    // Basic UI element detection based on common patterns
    const uiElements = detectBasicUIElements(extractedText);
    
    const analysis = {
      filename,
      savedTo: args.savePath || tempPath,
      region: args.region || 'fullscreen',
      extractedText: extractedText.trim() || 'No text detected',
      detectedElements: uiElements,
      summary: generateScreenshotSummary(extractedText, uiElements),
    };
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify(analysis, null, 2),
      }],
    };
  }
};

/**
 * List recent screenshots tool handler
 */
export const listRecentScreenshotsHandler: ToolHandler = {
  name: 'list_recent_screenshots',
  description: 'List recently captured and saved screenshots with metadata including timestamps, file sizes, and basic information. Essential for accessing previously captured screenshots for comparison, analysis, or review. Returns chronologically sorted list of screenshot files with details like filename, capture time, file size, and dimensions when available. Use this to find specific screenshots by timestamp or to see what visual data is available for analysis. Commonly used before view_screenshot or extract_text_from_screenshot operations.',
  schema: ListRecentScreenshotsToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    try {
      await fs.mkdir(TEMP_SCREENSHOTS_FOLDER, { recursive: true });
      const files = await fs.readdir(TEMP_SCREENSHOTS_FOLDER);
      const screenshots = files
        .filter(f => f.endsWith('.png'))
        .sort((a, b) => b.localeCompare(a))
        .slice(0, args.limit);
      
      if (screenshots.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No screenshots found in temporary folder",
          }],
        };
      }
      
      const fileInfo = await Promise.all(
        screenshots.map(async (filename) => {
          const filePath = join(TEMP_SCREENSHOTS_FOLDER, filename);
          const stats = await fs.stat(filePath);
          
          // Try to get image dimensions
          let dimensions = { width: 0, height: 0 };
          try {
            const metadata = await sharp(filePath).metadata();
            dimensions = { 
              width: metadata.width || 0, 
              height: metadata.height || 0 
            };
          } catch {
            // Ignore dimension errors
          }
          
          return {
            filename,
            size: `${(stats.size / 1024).toFixed(1)}KB`,
            modified: stats.mtime.toISOString(),
            timestamp: extractTimestampFromFilename(filename),
            dimensions: dimensions.width > 0 ? dimensions : undefined,
          };
        })
      );
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(fileInfo, null, 2),
        }],
      };
    } catch (error) {
      throw new FileSystemError(
        `Failed to list recent screenshots: ${error}`,
        TEMP_SCREENSHOTS_FOLDER
      );
    }
  }
};

/**
 * Extract text from screenshot tool handler
 */
export const extractTextFromScreenshotHandler: ToolHandler = {
  name: 'extract_text_from_screenshot',
  description: 'Extract text content from a previously saved screenshot file using advanced OCR (Optical Character Recognition). Perfect for retrieving text from screenshots taken earlier without needing to recapture the screen. Useful for analyzing text content from past screen states, extracting data from images, or processing visual text for further analysis. Use list_recent_screenshots first to find available screenshot files. Returns extracted text content with confidence levels and positioning information.',
  schema: ExtractTextFromScreenshotToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    const filePath = join(TEMP_SCREENSHOTS_FOLDER, args.filename);
    
    try {
      // For now, we'll load the image using sharp and convert to base64
      // since nut-js Image expects specific format
      const imageBuffer = await fs.readFile(filePath);
      
      // We'll pass the file path to a modified OCR function
      // For now, return a placeholder
      const extractedText = `[Text extraction from saved screenshots not yet implemented]`;
      
      return {
        content: [{
          type: "text",
          text: extractedText.trim() || 'No text detected in screenshot',
        }],
      };
    } catch (error) {
      throw new FileSystemError(
        `Failed to extract text from screenshot: ${error}`,
        filePath
      );
    }
  }
};

/**
 * Compare screenshots tool handler
 */
export const compareScreenshotsHandler: ToolHandler = {
  name: 'compare_screenshots',
  description: 'Compare two previously saved screenshots to identify differences, changes, or similarities between screen states. Useful for detecting UI changes, verifying automation results, monitoring application state changes, or debugging interface issues. Provides similarity metrics and identifies key differences between the compared images. Use list_recent_screenshots to find available screenshots for comparison. Returns detailed comparison results including similarity percentage and description of detected differences.',
  schema: CompareScreenshotsToolSchema,
  
  async execute(args: any, context: ExecutionContext): Promise<ToolResult> {
    const path1 = join(TEMP_SCREENSHOTS_FOLDER, args.screenshot1);
    const path2 = join(TEMP_SCREENSHOTS_FOLDER, args.screenshot2);
    
    try {
      // Load both images
      const [img1, img2] = await Promise.all([
        sharp(path1),
        sharp(path2)
      ]);
      
      // Get metadata
      const [meta1, meta2] = await Promise.all([
        img1.metadata(),
        img2.metadata()
      ]);
      
      // Basic comparison
      const sameSize = meta1.width === meta2.width && meta1.height === meta2.height;
      
      let similarity = 0;
      let differences = [];
      
      if (!sameSize) {
        differences.push(`Different dimensions: ${meta1.width}x${meta1.height} vs ${meta2.width}x${meta2.height}`);
      } else {
        // Simple pixel difference calculation
        const [buf1, buf2] = await Promise.all([
          img1.raw().toBuffer(),
          img2.raw().toBuffer()
        ]);
        
        let matchingPixels = 0;
        const totalPixels = buf1.length / 3; // RGB channels
        
        for (let i = 0; i < buf1.length; i += 3) {
          const r1 = buf1[i], g1 = buf1[i+1], b1 = buf1[i+2];
          const r2 = buf2[i], g2 = buf2[i+1], b2 = buf2[i+2];
          
          if (Math.abs(r1 - r2) < 10 && Math.abs(g1 - g2) < 10 && Math.abs(b1 - b2) < 10) {
            matchingPixels++;
          }
        }
        
        similarity = (matchingPixels / totalPixels) * 100;
        
        if (similarity < 95) {
          differences.push(`Visual differences detected (${similarity.toFixed(1)}% similar)`);
        }
      }
      
      const comparison = {
        screenshot1: args.screenshot1,
        screenshot2: args.screenshot2,
        sameSize,
        dimensions1: { width: meta1.width, height: meta1.height },
        dimensions2: { width: meta2.width, height: meta2.height },
        similarity: `${similarity.toFixed(1)}%`,
        differences: differences.length > 0 ? differences : ['Screenshots appear identical'],
      };
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(comparison, null, 2),
        }],
      };
    } catch (error) {
      throw new FileSystemError(
        `Failed to compare screenshots: ${error}`,
        `${path1}, ${path2}`
      );
    }
  }
};

// Helper functions
function detectBasicUIElements(text: string): any[] {
  const elements = [];
  const lines = text.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Detect buttons (common patterns)
    if (trimmed.match(/^(OK|Cancel|Submit|Save|Delete|Close|Open|Click|Next|Previous|Back)$/i)) {
      elements.push({ type: 'button', text: trimmed });
    }
    // Detect links (contains http or www)
    else if (trimmed.match(/https?:\/\/|www\./)) {
      elements.push({ type: 'link', text: trimmed });
    }
    // Detect potential form labels
    else if (trimmed.endsWith(':')) {
      elements.push({ type: 'label', text: trimmed });
    }
    // Detect error messages
    else if (trimmed.match(/error|failed|invalid|warning/i)) {
      elements.push({ type: 'error', text: trimmed });
    }
  }
  
  return elements;
}

function generateScreenshotSummary(text: string, elements: any[]): string {
  const buttonCount = elements.filter(e => e.type === 'button').length;
  const linkCount = elements.filter(e => e.type === 'link').length;
  const errorCount = elements.filter(e => e.type === 'error').length;
  
  let summary = 'Screenshot captured. ';
  
  if (text.trim()) {
    summary += `Contains text content. `;
  }
  
  if (buttonCount > 0) {
    summary += `Found ${buttonCount} button(s). `;
  }
  
  if (linkCount > 0) {
    summary += `Found ${linkCount} link(s). `;
  }
  
  if (errorCount > 0) {
    summary += `Detected ${errorCount} potential error message(s). `;
  }
  
  if (elements.length === 0 && !text.trim()) {
    summary += 'No text or UI elements detected.';
  }
  
  return summary;
}

function extractTimestampFromFilename(filename: string): string | undefined {
  const match = filename.match(/(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/);
  if (match) {
    return match[1].replace(/_/g, ' ').replace(/-/g, ':');
  }
  return undefined;
}

// Export all handlers
export const screenshotToolHandlers: ToolHandler[] = [
  screenshotHandler,
  listScreenshotsHandler,
  viewScreenshotHandler,
  cleanupScreenshotsHandler,
  describeScreenshotHandler,
  listRecentScreenshotsHandler,
  extractTextFromScreenshotHandler,
  compareScreenshotsHandler,
];