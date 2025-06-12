import { Image } from "@nut-tree-fork/nut-js";
import { promises as fs } from "fs";
import { join, dirname, basename, extname } from "path";
import { tmpdir } from "os";
import { extractTextFromImage, getTextLocations, TextLocation } from "./ocr-utils.js";
import { imageToBase64, base64ToBuffer } from "./image-utils.js";
import { logger } from "./logger.js";
import { OCRError, FileSystemError } from "./errors.js";

/**
 * Interface for screenshot metadata
 */
export interface ScreenshotMetadata {
  filename: string;
  filepath: string;
  timestamp: Date;
  size: number;
  dimensions: {
    width: number;
    height: number;
  };
  format: string;
  hasOCRData?: boolean;
  textLength?: number;
}

/**
 * Interface for screenshot analysis results
 */
export interface ScreenshotAnalysis {
  metadata: ScreenshotMetadata;
  extractedText: string;
  textLocations: TextLocation[];
  detectedElements: UIElement[];
  summary: string;
}

/**
 * Interface for UI elements detected in screenshots
 */
export interface UIElement {
  type: 'button' | 'text_field' | 'link' | 'image' | 'icon' | 'dialog' | 'menu' | 'window' | 'other';
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  clickable: boolean;
  description: string;
}

/**
 * Screenshot analysis utility class
 */
export class ScreenshotAnalyzer {
  private tempDir: string;
  private maxScreenshots: number;

  constructor(maxScreenshots: number = 50) {
    this.tempDir = join(tmpdir(), 'mcp-screenshots');
    this.maxScreenshots = maxScreenshots;
    this.ensureTempDir();
  }

