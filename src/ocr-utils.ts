import { createWorker, Worker } from 'tesseract.js';
import { Image, Region } from "@nut-tree-fork/nut-js";
import { imageToBase64 } from './image-utils.js';
import { logger } from './logger.js';
import { OCRError, TimeoutError } from './errors.js';
import { getOCRWorkerPool, initializeOCRWorkerPool, shutdownOCRWorkerPool, OCRTaskPriority } from './core/ocr-worker-pool.js';

// Legacy single worker for backward compatibility
let legacyWorker: Worker | null = null;
let useWorkerPool = true;
let isInitialized = false;

/**
 * Initialize OCR with worker pool (recommended) or legacy single worker
 */
export async function initializeOCR(useLegacy = false): Promise<void> {
  // Don't reinitialize if already initialized unless explicitly forced
  if (isInitialized) {
    return;
  }
  
  useWorkerPool = !useLegacy;
  
  if (useWorkerPool) {
    try {
      await initializeOCRWorkerPool();
      logger.info('OCR initialized with worker pool');
    } catch (error) {
      logger.warn('Failed to initialize worker pool, falling back to legacy worker', error as Error);
      useWorkerPool = false;
      await initializeLegacyWorker();
    }
  } else {
    await initializeLegacyWorker();
  }
  
  isInitialized = true;
}

/**
 * Initialize legacy single worker
 */
async function initializeLegacyWorker(): Promise<void> {
  if (!legacyWorker) {
    legacyWorker = await createWorker('eng');
    logger.info('OCR initialized with legacy single worker');
  }
}

/**
 * Terminate OCR resources
 */
export async function terminateOCR(): Promise<void> {
  if (useWorkerPool) {
    await shutdownOCRWorkerPool();
  } else if (legacyWorker) {
    await legacyWorker.terminate();
    legacyWorker = null;
  }
  isInitialized = false;
}

export async function extractTextFromImage(image: Image, region?: Region, priority = OCRTaskPriority.NORMAL): Promise<string> {
  try {
    await initializeOCR();
    
    logger.debug('Converting image to base64 for OCR...');
    const base64 = await imageToBase64(image);
    
    if (!base64) {
      throw new OCRError('Failed to convert image to base64');
    }
    
    logger.debug('Performing OCR text extraction...');
    
    let result: any;
    if (useWorkerPool) {
      // Use worker pool for concurrent OCR operations
      const workerPool = getOCRWorkerPool();
      result = await workerPool.recognize(base64, priority, 30000);
    } else {
      // Legacy single worker implementation
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new TimeoutError('OCR text extraction', 30000));
        }, 30000);
      });
      
      result = await Promise.race([
        legacyWorker!.recognize(base64),
        timeoutPromise
      ]);
    }
    
    const text = result.data.text;
    logger.debug('OCR text extraction completed', { textLength: text.length });
    
    return text.trim();
  } catch (error) {
    if (error instanceof TimeoutError || error instanceof OCRError) {
      throw error;
    }
    throw new OCRError(`Text extraction failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function findTextInImage(image: Image, searchText: string, priority = OCRTaskPriority.NORMAL): Promise<boolean> {
  try {
    logger.debug('Searching for text in image', { searchText });
    const extractedText = await extractTextFromImage(image, undefined, priority);
    const found = extractedText.toLowerCase().includes(searchText.toLowerCase());
    logger.debug('Text search completed', { searchText, found });
    return found;
  } catch (error) {
    logger.error('Error during text search', error as Error, { searchText });
    return false;
  }
}

export interface TextLocation {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export async function getTextLocations(image: Image, region?: Region, priority = OCRTaskPriority.NORMAL): Promise<TextLocation[]> {
  try {
    await initializeOCR();
    
    logger.debug('Converting image for text location detection...');
    const base64 = await imageToBase64(image);
    
    if (!base64) {
      throw new OCRError('Failed to convert image to base64');
    }
    
    logger.debug('Detecting text locations...');
    
    let result: any;
    if (useWorkerPool) {
      // Use worker pool for concurrent OCR operations
      const workerPool = getOCRWorkerPool();
      result = await workerPool.recognize(base64, priority, 30000);
    } else {
      // Legacy single worker implementation
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new TimeoutError('OCR text location detection', 30000));
        }, 30000);
      });
      
      result = await Promise.race([
        legacyWorker!.recognize(base64),
        timeoutPromise
      ]);
    }
    
    const data = result.data;
    const locations: TextLocation[] = [];
    
    if ('words' in data && Array.isArray(data.words)) {
      for (const word of data.words as any[]) {
        if (word.confidence > 50) {
          locations.push({
            text: word.text,
            x: word.bbox.x0,
            y: word.bbox.y0,
            width: word.bbox.x1 - word.bbox.x0,
            height: word.bbox.y1 - word.bbox.y0,
            confidence: word.confidence,
          });
        }
      }
    }
    
    logger.debug('Text location detection completed', { locationsFound: locations.length });
    
    return locations;
  } catch (error) {
    if (error instanceof TimeoutError || error instanceof OCRError) {
      throw error;
    }
    throw new OCRError(`Failed to get text locations: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get OCR worker pool metrics (only available when using worker pool)
 */
export function getOCRMetrics() {
  if (!useWorkerPool) {
    return null;
  }
  
  const workerPool = getOCRWorkerPool();
  return workerPool.getMetrics();
}

/**
 * Get detailed worker states (only available when using worker pool)
 */
export function getOCRWorkerStates() {
  if (!useWorkerPool) {
    return null;
  }
  
  const workerPool = getOCRWorkerPool();
  return workerPool.getWorkerStates();
}

/**
 * Check if OCR is using worker pool
 */
export function isUsingWorkerPool(): boolean {
  return useWorkerPool;
}

/**
 * Extract text from multiple images concurrently using worker pool
 * Falls back to sequential processing if using legacy worker
 */
export async function extractTextFromImages(
  images: Image[], 
  priority = OCRTaskPriority.NORMAL
): Promise<string[]> {
  if (!useWorkerPool) {
    // Sequential processing for legacy worker
    const results: string[] = [];
    for (const image of images) {
      const text = await extractTextFromImage(image, undefined, priority);
      results.push(text);
    }
    return results;
  }

  // Concurrent processing with worker pool
  const promises = images.map(image => extractTextFromImage(image, undefined, priority));
  return Promise.all(promises);
}

/**
 * Get text locations from multiple images concurrently using worker pool
 * Falls back to sequential processing if using legacy worker
 */
export async function getTextLocationsFromImages(
  images: Image[],
  priority = OCRTaskPriority.NORMAL
): Promise<TextLocation[][]> {
  if (!useWorkerPool) {
    // Sequential processing for legacy worker
    const results: TextLocation[][] = [];
    for (const image of images) {
      const locations = await getTextLocations(image, undefined, priority);
      results.push(locations);
    }
    return results;
  }

  // Concurrent processing with worker pool
  const promises = images.map(image => getTextLocations(image, undefined, priority));
  return Promise.all(promises);
}

// Re-export worker pool types and enums for convenience
export { OCRTaskPriority, type OCRWorkerPoolConfig, type PoolMetrics, type WorkerState } from './core/ocr-worker-pool.js';