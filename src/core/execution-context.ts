import { randomUUID } from 'crypto';
import { CacheManagerImpl } from './cache-manager.js';
import { ExecutionContext, CacheManager, PerformanceTracker } from './types.js';
import { logger } from '../logger.js';
import { getPerformanceMonitor } from './performance-monitor.js';

/**
 * Enhanced performance tracker implementation with integration to PerformanceMonitor
 */
class PerformanceTrackerImpl implements PerformanceTracker {
  private metrics: Map<string, number[]> = new Map();
  private timers: Map<string, number> = new Map();
  private sessionId: string;
  
  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }
  
  startTimer(operation: string): void {
    this.timers.set(operation, Date.now());
  }
  
  endTimer(operation: string): void {
    const startTime = this.timers.get(operation);
    if (!startTime) {
      logger.warn(`No start time found for operation: ${operation}`);
      return;
    }
    
    const duration = Date.now() - startTime;
    this.timers.delete(operation);
    
    const times = this.metrics.get(operation) || [];
    times.push(duration);
    this.metrics.set(operation, times);
    
    // Report to PerformanceMonitor if it's a tool execution
    if (operation.startsWith('tool_')) {
      try {
        const performanceMonitor = getPerformanceMonitor();
        // Assume success for now - this could be enhanced to track actual success/failure
        performanceMonitor.recordToolExecution(operation, duration, true);
      } catch (error) {
        // Performance monitor might not be available during initialization
        logger.debug('Could not report to PerformanceMonitor', { operation, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  
  /**
   * Record a tool execution with explicit success/failure status
   */
  recordToolExecution(toolName: string, duration: number, success: boolean): void {
    const times = this.metrics.get(toolName) || [];
    times.push(duration);
    this.metrics.set(toolName, times);
    
    try {
      const performanceMonitor = getPerformanceMonitor();
      performanceMonitor.recordToolExecution(toolName, duration, success);
    } catch (error) {
      logger.debug('Could not report to PerformanceMonitor', { toolName, error: error instanceof Error ? error.message : String(error) });
    }
  }
  
  getMetrics(operation: string): any {
    const times = this.metrics.get(operation) || [];
    if (times.length === 0) {
      return {
        count: 0,
        totalTime: 0,
        averageTime: 0,
        minTime: 0,
        maxTime: 0
      };
    }
    
    const totalTime = times.reduce((sum, time) => sum + time, 0);
    return {
      count: times.length,
      totalTime,
      averageTime: totalTime / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times)
    };
  }
  
  clear(): void {
    this.metrics.clear();
    this.timers.clear();
  }
}

/**
 * Execution context for sharing state between tool executions
 */
export class ExecutionContextImpl implements ExecutionContext {
  public readonly sessionId: string;
  public readonly startTime: number;
  public readonly sharedResources: Map<string, any>;
  public readonly cacheManager: CacheManager;
  public readonly performanceTracker: PerformanceTracker;
  
  constructor(sessionId?: string) {
    this.sessionId = sessionId || randomUUID();
    this.startTime = Date.now();
    this.sharedResources = new Map();
    this.cacheManager = CacheManagerImpl.getInstance();
    this.performanceTracker = new PerformanceTrackerImpl(this.sessionId);
    
    logger.debug('ExecutionContext created', { sessionId: this.sessionId });
  }
  
  shareResource(key: string, value: any): void {
    this.sharedResources.set(key, value);
    logger.debug('Resource shared', { key, sessionId: this.sessionId });
  }
  
  getSharedResource<T>(key: string): T | undefined {
    return this.sharedResources.get(key) as T;
  }
  
  /**
   * Get or create a shared screenshot for the current execution
   */
  async getSharedScreenshot(key: string = 'current'): Promise<any> {
    return this.getSharedResource(`screenshot:${key}`);
  }
  
  /**
   * Share a screenshot for other tools in the same execution
   */
  shareScreenshot(screenshot: any, key: string = 'current'): void {
    this.shareResource(`screenshot:${key}`, screenshot);
  }
  
  /**
   * Get execution duration
   */
  getDuration(): number {
    return Date.now() - this.startTime;
  }
  
  /**
   * Record a tool execution with performance tracking
   */
  recordToolExecution(toolName: string, duration: number, success: boolean): void {
    (this.performanceTracker as PerformanceTrackerImpl).recordToolExecution(toolName, duration, success);
  }
  
  /**
   * Clean up resources
   */
  cleanup(): void {
    const duration = this.getDuration();
    this.sharedResources.clear();
    (this.performanceTracker as PerformanceTrackerImpl).clear();
    
    logger.debug('ExecutionContext cleaned up', { 
      sessionId: this.sessionId,
      duration
    });
  }
}