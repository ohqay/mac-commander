import { describe, it, expect } from 'vitest';
import {
  MCPError,
  PermissionError,
  ScreenCaptureError,
  WindowNotFoundError,
  OCRError,
  ValidationError,
  TimeoutError,
  CoordinateOutOfBoundsError,
  FileSystemError,
  AutomationError,
  isRetryableError,
  getUserFriendlyErrorMessage
} from '../../src/errors';

describe('errors', () => {
  describe('MCPError', () => {
    it('should create error with message, code, and details', () => {
      const error = new MCPError('Test error', 'TEST_CODE', { detail: 'value' });
      
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.details).toEqual({ detail: 'value' });
      expect(error.name).toBe('MCPError');
    });

    it('should create error without details', () => {
      const error = new MCPError('Test error', 'TEST_CODE');
      
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.details).toBeUndefined();
    });
  });

  describe('PermissionError', () => {
    it('should create permission error with permission type', () => {
      const error = new PermissionError('Access denied', 'screenRecording', { extra: 'info' });
      
      expect(error.message).toBe('Access denied');
      expect(error.code).toBe('PERMISSION_DENIED');
      expect(error.permission).toBe('screenRecording');
      expect(error.details).toEqual({ extra: 'info' });
      expect(error.name).toBe('PermissionError');
    });

    it('should create permission error without details', () => {
      const error = new PermissionError('Access denied', 'accessibility');
      
      expect(error.message).toBe('Access denied');
      expect(error.permission).toBe('accessibility');
      expect(error.details).toBeUndefined();
    });
  });

  describe('ScreenCaptureError', () => {
    it('should create screen capture error', () => {
      const error = new ScreenCaptureError('Failed to capture screen', { retryCount: 3 });
      
      expect(error.message).toBe('Failed to capture screen');
      expect(error.code).toBe('SCREEN_CAPTURE_FAILED');
      expect(error.details).toEqual({ retryCount: 3 });
    });

    it('should create screen capture error without details', () => {
      const error = new ScreenCaptureError('Failed to capture screen');
      
      expect(error.message).toBe('Failed to capture screen');
      expect(error.details).toBeUndefined();
    });
  });

  describe('WindowNotFoundError', () => {
    it('should create window not found error with formatted message', () => {
      const error = new WindowNotFoundError('Terminal', { processId: 1234 });
      
      expect(error.message).toBe('Window with title "Terminal" not found');
      expect(error.code).toBe('WINDOW_NOT_FOUND');
      expect(error.details).toEqual({ processId: 1234 });
    });

    it('should create window not found error without details', () => {
      const error = new WindowNotFoundError('Browser');
      
      expect(error.message).toBe('Window with title "Browser" not found');
      expect(error.details).toBeUndefined();
    });
  });

  describe('OCRError', () => {
    it('should create OCR error', () => {
      const error = new OCRError('Text extraction failed', { engine: 'tesseract' });
      
      expect(error.message).toBe('Text extraction failed');
      expect(error.code).toBe('OCR_FAILED');
      expect(error.details).toEqual({ engine: 'tesseract' });
    });
  });

  describe('ValidationError', () => {
    it('should create validation error with field info', () => {
      const error = new ValidationError('Invalid value', 'coordinates', { min: 0, max: 100 });
      
      expect(error.message).toBe('Invalid value');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.field).toBe('coordinates');
      expect(error.details).toEqual({ field: 'coordinates', min: 0, max: 100 });
    });

    it('should create validation error without extra details', () => {
      const error = new ValidationError('Required field missing', 'username');
      
      expect(error.field).toBe('username');
      expect(error.details).toEqual({ field: 'username' });
    });
  });

  describe('TimeoutError', () => {
    it('should create timeout error with formatted message', () => {
      const error = new TimeoutError('screenshot', 5000, { attempt: 2 });
      
      expect(error.message).toBe('Operation "screenshot" timed out after 5000ms');
      expect(error.code).toBe('TIMEOUT');
      expect(error.details).toEqual({ attempt: 2 });
    });

    it('should create timeout error without details', () => {
      const error = new TimeoutError('OCR processing', 30000);
      
      expect(error.message).toBe('Operation "OCR processing" timed out after 30000ms');
      expect(error.details).toBeUndefined();
    });
  });

  describe('CoordinateOutOfBoundsError', () => {
    it('should create coordinate error with formatted message and details', () => {
      const error = new CoordinateOutOfBoundsError(2000, 1500, 1920, 1080);
      
      expect(error.message).toBe('Coordinates (2000, 1500) are out of screen bounds (1920x1080)');
      expect(error.code).toBe('COORDINATES_OUT_OF_BOUNDS');
      expect(error.details).toEqual({
        x: 2000,
        y: 1500,
        screenWidth: 1920,
        screenHeight: 1080
      });
    });
  });

  describe('FileSystemError', () => {
    it('should create file system error with path info', () => {
      const error = new FileSystemError('Permission denied', '/tmp/test.png', { errno: -13 });
      
      expect(error.message).toBe('Permission denied');
      expect(error.code).toBe('FILE_SYSTEM_ERROR');
      expect(error.details).toEqual({ path: '/tmp/test.png', errno: -13 });
    });

    it('should create file system error without extra details', () => {
      const error = new FileSystemError('File not found', '/missing/file.txt');
      
      expect(error.details).toEqual({ path: '/missing/file.txt' });
    });
  });

  describe('AutomationError', () => {
    it('should create automation error with operation info', () => {
      const error = new AutomationError('Click failed', 'mouse_click', { button: 'left' });
      
      expect(error.message).toBe('Click failed');
      expect(error.code).toBe('AUTOMATION_ERROR');
      expect(error.details).toEqual({ operation: 'mouse_click', button: 'left' });
    });

    it('should create automation error without extra details', () => {
      const error = new AutomationError('Key press failed', 'keyboard_input');
      
      expect(error.details).toEqual({ operation: 'keyboard_input' });
    });
  });

  describe('isRetryableError', () => {
    it('should return true for retryable error types', () => {
      expect(isRetryableError(new TimeoutError('test', 1000))).toBe(true);
      expect(isRetryableError(new ScreenCaptureError('failed'))).toBe(true);
      expect(isRetryableError(new OCRError('failed'))).toBe(true);
    });

    it('should return true for retryable automation errors', () => {
      expect(isRetryableError(new AutomationError('Service temporary unavailable', 'click'))).toBe(true);
      expect(isRetryableError(new AutomationError('System is busy', 'type'))).toBe(true);
    });

    it('should return false for non-retryable automation errors', () => {
      expect(isRetryableError(new AutomationError('Invalid coordinates', 'click'))).toBe(false);
      expect(isRetryableError(new AutomationError('Permission denied permanently', 'type'))).toBe(false);
    });

    it('should return false for non-retryable error types', () => {
      expect(isRetryableError(new PermissionError('denied', 'screen'))).toBe(false);
      expect(isRetryableError(new WindowNotFoundError('test'))).toBe(false);
      expect(isRetryableError(new ValidationError('invalid', 'field'))).toBe(false);
      expect(isRetryableError(new CoordinateOutOfBoundsError(100, 100, 50, 50))).toBe(false);
      expect(isRetryableError(new FileSystemError('error', '/path'))).toBe(false);
      expect(isRetryableError(new Error('generic error'))).toBe(false);
    });
  });

  describe('getUserFriendlyErrorMessage', () => {
    it('should return friendly message for PermissionError', () => {
      const error = new PermissionError('Access denied', 'screenRecording');
      const message = getUserFriendlyErrorMessage(error);
      
      expect(message).toBe('Permission denied: screenRecording. Please grant the required permission in System Preferences > Security & Privacy.');
    });

    it('should return friendly message for ScreenCaptureError', () => {
      const error = new ScreenCaptureError('Capture failed');
      const message = getUserFriendlyErrorMessage(error);
      
      expect(message).toBe('Screen capture failed: Capture failed. Make sure Screen Recording permission is granted.');
    });

    it('should return message for WindowNotFoundError', () => {
      const error = new WindowNotFoundError('Browser');
      const message = getUserFriendlyErrorMessage(error);
      
      expect(message).toBe('Window with title "Browser" not found');
    });

    it('should return friendly message for OCRError', () => {
      const error = new OCRError('Text extraction failed');
      const message = getUserFriendlyErrorMessage(error);
      
      expect(message).toBe('Text recognition failed: Text extraction failed. The image might be unclear or contain no text.');
    });

    it('should return friendly message for ValidationError', () => {
      const error = new ValidationError('Value out of range', 'coordinates');
      const message = getUserFriendlyErrorMessage(error);
      
      expect(message).toBe('Invalid input for coordinates: Value out of range');
    });

    it('should return message for TimeoutError', () => {
      const error = new TimeoutError('screenshot', 5000);
      const message = getUserFriendlyErrorMessage(error);
      
      expect(message).toBe('Operation "screenshot" timed out after 5000ms');
    });

    it('should return message for CoordinateOutOfBoundsError', () => {
      const error = new CoordinateOutOfBoundsError(2000, 1500, 1920, 1080);
      const message = getUserFriendlyErrorMessage(error);
      
      expect(message).toBe('Coordinates (2000, 1500) are out of screen bounds (1920x1080)');
    });

    it('should return friendly message for FileSystemError', () => {
      const error = new FileSystemError('Permission denied', '/tmp/test.png');
      const message = getUserFriendlyErrorMessage(error);
      
      expect(message).toBe('File system error: Permission denied');
    });

    it('should return friendly message for AutomationError', () => {
      const error = new AutomationError('Click failed', 'mouse_click');
      const message = getUserFriendlyErrorMessage(error);
      
      expect(message).toBe('Automation failed: Click failed');
    });

    it('should return generic message for unknown error types', () => {
      const error = new Error('Something went wrong');
      const message = getUserFriendlyErrorMessage(error);
      
      expect(message).toBe('An unexpected error occurred: Something went wrong');
    });
  });
});