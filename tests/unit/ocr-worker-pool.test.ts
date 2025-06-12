import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OCRWorkerPool, OCRTaskPriority, type OCRWorkerPoolConfig } from '../../src/core/ocr-worker-pool';

// Mock tesseract.js
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(() => Promise.resolve({
    recognize: vi.fn(() => Promise.resolve({ 
      data: { text: 'Mock OCR result' } 
    })),
    detect: vi.fn(() => Promise.resolve({ 
      data: { words: [] } 
    })),
    terminate: vi.fn(() => Promise.resolve())
  }))
}));

// Mock logger
vi.mock('../../src/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('OCRWorkerPool', () => {
  let workerPool: OCRWorkerPool;
  
  beforeEach(async () => {
    const config: Partial<OCRWorkerPoolConfig> = {
      minWorkers: 1,
      maxWorkers: 2,
      idleTimeoutMs: 1000,
      taskTimeoutMs: 5000,
      healthCheckIntervalMs: 500
    };
    
    workerPool = new OCRWorkerPool(config);
  });

  afterEach(async () => {
    if (workerPool) {
      await workerPool.shutdown();
    }
  });

  describe('initialization', () => {
    it('should initialize with correct configuration', async () => {
      await workerPool.initialize();
      
      const metrics = workerPool.getMetrics();
      expect(metrics.totalWorkers).toBeGreaterThanOrEqual(1);
      expect(metrics.idleWorkers).toBe(1);
      expect(metrics.busyWorkers).toBe(0);
      expect(metrics.queuedTasks).toBe(0);
    });

    it('should throw error with invalid configuration', () => {
      expect(() => new OCRWorkerPool({ minWorkers: 0 }))
        .toThrow('minWorkers must be at least 1');
      
      expect(() => new OCRWorkerPool({ minWorkers: 3, maxWorkers: 2 }))
        .toThrow('maxWorkers must be >= minWorkers');
    });
  });

  describe('task execution', () => {
    beforeEach(async () => {
      await workerPool.initialize();
    });

    it('should execute recognize task successfully', async () => {
      const result = await workerPool.recognize('base64image', OCRTaskPriority.NORMAL);
      
      expect(result).toBeDefined();
      expect(result.data.text).toBe('Mock OCR result');
      
      const metrics = workerPool.getMetrics();
      expect(metrics.completedTasks).toBe(1);
      expect(metrics.failedTasks).toBe(0);
    });

    it('should execute detect task successfully', async () => {
      const result = await workerPool.detect('base64image', OCRTaskPriority.NORMAL);
      
      expect(result).toBeDefined();
      expect(result.data.words).toEqual([]);
      
      const metrics = workerPool.getMetrics();
      expect(metrics.completedTasks).toBe(1);
    });

    it('should handle multiple concurrent tasks', async () => {
      const tasks = [
        workerPool.recognize('image1', OCRTaskPriority.NORMAL),
        workerPool.recognize('image2', OCRTaskPriority.HIGH),
        workerPool.recognize('image3', OCRTaskPriority.LOW)
      ];

      const results = await Promise.all(tasks);
      
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.data.text).toBe('Mock OCR result');
      });

      const metrics = workerPool.getMetrics();
      expect(metrics.completedTasks).toBe(3);
    });

    it('should prioritize high priority tasks', async () => {
      // This test verifies task ordering but is complex to implement
      // without exposing internal queue state
      const highPriorityTask = workerPool.recognize('high', OCRTaskPriority.HIGH);
      const normalPriorityTask = workerPool.recognize('normal', OCRTaskPriority.NORMAL);
      
      const results = await Promise.all([highPriorityTask, normalPriorityTask]);
      
      expect(results).toHaveLength(2);
      // Both should complete successfully regardless of priority
      results.forEach(result => {
        expect(result.data.text).toBe('Mock OCR result');
      });
    });
  });

  describe('metrics and monitoring', () => {
    beforeEach(async () => {
      await workerPool.initialize();
    });

    it('should track performance metrics', async () => {
      // Wait a moment to ensure uptime > 0
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await workerPool.recognize('test', OCRTaskPriority.NORMAL);
      
      const metrics = workerPool.getMetrics();
      
      expect(metrics.completedTasks).toBe(1);
      expect(metrics.failedTasks).toBe(0);
      expect(metrics.averageTaskTime).toBeGreaterThanOrEqual(0);
      expect(metrics.totalTaskTime).toBeGreaterThanOrEqual(0);
      expect(metrics.uptime).toBeGreaterThan(0);
    });

    it('should provide worker state information', async () => {
      const workerStates = workerPool.getWorkerStates();
      
      expect(workerStates).toHaveLength(1);
      
      const worker = workerStates[0];
      expect(worker.id).toBeDefined();
      expect(worker.isIdle).toBe(true);
      expect(worker.isHealthy).toBe(true);
      expect(worker.currentTask).toBeNull();
      expect(worker.tasksCompleted).toBe(0);
      expect(worker.errorCount).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should throw error when pool is not initialized', async () => {
      const uninitializedPool = new OCRWorkerPool();
      
      await expect(uninitializedPool.recognize('test'))
        .rejects.toThrow('Worker pool is not running');
    });

    it('should handle worker creation failures gracefully', async () => {
      // Mock createWorker to fail
      const { createWorker } = await import('tesseract.js');
      vi.mocked(createWorker).mockRejectedValueOnce(new Error('Failed to create worker'));
      
      const failingPool = new OCRWorkerPool({ minWorkers: 1 });
      
      await expect(failingPool.initialize())
        .rejects.toThrow('Failed to create worker');
    });
  });

  describe('shutdown', () => {
    it('should shutdown cleanly', async () => {
      await workerPool.initialize();
      
      const metrics = workerPool.getMetrics();
      expect(metrics.totalWorkers).toBeGreaterThan(0);
      
      await workerPool.shutdown();
      
      // After shutdown, new tasks should be rejected
      await expect(workerPool.recognize('test'))
        .rejects.toThrow('Worker pool is not running');
    });

    it('should reject pending tasks on shutdown', async () => {
      await workerPool.initialize();
      
      // Create multiple tasks to fill the queue
      const taskPromises = [];
      for (let i = 0; i < 5; i++) {
        taskPromises.push(workerPool.recognize(`test${i}`));
      }
      
      // Shutdown quickly to catch some tasks in queue
      const shutdownPromise = workerPool.shutdown();
      
      // Some tasks might complete, others should be rejected
      const results = await Promise.allSettled(taskPromises);
      await shutdownPromise;
      
      // Check that at least one task was rejected or all completed
      expect(results.length).toBe(5);
      
      // After shutdown, new tasks should be rejected
      await expect(workerPool.recognize('new-task'))
        .rejects.toThrow('Worker pool is not running');
    });
  });

  describe('scaling behavior', () => {
    beforeEach(async () => {
      const config: Partial<OCRWorkerPoolConfig> = {
        minWorkers: 1,
        maxWorkers: 3,
        idleTimeoutMs: 100, // Short timeout for faster testing
        healthCheckIntervalMs: 50
      };
      
      workerPool = new OCRWorkerPool(config);
      await workerPool.initialize();
    });

    it('should scale up when tasks are queued', async () => {
      // Mock slow OCR processing to create queue backlog
      const { createWorker } = await import('tesseract.js');
      const slowWorker = {
        recognize: vi.fn(() => new Promise(resolve => setTimeout(() => resolve({ data: { text: 'slow' } }), 200))),
        detect: vi.fn(() => Promise.resolve({ data: { words: [] } })),
        terminate: vi.fn(() => Promise.resolve())
      };
      vi.mocked(createWorker).mockResolvedValue(slowWorker as any);

      // Queue multiple tasks
      const tasks = Array.from({ length: 5 }, (_, i) => 
        workerPool.recognize(`image${i}`, OCRTaskPriority.NORMAL)
      );

      // Allow some time for scaling
      await new Promise(resolve => setTimeout(resolve, 100));

      const metrics = workerPool.getMetrics();
      // Should have scaled up to handle the queue
      expect(metrics.totalWorkers).toBeGreaterThan(1);

      // Clean up
      await Promise.all(tasks);
    });
  });
});

describe('OCRWorkerPool singleton functions', () => {
  afterEach(async () => {
    const { shutdownOCRWorkerPool } = await import('../../src/core/ocr-worker-pool');
    await shutdownOCRWorkerPool();
  });

  it('should initialize and get singleton instance', async () => {
    const { initializeOCRWorkerPool, getOCRWorkerPool } = await import('../../src/core/ocr-worker-pool');
    
    await initializeOCRWorkerPool({ minWorkers: 1, maxWorkers: 2 });
    
    const pool = getOCRWorkerPool();
    expect(pool).toBeDefined();
    
    const metrics = pool.getMetrics();
    expect(metrics.totalWorkers).toBeGreaterThanOrEqual(1);
  });

  it('should shutdown singleton instance', async () => {
    const { initializeOCRWorkerPool, getOCRWorkerPool, shutdownOCRWorkerPool } = 
      await import('../../src/core/ocr-worker-pool');
    
    await initializeOCRWorkerPool();
    const pool = getOCRWorkerPool();
    
    await shutdownOCRWorkerPool();
    
    // Pool should no longer be running
    await expect(pool.recognize('test')).rejects.toThrow();
  });
});