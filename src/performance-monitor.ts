import { performance } from 'perf_hooks';
import { ocrCache } from './ocr-cache.js';
import { enhancedOCR } from './ocr-enhanced.js';

export interface PerformanceMetric {
  operation: string;
  duration: number;
  timestamp: number;
  memory?: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  metadata?: Record<string, any>;
}

export interface PerformanceStats {
  operation: string;
  count: number;
  totalDuration: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  p95Duration: number;
  p99Duration: number;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private activeOperations: Map<string, number> = new Map();
  private maxMetrics: number = 10000; // Keep last 10k metrics
  private enabled: boolean = true;

  /**
   * Start timing an operation
   */
  startOperation(operationId: string): void {
    if (!this.enabled) return;
    this.activeOperations.set(operationId, performance.now());
  }

  /**
   * End timing an operation and record the metric
   */
  endOperation(operationId: string, metadata?: Record<string, any>): number {
    if (!this.enabled) return 0;
    
    const startTime = this.activeOperations.get(operationId);
    if (!startTime) {
      console.warn(`No start time found for operation: ${operationId}`);
      return 0;
    }

    const duration = performance.now() - startTime;
    this.activeOperations.delete(operationId);

    const metric: PerformanceMetric = {
      operation: operationId,
      duration,
      timestamp: Date.now(),
      memory: this.getMemoryUsage(),
      metadata
    };

    this.addMetric(metric);
    return duration;
  }

  /**
   * Measure a function's execution time
   */
  async measure<T>(operationName: string, fn: () => Promise<T>): Promise<T> {
    const operationId = `${operationName}_${Date.now()}`;
    this.startOperation(operationId);
    
    try {
      const result = await fn();
      this.endOperation(operationId, { success: true });
      return result;
    } catch (error) {
      this.endOperation(operationId, { 
        success: false, 
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Measure a synchronous function's execution time
   */
  measureSync<T>(operationName: string, fn: () => T): T {
    const operationId = `${operationName}_${Date.now()}`;
    this.startOperation(operationId);
    
    try {
      const result = fn();
      this.endOperation(operationId, { success: true });
      return result;
    } catch (error) {
      this.endOperation(operationId, { 
        success: false, 
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Add a metric and maintain size limit
   */
  private addMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);
    
    // Remove oldest metrics if we exceed the limit
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }
  }

  /**
   * Get memory usage information
   */
  private getMemoryUsage(): PerformanceMetric['memory'] {
    const usage = process.memoryUsage();
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss
    };
  }

  /**
   * Get statistics for a specific operation
   */
  getOperationStats(operationName: string): PerformanceStats | null {
    const operationMetrics = this.metrics.filter(m => m.operation.startsWith(operationName));
    
    if (operationMetrics.length === 0) {
      return null;
    }

    const durations = operationMetrics.map(m => m.duration).sort((a, b) => a - b);
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);

    return {
      operation: operationName,
      count: operationMetrics.length,
      totalDuration,
      averageDuration: totalDuration / operationMetrics.length,
      minDuration: durations[0],
      maxDuration: durations[durations.length - 1],
      p95Duration: this.getPercentile(durations, 0.95),
      p99Duration: this.getPercentile(durations, 0.99)
    };
  }

  /**
   * Get all operation statistics
   */
  getAllStats(): PerformanceStats[] {
    const operationNames = new Set(this.metrics.map(m => {
      // Extract base operation name (remove timestamp suffix)
      const parts = m.operation.split('_');
      return parts.slice(0, -1).join('_');
    }));

    return Array.from(operationNames)
      .map(name => this.getOperationStats(name))
      .filter((stats): stats is PerformanceStats => stats !== null);
  }

  /**
   * Get performance report
   */
  getReport(): {
    summary: {
      totalOperations: number;
      averageMemoryUsage: number;
      peakMemoryUsage: number;
      ocrCacheStats: any;
      ocrPerformance: any;
    };
    operations: PerformanceStats[];
    recentMetrics: PerformanceMetric[];
  } {
    const memoryUsages = this.metrics
      .filter(m => m.memory)
      .map(m => m.memory!.heapUsed);

    return {
      summary: {
        totalOperations: this.metrics.length,
        averageMemoryUsage: memoryUsages.length > 0 
          ? memoryUsages.reduce((sum, m) => sum + m, 0) / memoryUsages.length 
          : 0,
        peakMemoryUsage: memoryUsages.length > 0 
          ? Math.max(...memoryUsages) 
          : 0,
        ocrCacheStats: ocrCache.getStats(),
        ocrPerformance: enhancedOCR.getPerformanceMetrics()
      },
      operations: this.getAllStats(),
      recentMetrics: this.metrics.slice(-100) // Last 100 metrics
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
    this.activeOperations.clear();
  }

  /**
   * Enable or disable performance monitoring
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Get percentile value from sorted array
   */
  private getPercentile(sortedArray: number[], percentile: number): number {
    const index = Math.ceil(sortedArray.length * percentile) - 1;
    return sortedArray[Math.min(index, sortedArray.length - 1)];
  }

  /**
   * Export metrics to JSON
   */
  exportMetrics(): string {
    return JSON.stringify({
      metrics: this.metrics,
      stats: this.getAllStats(),
      timestamp: Date.now()
    }, null, 2);
  }

  /**
   * Import metrics from JSON
   */
  importMetrics(json: string): void {
    try {
      const data = JSON.parse(json);
      if (Array.isArray(data.metrics)) {
        this.metrics = data.metrics;
      }
    } catch (error) {
      throw new Error(`Failed to import metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create a benchmark for comparing operations
   */
  async benchmark(operations: Array<{ name: string; fn: () => Promise<any> }>, iterations: number = 10): Promise<void> {
    console.log(`Running benchmark with ${iterations} iterations per operation...`);
    
    for (const op of operations) {
      const durations: number[] = [];
      
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await op.fn();
        const duration = performance.now() - start;
        durations.push(duration);
      }
      
      const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      const min = Math.min(...durations);
      const max = Math.max(...durations);
      
      console.log(`\n${op.name}:`);
      console.log(`  Average: ${avg.toFixed(2)}ms`);
      console.log(`  Min: ${min.toFixed(2)}ms`);
      console.log(`  Max: ${max.toFixed(2)}ms`);
    }
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Helper decorator for automatic performance measurement
export function measurePerformance(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;

  descriptor.value = async function (...args: any[]) {
    return performanceMonitor.measure(
      `${target.constructor.name}.${propertyKey}`,
      async () => originalMethod.apply(this, args)
    );
  };

  return descriptor;
}