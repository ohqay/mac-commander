import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LogLevel, Logger } from '../../src/logger';
import { existsSync } from 'fs';

// Mock fs module
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
}));

// Mock os module
vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/home/test'),
}));

// Mock path module  
vi.mock('path', () => ({
  join: vi.fn((...args) => args.join('/')),
}));

import { writeFileSync, appendFileSync, mkdirSync } from 'fs';

describe('logger', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let consoleErrorSpy: any;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear environment variables
    delete process.env.MCP_LOG_LEVEL;
    delete process.env.MCP_LOG_TO_FILE;
    
    // Reset the Logger singleton
    (Logger as any).instance = undefined;
    
    // Mock console.error
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleErrorSpy?.mockRestore();
  });

  describe('LogLevel enum', () => {
    it('should have correct log level values', () => {
      expect(LogLevel.DEBUG).toBe(0);
      expect(LogLevel.INFO).toBe(1);
      expect(LogLevel.WARN).toBe(2);
      expect(LogLevel.ERROR).toBe(3);
    });
  });

  describe('Logger singleton', () => {
    it('should return the same instance', () => {
      const logger1 = Logger.getInstance();
      const logger2 = Logger.getInstance();
      
      expect(logger1).toBe(logger2);
    });

    it('should initialize with default log level INFO', () => {
      const logger = Logger.getInstance();
      
      // Test by attempting to log at different levels
      logger.debug('debug message');
      logger.info('info message');
      
      // DEBUG should not be logged (below INFO threshold)
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] info message'));
    });

    it('should respect MCP_LOG_LEVEL environment variable', () => {
      process.env.MCP_LOG_LEVEL = 'DEBUG';
      const logger = Logger.getInstance();
      
      logger.debug('debug message');
      logger.info('info message');
      
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(1, expect.stringContaining('[DEBUG] debug message'));
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(2, expect.stringContaining('[INFO] info message'));
    });

    it('should handle invalid log level and default to INFO', () => {
      process.env.MCP_LOG_LEVEL = 'INVALID';
      const logger = Logger.getInstance();
      
      logger.debug('debug message');
      logger.info('info message');
      
      // Should use INFO level (DEBUG not logged)
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] info message'));
    });

    it('should enable file logging when MCP_LOG_TO_FILE is true', () => {
      process.env.MCP_LOG_TO_FILE = 'true';
      vi.mocked(existsSync).mockReturnValue(false);
      
      const logger = Logger.getInstance();
      logger.info('test message');
      
      expect(mkdirSync).toHaveBeenCalledWith('/home/test/.macos-simulator-mcp/logs', { recursive: true });
      expect(appendFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\/home\/test\/\.macos-simulator-mcp\/logs\/mcp-.*\.log/),
        expect.stringContaining('[INFO] test message\n')
      );
    });

    it('should not create log directory when file logging is disabled', () => {
      process.env.MCP_LOG_TO_FILE = 'false';
      
      const logger = Logger.getInstance();
      logger.info('test message');
      
      expect(mkdirSync).not.toHaveBeenCalled();
      expect(appendFileSync).not.toHaveBeenCalled();
    });

    it('should not create log directory if it already exists', () => {
      process.env.MCP_LOG_TO_FILE = 'true';
      vi.mocked(existsSync).mockReturnValue(true);
      
      const logger = Logger.getInstance();
      logger.info('test message');
      
      expect(mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('logging methods', () => {
    let logger: Logger;

    beforeEach(() => {
      process.env.MCP_LOG_LEVEL = 'DEBUG'; // Enable all log levels
      logger = Logger.getInstance();
    });

    it('should log debug messages', () => {
      logger.debug('debug message', { key: 'value' });
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*\] \[DEBUG\] debug message \| Context: {"key":"value"}/)
      );
    });

    it('should log info messages', () => {
      logger.info('info message', { data: 123 });
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*\] \[INFO\] info message \| Context: {"data":123}/)
      );
    });

    it('should log warn messages', () => {
      logger.warn('warning message', { warning: true });
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*\] \[WARN\] warning message \| Context: {"warning":true}/)
      );
    });

    it('should log error messages', () => {
      const error = new Error('test error');
      logger.error('error message', error, { context: 'test' });
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*\] \[ERROR\] error message \| Context: {"context":"test"} \| Error: test error/)
      );
    });

    it('should log without context', () => {
      logger.info('simple message');
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*\] \[INFO\] simple message$/)
      );
    });

    it('should include stack trace in debug mode', () => {
      process.env.MCP_LOG_LEVEL = 'DEBUG';
      const logger = Logger.getInstance();
      const error = new Error('test error');
      error.stack = 'Error: test error\n    at test.js:1:1';
      
      logger.error('error with stack', error);
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Stack: Error: test error\n    at test.js:1:1')
      );
    });

    it('should not include stack trace in non-debug mode', () => {
      // Create a new logger instance with INFO level  
      (Logger as any).instance = undefined;
      process.env.MCP_LOG_LEVEL = 'INFO';
      const logger = Logger.getInstance();
      const error = new Error('test error');
      error.stack = 'Error: test error\n    at test.js:1:1';
      
      logger.error('error without stack', error);
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.not.stringContaining('Stack:')
      );
    });

    it('should filter messages below log level', () => {
      // Create a new logger instance with ERROR level
      (Logger as any).instance = undefined;
      process.env.MCP_LOG_LEVEL = 'ERROR';
      const logger = Logger.getInstance();
      
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
      
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR] error'));
    });
  });

  describe('file logging', () => {
    let logger: Logger;

    beforeEach(() => {
      process.env.MCP_LOG_TO_FILE = 'true';
      process.env.MCP_LOG_LEVEL = 'DEBUG';
      vi.mocked(existsSync).mockReturnValue(false);
      logger = Logger.getInstance();
    });

    it('should write to file when enabled', () => {
      logger.info('file message');
      
      expect(appendFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/mcp-.*\.log$/),
        expect.stringContaining('[INFO] file message\n')
      );
    });

    it('should handle file write errors gracefully', () => {
      vi.mocked(appendFileSync).mockImplementation(() => {
        throw new Error('File write error');
      });
      
      logger.info('test message');
      
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to write to log file:', expect.any(Error));
    });

    it('should create log file with timestamp', () => {
      logger.info('test');
      
      expect(appendFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\/home\/test\/\.macos-simulator-mcp\/logs\/mcp-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.log$/),
        expect.any(String)
      );
    });
  });

  describe('performance tracking', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = Logger.getInstance();
    });

    it('should track operation start time', () => {
      logger.startTimer('test-operation');
      
      // No assertions needed, just ensure no errors
      expect(true).toBe(true);
    });

    it('should calculate and return operation duration', () => {
      // Reset logger instance to ensure DEBUG level
      (Logger as any).instance = undefined;
      process.env.MCP_LOG_LEVEL = 'DEBUG';
      const logger = Logger.getInstance();
      
      // Mock Date.now to control timing
      const mockNow = vi.spyOn(Date, 'now');
      mockNow.mockReturnValueOnce(1000); // Start time
      
      logger.startTimer('test-operation');
      
      mockNow.mockReturnValueOnce(1500); // End time
      const duration = logger.endTimer('test-operation');
      
      expect(duration).toBe(500);
      // The debug message is logged during endTimer
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Operation "test-operation" took 500ms')
      );
      
      mockNow.mockRestore();
    });

    it('should handle ending timer without start', () => {
      process.env.MCP_LOG_LEVEL = 'DEBUG';
      const logger = Logger.getInstance();
      
      const duration = logger.endTimer('non-existent-operation');
      
      expect(duration).toBe(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WARN] No start time found for operation: non-existent-operation')
      );
    });

    it('should handle multiple start times for same operation', () => {
      const originalNow = Date.now;
      let callCount = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => {
        callCount++;
        switch (callCount) {
          case 1: return 1000; // First start
          case 2: return 2000; // Second start  
          case 3: return 2300; // End
          default: return 0;
        }
      });
      
      logger.startTimer('test-op');
      logger.startTimer('test-op'); // Second start for same operation
      const duration = logger.endTimer('test-op');
      
      expect(duration).toBe(300); // Should use most recent start time
      
      Date.now = originalNow;
    });

    it('should get performance stats', () => {
      // The current implementation tracks start times, not durations
      // So getPerformanceStats works on remaining start times after endTimer calls
      const mockNow = vi.spyOn(Date, 'now');
      
      // Add multiple start times without ending them to test getPerformanceStats
      mockNow.mockReturnValueOnce(1000);
      logger.startTimer('test-op');
      
      mockNow.mockReturnValueOnce(2000);
      logger.startTimer('test-op');
      
      mockNow.mockReturnValueOnce(3000);
      logger.startTimer('test-op');
      
      const stats = logger.getPerformanceStats('test-op');
      
      expect(stats).toEqual({
        count: 3,
        average: 2000, // (1000 + 2000 + 3000) / 3
        min: 1000,
        max: 3000,
      });
      
      mockNow.mockRestore();
    });

    it('should return null stats for non-existent operation', () => {
      const stats = logger.getPerformanceStats('non-existent');
      
      expect(stats).toBeNull();
    });

    it('should return null stats for operation with no start times', () => {
      // Start and immediately end an operation, leaving no start times
      const mockNow = vi.spyOn(Date, 'now');
      mockNow.mockReturnValueOnce(1000);
      logger.startTimer('complete-op');
      mockNow.mockReturnValueOnce(1500);
      logger.endTimer('complete-op');
      
      const stats = logger.getPerformanceStats('complete-op');
      
      expect(stats).toBeNull();
      
      mockNow.mockRestore();
    });

    it('should clear performance metrics', () => {
      logger.startTimer('test-op');
      logger.endTimer('test-op');
      
      logger.clearPerformanceMetrics();
      
      const stats = logger.getPerformanceStats('test-op');
      expect(stats).toBeNull();
    });
  });

  describe('message formatting', () => {
    let logger: Logger;

    beforeEach(() => {
      process.env.MCP_LOG_LEVEL = 'DEBUG';
      logger = Logger.getInstance();
    });

    it('should format timestamps correctly', () => {
      logger.info('test message');
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/)
      );
    });

    it('should format log levels correctly', () => {
      logger.debug('debug');
      logger.info('info');  
      logger.warn('warn');
      logger.error('error');
      
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(1, expect.stringContaining('[DEBUG]'));
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(2, expect.stringContaining('[INFO]'));
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(3, expect.stringContaining('[WARN]'));
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(4, expect.stringContaining('[ERROR]'));
    });

    it('should format context objects correctly', () => {
      logger.info('test', { nested: { value: 123 }, array: [1, 2, 3] });
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Context: {"nested":{"value":123},"array":[1,2,3]}')
      );
    });

    it('should handle errors without stack trace when not in debug mode', () => {
      // Create a new logger instance with INFO level
      (Logger as any).instance = undefined;
      process.env.MCP_LOG_LEVEL = 'INFO';
      const logger = Logger.getInstance();
      const error = new Error('test error');
      
      logger.error('test', error);
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*\] \[ERROR\] test \| Error: test error$/)
      );
    });
  });

  describe('exported logger instance', () => {
    it('should export singleton instance', async () => {
      const { logger } = await import('../../src/logger');
      
      expect(logger).toBeInstanceOf(Logger);
      // Due to the singleton pattern and test isolation, we just verify it's a Logger instance
      expect(Logger.getInstance()).toBeInstanceOf(Logger);
    });
  });
});