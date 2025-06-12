import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { logger } from './logger.js';

// Screenshot temporary folder management
export const TEMP_SCREENSHOTS_FOLDER = join(tmpdir(), 'mcp-screenshots');
let screenshotCounter = 0;

/**
 * Initialize temp folder for screenshots
 */
export async function initTempFolder(): Promise<void> {
  try {
    await fs.mkdir(TEMP_SCREENSHOTS_FOLDER, { recursive: true });
    logger.info(`Screenshot temp folder initialized: ${TEMP_SCREENSHOTS_FOLDER}`);
  } catch (error) {
    logger.error('Failed to initialize temp folder', error as Error);
  }
}

/**
 * Generate timestamp-based filename for screenshots
 */
export function generateScreenshotFilename(prefix: string = 'screenshot'): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5); // Remove milliseconds and 'Z'
  screenshotCounter++;
  return `${prefix}-${timestamp}-${screenshotCounter.toString().padStart(3, '0')}.png`;
}

/**
 * Clean up old screenshots (keep last N screenshots)
 */
export async function cleanupOldScreenshots(keepLast: number = 20): Promise<void> {
  try {
    const files = await fs.readdir(TEMP_SCREENSHOTS_FOLDER);
    const screenshots = files
      .filter(f => f.endsWith('.png'))
      .map(f => ({ name: f, path: join(TEMP_SCREENSHOTS_FOLDER, f) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    
    if (screenshots.length > keepLast) {
      const toDelete = screenshots.slice(0, screenshots.length - keepLast);
      for (const file of toDelete) {
        await fs.unlink(file.path);
        logger.debug(`Cleaned up old screenshot: ${file.name}`);
      }
    }
  } catch (error) {
    logger.warn('Failed to cleanup old screenshots', error as Error);
  }
}

/**
 * Get the full path for a screenshot filename
 */
export function getScreenshotPath(filename: string): string {
  return join(TEMP_SCREENSHOTS_FOLDER, filename);
}

/**
 * Check if a screenshot exists
 */
export async function screenshotExists(filename: string): Promise<boolean> {
  try {
    await fs.access(getScreenshotPath(filename));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of all screenshots in temp folder
 */
export async function getAllScreenshots(): Promise<string[]> {
  try {
    const files = await fs.readdir(TEMP_SCREENSHOTS_FOLDER);
    return files.filter(f => f.endsWith('.png')).sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}