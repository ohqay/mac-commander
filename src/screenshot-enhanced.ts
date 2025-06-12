import { Image, Region, screen } from "@nut-tree-fork/nut-js";
import { imageToBase64, saveImage } from "./image-utils.js";
import sharp from 'sharp';
import { createCanvas, Canvas, CanvasRenderingContext2D } from 'canvas';
import { performanceMonitor } from "./performance-monitor.js";

export interface ScreenshotOptions {
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number; // For JPEG and WebP (0-100)
  region?: Region;
  monitorId?: number;
}

export interface ScreenshotComparison {
  identical: boolean;
  similarity: number; // 0-1
  differences: {
    pixels: number;
    percentage: number;
    regions: Region[];
  };
  diffImage?: string; // Base64 encoded diff image
}

export interface Annotation {
  type: 'rectangle' | 'arrow' | 'text' | 'circle';
  color?: string;
  lineWidth?: number;
  fontSize?: number;
  text?: string;
  points?: { x: number; y: number }[];
}

export class EnhancedScreenshot {
  private screenshotHistory: Map<string, { timestamp: number; base64: string }> = new Map();
  private maxHistorySize: number = 50;
  private historyTTL: number = 300000; // 5 minutes

  /**
   * Take a screenshot with enhanced options
   */
  async capture(options: ScreenshotOptions = {}): Promise<string> {
    const operationId = `screenshot_capture_${Date.now()}`;
    performanceMonitor.startOperation(operationId);

    try {
      let screenshot: Image;
      
      // Handle monitor-specific capture
      if (options.monitorId !== undefined) {
        const { multiMonitorManager } = await import('./multi-monitor.js');
        const monitor = await multiMonitorManager.getMonitor(options.monitorId);
        
        if (!monitor) {
          throw new Error(`Monitor ${options.monitorId} not found`);
        }
        
        const region = new Region(
          monitor.bounds.x,
          monitor.bounds.y,
          monitor.bounds.width,
          monitor.bounds.height
        );
        
        screenshot = await screen.grabRegion(region);
      } else if (options.region) {
        screenshot = await screen.grabRegion(options.region);
      } else {
        screenshot = await screen.grab();
      }

      // Convert to base64
      let base64 = await imageToBase64(screenshot);
      
      // Convert format if needed
      if (options.format && options.format !== 'png') {
        base64 = await this.convertFormat(base64, options.format, options.quality);
      }

      // Add to history
      this.addToHistory(base64);

      performanceMonitor.endOperation(operationId, {
        format: options.format || 'png',
        hasRegion: !!options.region,
        monitorId: options.monitorId
      });

      return base64;
    } catch (error) {
      performanceMonitor.endOperation(operationId, {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Compare two screenshots
   */
  async compare(screenshot1: string, screenshot2: string, threshold: number = 0.1): Promise<ScreenshotComparison> {
    const operationId = `screenshot_compare_${Date.now()}`;
    performanceMonitor.startOperation(operationId);

    try {
      // Convert base64 to buffers
      const buffer1 = Buffer.from(screenshot1.split(',')[1], 'base64');
      const buffer2 = Buffer.from(screenshot2.split(',')[1], 'base64');

      // Get image metadata
      const meta1 = await sharp(buffer1).metadata();
      const meta2 = await sharp(buffer2).metadata();

      if (meta1.width !== meta2.width || meta1.height !== meta2.height) {
        performanceMonitor.endOperation(operationId, { identical: false, reason: 'size_mismatch' });
        
        return {
          identical: false,
          similarity: 0,
          differences: {
            pixels: meta1.width! * meta1.height!,
            percentage: 100,
            regions: []
          }
        };
      }

      // Get raw pixel data
      const raw1 = await sharp(buffer1).raw().toBuffer();
      const raw2 = await sharp(buffer2).raw().toBuffer();

      // Compare pixels
      let diffPixels = 0;
      const diffRegions: Region[] = [];
      const width = meta1.width!;
      const height = meta1.height!;
      const channels = meta1.channels || 3;

      // Create diff image
      const diffCanvas = createCanvas(width, height);
      const ctx = diffCanvas.getContext('2d');
      const imageData = ctx.createImageData(width, height);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * channels;
          const imgIdx = (y * width + x) * 4;

          let diff = 0;
          for (let c = 0; c < Math.min(channels, 3); c++) {
            diff += Math.abs(raw1[idx + c] - raw2[idx + c]);
          }
          
          const normalized = diff / (255 * 3);
          
          if (normalized > threshold) {
            diffPixels++;
            // Highlight differences in red
            imageData.data[imgIdx] = 255;
            imageData.data[imgIdx + 1] = 0;
            imageData.data[imgIdx + 2] = 0;
            imageData.data[imgIdx + 3] = 255;
          } else {
            // Show original image in grayscale
            const gray = raw1[idx];
            imageData.data[imgIdx] = gray;
            imageData.data[imgIdx + 1] = gray;
            imageData.data[imgIdx + 2] = gray;
            imageData.data[imgIdx + 3] = 128;
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
      const diffBase64 = diffCanvas.toDataURL('image/png');

      const totalPixels = width * height;
      const diffPercentage = (diffPixels / totalPixels) * 100;
      const similarity = 1 - (diffPixels / totalPixels);

      performanceMonitor.endOperation(operationId, {
        identical: diffPixels === 0,
        similarity,
        diffPercentage
      });

      return {
        identical: diffPixels === 0,
        similarity,
        differences: {
          pixels: diffPixels,
          percentage: diffPercentage,
          regions: this.findDifferenceRegions(imageData, width, height)
        },
        diffImage: diffBase64
      };
    } catch (error) {
      performanceMonitor.endOperation(operationId, {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Annotate a screenshot
   */
  async annotate(screenshot: string, annotations: Annotation[]): Promise<string> {
    const operationId = `screenshot_annotate_${Date.now()}`;
    performanceMonitor.startOperation(operationId);

    try {
      // Convert base64 to buffer
      const buffer = Buffer.from(screenshot.split(',')[1], 'base64');
      const meta = await sharp(buffer).metadata();
      
      // Create canvas
      const canvas = createCanvas(meta.width!, meta.height!);
      const ctx = canvas.getContext('2d');
      
      // Draw original image
      const img = await sharp(buffer).png().toBuffer();
      const imgData = await sharp(img).raw().toBuffer();
      
      const imageData = ctx.createImageData(meta.width!, meta.height!);
      for (let i = 0; i < imgData.length; i++) {
        imageData.data[i] = imgData[i];
      }
      ctx.putImageData(imageData, 0, 0);

      // Apply annotations
      for (const annotation of annotations) {
        ctx.strokeStyle = annotation.color || '#FF0000';
        ctx.lineWidth = annotation.lineWidth || 2;
        ctx.fillStyle = annotation.color || '#FF0000';

        switch (annotation.type) {
          case 'rectangle':
            if (annotation.points && annotation.points.length >= 2) {
              const [p1, p2] = annotation.points;
              const width = p2.x - p1.x;
              const height = p2.y - p1.y;
              ctx.strokeRect(p1.x, p1.y, width, height);
            }
            break;

          case 'circle':
            if (annotation.points && annotation.points.length >= 2) {
              const [center, edge] = annotation.points;
              const radius = Math.sqrt(
                Math.pow(edge.x - center.x, 2) + 
                Math.pow(edge.y - center.y, 2)
              );
              ctx.beginPath();
              ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
              ctx.stroke();
            }
            break;

          case 'arrow':
            if (annotation.points && annotation.points.length >= 2) {
              const [start, end] = annotation.points;
              this.drawArrow(ctx, start.x, start.y, end.x, end.y);
            }
            break;

          case 'text':
            if (annotation.text && annotation.points && annotation.points.length > 0) {
              ctx.font = `${annotation.fontSize || 16}px Arial`;
              ctx.fillText(annotation.text, annotation.points[0].x, annotation.points[0].y);
            }
            break;
        }
      }

      const annotatedBase64 = canvas.toDataURL('image/png');
      
      performanceMonitor.endOperation(operationId, {
        annotationCount: annotations.length
      });

      return annotatedBase64;
    } catch (error) {
      performanceMonitor.endOperation(operationId, {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Draw an arrow
   */
  private drawArrow(
    ctx: CanvasRenderingContext2D, 
    fromX: number, 
    fromY: number, 
    toX: number, 
    toY: number
  ): void {
    const headLength = 10;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    // Draw line
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    // Draw arrowhead
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle - Math.PI / 6),
      toY - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle + Math.PI / 6),
      toY - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.stroke();
  }

  /**
   * Find regions of differences
   */
  private findDifferenceRegions(imageData: ImageData, width: number, height: number): Region[] {
    const regions: Region[] = [];
    const visited = new Set<string>();

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const key = `${x},${y}`;

        // Check if this pixel is a difference (red) and not visited
        if (imageData.data[idx] === 255 && 
            imageData.data[idx + 1] === 0 && 
            !visited.has(key)) {
          
          // Find connected region
          const region = this.floodFill(imageData, width, height, x, y, visited);
          if (region.width > 5 && region.height > 5) { // Ignore tiny regions
            regions.push(region);
          }
        }
      }
    }

    return regions;
  }

  /**
   * Flood fill to find connected difference region
   */
  private floodFill(
    imageData: ImageData, 
    width: number, 
    height: number, 
    startX: number, 
    startY: number,
    visited: Set<string>
  ): Region {
    const stack: [number, number][] = [[startX, startY]];
    let minX = startX, maxX = startX;
    let minY = startY, maxY = startY;

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const key = `${x},${y}`;

      if (visited.has(key)) continue;
      visited.add(key);

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      // Check neighbors
      const neighbors = [
        [x - 1, y], [x + 1, y],
        [x, y - 1], [x, y + 1]
      ];

      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const idx = (ny * width + nx) * 4;
          if (imageData.data[idx] === 255 && imageData.data[idx + 1] === 0) {
            stack.push([nx, ny]);
          }
        }
      }
    }

    return new Region(minX, minY, maxX - minX + 1, maxY - minY + 1);
  }

  /**
   * Convert image format
   */
  private async convertFormat(base64: string, format: 'jpeg' | 'webp', quality?: number): Promise<string> {
    const buffer = Buffer.from(base64.split(',')[1], 'base64');
    
    let converter = sharp(buffer);
    
    if (format === 'jpeg') {
      converter = converter.jpeg({ quality: quality || 85 });
    } else if (format === 'webp') {
      converter = converter.webp({ quality: quality || 85 });
    }
    
    const convertedBuffer = await converter.toBuffer();
    return `data:image/${format};base64,${convertedBuffer.toString('base64')}`;
  }

  /**
   * Add screenshot to history
   */
  private addToHistory(base64: string): void {
    const key = `screenshot_${Date.now()}`;
    this.screenshotHistory.set(key, {
      timestamp: Date.now(),
      base64
    });

    // Clean up old entries
    this.pruneHistory();
  }

  /**
   * Get screenshot from history
   */
  getFromHistory(index: number = 0): string | null {
    const entries = Array.from(this.screenshotHistory.values())
      .sort((a, b) => b.timestamp - a.timestamp);
    
    if (index < entries.length) {
      return entries[index].base64;
    }
    
    return null;
  }

  /**
   * Clean up old history entries
   */
  private pruneHistory(): void {
    const now = Date.now();
    const entries = Array.from(this.screenshotHistory.entries());
    
    // Remove expired entries
    for (const [key, value] of entries) {
      if (now - value.timestamp > this.historyTTL) {
        this.screenshotHistory.delete(key);
      }
    }
    
    // Keep only the most recent entries if over limit
    if (this.screenshotHistory.size > this.maxHistorySize) {
      const sorted = entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      const toDelete = sorted.slice(this.maxHistorySize);
      
      for (const [key] of toDelete) {
        this.screenshotHistory.delete(key);
      }
    }
  }

  /**
   * Clear screenshot history
   */
  clearHistory(): void {
    this.screenshotHistory.clear();
  }
}

// Singleton instance
export const enhancedScreenshot = new EnhancedScreenshot();