import { createWorker, Worker } from 'tesseract.js';
import { Image, Region } from "@nut-tree-fork/nut-js";
import { imageToBase64 } from './image-utils.js';
import { logger } from './logger.js';
import { OCRError, TimeoutError } from './errors.js';

let worker: Worker | null = null;

export async function initializeOCR(): Promise<void> {
  if (!worker) {
    worker = await createWorker('eng');
  }
}

export async function terminateOCR(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}

export async function extractTextFromImage(image: Image, region?: Region): Promise<string> {
  try {
    await initializeOCR();
    
    logger.debug('Converting image to base64 for OCR...');
    const base64 = await imageToBase64(image);
    
    if (!base64) {
      throw new OCRError('Failed to convert image to base64');
    }
    
    logger.debug('Performing OCR text extraction...');
    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError('OCR text extraction', 30000));
      }, 30000);
    });
    
    // Race between OCR and timeout
    const { data: { text } } = await Promise.race([
      worker!.recognize(base64),
      timeoutPromise
    ]);
    
    logger.debug('OCR text extraction completed', { textLength: text.length });
    
    return text.trim();
  } catch (error) {
    if (error instanceof TimeoutError || error instanceof OCRError) {
      throw error;
    }
    throw new OCRError(`Text extraction failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function findTextInImage(image: Image, searchText: string): Promise<boolean> {
  try {
    logger.debug('Searching for text in image', { searchText });
    const extractedText = await extractTextFromImage(image);
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

export async function getTextLocations(image: Image, region?: Region): Promise<TextLocation[]> {
  try {
    await initializeOCR();
    
    logger.debug('Converting image for text location detection...');
    const base64 = await imageToBase64(image);
    
    if (!base64) {
      throw new OCRError('Failed to convert image to base64');
    }
    
    logger.debug('Detecting text locations...');
    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError('OCR text location detection', 30000));
      }, 30000);
    });
    
    // Race between OCR and timeout
    const { data } = await Promise.race([
      worker!.recognize(base64),
      timeoutPromise
    ]);
    
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