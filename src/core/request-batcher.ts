import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { ExecutionContext } from './types.js';
import { ToolRegistry } from './tool-registry.js';
import { logger } from '../logger.js';

/**
 * Types for batch request system
 */
export interface BatchRequest {
  id: string;
  toolName: string;
  args: any;
  priority: BatchPriority;
  timestamp: number;
  timeout?: number;
  resolve: (result: BatchResult) => void;
  reject: (error: Error) => void;
}

export interface BatchResult {
  id: string;
  toolName: string;
  success: boolean;
  data?: any;
  error?: Error;
  executionTime: number;
}

export interface BatchMetrics {
  batchId: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
  parallelGroups: number;
  timestamp: number;
}

export enum BatchPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3
}

export enum ToolCompatibilityGroup {
  SCREENSHOT = 'screenshot',
  WINDOW_QUERY = 'window_query',
  WINDOW_CONTROL = 'window_control',
  AUTOMATION = 'automation',
  OCR = 'ocr',
  UTILITY = 'utility'
}

export interface BatchConfig {
  maxBatchSize: number;
  batchTimeout: number;
  maxConcurrentBatches: number;
  enableParallelExecution: boolean;
  priorityWeighting: boolean;
}

/**
 * Tool compatibility matrix for determining which tools can run in parallel
 */
class ToolCompatibilityMatrix {
  private static readonly COMPATIBILITY_GROUPS: Map<string, ToolCompatibilityGroup> = new Map([
    // Screenshot tools - can run in parallel
    ['take_screenshot', ToolCompatibilityGroup.SCREENSHOT],
    ['take_region_screenshot', ToolCompatibilityGroup.SCREENSHOT],
    ['list_screenshots', ToolCompatibilityGroup.SCREENSHOT],
    ['view_screenshot', ToolCompatibilityGroup.SCREENSHOT],
    ['describe_screenshot', ToolCompatibilityGroup.SCREENSHOT],
    
    // Window query tools - can run in parallel
    ['list_windows', ToolCompatibilityGroup.WINDOW_QUERY],
    ['get_active_window', ToolCompatibilityGroup.WINDOW_QUERY],
    ['find_window', ToolCompatibilityGroup.WINDOW_QUERY],
    ['get_window_info', ToolCompatibilityGroup.WINDOW_QUERY],
    
    // Window control tools - cannot run in parallel
    ['focus_window', ToolCompatibilityGroup.WINDOW_CONTROL],
    
    // Automation tools - cannot run in parallel
    ['click', ToolCompatibilityGroup.AUTOMATION],
    ['double_click', ToolCompatibilityGroup.AUTOMATION],
    ['right_click', ToolCompatibilityGroup.AUTOMATION],
    ['type_text', ToolCompatibilityGroup.AUTOMATION],
    ['key_press', ToolCompatibilityGroup.AUTOMATION],
    ['key_combination', ToolCompatibilityGroup.AUTOMATION],
    ['scroll', ToolCompatibilityGroup.AUTOMATION],
    
    // OCR tools - can run in parallel with different images
    ['extract_text', ToolCompatibilityGroup.OCR],
    
    // Utility tools - generally safe to parallelize
    ['cleanup_screenshots', ToolCompatibilityGroup.UTILITY],
    ['check_permissions', ToolCompatibilityGroup.UTILITY],
    ['health_check', ToolCompatibilityGroup.UTILITY]
  ]);

  private static readonly PARALLEL_SAFE_GROUPS = new Set([
    ToolCompatibilityGroup.SCREENSHOT,
    ToolCompatibilityGroup.WINDOW_QUERY,
    ToolCompatibilityGroup.OCR,
    ToolCompatibilityGroup.UTILITY
  ]);

  static getToolGroup(toolName: string): ToolCompatibilityGroup {
    return this.COMPATIBILITY_GROUPS.get(toolName) || ToolCompatibilityGroup.UTILITY;
  }

  static canRunInParallel(toolName1: string, toolName2: string): boolean {
    const group1 = this.getToolGroup(toolName1);
    const group2 = this.getToolGroup(toolName2);
    
    // Same group tools can run in parallel if the group is parallel-safe
    if (group1 === group2) {
      return this.PARALLEL_SAFE_GROUPS.has(group1);
    }
    
    // Different groups can run in parallel if both are parallel-safe
    return this.PARALLEL_SAFE_GROUPS.has(group1) && this.PARALLEL_SAFE_GROUPS.has(group2);
  }

