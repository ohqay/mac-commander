import { createHash } from 'crypto';
import { logger } from '../logger.js';
import { CacheManager, TimedCache } from './types.js';
import { getPerformanceMonitor } from './performance-monitor.js';

/**
 * Implementation of a time-based cache with TTL support and performance tracking
 */
class TimedCacheImpl<T> implements TimedCache<T> {
  private cache: Map<string, { value: T; expiry: number }> = new Map();
  private cleanupInterval: NodeJS.Timeout;
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;
  
  constructor(
    private cacheName: string,
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
    if (!entry) {
      this.missCount++;
      this.updatePerformanceMetrics();
      return undefined;
    }
    
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.evictionCount++;
      this.missCount++;
      this.updatePerformanceMetrics();
      return undefined;
    }
    
    this.hitCount++;
    this.updatePerformanceMetrics();
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
    const entry = this.cache.get(key);
    if (!entry) {
      this.missCount++;
      this.updatePerformanceMetrics();
      return false;
    }
    
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.evictionCount++;
      this.missCount++;
      this.updatePerformanceMetrics();
      return false;
    }
    
    this.hitCount++;
    this.updatePerformanceMetrics();
    return true;
  }
  
  delete(key: string): void {
    this.cache.delete(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  private cleanup(): void {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
        evicted++;
      }
    }
    if (evicted > 0) {
      this.evictionCount += evicted;
      this.updatePerformanceMetrics();
      logger.debug(`Cache cleanup: evicted ${evicted} expired entries from ${this.cacheName}`);
    }
  }
  
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.clear();
  }
  
  /**
   * Get cache statistics
   */
  getStats(): {
    hitCount: number;
    missCount: number;
    hitRate: number;
    evictionCount: number;
    size: number;
  } {
    const totalRequests = this.hitCount + this.missCount;
    return {
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: totalRequests > 0 ? this.hitCount / totalRequests : 0,
      evictionCount: this.evictionCount,
      size: this.cache.size
    };
  }
  
  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hitCount = 0;
    this.missCount = 0;
    this.evictionCount = 0;
  }
  
  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(): void {
    try {
      const performanceMonitor = getPerformanceMonitor();
      const stats = this.getStats();
      performanceMonitor.recordCacheMetrics(
        this.cacheName,
        stats.hitCount,
        stats.missCount,
        stats.evictionCount,
        stats.size
      );
    } catch (error) {
      // Ignore errors if performance monitor is not available
    }
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
  
  // Performance tracking
  private performanceUpdateInterval: NodeJS.Timeout | null = null;
  
  private constructor() {
    // Different TTLs for different types of data
    this.screenshotCache = new TimedCacheImpl('screenshot', 5000); // 5 seconds
    this.ocrCache = new TimedCacheImpl('ocr', 30000); // 30 seconds
    this.windowCache = new TimedCacheImpl('window', 2000); // 2 seconds
    this.permissionCache = new TimedCacheImpl('permission', 300000); // 5 minutes
    
    // Start periodic performance reporting
    this.startPerformanceReporting();
    
    logger.debug('CacheManager initialized with TTL-based caches and performance tracking');
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
  
  /**
   * Get comprehensive cache statistics
   */
  getAllCacheStats(): {
    screenshot: ReturnType<TimedCacheImpl<any>['getStats']>;
    ocr: ReturnType<TimedCacheImpl<any>['getStats']>;
    window: ReturnType<TimedCacheImpl<any>['getStats']>;
    permission: ReturnType<TimedCacheImpl<any>['getStats']>;
  } {
    return {
      screenshot: (this.screenshotCache as TimedCacheImpl<any>).getStats(),
      ocr: (this.ocrCache as TimedCacheImpl<any>).getStats(),
      window: (this.windowCache as TimedCacheImpl<any>).getStats(),
      permission: (this.permissionCache as TimedCacheImpl<any>).getStats()
    };
  }
  
  /**
   * Reset all cache statistics
   */
  resetAllStats(): void {
    (this.screenshotCache as TimedCacheImpl<any>).resetStats();
    (this.ocrCache as TimedCacheImpl<any>).resetStats();
    (this.windowCache as TimedCacheImpl<any>).resetStats();
    (this.permissionCache as TimedCacheImpl<any>).resetStats();
    logger.debug('All cache statistics reset');
  }
  
  /**
   * Start periodic performance reporting
   */
  private startPerformanceReporting(): void {
    // Report cache metrics every 30 seconds
    this.performanceUpdateInterval = setInterval(() => {
      this.reportPerformanceMetrics();
    }, 30000);
  }
  
  /**
   * Report current cache metrics to performance monitor
   */
  private reportPerformanceMetrics(): void {
    try {
      const performanceMonitor = getPerformanceMonitor();
      const allStats = this.getAllCacheStats();
      
      for (const [cacheName, stats] of Object.entries(allStats)) {
        performanceMonitor.recordCacheMetrics(
          cacheName,
          stats.hitCount,
          stats.missCount,
          stats.evictionCount,
          stats.size
        );
      }
    } catch (error) {
      // Ignore errors if performance monitor is not available
      logger.debug('Performance monitor not available for cache metrics reporting');
    }
  }
  
  destroy(): void {
    if (this.performanceUpdateInterval) {
      clearInterval(this.performanceUpdateInterval);
      this.performanceUpdateInterval = null;
    }
    
    this.screenshotCache.destroy();
    this.ocrCache.destroy();
    this.windowCache.destroy();
    this.permissionCache.destroy();
  }
}