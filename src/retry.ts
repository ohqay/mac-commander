import { logger } from './logger.js';
import { isRetryableError, TimeoutError } from './errors.js';

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
  timeoutMs: 60000,
  shouldRetry: (error: Error) => isRetryableError(error)
};

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      logger.debug(`Attempting operation "${operationName}" (attempt ${attempt}/${opts.maxAttempts})`);
      
      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new TimeoutError(operationName, opts.timeoutMs));
        }, opts.timeoutMs);
      });
      
      // Race between operation and timeout
      const result = await Promise.race([
        operation(),
        timeoutPromise
      ]);
      
      logger.debug(`Operation "${operationName}" succeeded on attempt ${attempt}`);
      return result;
    } catch (error) {
      lastError = error as Error;
      logger.warn(`Operation "${operationName}" failed on attempt ${attempt}`, { error: lastError.message });
      
      // Check if we should retry
      if (attempt < opts.maxAttempts && opts.shouldRetry(lastError, attempt)) {
        const delay = Math.min(
          opts.delayMs * Math.pow(opts.backoffMultiplier, attempt - 1),
          opts.maxDelayMs
        );
        
        logger.debug(`Retrying operation "${operationName}" after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        break;
      }
    }
  }
  
  logger.error(`Operation "${operationName}" failed after ${opts.maxAttempts} attempts`, lastError!);
  throw lastError;
}

/**
 * Execute multiple operations in parallel with individual retry logic
 */
export async function withRetryBatch<T>(
  operations: Array<{
    operation: () => Promise<T>;
    name: string;
    options?: RetryOptions;
  }>
): Promise<Array<{ success: boolean; result?: T; error?: Error }>> {
  return Promise.all(
    operations.map(async ({ operation, name, options }) => {
      try {
        const result = await withRetry(operation, name, options);
        return { success: true, result };
      } catch (error) {
        return { success: false, error: error as Error };
      }
    })
  );
}

/**
 * Create a circuit breaker for operations that might fail repeatedly
 */
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly resetTimeMs: number = 60000
  ) {}

  async execute<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    // Check if circuit should be reset
    if (
      this.state === 'open' &&
      Date.now() - this.lastFailureTime > this.resetTimeMs
    ) {
      this.state = 'half-open';
      logger.info(`Circuit breaker for "${operationName}" is now half-open`);
    }

    // If circuit is open, fail fast
    if (this.state === 'open') {
      throw new Error(`Circuit breaker is open for operation "${operationName}"`);
    }

    try {
      const result = await operation();
      
      // Success - reset failure count
      if (this.state === 'half-open') {
        this.state = 'closed';
        logger.info(`Circuit breaker for "${operationName}" is now closed`);
      }
      this.failureCount = 0;
      
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'open';
        logger.error(
          `Circuit breaker for "${operationName}" is now open after ${this.failureCount} failures`
        );
      }
      
      throw error;
    }
  }

  reset(): void {
    this.failureCount = 0;
    this.state = 'closed';
    logger.info('Circuit breaker has been manually reset');
  }

  getState(): { state: string; failureCount: number } {
    return {
      state: this.state,
      failureCount: this.failureCount
    };
  }
}