  static groupRequests(requests: BatchRequest[]): BatchRequest[][] {
    const groups: BatchRequest[][] = [];
    const processed = new Set<string>();

    for (const request of requests) {
      if (processed.has(request.id)) continue;

      const group = [request];
      processed.add(request.id);

      // Find compatible requests for parallel execution
      for (const otherRequest of requests) {
        if (processed.has(otherRequest.id)) continue;
        
        // Check if this request can run in parallel with all requests in current group
        const canAddToGroup = group.every(groupedRequest => 
          this.canRunInParallel(groupedRequest.toolName, otherRequest.toolName)
        );

        if (canAddToGroup) {
          group.push(otherRequest);
          processed.add(otherRequest.id);
        }
      }

      groups.push(group);
    }

    return groups;
  }
}

/**
 * Request batching and optimization system for macOS Simulator MCP server
 */
export class RequestBatcher extends EventEmitter {
  private readonly config: BatchConfig;
  private readonly toolRegistry: ToolRegistry;
  private readonly requestQueue: BatchRequest[] = [];
  private readonly activeBatches: Set<string> = new Set();
  private readonly batchMetrics: Map<string, BatchMetrics> = new Map();
  
  private batchTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private readonly performanceTracker = new Map<string, number[]>();

  constructor(config: Partial<BatchConfig> = {}) {
    super();
    
    this.config = {
      maxBatchSize: 10,
      batchTimeout: 100, // 100ms
      maxConcurrentBatches: 3,
      enableParallelExecution: true,
      priorityWeighting: true,
      ...config
    };
    
    this.toolRegistry = ToolRegistry.getInstance();
    
    logger.debug('RequestBatcher initialized', { config: this.config });
  }

  /**
   * Add a request to the batch queue
   */
  async addRequest(
    toolName: string, 
    args: any, 
    options: {
      priority?: BatchPriority;
      timeout?: number;
    } = {}
  ): Promise<BatchResult> {
    const request: BatchRequest = {
      id: randomUUID(),
      toolName,
      args,
      priority: options.priority || BatchPriority.NORMAL,
      timestamp: Date.now(),
      timeout: options.timeout,
      resolve: () => {}, // Will be set below
      reject: () => {} // Will be set below
    };

    // Create promise for the request
    const promise = new Promise<BatchResult>((resolve, reject) => {
      request.resolve = resolve;
      request.reject = reject;
    });

    // Add to queue
    this.requestQueue.push(request);
    this.sortQueueByPriority();
    
    logger.debug('Request added to batch queue', { 
      requestId: request.id, 
      toolName, 
      queueSize: this.requestQueue.length 
    });

    // Start batch processing if not already running
    this.scheduleBatchProcessing();

    // Set timeout for individual request if specified
    if (request.timeout) {
      setTimeout(() => {
        this.removeRequestFromQueue(request.id);
        request.reject(new Error(`Request timeout after ${request.timeout}ms`));
      }, request.timeout);
    }

    return promise;
  }

  /**
   * Process the batch queue
   */
  private async processBatchQueue(): Promise<void> {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }

    if (this.activeBatches.size >= this.config.maxConcurrentBatches) {
      logger.debug('Max concurrent batches reached, waiting');
      return;
    }

    this.isProcessing = true;
    
