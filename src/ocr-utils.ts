import { createWorker, Worker } from 'tesseract.js';
import { Image } from "@nut-tree-fork/nut-js";
import { imageToBase64 } from './image-utils.js';

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

export async function extractTextFromImage(image: Image): Promise<string> {
  try {
    await initializeOCR();
    
    // Convert image to base64 for tesseract
    const base64 = await imageToBase64(image);
    
    // Extract text
    const { data: { text } } = await worker!.recognize(base64);
    
    return text.trim();
  } catch (error) {
    throw new Error(`OCR failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function findTextInImage(image: Image, searchText: string): Promise<boolean> {
  try {
    const extractedText = await extractTextFromImage(image);
    return extractedText.toLowerCase().includes(searchText.toLowerCase());
  } catch (error) {
    console.error('Error during text search:', error);
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

export async function getTextLocations(image: Image): Promise<TextLocation[]> {
  try {
    await initializeOCR();
    
    // Convert image to base64 for tesseract
    const base64 = await imageToBase64(image);
    
    // Get detailed results with bounding boxes
    const { data } = await worker!.recognize(base64);
    
    const locations: TextLocation[] = [];
    
    // Check if words exist in the data structure
    if ('words' in data && Array.isArray(data.words)) {
      for (const word of data.words as any[]) {
        if (word.confidence > 50) { // Only include words with reasonable confidence
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
    
    return locations;
  } catch (error) {
    throw new Error(`Failed to get text locations: ${error instanceof Error ? error.message : String(error)}`);
  }
}