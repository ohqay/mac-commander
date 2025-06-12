import { createWorker, Worker } from 'tesseract.js';
import { logger } from '../logger.js';
import { OCRError, TimeoutError } from '../errors.js';

/**
 * Priority levels for OCR tasks
 */
export enum OCRTaskPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  URGENT = 3
}

/**
 * Configuration for OCR worker pool
 */
export interface OCRWorkerPoolConfig {
  minWorkers: number;
  maxWorkers: number;
  idleTimeoutMs: number;
  taskTimeoutMs: number;
  maxRetries: number;
  healthCheckIntervalMs: number;
  language: string;
}

/**
 * OCR task to be executed by workers
 */
export interface OCRTask {
  id: string;
  type: 'recognize' | 'detect';
  imageData: string;
  priority: OCRTaskPriority;
  timeoutMs: number;
  retries: number;
  maxRetries: number;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  createdAt: number;
}

/**
 * Worker state and performance metrics
 */
export interface WorkerState {
  id: string;
  worker: Worker;
  isIdle: boolean;
  isHealthy: boolean;
  currentTask: OCRTask | null;
  lastUsed: number;
  createdAt: number;
  tasksCompleted: number;
  averageTaskTime: number;
  totalTaskTime: number;
  errorCount: number;
  lastError: Error | null;
  restartCount: number;
}

/**
 * Pool performance metrics
 */
export interface PoolMetrics {
  totalWorkers: number;
  idleWorkers: number;
  busyWorkers: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageTaskTime: number;
  totalTaskTime: number;
  uptime: number;
}

/**
 * Optimized worker pool for Tesseract.js OCR operations
 * Handles concurrent OCR tasks with automatic scaling, health monitoring, and recovery
 */