    try {
      // Extract batch from queue
      const batchSize = Math.min(this.config.maxBatchSize, this.requestQueue.length);
      const batchRequests = this.requestQueue.splice(0, batchSize);
      
      if (batchRequests.length > 0) {
        await this.executeBatch(batchRequests);
      }
    } catch (error) {
      logger.error('Error processing batch queue', { error });
    } finally {
      this.isProcessing = false;
      
      // Continue processing if there are more requests
      if (this.requestQueue.length > 0) {
        this.scheduleBatchProcessing();
      }
    }
  }

  /**
   * Execute a batch of requests
   */
  private async executeBatch(requests: BatchRequest[]): Promise<void> {
    const batchId = randomUUID();
    const startTime = Date.now();
    
    this.activeBatches.add(batchId);
    
    logger.debug('Executing batch', { 
      batchId, 
      requestCount: requests.length,
      requests: requests.map(r => ({ id: r.id, tool: r.toolName }))
    });

    try {
      let results: BatchResult[];
      
      if (this.config.enableParallelExecution && requests.length > 1) {
        results = await this.executeParallelBatch(requests, batchId);
      } else {
        results = await this.executeSequentialBatch(requests, batchId);
      }

      // Record batch metrics
      const totalExecutionTime = Date.now() - startTime;
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;
      
      const metrics: BatchMetrics = {
        batchId,
        requestCount: requests.length,
        successCount,
        failureCount,
        totalExecutionTime,
        averageExecutionTime: totalExecutionTime / requests.length,
        parallelGroups: this.config.enableParallelExecution ? 
          ToolCompatibilityMatrix.groupRequests(requests).length : requests.length,
        timestamp: startTime
      };
      
      this.batchMetrics.set(batchId, metrics);
      this.emit('batchCompleted', metrics);
      
      logger.debug('Batch completed', metrics);

    } catch (error) {
      logger.error('Batch execution failed', { batchId, error });
      
      // Reject all requests in the batch
      requests.forEach(request => {
        request.reject(error as Error);
      });
    } finally {
      this.activeBatches.delete(batchId);
    }
  }

  /**
   * Execute requests with parallel optimization
   */
  private async executeParallelBatch(requests: BatchRequest[], batchId: string): Promise<BatchResult[]> {
    const parallelGroups = ToolCompatibilityMatrix.groupRequests(requests);
    const results: BatchResult[] = [];
    
    logger.debug('Executing parallel batch', { 
      batchId, 
      groupCount: parallelGroups.length,
      groups: parallelGroups.map(group => group.map(r => r.toolName))
    });

    // Execute each group sequentially, but requests within each group in parallel
    for (const group of parallelGroups) {
      const groupResults = await Promise.allSettled(
        group.map(request => this.executeRequest(request))
      );

      // Process results and resolve/reject individual requests
      groupResults.forEach((result, index) => {
        const request = group[index];
        
        if (result.status === 'fulfilled') {
          results.push(result.value);
          request.resolve(result.value);
        } else {
          const batchResult: BatchResult = {
            id: request.id,
            toolName: request.toolName,
            success: false,
            error: result.reason,
            executionTime: 0
          };
          results.push(batchResult);
          request.reject(result.reason);
        }
      });
    }

    return results;
  }

  /**
   * Execute requests sequentially
   */
  private async executeSequentialBatch(requests: BatchRequest[], batchId: string): Promise<BatchResult[]> {
    const results: BatchResult[] = [];
    
    logger.debug('Executing sequential batch', { batchId, requestCount: requests.length });

    for (const request of requests) {
      try {
        const result = await this.executeRequest(request);
        results.push(result);
        request.resolve(result);
      } catch (error) {
        const batchResult: BatchResult = {
          id: request.id,
          toolName: request.toolName,
          success: false,
          error: error as Error,
          executionTime: 0
        };
        results.push(batchResult);
        request.reject(error as Error);
      }
    }

    return results;
  }

  /**
   * Execute a single request
   */
  private async executeRequest(request: BatchRequest): Promise<BatchResult> {
    const startTime = Date.now();
    
    try {
      const handler = this.toolRegistry.getHandler(request.toolName);
      if (!handler) {
        throw new Error(`Tool not found: ${request.toolName}`);
      }

      // Create execution context for the request
      const context = new (await import('./execution-context.js')).ExecutionContextImpl();
      
      // Validate permissions if required
      if (handler.validatePermissions) {
        await handler.validatePermissions();
      }

      // Execute the tool
      const toolResult = await handler.execute(request.args, context);
      const executionTime = Date.now() - startTime;

      // Track performance
      this.trackPerformance(request.toolName, executionTime);

      const result: BatchResult = {
        id: request.id,
        toolName: request.toolName,
        success: !toolResult.isError,
        data: toolResult,
        executionTime
      };

      logger.debug('Request executed successfully', { 
        requestId: request.id, 
        toolName: request.toolName, 
        executionTime 
      });

      return result;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      logger.error('Request execution failed', { 
        requestId: request.id, 
        toolName: request.toolName, 
        error: error instanceof Error ? error.message : String(error),
        executionTime 
      });

      return {
        id: request.id,
        toolName: request.toolName,
        success: false,
        error: error as Error,
        executionTime
      };
    }
  }

  /**
   * Sort queue by priority and timestamp
   */
  private sortQueueByPriority(): void {
    if (!this.config.priorityWeighting) return;

    this.requestQueue.sort((a, b) => {
      // First sort by priority (higher priority first)
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // Then by timestamp (older requests first)
      return a.timestamp - b.timestamp;
    });
  }

  /**
   * Schedule batch processing
   */
  private scheduleBatchProcessing(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.processBatchQueue();
    }, this.config.batchTimeout);
  }

  /**
   * Remove a request from the queue
   */
  private removeRequestFromQueue(requestId: string): boolean {
    const index = this.requestQueue.findIndex(r => r.id === requestId);
    if (index >= 0) {
      this.requestQueue.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Track performance metrics
   */
  private trackPerformance(toolName: string, executionTime: number): void {
    if (!this.performanceTracker.has(toolName)) {
      this.performanceTracker.set(toolName, []);
    }
    
    const times = this.performanceTracker.get(toolName)!;
    times.push(executionTime);
    
    // Keep only last 100 measurements
    if (times.length > 100) {
      times.shift();
    }
  }

  /**
   * Get performance metrics for a tool
   */
  getToolPerformanceMetrics(toolName: string): {
    count: number;
    averageTime: number;
    minTime: number;
    maxTime: number;
    totalTime: number;
  } | null {
    const times = this.performanceTracker.get(toolName);
    if (!times || times.length === 0) {
      return null;
    }

    const totalTime = times.reduce((sum, time) => sum + time, 0);
    return {
      count: times.length,
      averageTime: totalTime / times.length,
      minTime: Math.min(...times),
      maxTime: Math.max(...times),
      totalTime
    };
  }

  /**
   * Get batch metrics
   */
  getBatchMetrics(batchId?: string): BatchMetrics[] {
    if (batchId) {
      const metrics = this.batchMetrics.get(batchId);
      return metrics ? [metrics] : [];
    }
    return Array.from(this.batchMetrics.values());
  }

  /**
   * Get current queue status
   */
  getQueueStatus(): {
    queueLength: number;
    activeBatches: number;
    priorityDistribution: Record<BatchPriority, number>;
    oldestRequestAge: number;
  } {
    const priorityDistribution: Record<BatchPriority, number> = {
      [BatchPriority.LOW]: 0,
      [BatchPriority.NORMAL]: 0,
      [BatchPriority.HIGH]: 0,
      [BatchPriority.CRITICAL]: 0
    };

    this.requestQueue.forEach(request => {
      priorityDistribution[request.priority]++;
    });

    const oldestRequest = this.requestQueue.reduce((oldest, current) => 
      current.timestamp < oldest.timestamp ? current : oldest, 
      this.requestQueue[0]
    );

    return {
      queueLength: this.requestQueue.length,
      activeBatches: this.activeBatches.size,
      priorityDistribution,
      oldestRequestAge: oldestRequest ? Date.now() - oldestRequest.timestamp : 0
    };
  }

  /**
   * Clear all pending requests
   */
  clearQueue(): void {
    this.requestQueue.forEach(request => {
      request.reject(new Error('Queue cleared'));
    });
    this.requestQueue.length = 0;
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    logger.debug('Request queue cleared');
  }

  /**
   * Update batch configuration
   */
  updateConfig(newConfig: Partial<BatchConfig>): void {
    Object.assign(this.config, newConfig);
    logger.debug('Batch configuration updated', { config: this.config });
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.clearQueue();
    this.batchMetrics.clear();
    this.performanceTracker.clear();
    this.activeBatches.clear();
    this.removeAllListeners();
    
    logger.debug('RequestBatcher cleaned up');
  }
}

/**
 * Singleton instance for global access
 */
let batcherInstance: RequestBatcher | null = null;

export function getBatcher(config?: Partial<BatchConfig>): RequestBatcher {
  if (!batcherInstance) {
    batcherInstance = new RequestBatcher(config);
  }
  return batcherInstance;
}

export function resetBatcher(): void {
  if (batcherInstance) {
    batcherInstance.cleanup();
    batcherInstance = null;
  }
}