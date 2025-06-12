import { createHash } from 'crypto';
import { logger } from '../logger.js';
import { CacheManager, TimedCache } from './types.js';

/**
 * Implementation of a time-based cache with TTL support
 */
class TimedCacheImpl<T> implements TimedCache<T> {
  private cache: Map<string, { value: T; expiry: number }> = new Map();
  private cleanupInterval: NodeJS.Timeout;
  
  constructor(
    private defaultTTL: number = 5000,
    cleanupIntervalMs: number = 30000
  ) {
    // Periodic cleanup of expired entries
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);
  }
  
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }
    
    return entry.value;
  }
  
  set(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTTL;
    this.cache.set(key, {
      value,
      expiry: Date.now() + ttl
    });
  }
  
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
  
  delete(key: string): void {
    this.cache.delete(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }
  
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.clear();
  }
}

/**
 * Centralized cache manager for all caching needs
 */
export class CacheManagerImpl implements CacheManager {
  private static instance: CacheManagerImpl;
  
  private screenshotCache: TimedCacheImpl<any>;
  private ocrCache: TimedCacheImpl<any>;
  private windowCache: TimedCacheImpl<any>;
  private permissionCache: TimedCacheImpl<any>;
  
  private constructor() {
    // Different TTLs for different types of data
    this.screenshotCache = new TimedCacheImpl(5000); // 5 seconds
    this.ocrCache = new TimedCacheImpl(30000); // 30 seconds
    this.windowCache = new TimedCacheImpl(2000); // 2 seconds
    this.permissionCache = new TimedCacheImpl(300000); // 5 minutes
    
    logger.debug('CacheManager initialized with TTL-based caches');
  }
  
  static getInstance(): CacheManagerImpl {
    if (!CacheManagerImpl.instance) {
      CacheManagerImpl.instance = new CacheManagerImpl();
    }
    return CacheManagerImpl.instance;
  }
  
  getScreenshotCache(): TimedCache<any> {
    return this.screenshotCache;
  }
  
  getOCRCache(): TimedCache<any> {
    return this.ocrCache;
  }
  
  getWindowCache(): TimedCache<any> {
    return this.windowCache;
  }
  
  getPermissionCache(): TimedCache<any> {
    return this.permissionCache;
  }
  
  invalidate(pattern?: string): void {
    if (!pattern) {
      // Clear all caches
      this.screenshotCache.clear();
      this.ocrCache.clear();
      this.windowCache.clear();
      this.permissionCache.clear();
      logger.debug('All caches cleared');
    } else {
      // Pattern-based invalidation would require storing keys
      // For now, just clear the specific cache type
      switch (pattern) {
        case 'screenshot':
          this.screenshotCache.clear();
          break;
        case 'ocr':
          this.ocrCache.clear();
          break;
        case 'window':
          this.windowCache.clear();
          break;
        case 'permission':
          this.permissionCache.clear();
          break;
      }
      logger.debug(`Cache cleared for pattern: ${pattern}`);
    }
  }
  
  /**
   * Generate a hash key for caching screenshot/OCR results
   */
  static generateImageHash(imageData: Buffer | Uint8Array): string {
    const hash = createHash('md5');
    hash.update(Buffer.from(imageData));
    return hash.digest('hex');
  }
  
  /**
   * Generate a cache key for region-based operations
   */
  static generateRegionKey(region?: { x: number; y: number; width: number; height: number }): string {
    if (!region) return 'fullscreen';
    return `${region.x},${region.y},${region.width},${region.height}`;
  }
  
  destroy(): void {
    this.screenshotCache.destroy();
    this.ocrCache.destroy();
    this.windowCache.destroy();
    this.permissionCache.destroy();
  }
}