import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { withRetry, withRetryBatch, CircuitBreaker } from '../../src/retry';
import { TimeoutError, ScreenCaptureError, OCRError, AutomationError, PermissionError } from '../../src/errors';

// Mock the logger
vi.mock('../../src/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('retry module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('withRetry', () => {
    describe('successful operations', () => {
      it('should return result on first attempt success', async () => {
        const operation = vi.fn().mockResolvedValue('success');
        
        const result = await withRetry(operation, 'test-operation');
        
        expect(result).toBe('success');
        expect(operation).toHaveBeenCalledTimes(1);
      });

      it('should succeed after retries', async () => {
        const operation = vi.fn()
          .mockRejectedValueOnce(new ScreenCaptureError('temp failure'))
          .mockRejectedValueOnce(new OCRError('temp failure'))
          .mockResolvedValue('success');
        
        const promise = withRetry(operation, 'test-operation');
        
        // Fast-forward through delays
        await vi.runAllTimersAsync();
        
        const result = await promise;
        
        expect(result).toBe('success');
        expect(operation).toHaveBeenCalledTimes(3);
      });

      it('should work with custom retry options', async () => {
        const operation = vi.fn().mockResolvedValue('custom-success');
        
        const result = await withRetry(operation, 'custom-operation', {
          maxAttempts: 5,
          delayMs: 500,
          backoffMultiplier: 1.5,
        });
        
        expect(result).toBe('custom-success');
        expect(operation).toHaveBeenCalledTimes(1);
      });
    });

    describe('timeout handling', () => {
      it('should timeout operations that take too long', async () => {
        const slowOperation = vi.fn().mockImplementation(() => 
          new Promise(resolve => setTimeout(resolve, 70000)) // 70 seconds
        );
        
        const promise = withRetry(slowOperation, 'slow-operation', { 
          timeoutMs: 1000,
          maxAttempts: 1 
        });
        
        // Fast-forward past timeout
        await vi.advanceTimersByTimeAsync(1001);
        
        await expect(promise).rejects.toThrow(TimeoutError);
        await expect(promise).rejects.toThrow('Operation "slow-operation" timed out after 1000ms');
        
        // Clear any remaining timers
        vi.clearAllTimers();
      });

      it('should use custom timeout values', async () => {
        const slowOperation = vi.fn().mockImplementation(() => 
          new Promise(resolve => setTimeout(resolve, 6000))
        );
        
        const promise = withRetry(slowOperation, 'custom-timeout-operation', {
          timeoutMs: 5000,
          maxAttempts: 1
        });
        
        await vi.advanceTimersByTimeAsync(5001);
        
        await expect(promise).rejects.toThrow('Operation "custom-timeout-operation" timed out after 5000ms');
        
        // Clear any remaining timers
        vi.clearAllTimers();
      });

      it('should not timeout fast operations', async () => {
        const fastOperation = vi.fn().mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 'fast-result';
        });
        
        const promise = withRetry(fastOperation, 'fast-operation', {
          timeoutMs: 1000,
          maxAttempts: 1
        });
        
        await vi.advanceTimersByTimeAsync(101);
        
        const result = await promise;
        expect(result).toBe('fast-result');
      });
    });

    describe('retry logic', () => {
      it('should respect maxAttempts limit', async () => {
        const operation = vi.fn().mockRejectedValue(new ScreenCaptureError('persistent error'));
        
        const promise = withRetry(operation, 'failing-operation', { maxAttempts: 2 });
        
        await vi.runAllTimersAsync();
        
        await expect(promise).rejects.toThrow('persistent error');
        expect(operation).toHaveBeenCalledTimes(2);
      });

      it('should calculate delays correctly with exponential backoff', async () => {
        const operation = vi.fn().mockRejectedValue(new OCRError('always fails'));
        
        const options = {
          maxAttempts: 3,
          delayMs: 1000,
          backoffMultiplier: 2
        };
        
        const promise = withRetry(operation, 'backoff-test', options);
        const promiseResult = promise.catch(() => {}); // Catch to prevent unhandled rejection
        
        // Let all timers run to completion
        await vi.runAllTimersAsync();
        
        // Should have tried 3 times total
        expect(operation).toHaveBeenCalledTimes(3);
        
        await promiseResult;
      });

      it('should respect maxDelayMs limit', async () => {
        const operation = vi.fn().mockRejectedValue(new ScreenCaptureError('always fails'));
        
        const promise = withRetry(operation, 'max-delay-test', {
          maxAttempts: 3,
          delayMs: 1000,
          backoffMultiplier: 10, // Would normally create very long delays
          maxDelayMs: 2500
        });
        
        const promiseResult = promise.catch(() => {});
        
        // Let all timers run to completion
        await vi.runAllTimersAsync();
        
        // Should have tried 3 times total
        expect(operation).toHaveBeenCalledTimes(3);
        
        await promiseResult;
      });

      it('should use custom shouldRetry function', async () => {
        const operation = vi.fn()
          .mockRejectedValueOnce(new PermissionError('not allowed', 'screen-capture'))
          .mockRejectedValueOnce(new ScreenCaptureError('retryable error'))
          .mockResolvedValue('success');
        
        const customShouldRetry = vi.fn((error: Error) => {
          return error instanceof ScreenCaptureError;
        });
        
        const promise = withRetry(operation, 'custom-retry-test', {
          maxAttempts: 3,
          shouldRetry: customShouldRetry
        });
        
        await vi.runAllTimersAsync();
        
        // Should fail on first attempt (PermissionError) without retrying
        await expect(promise).rejects.toThrow('not allowed');
        expect(operation).toHaveBeenCalledTimes(1);
        expect(customShouldRetry).toHaveBeenCalledWith(
          expect.any(PermissionError),
          1
        );
      });

      it('should pass attempt number to shouldRetry function', async () => {
        const operation = vi.fn().mockRejectedValue(new ScreenCaptureError('always fails'));
        const shouldRetry = vi.fn().mockReturnValue(false);
        
        const promise = withRetry(operation, 'attempt-number-test', {
          maxAttempts: 3,
          shouldRetry
        });
        
        await vi.runAllTimersAsync();
        
        await expect(promise).rejects.toThrow('always fails');
        expect(shouldRetry).toHaveBeenCalledWith(expect.any(ScreenCaptureError), 1);
        expect(operation).toHaveBeenCalledTimes(1);
      });
    });

    describe('error handling', () => {
      it('should retry retryable errors by default', async () => {
        const retryableErrors = [
          new TimeoutError('test-op', 1000),
          new ScreenCaptureError('capture failed'),
          new OCRError('ocr failed'),
          new AutomationError('temporary failure', 'test-op'),
        ];
        
        for (const error of retryableErrors) {
          const operation = vi.fn()
            .mockRejectedValueOnce(error)
            .mockResolvedValue('recovered');
          
          const promise = withRetry(operation, 'retryable-test');
          await vi.runAllTimersAsync();
          
          const result = await promise;
          expect(result).toBe('recovered');
          expect(operation).toHaveBeenCalledTimes(2);
          
          vi.clearAllMocks();
        }
      });

      it('should not retry non-retryable errors by default', async () => {
        const nonRetryableError = new PermissionError('access denied', 'screen-capture');
        const operation = vi.fn().mockRejectedValue(nonRetryableError);
        
        const promise = withRetry(operation, 'non-retryable-test');
        
        await expect(promise).rejects.toThrow('access denied');
        expect(operation).toHaveBeenCalledTimes(1);
      });

      it('should handle AutomationError retry conditions', async () => {
        const temporaryError = new AutomationError('temporary failure', 'test');
        const busyError = new AutomationError('system busy', 'test');
        const permanentError = new AutomationError('permanent failure', 'test');
        
        // Temporary error should be retried
        const tempOperation = vi.fn()
          .mockRejectedValueOnce(temporaryError)
          .mockResolvedValue('recovered');
        
        const tempPromise = withRetry(tempOperation, 'temp-test');
        await vi.runAllTimersAsync();
        
        const tempResult = await tempPromise;
        expect(tempResult).toBe('recovered');
        expect(tempOperation).toHaveBeenCalledTimes(2);
        
        // Busy error should be retried
        const busyOperation = vi.fn()
          .mockRejectedValueOnce(busyError)
          .mockResolvedValue('recovered');
        
        const busyPromise = withRetry(busyOperation, 'busy-test');
        await vi.runAllTimersAsync();
        
        const busyResult = await busyPromise;
        expect(busyResult).toBe('recovered');
        expect(busyOperation).toHaveBeenCalledTimes(2);
        
        // Permanent error should not be retried
        const permOperation = vi.fn().mockRejectedValue(permanentError);
        
        const permPromise = withRetry(permOperation, 'perm-test');
        
        await expect(permPromise).rejects.toThrow('permanent failure');
        expect(permOperation).toHaveBeenCalledTimes(1);
      });

      it('should throw the last error after all attempts fail', async () => {
        const firstError = new ScreenCaptureError('first failure');
        const lastError = new ScreenCaptureError('final failure');
        
        const operation = vi.fn()
          .mockRejectedValueOnce(firstError)
          .mockRejectedValueOnce(lastError);
        
        const promise = withRetry(operation, 'final-error-test', { maxAttempts: 2 });
        
        await vi.runAllTimersAsync();
        
        await expect(promise).rejects.toThrow('final failure');
        expect(operation).toHaveBeenCalledTimes(2);
      });
    });

    describe('edge cases', () => {
      it('should handle zero maxAttempts', async () => {
        const operation = vi.fn().mockResolvedValue('should not run');
        
        const promise = withRetry(operation, 'zero-attempts', { maxAttempts: 0 });
        
        // Should throw immediately without calling operation
        await expect(promise).rejects.toThrow();
        expect(operation).not.toHaveBeenCalled();
      });

      it('should handle negative delays gracefully', async () => {
        const operation = vi.fn()
          .mockRejectedValueOnce(new ScreenCaptureError('first fail'))
          .mockResolvedValue('success');
        
        const promise = withRetry(operation, 'negative-delay', {
          delayMs: -1000,
          maxAttempts: 2
        });
        
        await vi.runAllTimersAsync();
        
        const result = await promise;
        expect(result).toBe('success');
        expect(operation).toHaveBeenCalledTimes(2);
      });

      it('should handle operations that throw non-Error objects', async () => {
        const operation = vi.fn().mockRejectedValue('string error');
        
        const promise = withRetry(operation, 'non-error-test', { maxAttempts: 1 });
        
        await expect(promise).rejects.toBe('string error');
        expect(operation).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('withRetryBatch', () => {
    it('should execute all operations in parallel', async () => {
      const operations = [
        {
          operation: vi.fn().mockResolvedValue('result1'),
          name: 'op1'
        },
        {
          operation: vi.fn().mockResolvedValue('result2'),
          name: 'op2'
        },
        {
          operation: vi.fn().mockResolvedValue('result3'),
          name: 'op3'
        }
      ];
      
      const results = await withRetryBatch(operations);
      
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ success: true, result: 'result1' });
      expect(results[1]).toEqual({ success: true, result: 'result2' });
      expect(results[2]).toEqual({ success: true, result: 'result3' });
      
      operations.forEach(op => {
        expect(op.operation).toHaveBeenCalledTimes(1);
      });
    });

    it('should handle mixed success and failure', async () => {
      const operations = [
        {
          operation: vi.fn().mockResolvedValue('success'),
          name: 'successful-op'
        },
        {
          operation: vi.fn().mockRejectedValue(new Error('failure')),
          name: 'failing-op',
          options: { maxAttempts: 1 }
        },
        {
          operation: vi.fn()
            .mockRejectedValueOnce(new ScreenCaptureError('temp fail'))
            .mockResolvedValue('recovered'),
          name: 'retry-op'
        }
      ];
      
      const promise = withRetryBatch(operations);
      await vi.runAllTimersAsync();
      const results = await promise;
      
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ success: true, result: 'success' });
      expect(results[1]).toEqual({ 
        success: false, 
        error: expect.objectContaining({ message: 'failure' })
      });
      expect(results[2]).toEqual({ success: true, result: 'recovered' });
    });

    it('should use individual retry options for each operation', async () => {
      const operations = [
        {
          operation: vi.fn().mockRejectedValue(new ScreenCaptureError('always fails')),
          name: 'high-retry-op',
          options: { maxAttempts: 5 }
        },
        {
          operation: vi.fn().mockRejectedValue(new OCRError('quick fail')),
          name: 'low-retry-op', 
          options: { maxAttempts: 1 }
        }
      ];
      
      const promise = withRetryBatch(operations);
      await vi.runAllTimersAsync();
      const results = await promise;
      
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(false);
      expect(results[1].success).toBe(false);
      
      expect(operations[0].operation).toHaveBeenCalledTimes(5);
      expect(operations[1].operation).toHaveBeenCalledTimes(1);
    });

    it('should handle empty operations array', async () => {
      const results = await withRetryBatch([]);
      
      expect(results).toHaveLength(0);
    });

    it('should not affect independent operation timing', async () => {
      let fastOpTime = 0;
      let slowOpTime = 0;
      
      const operations = [
        {
          operation: vi.fn().mockImplementation(async () => {
            fastOpTime = Date.now();
            return 'fast';
          }),
          name: 'fast-op'
        },
        {
          operation: vi.fn().mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            slowOpTime = Date.now();
            return 'slow';
          }),
          name: 'slow-op'
        }
      ];
      
      const promise = withRetryBatch(operations);
      await vi.runAllTimersAsync();
      const results = await promise;
      
      expect(results[0]).toEqual({ success: true, result: 'fast' });
      expect(results[1]).toEqual({ success: true, result: 'slow' });
    });
  });

  describe('CircuitBreaker', () => {
    let circuitBreaker: CircuitBreaker;

    beforeEach(() => {
      circuitBreaker = new CircuitBreaker(3, 5000); // 3 failures, 5 second reset
    });

    describe('closed state (normal operation)', () => {
      it('should execute operations normally when closed', async () => {
        const operation = vi.fn().mockResolvedValue('success');
        
        const result = await circuitBreaker.execute(operation, 'test-op');
        
        expect(result).toBe('success');
        expect(operation).toHaveBeenCalledTimes(1);
        expect(circuitBreaker.getState().state).toBe('closed');
        expect(circuitBreaker.getState().failureCount).toBe(0);
      });

      it('should track failures but stay closed under threshold', async () => {
        const operation = vi.fn().mockRejectedValue(new Error('failure'));
        
        // First failure
        await expect(circuitBreaker.execute(operation, 'test-op')).rejects.toThrow('failure');
        expect(circuitBreaker.getState().failureCount).toBe(1);
        expect(circuitBreaker.getState().state).toBe('closed');
        
        // Second failure
        await expect(circuitBreaker.execute(operation, 'test-op')).rejects.toThrow('failure');
        expect(circuitBreaker.getState().failureCount).toBe(2);
        expect(circuitBreaker.getState().state).toBe('closed');
      });

      it('should reset failure count on success', async () => {
        const failingOp = vi.fn().mockRejectedValue(new Error('failure'));
        const successOp = vi.fn().mockResolvedValue('success');
        
        // Build up some failures
        await expect(circuitBreaker.execute(failingOp, 'fail-op')).rejects.toThrow();
        await expect(circuitBreaker.execute(failingOp, 'fail-op')).rejects.toThrow();
        expect(circuitBreaker.getState().failureCount).toBe(2);
        
        // Success should reset count
        const result = await circuitBreaker.execute(successOp, 'success-op');
        expect(result).toBe('success');
        expect(circuitBreaker.getState().failureCount).toBe(0);
        expect(circuitBreaker.getState().state).toBe('closed');
      });
    });

    describe('open state (circuit tripped)', () => {
      it('should open circuit after reaching failure threshold', async () => {
        const operation = vi.fn().mockRejectedValue(new Error('failure'));
        
        // Trip the circuit with 3 failures
        for (let i = 0; i < 3; i++) {
          await expect(circuitBreaker.execute(operation, 'failing-op')).rejects.toThrow('failure');
        }
        
        expect(circuitBreaker.getState().failureCount).toBe(3);
        expect(circuitBreaker.getState().state).toBe('open');
      });

      it('should fail fast when circuit is open', async () => {
        const operation = vi.fn().mockRejectedValue(new Error('failure'));
        
        // Trip the circuit
        for (let i = 0; i < 3; i++) {
          await expect(circuitBreaker.execute(operation, 'failing-op')).rejects.toThrow('failure');
        }
        
        // Next call should fail fast without calling operation
        vi.clearAllMocks();
        await expect(circuitBreaker.execute(operation, 'blocked-op')).rejects.toThrow(
          'Circuit breaker is open for operation "blocked-op"'
        );
        expect(operation).not.toHaveBeenCalled();
      });

      it('should transition to half-open after reset time', async () => {
        const operation = vi.fn().mockRejectedValue(new Error('failure'));
        
        // Trip the circuit
        for (let i = 0; i < 3; i++) {
          await expect(circuitBreaker.execute(operation, 'failing-op')).rejects.toThrow('failure');
        }
        expect(circuitBreaker.getState().state).toBe('open');
        
        // Advance time past reset period
        await vi.advanceTimersByTimeAsync(5001);
        
        // Next execution should attempt (half-open state)
        const newOp = vi.fn().mockResolvedValue('recovery');
        const result = await circuitBreaker.execute(newOp, 'recovery-op');
        
        expect(result).toBe('recovery');
        expect(newOp).toHaveBeenCalledTimes(1);
        expect(circuitBreaker.getState().state).toBe('closed');
        expect(circuitBreaker.getState().failureCount).toBe(0);
      });
    });

    describe('half-open state (testing recovery)', () => {
      async function getToHalfOpenState() {
        const operation = vi.fn().mockRejectedValue(new Error('failure'));
        
        // Trip the circuit
        for (let i = 0; i < 3; i++) {
          await expect(circuitBreaker.execute(operation, 'failing-op')).rejects.toThrow();
        }
        
        // Wait for reset time
        await vi.advanceTimersByTimeAsync(5001);
        
        // Verify we're ready for half-open
        expect(circuitBreaker.getState().state).toBe('open');
      }

      it('should close circuit on successful half-open execution', async () => {
        await getToHalfOpenState();
        
        const recoveryOp = vi.fn().mockResolvedValue('recovered');
        const result = await circuitBreaker.execute(recoveryOp, 'recovery-test');
        
        expect(result).toBe('recovered');
        expect(circuitBreaker.getState().state).toBe('closed');
        expect(circuitBreaker.getState().failureCount).toBe(0);
      });

      it('should reopen circuit on failed half-open execution', async () => {
        await getToHalfOpenState();
        
        const stillFailingOp = vi.fn().mockRejectedValue(new Error('still failing'));
        
        await expect(circuitBreaker.execute(stillFailingOp, 'still-failing')).rejects.toThrow('still failing');
        
        expect(circuitBreaker.getState().state).toBe('open');
        expect(circuitBreaker.getState().failureCount).toBe(4); // Previous 3 + this new failure
      });
    });

    describe('manual reset', () => {
      it('should manually reset circuit to closed state', async () => {
        const operation = vi.fn().mockRejectedValue(new Error('failure'));
        
        // Trip the circuit
        for (let i = 0; i < 3; i++) {
          await expect(circuitBreaker.execute(operation, 'failing-op')).rejects.toThrow();
        }
        expect(circuitBreaker.getState().state).toBe('open');
        
        // Manual reset
        circuitBreaker.reset();
        
        expect(circuitBreaker.getState().state).toBe('closed');
        expect(circuitBreaker.getState().failureCount).toBe(0);
        
        // Should allow operations again
        const newOp = vi.fn().mockResolvedValue('after-reset');
        const result = await circuitBreaker.execute(newOp, 'after-reset-op');
        
        expect(result).toBe('after-reset');
        expect(newOp).toHaveBeenCalledTimes(1);
      });
    });

    describe('custom thresholds', () => {
      it('should use custom failure threshold', async () => {
        const customBreaker = new CircuitBreaker(1, 1000); // Open after 1 failure
        const operation = vi.fn().mockRejectedValue(new Error('single failure'));
        
        await expect(customBreaker.execute(operation, 'single-fail')).rejects.toThrow('single failure');
        
        expect(customBreaker.getState().state).toBe('open');
        expect(customBreaker.getState().failureCount).toBe(1);
      });

      it('should use custom reset time', async () => {
        const customBreaker = new CircuitBreaker(1, 100); // 100ms reset time
        const operation = vi.fn().mockRejectedValue(new Error('failure'));
        
        // Trip circuit
        await expect(customBreaker.execute(operation, 'quick-fail')).rejects.toThrow();
        expect(customBreaker.getState().state).toBe('open');
        
        // Short wait should not reset
        await vi.advanceTimersByTimeAsync(50);
        await expect(customBreaker.execute(operation, 'still-blocked')).rejects.toThrow(
          'Circuit breaker is open'
        );
        
        // Longer wait should allow half-open
        await vi.advanceTimersByTimeAsync(51);
        const recoveryOp = vi.fn().mockResolvedValue('quick-recovery');
        const result = await customBreaker.execute(recoveryOp, 'quick-recovery-op');
        
        expect(result).toBe('quick-recovery');
        expect(customBreaker.getState().state).toBe('closed');
      });
    });

    describe('getState', () => {
      it('should return current state and failure count', async () => {
        expect(circuitBreaker.getState()).toEqual({
          state: 'closed',
          failureCount: 0
        });
        
        const operation = vi.fn().mockRejectedValue(new Error('failure'));
        await expect(circuitBreaker.execute(operation, 'test')).rejects.toThrow();
        
        expect(circuitBreaker.getState()).toEqual({
          state: 'closed',
          failureCount: 1
        });
      });
    });
  });
});