export class OCRWorkerPool {
  private workers: Map<string, WorkerState> = new Map();
  private taskQueue: OCRTask[] = [];
  private config: OCRWorkerPoolConfig;
  private isRunning = false;
  private createdAt = Date.now();
  private taskCounter = 0;
  private completedTasks = 0;
  private failedTasks = 0;
  private totalTaskTime = 0;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private scaleInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<OCRWorkerPoolConfig> = {}) {
    this.config = {
      minWorkers: 1,
      maxWorkers: 4,
      idleTimeoutMs: 60000, // 1 minute
      taskTimeoutMs: 30000, // 30 seconds
      maxRetries: 2,
      healthCheckIntervalMs: 10000, // 10 seconds
      language: 'eng',
      ...config
    };

    // Validate configuration
    if (this.config.minWorkers < 1) {
      throw new Error('minWorkers must be at least 1');
    }
    if (this.config.maxWorkers < this.config.minWorkers) {
      throw new Error('maxWorkers must be >= minWorkers');
    }
  }

  /**
   * Initialize the worker pool
   */
  async initialize(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    logger.info('Initializing OCR worker pool', {
      minWorkers: this.config.minWorkers,
      maxWorkers: this.config.maxWorkers,
      language: this.config.language
    });

    this.isRunning = true;

    // Create minimum number of workers
    const initPromises = [];
    for (let i = 0; i < this.config.minWorkers; i++) {
      initPromises.push(this.createWorker());
    }

    await Promise.all(initPromises);

    // Start background processes
    this.startHealthChecking();
    this.startAutoScaling();
    this.startTaskProcessing();

    logger.info('OCR worker pool initialized successfully', {
      workerCount: this.workers.size
    });
  }

  /**
   * Shutdown the worker pool
   */
  async shutdown(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Shutting down OCR worker pool...');
    this.isRunning = false;

    // Stop background processes
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.scaleInterval) {
      clearInterval(this.scaleInterval);
      this.scaleInterval = null;
    }

    // Reject all queued tasks
    for (const task of this.taskQueue) {
      task.reject(new OCRError('Worker pool shutting down'));
    }
    this.taskQueue = [];

    // Terminate all workers
    const terminatePromises = Array.from(this.workers.values()).map(async (workerState) => {
      try {
        await workerState.worker.terminate();
      } catch (error) {
        logger.warn(`Error terminating worker ${workerState.id}`, error as Error);
      }
    });

    await Promise.all(terminatePromises);
    this.workers.clear();

    logger.info('OCR worker pool shut down successfully');
  }

  /**
   * Submit an OCR recognition task
   */
  async recognize(imageData: string, priority: OCRTaskPriority = OCRTaskPriority.NORMAL, timeoutMs?: number): Promise<any> {
    return this.submitTask('recognize', imageData, priority, timeoutMs);
  }

  /**
   * Submit an OCR detection task
   */
  async detect(imageData: string, priority: OCRTaskPriority = OCRTaskPriority.NORMAL, timeoutMs?: number): Promise<any> {
    return this.submitTask('detect', imageData, priority, timeoutMs);
  }

  /**
   * Get current pool metrics
   */
  getMetrics(): PoolMetrics {
    const idleWorkers = Array.from(this.workers.values()).filter(w => w.isIdle).length;
    const busyWorkers = this.workers.size - idleWorkers;

    return {
      totalWorkers: this.workers.size,
      idleWorkers,
      busyWorkers,
      queuedTasks: this.taskQueue.length,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      averageTaskTime: this.completedTasks > 0 ? this.totalTaskTime / this.completedTasks : 0,
      totalTaskTime: this.totalTaskTime,
      uptime: Date.now() - this.createdAt
    };
  }

  /**
   * Get detailed worker states
   */
  getWorkerStates(): WorkerState[] {
    return Array.from(this.workers.values());
  }

  /**
   * Submit a task to the worker pool
   */
  private async submitTask(
    type: 'recognize' | 'detect',
    imageData: string,
    priority: OCRTaskPriority,
    timeoutMs?: number
  ): Promise<any> {
    if (!this.isRunning) {
      throw new OCRError('Worker pool is not running');
    }

    return new Promise((resolve, reject) => {
      const task: OCRTask = {
        id: `ocr-${++this.taskCounter}`,
        type,
        imageData,
        priority,
        timeoutMs: timeoutMs || this.config.taskTimeoutMs,
        retries: 0,
        maxRetries: this.config.maxRetries,
        resolve,
        reject,
        createdAt: Date.now()
      };

      // Insert task in priority order (higher priority first)
      let insertIndex = this.taskQueue.length;
      for (let i = 0; i < this.taskQueue.length; i++) {
        if (this.taskQueue[i].priority < priority) {
          insertIndex = i;
          break;
        }
      }
      this.taskQueue.splice(insertIndex, 0, task);

      logger.debug('OCR task queued', {
        taskId: task.id,
        type: task.type,
        priority: task.priority,
        queueLength: this.taskQueue.length
      });

      // Try to process immediately if possible
      this.processNextTask();
    });
  }

  /**
   * Create a new worker
   */
  private async createWorker(): Promise<WorkerState> {
    const workerId = `worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      logger.debug('Creating new OCR worker', { workerId });
      
      const worker = await createWorker(this.config.language);
      
      const workerState: WorkerState = {
        id: workerId,
        worker,
        isIdle: true,
        isHealthy: true,
        currentTask: null,
        lastUsed: Date.now(),
        createdAt: Date.now(),
        tasksCompleted: 0,
        averageTaskTime: 0,
        totalTaskTime: 0,
        errorCount: 0,
        lastError: null,
        restartCount: 0
      };

      this.workers.set(workerId, workerState);
      
      logger.debug('OCR worker created successfully', { workerId });
      return workerState;
    } catch (error) {
      logger.error(`Failed to create OCR worker ${workerId}`, error as Error);
      throw new OCRError(`Failed to create worker: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Remove and terminate a worker
   */
  private async removeWorker(workerId: string): Promise<void> {
    const workerState = this.workers.get(workerId);
    if (!workerState) {
      return;
    }

    logger.debug('Removing OCR worker', { workerId });

    // If worker is busy, reject its current task
    if (workerState.currentTask) {
      workerState.currentTask.reject(new OCRError('Worker being removed'));
    }

    try {
      await workerState.worker.terminate();
    } catch (error) {
      logger.warn(`Error terminating worker ${workerId} during removal`, error as Error);
    }

    this.workers.delete(workerId);
  }

  /**
   * Restart a worker
   */
  private async restartWorker(workerId: string): Promise<void> {
    const workerState = this.workers.get(workerId);
    if (!workerState) {
      return;
    }

    logger.info('Restarting OCR worker', { workerId, restartCount: workerState.restartCount });

    // Reject current task if any
    if (workerState.currentTask) {
      workerState.currentTask.reject(new OCRError('Worker restarting'));
    }

    try {
      await workerState.worker.terminate();
    } catch (error) {
      logger.warn(`Error terminating worker ${workerId} during restart`, error as Error);
    }

    try {
      const newWorker = await createWorker(this.config.language);
      
      // Update worker state
      workerState.worker = newWorker;
      workerState.isIdle = true;
      workerState.isHealthy = true;
      workerState.currentTask = null;
      workerState.lastUsed = Date.now();
      workerState.restartCount++;
      
      logger.info('OCR worker restarted successfully', { workerId });
    } catch (error) {
      logger.error(`Failed to restart OCR worker ${workerId}`, error as Error);
      // Remove the worker if restart fails
      this.workers.delete(workerId);
    }
  }

  /**
   * Process the next task in queue
   */
  private async processNextTask(): Promise<void> {
    if (this.taskQueue.length === 0) {
      return;
    }

    // Find an idle worker
    const idleWorker = Array.from(this.workers.values()).find(w => w.isIdle && w.isHealthy);
    if (!idleWorker) {
      // Try to scale up if possible
      if (this.workers.size < this.config.maxWorkers) {
        try {
          await this.createWorker();
          // Retry processing after creating new worker
          setTimeout(() => this.processNextTask(), 0);
        } catch (error) {
          logger.error('Failed to create worker for task processing', error as Error);
        }
      }
      return;
    }

    const task = this.taskQueue.shift()!;
    await this.executeTask(idleWorker, task);
  }

  /**
   * Execute a task on a worker
   */
  private async executeTask(workerState: WorkerState, task: OCRTask): Promise<void> {
    workerState.isIdle = false;
    workerState.currentTask = task;
    workerState.lastUsed = Date.now();

    const startTime = Date.now();

    logger.debug('Executing OCR task', {
      workerId: workerState.id,
      taskId: task.id,
      type: task.type
    });

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new TimeoutError(`OCR ${task.type}`, task.timeoutMs));
        }, task.timeoutMs);
      });

      // Execute the OCR operation
      let result: any;
      if (task.type === 'recognize') {
        result = await Promise.race([
          workerState.worker.recognize(task.imageData),
          timeoutPromise
        ]);
      } else {
        result = await Promise.race([
          workerState.worker.detect(task.imageData),
          timeoutPromise
        ]);
      }

      // Update metrics
      const taskTime = Date.now() - startTime;
      workerState.tasksCompleted++;
      workerState.totalTaskTime += taskTime;
      workerState.averageTaskTime = workerState.totalTaskTime / workerState.tasksCompleted;
      
      this.completedTasks++;
      this.totalTaskTime += taskTime;

      // Resolve the task
      task.resolve(result);

      logger.debug('OCR task completed successfully', {
        workerId: workerState.id,
        taskId: task.id,
        executionTime: taskTime
      });

    } catch (error) {
      const taskTime = Date.now() - startTime;
      workerState.errorCount++;
      workerState.lastError = error as Error;

      logger.error(`OCR task ${task.id} failed on worker ${workerState.id} (${task.retries}/${task.maxRetries} retries, ${taskTime}ms)`, error as Error);

      // Retry logic
      if (task.retries < task.maxRetries) {
        task.retries++;
        // Re-queue the task with higher priority
        const retryPriority = Math.min(task.priority + 1, OCRTaskPriority.URGENT);
        this.taskQueue.unshift({ ...task, priority: retryPriority });
        
        logger.debug('Retrying OCR task', {
          taskId: task.id,
          retryCount: task.retries,
          newPriority: retryPriority
        });
      } else {
        // Max retries reached, reject the task
        this.failedTasks++;
        task.reject(error as Error);
      }

      // Mark worker as potentially unhealthy if too many errors
      if (workerState.errorCount > 3) {
        workerState.isHealthy = false;
        logger.warn('Worker marked as unhealthy due to errors', {
          workerId: workerState.id,
          errorCount: workerState.errorCount
        });
      }
    } finally {
      // Reset worker state
      workerState.isIdle = true;
      workerState.currentTask = null;

      // Process next task if available
      if (this.taskQueue.length > 0) {
        setTimeout(() => this.processNextTask(), 0);
      }
    }
  }

  /**
   * Start task processing loop
   */
  private startTaskProcessing(): void {
    const processLoop = () => {
      if (!this.isRunning) return;
      
      this.processNextTask().catch(error => {
        logger.error('Error in task processing loop', error as Error);
      });
      
      // Schedule next iteration
      setTimeout(processLoop, 100);
    };
    
    processLoop();
  }

  /**
   * Start health checking for workers
   */
  private startHealthChecking(): void {
    this.healthCheckInterval = setInterval(async () => {
      if (!this.isRunning) return;

      const unhealthyWorkers = Array.from(this.workers.entries())
        .filter(([_, state]) => !state.isHealthy)
        .map(([id, _]) => id);

      // Restart unhealthy workers
      for (const workerId of unhealthyWorkers) {
        try {
          await this.restartWorker(workerId);
        } catch (error) {
          logger.error(`Failed to restart unhealthy worker ${workerId}`, error as Error);
        }
      }

      // Remove idle workers that have been unused for too long
      const now = Date.now();
      const idleWorkers = Array.from(this.workers.entries())
        .filter(([_, state]) => 
          state.isIdle && 
          state.isHealthy &&
          now - state.lastUsed > this.config.idleTimeoutMs &&
          this.workers.size > this.config.minWorkers
        )
        .map(([id, _]) => id);

      for (const workerId of idleWorkers) {
        try {
          await this.removeWorker(workerId);
          logger.debug('Removed idle worker', { workerId });
        } catch (error) {
          logger.error(`Failed to remove idle worker ${workerId}`, error as Error);
        }
      }

    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Start auto-scaling based on queue length
   */
  private startAutoScaling(): void {
    this.scaleInterval = setInterval(async () => {
      if (!this.isRunning) return;

      const metrics = this.getMetrics();
      
      // Scale up if queue is backing up
      if (metrics.queuedTasks > 0 && metrics.idleWorkers === 0 && metrics.totalWorkers < this.config.maxWorkers) {
        try {
          await this.createWorker();
          logger.debug('Scaled up worker pool', {
            totalWorkers: this.workers.size,
            queuedTasks: metrics.queuedTasks
          });
        } catch (error) {
          logger.error('Failed to scale up worker pool', error as Error);
        }
      }

      // Scale down if too many idle workers
      const excessIdleWorkers = metrics.idleWorkers - Math.ceil(this.config.minWorkers / 2);
      if (excessIdleWorkers > 1 && metrics.totalWorkers > this.config.minWorkers) {
        const idleWorkers = Array.from(this.workers.entries())
          .filter(([_, state]) => state.isIdle && state.isHealthy)
          .slice(0, excessIdleWorkers - 1);

        for (const [workerId, _] of idleWorkers) {
          try {
            await this.removeWorker(workerId);
            logger.debug('Scaled down worker pool', {
              totalWorkers: this.workers.size,
              removedWorker: workerId
            });
          } catch (error) {
            logger.error(`Failed to scale down worker pool by removing worker ${workerId}`, error as Error);
          }
        }
      }

    }, 5000); // Check every 5 seconds
  }
}

// Singleton instance for the application
let ocrWorkerPool: OCRWorkerPool | null = null;

/**
 * Get the singleton OCR worker pool instance
 */
export function getOCRWorkerPool(): OCRWorkerPool {
  if (!ocrWorkerPool) {
    ocrWorkerPool = new OCRWorkerPool();
  }
  return ocrWorkerPool;
}

/**
 * Initialize the global OCR worker pool
 */
export async function initializeOCRWorkerPool(config?: Partial<OCRWorkerPoolConfig>): Promise<void> {
  if (ocrWorkerPool) {
    await ocrWorkerPool.shutdown();
  }
  ocrWorkerPool = new OCRWorkerPool(config);
  await ocrWorkerPool.initialize();
}

/**
 * Shutdown the global OCR worker pool
 */
export async function shutdownOCRWorkerPool(): Promise<void> {
  if (ocrWorkerPool) {
    await ocrWorkerPool.shutdown();
    ocrWorkerPool = null;
  }
}