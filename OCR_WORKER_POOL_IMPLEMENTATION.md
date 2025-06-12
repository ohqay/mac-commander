# OCR Worker Pool Implementation

## Overview

This implementation adds a sophisticated worker pool for Tesseract.js OCR operations to the macOS Simulator MCP server, enabling concurrent text extraction with automatic scaling, health monitoring, and performance optimization.

## Files Created/Modified

### New Files

1. **`src/core/ocr-worker-pool.ts`** - Core worker pool implementation
2. **`tests/unit/ocr-worker-pool.test.ts`** - Comprehensive test suite for the worker pool

### Modified Files

1. **`src/ocr-utils.ts`** - Updated to use worker pool with backward compatibility
2. **`tests/unit/ocr-utils.test.ts`** - Extended tests to cover new functionality

## Key Features

### 1. WorkerPool Class (`OCRWorkerPool`)

- **Automatic Scaling**: Dynamically adjusts worker count based on load (min/max configurable)
- **Task Prioritization**: Support for URGENT, HIGH, NORMAL, and LOW priority tasks
- **Health Monitoring**: Automatic worker health checks and restart on failure
- **Memory Management**: Prevents leaks from long-running OCR operations
- **Performance Tracking**: Detailed metrics per worker and pool-wide
- **Error Recovery**: Automatic retry logic and graceful degradation

### 2. Configuration Options

```typescript
interface OCRWorkerPoolConfig {
  minWorkers: number;           // Minimum workers (default: 1)
  maxWorkers: number;           // Maximum workers (default: 4)
  idleTimeoutMs: number;        // Idle worker timeout (default: 60s)
  taskTimeoutMs: number;        // Task timeout (default: 30s)
  maxRetries: number;           // Max retries per task (default: 2)
  healthCheckIntervalMs: number; // Health check frequency (default: 10s)
  language: string;             // OCR language (default: 'eng')
}
```

### 3. Task Management

- **Queue-based Processing**: Priority-ordered task queue
- **Concurrent Execution**: Multiple OCR operations in parallel
- **Load Balancing**: Intelligent worker assignment
- **Failure Handling**: Retry failed tasks with backoff

### 4. Monitoring & Metrics

```typescript
interface PoolMetrics {
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
```

## API Enhancements

### Backward Compatible Functions

All existing OCR functions now support optional priority parameters:

```typescript
// Original function (still works)
await extractTextFromImage(image);

// New with priority support
await extractTextFromImage(image, region, OCRTaskPriority.HIGH);
await findTextInImage(image, "text", OCRTaskPriority.URGENT);
await getTextLocations(image, region, OCRTaskPriority.LOW);
```

### New Concurrent Functions

```typescript
// Process multiple images concurrently
const results = await extractTextFromImages([image1, image2, image3]);

// Get locations from multiple images
const locations = await getTextLocationsFromImages([image1, image2]);
```

### New Utility Functions

```typescript
// Check if using worker pool
const usingPool = isUsingWorkerPool();

// Get performance metrics
const metrics = getOCRMetrics();

// Get worker states
const workers = getOCRWorkerStates();
```

## Initialization Options

```typescript
// Use worker pool (default)
await initializeOCR();

// Force legacy single worker
await initializeOCR(true);

// Initialize with custom config
await initializeOCRWorkerPool({
  minWorkers: 2,
  maxWorkers: 8,
  taskTimeoutMs: 45000
});
```

## Performance Benefits

1. **Parallel Processing**: Multiple OCR operations can run simultaneously
2. **Better Resource Utilization**: Automatic scaling based on demand
3. **Reduced Latency**: Workers are pre-initialized and reused
4. **Fault Tolerance**: Failed workers are automatically restarted
5. **Memory Efficiency**: Idle workers are terminated after timeout

## Error Handling

- **Worker Crashes**: Automatic worker restart
- **Task Failures**: Retry logic with exponential backoff
- **Pool Shutdown**: Graceful termination with pending task cleanup
- **Fallback**: Automatic fallback to legacy worker if pool fails

## Testing

Comprehensive test coverage including:

- Worker lifecycle management
- Task execution and prioritization
- Error handling and recovery
- Scaling behavior
- Metrics and monitoring
- Backward compatibility
- Performance tracking

## Migration Guide

The implementation is fully backward compatible. Existing code will automatically use the worker pool without changes. For optimal performance:

1. Use priority parameters for time-sensitive operations
2. Utilize concurrent functions for batch processing
3. Monitor metrics for performance optimization
4. Configure pool size based on your workload

## Example Usage

```typescript
// High-priority real-time OCR
const urgentText = await extractTextFromImage(
  screenshot, 
  region, 
  OCRTaskPriority.URGENT
);

// Batch process multiple images
const results = await extractTextFromImages(imageArray);

// Monitor performance
const metrics = getOCRMetrics();
console.log(`Average task time: ${metrics.averageTaskTime}ms`);
console.log(`Pool utilization: ${metrics.busyWorkers}/${metrics.totalWorkers}`);
```

This implementation provides a robust, scalable solution for OCR operations that maintains simplicity while offering advanced features for high-performance scenarios.