  private async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      throw new FileSystemError(`Failed to create temp directory: ${error}`, this.tempDir);
    }
  }

  /**
   * Get the path to save a screenshot with timestamp
   */
  private getScreenshotPath(prefix: string = 'screenshot'): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return join(this.tempDir, `${prefix}_${timestamp}.png`);
  }

  /**
   * Save a screenshot and return metadata
   */
  async saveScreenshot(image: Image, prefix: string = 'screenshot'): Promise<ScreenshotMetadata> {
    const filepath = this.getScreenshotPath(prefix);
    const filename = basename(filepath);
    
    try {
      // Convert image to base64 first to get the data
      const base64Data = await imageToBase64(image);
      const buffer = base64ToBuffer(base64Data);
      
      await fs.writeFile(filepath, buffer);
      
      const stats = await fs.stat(filepath);
      
      const metadata: ScreenshotMetadata = {
        filename,
        filepath,
        timestamp: new Date(),
        size: stats.size,
        dimensions: {
          width: image.width,
          height: image.height
        },
        format: 'png'
      };
      
      logger.info('Screenshot saved', { filepath, size: stats.size });
      
      // Clean up old screenshots
      await this.cleanupOldScreenshots();
      
      return metadata;
    } catch (error) {
      throw new FileSystemError(`Failed to save screenshot: ${error}`, filepath);
    }
  }

  /**
   * Load a screenshot from file
   */
  async loadScreenshot(filepath: string): Promise<Buffer> {
    try {
      return await fs.readFile(filepath);
    } catch (error) {
      throw new FileSystemError(`Failed to load screenshot: ${error}`, filepath);
    }
  }

  /**
   * Get metadata for a screenshot file
   */
  async getScreenshotMetadata(filepath: string): Promise<ScreenshotMetadata> {
    try {
      const stats = await fs.stat(filepath);
      const filename = basename(filepath);
      
      // Try to read image dimensions (simplified - would need proper image parsing)
      const metadata: ScreenshotMetadata = {
        filename,
        filepath,
        timestamp: stats.birthtime,
        size: stats.size,
        dimensions: { width: 0, height: 0 }, // Would need image parsing
        format: extname(filepath).slice(1) || 'png'
      };
      
      return metadata;
    } catch (error) {
      throw new FileSystemError(`Failed to get screenshot metadata: ${error}`, filepath);
    }
  }

  /**
   * List recent screenshots
   */
  async listRecentScreenshots(limit: number = 10): Promise<ScreenshotMetadata[]> {
    try {
      await this.ensureTempDir();
      
      const files = await fs.readdir(this.tempDir);
      const screenshotFiles = files.filter(file => 
        file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')
      );
      
      const screenshots: ScreenshotMetadata[] = [];
      
      for (const file of screenshotFiles) {
        try {
          const filepath = join(this.tempDir, file);
          const metadata = await this.getScreenshotMetadata(filepath);
          screenshots.push(metadata);
        } catch (error) {
          logger.warn(`Failed to get metadata for ${file}`, { error });
        }
      }
      
      // Sort by timestamp descending and limit
      return screenshots
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit);
    } catch (error) {
      throw new FileSystemError(`Failed to list screenshots: ${error}`, this.tempDir);
    }
  }

  /**
   * Extract text from a saved screenshot
   */
  async extractTextFromScreenshot(filepath: string): Promise<string> {
    try {
      // For now, we'll need to reconstruct an Image object
      // In a real implementation, we'd save the raw image data
      // or use a different OCR approach for files
      throw new OCRError('Text extraction from saved files not yet implemented');
    } catch (error) {
      throw new OCRError(`Failed to extract text from screenshot: ${error}`);
    }
  }

  /**
   * Analyze a screenshot comprehensively
   */
  async analyzeScreenshot(image: Image): Promise<ScreenshotAnalysis> {
    try {
      logger.startTimer('screenshot_analysis');
      
      // Save the screenshot
      const metadata = await this.saveScreenshot(image, 'analysis');
      
      // Extract text
      const extractedText = await extractTextFromImage(image);
      const textLocations = await getTextLocations(image);
      
      // Detect UI elements
      const detectedElements = await this.detectUIElements(textLocations);
      
      // Generate summary
      const summary = this.generateSummary(extractedText, detectedElements);
      
      // Update metadata with OCR info
      metadata.hasOCRData = true;
      metadata.textLength = extractedText.length;
      
      logger.endTimer('screenshot_analysis');
      
      return {
        metadata,
        extractedText,
        textLocations,
        detectedElements,
        summary
      };
    } catch (error) {
      logger.error('Screenshot analysis failed', error as Error);
      throw error;
    }
  }

  /**
   * Detect UI elements from text locations
   */
  private async detectUIElements(textLocations: TextLocation[]): Promise<UIElement[]> {
    const elements: UIElement[] = [];
    
    for (const location of textLocations) {
      const element = this.classifyUIElement(location);
      if (element) {
        elements.push(element);
      }
    }
    
    return elements;
  }

  /**
   * Classify a text location as a UI element
   */
  private classifyUIElement(location: TextLocation): UIElement | null {
    const text = location.text.toLowerCase().trim();
    
    if (!text) return null;
    
    let type: UIElement['type'] = 'other';
    let clickable = false;
    let description = '';
    
    // Button detection
    if (this.isButtonText(text)) {
      type = 'button';
      clickable = true;
      description = `Clickable button with text "${location.text}"`;
    }
    // Link detection
    else if (this.isLinkText(text)) {
      type = 'link';
      clickable = true;
      description = `Clickable link with text "${location.text}"`;
    }
    // Text field detection (harder to detect from OCR alone)
    else if (this.isTextFieldIndicator(text)) {
      type = 'text_field';
      clickable = true;
      description = `Text input field labeled "${location.text}"`;
    }
    // Dialog detection
    else if (this.isDialogText(text)) {
      type = 'dialog';
      clickable = false;
      description = `Dialog or modal with text "${location.text}"`;
    }
    // Menu detection
    else if (this.isMenuText(text)) {
      type = 'menu';
      clickable = true;
      description = `Menu item with text "${location.text}"`;
    }
    // Window title detection
    else if (this.isWindowTitle(location)) {
      type = 'window';
      clickable = false;
      description = `Window title: "${location.text}"`;
    }
    else {
      description = `Text element: "${location.text}"`;
    }
    
    return {
      type,
      text: location.text,
      x: location.x,
      y: location.y,
      width: location.width,
      height: location.height,
      confidence: location.confidence,
      clickable,
      description
    };
  }

  /**
   * Detect if text represents a button
   */
  private isButtonText(text: string): boolean {
    const buttonKeywords = ['ok', 'cancel', 'yes', 'no', 'apply', 'save', 'delete', 'close', 'open', 'submit', 'send', 'add', 'remove', 'edit', 'copy', 'paste', 'cut', 'undo', 'redo', 'refresh', 'reload', 'login', 'logout', 'sign in', 'sign up', 'register', 'continue', 'next', 'previous', 'back', 'forward', 'play', 'pause', 'stop', 'start', 'finish', 'done', 'create', 'new', 'browse', 'search', 'find', 'help', 'about', 'settings', 'preferences', 'options'];
    
    return buttonKeywords.some(keyword => text.includes(keyword)) ||
           text.match(/^[A-Z][a-z]+$/) !== null || // Single capitalized word
           text.match(/^\w+\s+\w+$/) !== null; // Two words (common for buttons)
  }

  /**
   * Detect if text represents a link
   */
  private isLinkText(text: string): boolean {
    return text.includes('http') || 
           text.includes('www.') ||
           text.includes('.com') ||
           text.includes('.org') ||
           text.includes('.edu') ||
           text.includes('click here') ||
           text.includes('learn more') ||
           text.includes('read more');
  }

  /**
   * Detect if text indicates a text field
   */
  private isTextFieldIndicator(text: string): boolean {
    const fieldKeywords = ['enter', 'type', 'search', 'email', 'password', 'username', 'name', 'address', 'phone', 'number', 'message', 'comment', 'description'];
    return fieldKeywords.some(keyword => text.includes(keyword));
  }

  /**
   * Detect if text represents dialog content
   */
  private isDialogText(text: string): boolean {
    return text.includes('error') ||
           text.includes('warning') ||
           text.includes('alert') ||
           text.includes('confirm') ||
           text.includes('are you sure') ||
           text.includes('do you want to') ||
           text.includes('failed') ||
           text.includes('success') ||
           text.includes('completed');
  }

  /**
   * Detect if text represents a menu item
   */
  private isMenuText(text: string): boolean {
    const menuKeywords = ['file', 'edit', 'view', 'tools', 'help', 'window', 'format', 'insert', 'options', 'preferences', 'settings'];
    return menuKeywords.some(keyword => text.includes(keyword)) ||
           text.match(/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/) !== null; // Title case patterns
  }

  /**
   * Detect if text represents a window title
   */
  private isWindowTitle(location: TextLocation): boolean {
    // Window titles are typically at the top and have certain characteristics
    return location.y < 100 && // Near the top
           location.width > 100 && // Reasonably wide
           location.text.length > 3 && // Not too short
           !this.isButtonText(location.text.toLowerCase());
  }

  /**
   * Generate a summary of the screenshot analysis
   */
  private generateSummary(extractedText: string, elements: UIElement[]): string {
    const summary: string[] = [];
    
    // Text summary
    if (extractedText.length > 0) {
      summary.push(`Screenshot contains ${extractedText.length} characters of text.`);
    } else {
      summary.push('Screenshot contains no detectable text.');
    }
    
    // Element summary
    const elementCounts = elements.reduce((counts, element) => {
      counts[element.type] = (counts[element.type] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);
    
    if (Object.keys(elementCounts).length > 0) {
      const elementSummary = Object.entries(elementCounts)
        .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
        .join(', ');
      summary.push(`Detected UI elements: ${elementSummary}.`);
    }
    
    // Clickable elements summary
    const clickableElements = elements.filter(e => e.clickable);
    if (clickableElements.length > 0) {
      summary.push(`${clickableElements.length} clickable elements found.`);
    }
    
    // Key content detection
    if (extractedText.toLowerCase().includes('error')) {
      summary.push('⚠️ Error messages detected.');
    }
    if (extractedText.toLowerCase().includes('warning')) {
      summary.push('⚠️ Warning messages detected.');
    }
    if (elements.some(e => e.type === 'dialog')) {
      summary.push('📋 Dialog boxes present.');
    }
    
    return summary.join(' ');
  }

  /**
   * Clean up old screenshots to maintain storage limits
   */
  private async cleanupOldScreenshots(): Promise<void> {
    try {
      const screenshots = await this.listRecentScreenshots(this.maxScreenshots + 10);
      
      if (screenshots.length > this.maxScreenshots) {
        const toDelete = screenshots.slice(this.maxScreenshots);
        
        for (const screenshot of toDelete) {
          try {
            await fs.unlink(screenshot.filepath);
            logger.debug('Deleted old screenshot', { filepath: screenshot.filepath });
          } catch (error) {
            logger.warn('Failed to delete old screenshot', { filepath: screenshot.filepath, error });
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to cleanup old screenshots', { error });
    }
  }

  /**
   * Compare two screenshots (basic implementation)
   */
  async compareScreenshots(filepath1: string, filepath2: string): Promise<{
    similarity: number;
    differences: string[];
    summary: string;
  }> {
    try {
      // This is a simplified comparison - would need proper image comparison
      const metadata1 = await this.getScreenshotMetadata(filepath1);
      const metadata2 = await this.getScreenshotMetadata(filepath2);
      
      const differences: string[] = [];
      
      if (metadata1.dimensions.width !== metadata2.dimensions.width || 
          metadata1.dimensions.height !== metadata2.dimensions.height) {
        differences.push('Different dimensions');
      }
      
      if (Math.abs(metadata1.size - metadata2.size) > metadata1.size * 0.1) {
        differences.push('Significantly different file sizes');
      }
      
      // Simple similarity based on file size similarity
      const sizeDiff = Math.abs(metadata1.size - metadata2.size);
      const maxSize = Math.max(metadata1.size, metadata2.size);
      const similarity = Math.max(0, 1 - (sizeDiff / maxSize));
      
      const summary = differences.length > 0 
        ? `Screenshots differ: ${differences.join(', ')}`
        : 'Screenshots appear similar';
      
      return { similarity, differences, summary };
    } catch (error) {
      throw new FileSystemError(`Failed to compare screenshots: ${error}`, filepath1);
    }
  }
}

// Export singleton instance
export const screenshotAnalyzer = new ScreenshotAnalyzer();