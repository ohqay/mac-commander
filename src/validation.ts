import { z } from 'zod';
import { screen } from '@nut-tree-fork/nut-js';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { ValidationError, CoordinateOutOfBoundsError } from './errors.js';
import { logger } from './logger.js';

/**
 * Cache for screen dimensions to avoid repeated queries
 */
let screenDimensionsCache: { width: number; height: number } | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION_MS = 60000; // 1 minute

/**
 * Get current screen dimensions with caching
 */
export async function getScreenDimensions(): Promise<{ width: number; height: number }> {
  const now = Date.now();
  
  if (!screenDimensionsCache || now - cacheTimestamp > CACHE_DURATION_MS) {
    logger.debug('Fetching screen dimensions');
    const width = await screen.width();
    const height = await screen.height();
    screenDimensionsCache = { width, height };
    cacheTimestamp = now;
  }
  
  return screenDimensionsCache;
}

/**
 * Validate that coordinates are within screen bounds
 */
export async function validateCoordinates(x: number, y: number): Promise<void> {
  const { width, height } = await getScreenDimensions();
  
  if (x < 0 || x >= width || y < 0 || y >= height) {
    throw new CoordinateOutOfBoundsError(x, y, width, height);
  }
}

/**
 * Validate that a region is within screen bounds
 */
export async function validateRegion(region: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<void> {
  const screen = await getScreenDimensions();
  
  if (region.x < 0 || region.y < 0) {
    throw new ValidationError(
      'Region coordinates must be non-negative',
      'region',
      { region, screen }
    );
  }
  
  if (region.width <= 0 || region.height <= 0) {
    throw new ValidationError(
      'Region dimensions must be positive',
      'region',
      { region, screen }
    );
  }
  
  if (region.x + region.width > screen.width || region.y + region.height > screen.height) {
    throw new ValidationError(
      'Region extends beyond screen boundaries',
      'region',
      { region, screen }
    );
  }
}

/**
 * Validate that a file path is valid and the parent directory exists
 */
export function validateFilePath(path: string, mustExist: boolean = false): void {
  if (!path || path.trim() === '') {
    throw new ValidationError('File path cannot be empty', 'path');
  }
  
  if (mustExist && !existsSync(path)) {
    throw new ValidationError(`File does not exist: ${path}`, 'path');
  }
  
  const dir = dirname(path);
  if (!existsSync(dir)) {
    throw new ValidationError(`Parent directory does not exist: ${dir}`, 'path');
  }
}

/**
 * Create enhanced Zod schemas with better error messages
 */
export const EnhancedScreenshotToolSchema = z.object({
  outputPath: z.string()
    .optional()
    .refine((path) => {
      if (!path) return true;
      try {
        validateFilePath(path);
        return true;
      } catch {
        return false;
      }
    }, 'Invalid output path - parent directory must exist'),
  region: z.object({
    x: z.number().int().min(0, 'X coordinate must be non-negative'),
    y: z.number().int().min(0, 'Y coordinate must be non-negative'),
    width: z.number().int().positive('Width must be positive'),
    height: z.number().int().positive('Height must be positive'),
  }).optional(),
});

export const EnhancedClickToolSchema = z.object({
  x: z.number().int().min(0, 'X coordinate must be non-negative'),
  y: z.number().int().min(0, 'Y coordinate must be non-negative'),
  button: z.enum(['left', 'right', 'middle']).default('left'),
  doubleClick: z.boolean().default(false),
});

export const EnhancedTypeTextToolSchema = z.object({
  text: z.string().min(1, 'Text cannot be empty').max(10000, 'Text is too long'),
  delay: z.number()
    .int()
    .min(0, 'Delay must be non-negative')
    .max(1000, 'Delay cannot exceed 1000ms')
    .optional()
    .default(50),
});

export const EnhancedWaitToolSchema = z.object({
  milliseconds: z.number()
    .int()
    .positive('Wait time must be positive')
    .max(300000, 'Wait time cannot exceed 5 minutes'),
});

export const EnhancedKeyPressToolSchema = z.object({
  key: z.string()
    .min(1, 'Key cannot be empty')
    .refine((key) => {
      // Validate key format
      const validModifiers = ['cmd', 'command', 'ctrl', 'control', 'alt', 'option', 'shift'];
      const validKeys = [
        'enter', 'return', 'escape', 'esc', 'tab', 'space', 'delete', 
        'backspace', 'up', 'down', 'left', 'right'
      ];
      
      const parts = key.toLowerCase().split('+').map(k => k.trim());
      
      // Check each part
      for (const part of parts) {
        const isModifier = validModifiers.includes(part);
        const isSpecialKey = validKeys.includes(part);
        const isSingleChar = part.length === 1;
        
        if (!isModifier && !isSpecialKey && !isSingleChar) {
          return false;
        }
      }
      
      return true;
    }, 'Invalid key combination. Use format like "cmd+a" or "Enter"'),
});

/**
 * Validate all tool inputs with enhanced error messages
 */
export async function validateToolInput(
  toolName: string,
  input: any
): Promise<{ valid: boolean; error?: string; parsedInput?: any }> {
  try {
    let parsedInput: any;
    
    switch (toolName) {
      case 'screenshot':
        parsedInput = EnhancedScreenshotToolSchema.parse(input);
        if (parsedInput.region) {
          await validateRegion(parsedInput.region);
        }
        break;
        
      case 'click':
        parsedInput = EnhancedClickToolSchema.parse(input);
        await validateCoordinates(parsedInput.x, parsedInput.y);
        break;
        
      case 'mouse_move':
        parsedInput = z.object({
          x: z.number().int().min(0),
          y: z.number().int().min(0),
          smooth: z.boolean().default(true),
        }).parse(input);
        await validateCoordinates(parsedInput.x, parsedInput.y);
        break;
        
      case 'type_text':
        parsedInput = EnhancedTypeTextToolSchema.parse(input);
        break;
        
      case 'wait':
        parsedInput = EnhancedWaitToolSchema.parse(input);
        break;
        
      case 'key_press':
        parsedInput = EnhancedKeyPressToolSchema.parse(input);
        break;
        
      case 'extract_text':
      case 'find_text':
      case 'check_for_errors':
        if (input.region) {
          await validateRegion(input.region);
        }
        parsedInput = input;
        break;
        
      default:
        parsedInput = input;
    }
    
    return { valid: true, parsedInput };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return { valid: false, error: messages.join('; ') };
    }
    
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Clear the screen dimensions cache (useful for testing or when display configuration changes)
 */
export function clearScreenDimensionsCache(): void {
  screenDimensionsCache = null;
  logger.debug('Screen dimensions cache cleared');
}