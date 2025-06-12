import { createHash } from 'crypto';
import { Image, Region } from "@nut-tree-fork/nut-js";
import { imageToBase64 } from './image-utils.js';

export interface OCRCacheEntry {
  text: string;
  locations: TextLocation[];
  timestamp: number;
  confidence: number;
  preprocessingOptions?: PreprocessingOptions;
}

export interface TextLocation {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface PreprocessingOptions {
  contrast?: boolean;
  sharpen?: boolean;
  denoise?: boolean;
  threshold?: number;
}

export class OCRCache {
  private cache: Map<string, OCRCacheEntry>;
  private maxSize: number;
  private ttlMs: number;
  private hitCount: number = 0;
  private missCount: number = 0;

  constructor(maxSize: number = 100, ttlMs: number = 60000) { // Default: 100 entries, 1 minute TTL
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Generate a unique cache key based on image content and region
   */
  private async generateKey(image: Image, region?: Region, preprocessingOptions?: PreprocessingOptions): Promise<string> {
    const base64 = await imageToBase64(image);
    const hash = createHash('sha256');
    
    // Include region in hash if specified
    const regionStr = region ? `${region.left}-${region.top}-${region.width}-${region.height}` : 'full';
    const preprocessStr = preprocessingOptions ? JSON.stringify(preprocessingOptions) : 'none';
    
    hash.update(base64);
    hash.update(regionStr);
    hash.update(preprocessStr);
    
    return hash.digest('hex');
  }

  /**
   * Get OCR result from cache if available and not expired
   */
  async get(image: Image, region?: Region, preprocessingOptions?: PreprocessingOptions): Promise<OCRCacheEntry | null> {
    const key = await this.generateKey(image, region, preprocessingOptions);
    const entry = this.cache.get(key);

    if (!entry) {
      this.missCount++;
      return null;
    }

    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.missCount++;
      return null;
    }

    this.hitCount++;
    return entry;
  }

  /**
   * Store OCR result in cache
   */
  async set(
    image: Image, 
    text: string, 
    locations: TextLocation[], 
    confidence: number,
    region?: Region,
    preprocessingOptions?: PreprocessingOptions
  ): Promise<void> {
    const key = await this.generateKey(image, region, preprocessingOptions);

    // Implement LRU eviction if cache is full
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      text,
      locations,
      timestamp: Date.now(),
      confidence,
      preprocessingOptions
    });
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  /**
   * Remove expired entries from cache
   */
  pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    hitCount: number;
    missCount: number;
    hitRate: number;
  } {
    const total = this.hitCount + this.missCount;
    return {
      size: this.cache.size,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: total > 0 ? this.hitCount / total : 0
    };
  }

  /**
   * Get cache configuration
   */
  getConfig(): {
    maxSize: number;
    ttlMs: number;
  } {
    return {
      maxSize: this.maxSize,
      ttlMs: this.ttlMs
    };
  }

  /**
   * Update cache configuration
   */
  updateConfig(config: { maxSize?: number; ttlMs?: number }): void {
    if (config.maxSize !== undefined) {
      this.maxSize = config.maxSize;
      // Evict entries if new size is smaller
      while (this.cache.size > this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) {
          this.cache.delete(firstKey);
        } else {
          break;
        }
      }
    }
    if (config.ttlMs !== undefined) {
      this.ttlMs = config.ttlMs;
    }
  }
}

// Singleton instance
export const ocrCache = new OCRCache();