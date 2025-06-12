import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { existsSync } from 'fs';

// Mock modules before importing validation
vi.mock('@nut-tree-fork/nut-js', async () => {
  const { mockScreen, mockMouse, mockKeyboard, Region, Point, Button, Key, Image } = await import('../mocks/nut-js.mock');
  return {
    screen: mockScreen,
    mouse: mockMouse,
    keyboard: mockKeyboard,
    Region,
    Point,
    Button,
    Key,
    Image,
  };
});

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

// Mock path module
vi.mock('path', () => ({
  dirname: vi.fn(),
}));

// Mock logger
vi.mock('../../src/logger', () => ({
  logger: {
    debug: vi.fn(),
  },
}));

import {
  getScreenDimensions,
  validateCoordinates,
  validateRegion,
  validateFilePath,
  validateToolInput,
  clearScreenDimensionsCache,
  EnhancedScreenshotToolSchema,
  EnhancedClickToolSchema,
  EnhancedTypeTextToolSchema,
  EnhancedWaitToolSchema,
  EnhancedKeyPressToolSchema,
} from '../../src/validation';
import { ValidationError, CoordinateOutOfBoundsError } from '../../src/errors';
import { mockScreen } from '../mocks/nut-js.mock';
import { dirname } from 'path';

describe('validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearScreenDimensionsCache();
    // Reset screen mock to default values
    mockScreen.width.mockResolvedValue(1920);
    mockScreen.height.mockResolvedValue(1080);
  });

  afterEach(() => {
    clearScreenDimensionsCache();
  });

  describe('getScreenDimensions', () => {
    it('should return screen dimensions', async () => {
      const dimensions = await getScreenDimensions();
      
      expect(dimensions).toEqual({ width: 1920, height: 1080 });
      expect(mockScreen.width).toHaveBeenCalledOnce();
      expect(mockScreen.height).toHaveBeenCalledOnce();
    });

    it('should cache screen dimensions for 1 minute', async () => {
      // First call
      const dimensions1 = await getScreenDimensions();
      
      // Second call should use cache
      const dimensions2 = await getScreenDimensions();
      
      expect(dimensions1).toEqual(dimensions2);
      expect(mockScreen.width).toHaveBeenCalledOnce();
      expect(mockScreen.height).toHaveBeenCalledOnce();
    });

    it('should refresh cached dimensions after cache expires', async () => {
      // Mock Date.now to control cache expiration
      const originalDateNow = Date.now;
      let currentTime = 1000000;
      vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

      // First call
      await getScreenDimensions();
      expect(mockScreen.width).toHaveBeenCalledTimes(1);

      // Advance time by more than cache duration (60000ms)
      currentTime += 70000;
      
      // Second call should refresh cache
      await getScreenDimensions();
      expect(mockScreen.width).toHaveBeenCalledTimes(2);

      // Restore original Date.now
      Date.now = originalDateNow;
    });

    it('should handle different screen dimensions', async () => {
      mockScreen.width.mockResolvedValue(2560);
      mockScreen.height.mockResolvedValue(1440);

      const dimensions = await getScreenDimensions();
      
      expect(dimensions).toEqual({ width: 2560, height: 1440 });
    });
  });

  describe('validateCoordinates', () => {
    it('should not throw for valid coordinates', async () => {
      await expect(validateCoordinates(100, 200)).resolves.not.toThrow();
      await expect(validateCoordinates(0, 0)).resolves.not.toThrow();
      await expect(validateCoordinates(1919, 1079)).resolves.not.toThrow();
    });

    it('should throw CoordinateOutOfBoundsError for negative x coordinate', async () => {
      await expect(validateCoordinates(-1, 100))
        .rejects.toThrow(CoordinateOutOfBoundsError);
    });

    it('should throw CoordinateOutOfBoundsError for negative y coordinate', async () => {
      await expect(validateCoordinates(100, -1))
        .rejects.toThrow(CoordinateOutOfBoundsError);
    });

    it('should throw CoordinateOutOfBoundsError for x coordinate at screen width', async () => {
      await expect(validateCoordinates(1920, 100))
        .rejects.toThrow(CoordinateOutOfBoundsError);
    });

    it('should throw CoordinateOutOfBoundsError for y coordinate at screen height', async () => {
      await expect(validateCoordinates(100, 1080))
        .rejects.toThrow(CoordinateOutOfBoundsError);
    });

    it('should throw CoordinateOutOfBoundsError for coordinates beyond screen bounds', async () => {
      await expect(validateCoordinates(2000, 100))
        .rejects.toThrow(CoordinateOutOfBoundsError);
      await expect(validateCoordinates(100, 2000))
        .rejects.toThrow(CoordinateOutOfBoundsError);
    });

    it('should include proper error details in CoordinateOutOfBoundsError', async () => {
      try {
        await validateCoordinates(-5, 1500);
      } catch (error) {
        expect(error).toBeInstanceOf(CoordinateOutOfBoundsError);
        expect(error.message).toContain('(-5, 1500)');
        expect(error.message).toContain('(1920x1080)');
      }
    });
  });

  describe('validateRegion', () => {
    it('should not throw for valid region', async () => {
      const region = { x: 100, y: 200, width: 300, height: 400 };
      await expect(validateRegion(region)).resolves.not.toThrow();
    });

    it('should not throw for region at screen boundaries', async () => {
      const region = { x: 0, y: 0, width: 1920, height: 1080 };
      await expect(validateRegion(region)).resolves.not.toThrow();
    });

    it('should throw ValidationError for negative x coordinate', async () => {
      const region = { x: -1, y: 100, width: 200, height: 300 };
      await expect(validateRegion(region))
        .rejects.toThrow(new ValidationError('Region coordinates must be non-negative', 'region'));
    });

    it('should throw ValidationError for negative y coordinate', async () => {
      const region = { x: 100, y: -1, width: 200, height: 300 };
      await expect(validateRegion(region))
        .rejects.toThrow(new ValidationError('Region coordinates must be non-negative', 'region'));
    });

    it('should throw ValidationError for zero width', async () => {
      const region = { x: 100, y: 200, width: 0, height: 300 };
      await expect(validateRegion(region))
        .rejects.toThrow(new ValidationError('Region dimensions must be positive', 'region'));
    });

    it('should throw ValidationError for negative width', async () => {
      const region = { x: 100, y: 200, width: -10, height: 300 };
      await expect(validateRegion(region))
        .rejects.toThrow(new ValidationError('Region dimensions must be positive', 'region'));
    });

    it('should throw ValidationError for zero height', async () => {
      const region = { x: 100, y: 200, width: 300, height: 0 };
      await expect(validateRegion(region))
        .rejects.toThrow(new ValidationError('Region dimensions must be positive', 'region'));
    });

    it('should throw ValidationError for negative height', async () => {
      const region = { x: 100, y: 200, width: 300, height: -10 };
      await expect(validateRegion(region))
        .rejects.toThrow(new ValidationError('Region dimensions must be positive', 'region'));
    });

    it('should throw ValidationError when region extends beyond screen width', async () => {
      const region = { x: 1800, y: 200, width: 200, height: 300 }; // 1800 + 200 = 2000 > 1920
      await expect(validateRegion(region))
        .rejects.toThrow(new ValidationError('Region extends beyond screen boundaries', 'region'));
    });

    it('should throw ValidationError when region extends beyond screen height', async () => {
      const region = { x: 100, y: 900, width: 200, height: 300 }; // 900 + 300 = 1200 > 1080
      await expect(validateRegion(region))
        .rejects.toThrow(new ValidationError('Region extends beyond screen boundaries', 'region'));
    });

    it('should throw ValidationError when region extends beyond both boundaries', async () => {
      const region = { x: 1800, y: 900, width: 200, height: 300 };
      await expect(validateRegion(region))
        .rejects.toThrow(new ValidationError('Region extends beyond screen boundaries', 'region'));
    });

    it('should include region and screen data in error details', async () => {
      const region = { x: -5, y: 100, width: 200, height: 300 };
      try {
        await validateRegion(region);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.details.region).toEqual(region);
        expect(error.details.screen).toEqual({ width: 1920, height: 1080 });
      }
    });
  });

  describe('validateFilePath', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should not throw for valid file path when parent directory exists', () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        if (path === '/valid/parent') return true;
        if (path === '/valid/parent/file.txt') return false;
        return false;
      });
      vi.mocked(dirname).mockReturnValue('/valid/parent');

      expect(() => validateFilePath('/valid/parent/file.txt')).not.toThrow();
      expect(dirname).toHaveBeenCalledWith('/valid/parent/file.txt');
      expect(existsSync).toHaveBeenCalledWith('/valid/parent');
    });

    it('should not throw for existing file when mustExist is true', () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        if (path === '/valid/parent') return true;
        if (path === '/valid/parent/existing.txt') return true;
        return false;
      });
      vi.mocked(dirname).mockReturnValue('/valid/parent');

      expect(() => validateFilePath('/valid/parent/existing.txt', true)).not.toThrow();
    });

    it('should throw ValidationError for empty path', () => {
      expect(() => validateFilePath(''))
        .toThrow(new ValidationError('File path cannot be empty', 'path'));
    });

    it('should throw ValidationError for whitespace-only path', () => {
      expect(() => validateFilePath('   '))
        .toThrow(new ValidationError('File path cannot be empty', 'path'));
    });

    it('should throw ValidationError when file must exist but does not', () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        if (path === '/valid/parent') return true;
        if (path === '/valid/parent/missing.txt') return false;
        return false;
      });
      vi.mocked(dirname).mockReturnValue('/valid/parent');

      expect(() => validateFilePath('/valid/parent/missing.txt', true))
        .toThrow(new ValidationError('File does not exist: /valid/parent/missing.txt', 'path'));
    });

    it('should throw ValidationError when parent directory does not exist', () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        if (path === '/invalid/parent') return false;
        return false;
      });
      vi.mocked(dirname).mockReturnValue('/invalid/parent');

      expect(() => validateFilePath('/invalid/parent/file.txt'))
        .toThrow(new ValidationError('Parent directory does not exist: /invalid/parent', 'path'));
    });

    it('should handle nested path validation', () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        if (path === '/deep/nested/parent') return true;
        return false;
      });
      vi.mocked(dirname).mockReturnValue('/deep/nested/parent');

      expect(() => validateFilePath('/deep/nested/parent/file.txt')).not.toThrow();
    });
  });

  describe('clearScreenDimensionsCache', () => {
    it('should clear the cache and force refresh on next call', async () => {
      // First call to populate cache
      await getScreenDimensions();
      expect(mockScreen.width).toHaveBeenCalledTimes(1);

      // Clear cache
      clearScreenDimensionsCache();

      // Next call should fetch fresh data
      await getScreenDimensions();
      expect(mockScreen.width).toHaveBeenCalledTimes(2);
    });
  });

  describe('EnhancedScreenshotToolSchema', () => {
    it('should validate valid screenshot tool input', () => {
      const validInputs = [
        {},
        { outputPath: undefined },
        { region: { x: 0, y: 0, width: 100, height: 100 } },
        { outputPath: '/valid/path.png', region: { x: 10, y: 20, width: 200, height: 300 } },
      ];

      // Mock file path validation
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(dirname).mockReturnValue('/valid');

      validInputs.forEach(input => {
        expect(() => EnhancedScreenshotToolSchema.parse(input)).not.toThrow();
      });
    });

    it('should reject invalid region coordinates', () => {
      const invalidInputs = [
        { region: { x: -1, y: 0, width: 100, height: 100 } },
        { region: { x: 0, y: -1, width: 100, height: 100 } },
        { region: { x: 0, y: 0, width: 0, height: 100 } },
        { region: { x: 0, y: 0, width: 100, height: -1 } },
      ];

      invalidInputs.forEach(input => {
        expect(() => EnhancedScreenshotToolSchema.parse(input)).toThrow(z.ZodError);
      });
    });

    it('should reject invalid output path', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(dirname).mockReturnValue('/invalid');

      const input = { outputPath: '/invalid/path.png' };
      expect(() => EnhancedScreenshotToolSchema.parse(input)).toThrow(z.ZodError);
    });
  });

  describe('EnhancedClickToolSchema', () => {
    it('should validate valid click tool input', () => {
      const validInputs = [
        { x: 0, y: 0 },
        { x: 100, y: 200, button: 'left' },
        { x: 50, y: 75, button: 'right', doubleClick: true },
        { x: 300, y: 400, button: 'middle', doubleClick: false },
      ];

      validInputs.forEach(input => {
        const result = EnhancedClickToolSchema.parse(input);
        expect(result.x).toBeGreaterThanOrEqual(0);
        expect(result.y).toBeGreaterThanOrEqual(0);
        expect(['left', 'right', 'middle']).toContain(result.button);
        expect(typeof result.doubleClick).toBe('boolean');
      });
    });

    it('should apply default values', () => {
      const input = { x: 100, y: 200 };
      const result = EnhancedClickToolSchema.parse(input);
      
      expect(result.button).toBe('left');
      expect(result.doubleClick).toBe(false);
    });

    it('should reject invalid coordinates', () => {
      const invalidInputs = [
        { x: -1, y: 0 },
        { x: 0, y: -1 },
        { x: 1.5, y: 0 }, // Non-integer
        { x: 0, y: 2.5 }, // Non-integer
      ];

      invalidInputs.forEach(input => {
        expect(() => EnhancedClickToolSchema.parse(input)).toThrow(z.ZodError);
      });
    });

    it('should reject invalid button values', () => {
      const input = { x: 100, y: 200, button: 'invalid' };
      expect(() => EnhancedClickToolSchema.parse(input)).toThrow(z.ZodError);
    });
  });

  describe('EnhancedTypeTextToolSchema', () => {
    it('should validate valid type text input', () => {
      const validInputs = [
        { text: 'Hello World' },
        { text: 'Test', delay: 100 },
        { text: 'A'.repeat(10000) }, // Max length
        { text: 'Short', delay: 0 }, // Min delay
        { text: 'Delayed', delay: 1000 }, // Max delay
      ];

      validInputs.forEach(input => {
        const result = EnhancedTypeTextToolSchema.parse(input);
        expect(result.text.length).toBeGreaterThan(0);
        expect(result.delay).toBeGreaterThanOrEqual(0);
        expect(result.delay).toBeLessThanOrEqual(1000);
      });
    });

    it('should apply default delay value', () => {
      const input = { text: 'Hello' };
      const result = EnhancedTypeTextToolSchema.parse(input);
      
      expect(result.delay).toBe(50);
    });

    it('should reject empty text', () => {
      const input = { text: '' };
      expect(() => EnhancedTypeTextToolSchema.parse(input)).toThrow(z.ZodError);
    });

    it('should reject text that is too long', () => {
      const input = { text: 'A'.repeat(10001) };
      expect(() => EnhancedTypeTextToolSchema.parse(input)).toThrow(z.ZodError);
    });

    it('should reject invalid delay values', () => {
      const invalidInputs = [
        { text: 'Hello', delay: -1 },
        { text: 'Hello', delay: 1001 },
        { text: 'Hello', delay: 1.5 }, // Non-integer
      ];

      invalidInputs.forEach(input => {
        expect(() => EnhancedTypeTextToolSchema.parse(input)).toThrow(z.ZodError);
      });
    });
  });

  describe('EnhancedWaitToolSchema', () => {
    it('should validate valid wait times', () => {
      const validInputs = [
        { milliseconds: 1 },
        { milliseconds: 1000 },
        { milliseconds: 300000 }, // Max value (5 minutes)
      ];

      validInputs.forEach(input => {
        const result = EnhancedWaitToolSchema.parse(input);
        expect(result.milliseconds).toBeGreaterThan(0);
        expect(result.milliseconds).toBeLessThanOrEqual(300000);
      });
    });

    it('should reject invalid wait times', () => {
      const invalidInputs = [
        { milliseconds: 0 },
        { milliseconds: -1 },
        { milliseconds: 300001 }, // Exceeds max
        { milliseconds: 1.5 }, // Non-integer
      ];

      invalidInputs.forEach(input => {
        expect(() => EnhancedWaitToolSchema.parse(input)).toThrow(z.ZodError);
      });
    });
  });

  describe('EnhancedKeyPressToolSchema', () => {
    it('should validate single character keys', () => {
      const validKeys = ['a', 'A', '1', '!'];
      
      validKeys.forEach(key => {
        const result = EnhancedKeyPressToolSchema.parse({ key });
        expect(result.key).toBe(key);
      });
    });

    it('should validate special keys', () => {
      const validKeys = [
        'enter', 'return', 'escape', 'esc', 'tab', 'space',
        'delete', 'backspace', 'up', 'down', 'left', 'right'
      ];
      
      validKeys.forEach(key => {
        const result = EnhancedKeyPressToolSchema.parse({ key });
        expect(result.key).toBe(key);
      });
    });

    it('should validate modifier keys', () => {
      const validModifiers = [
        'cmd', 'command', 'ctrl', 'control', 'alt', 'option', 'shift'
      ];
      
      validModifiers.forEach(modifier => {
        const result = EnhancedKeyPressToolSchema.parse({ key: modifier });
        expect(result.key).toBe(modifier);
      });
    });

    it('should validate key combinations', () => {
      const validCombinations = [
        'cmd+a', 'ctrl+c', 'alt+tab', 'shift+enter',
        'cmd+ctrl+space', 'command+option+esc'
      ];
      
      validCombinations.forEach(combo => {
        const result = EnhancedKeyPressToolSchema.parse({ key: combo });
        expect(result.key).toBe(combo);
      });
    });

    it('should be case insensitive for validation', () => {
      const keyCombos = [
        'CMD+A', 'Ctrl+C', 'ALT+TAB', 'SHIFT+ENTER'
      ];
      
      keyCombos.forEach(combo => {
        expect(() => EnhancedKeyPressToolSchema.parse({ key: combo })).not.toThrow();
      });
    });

    it('should reject empty key', () => {
      expect(() => EnhancedKeyPressToolSchema.parse({ key: '' })).toThrow(z.ZodError);
    });

    it('should reject invalid key names', () => {
      const invalidKeys = [
        'invalid', 'unknown', 'badkey', 'cmd+invalid', 'ctrl+badkey'
      ];
      
      invalidKeys.forEach(key => {
        expect(() => EnhancedKeyPressToolSchema.parse({ key })).toThrow(z.ZodError);
      });
    });

    it('should reject multi-character keys that are not special keys', () => {
      const invalidKeys = ['hello', 'world', 'multiple'];
      
      invalidKeys.forEach(key => {
        expect(() => EnhancedKeyPressToolSchema.parse({ key })).toThrow(z.ZodError);
      });
    });
  });

  describe('validateToolInput', () => {
    beforeEach(() => {
      // Mock successful file path validation
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(dirname).mockReturnValue('/valid');
    });

    describe('screenshot tool', () => {
      it('should validate valid screenshot input', async () => {
        const input = { outputPath: '/valid/screenshot.png' };
        const result = await validateToolInput('screenshot', input);
        
        expect(result.valid).toBe(true);
        expect(result.parsedInput).toEqual(input);
      });

      it('should validate screenshot with valid region', async () => {
        const input = { 
          outputPath: '/valid/screenshot.png',
          region: { x: 0, y: 0, width: 100, height: 100 }
        };
        const result = await validateToolInput('screenshot', input);
        
        expect(result.valid).toBe(true);
        expect(result.parsedInput).toEqual(input);
      });

      it('should reject screenshot with invalid region', async () => {
        const input = { 
          region: { x: -1, y: 0, width: 100, height: 100 }
        };
        const result = await validateToolInput('screenshot', input);
        
        expect(result.valid).toBe(false);
        expect(result.error).toContain('X coordinate must be non-negative');
      });

      it('should reject screenshot with region extending beyond screen', async () => {
        const input = { 
          region: { x: 1800, y: 0, width: 200, height: 100 } // 1800 + 200 > 1920
        };
        const result = await validateToolInput('screenshot', input);
        
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Region extends beyond screen boundaries');
      });
    });

    describe('click tool', () => {
      it('should validate valid click input', async () => {
        const input = { x: 100, y: 200 };
        const result = await validateToolInput('click', input);
        
        expect(result.valid).toBe(true);
        expect(result.parsedInput.x).toBe(100);
        expect(result.parsedInput.y).toBe(200);
        expect(result.parsedInput.button).toBe('left'); // default
        expect(result.parsedInput.doubleClick).toBe(false); // default
      });

      it('should reject click with coordinates out of bounds', async () => {
        const input = { x: 2000, y: 100 };
        const result = await validateToolInput('click', input);
        
        expect(result.valid).toBe(false);
        expect(result.error).toContain('out of screen bounds');
      });

      it('should reject click with invalid button', async () => {
        const input = { x: 100, y: 200, button: 'invalid' };
        const result = await validateToolInput('click', input);
        
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('mouse_move tool', () => {
      it('should validate valid mouse move input', async () => {
        const input = { x: 100, y: 200 };
        const result = await validateToolInput('mouse_move', input);
        
        expect(result.valid).toBe(true);
        expect(result.parsedInput.x).toBe(100);
        expect(result.parsedInput.y).toBe(200);
        expect(result.parsedInput.smooth).toBe(true); // default
      });

      it('should validate mouse move with smooth disabled', async () => {
        const input = { x: 100, y: 200, smooth: false };
        const result = await validateToolInput('mouse_move', input);
        
        expect(result.valid).toBe(true);
        expect(result.parsedInput.smooth).toBe(false);
      });

      it('should reject mouse move with coordinates out of bounds', async () => {
        const input = { x: -1, y: 200 };
        const result = await validateToolInput('mouse_move', input);
        
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Number must be greater than or equal to 0');
      });
    });

    describe('type_text tool', () => {
      it('should validate valid type text input', async () => {
        const input = { text: 'Hello World' };
        const result = await validateToolInput('type_text', input);
        
        expect(result.valid).toBe(true);
        expect(result.parsedInput.text).toBe('Hello World');
        expect(result.parsedInput.delay).toBe(50); // default
      });

      it('should validate type text with custom delay', async () => {
        const input = { text: 'Hello', delay: 100 };
        const result = await validateToolInput('type_text', input);
        
        expect(result.valid).toBe(true);
        expect(result.parsedInput.delay).toBe(100);
      });

      it('should reject empty text', async () => {
        const input = { text: '' };
        const result = await validateToolInput('type_text', input);
        
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Text cannot be empty');
      });

      it('should reject text that is too long', async () => {
        const input = { text: 'A'.repeat(10001) };
        const result = await validateToolInput('type_text', input);
        
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Text is too long');
      });
    });

    describe('wait tool', () => {
      it('should validate valid wait input', async () => {
        const input = { milliseconds: 1000 };
        const result = await validateToolInput('wait', input);
        
        expect(result.valid).toBe(true);
        expect(result.parsedInput.milliseconds).toBe(1000);
      });

      it('should reject wait time of zero', async () => {
        const input = { milliseconds: 0 };
        const result = await validateToolInput('wait', input);
        
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Wait time must be positive');
      });

      it('should reject wait time exceeding maximum', async () => {
        const input = { milliseconds: 300001 };
        const result = await validateToolInput('wait', input);
        
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Wait time cannot exceed 5 minutes');
      });
    });

    describe('key_press tool', () => {
      it('should validate valid key press input', async () => {
        const input = { key: 'enter' };
        const result = await validateToolInput('key_press', input);
        
        expect(result.valid).toBe(true);
        expect(result.parsedInput.key).toBe('enter');
      });

      it('should validate key combination', async () => {
        const input = { key: 'cmd+a' };
        const result = await validateToolInput('key_press', input);
        
        expect(result.valid).toBe(true);
        expect(result.parsedInput.key).toBe('cmd+a');
      });

      it('should reject invalid key', async () => {
        const input = { key: 'invalidkey' };
        const result = await validateToolInput('key_press', input);
        
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid key combination');
      });

      it('should reject empty key', async () => {
        const input = { key: '' };
        const result = await validateToolInput('key_press', input);
        
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Key cannot be empty');
      });
    });

    describe('extract_text, find_text, check_for_errors tools', () => {
      it('should validate input without region', async () => {
        const tools = ['extract_text', 'find_text', 'check_for_errors'];
        
        for (const tool of tools) {
          const input = { someParam: 'value' };
          const result = await validateToolInput(tool, input);
          
          expect(result.valid).toBe(true);
          expect(result.parsedInput).toEqual(input);
        }
      });

      it('should validate input with valid region', async () => {
        const tools = ['extract_text', 'find_text', 'check_for_errors'];
        
        for (const tool of tools) {
          const input = { 
            region: { x: 0, y: 0, width: 100, height: 100 },
            someParam: 'value'
          };
          const result = await validateToolInput(tool, input);
          
          expect(result.valid).toBe(true);
          expect(result.parsedInput).toEqual(input);
        }
      });

      it('should reject input with invalid region', async () => {
        const tools = ['extract_text', 'find_text', 'check_for_errors'];
        
        for (const tool of tools) {
          const input = { 
            region: { x: -1, y: 0, width: 100, height: 100 }
          };
          const result = await validateToolInput(tool, input);
          
          expect(result.valid).toBe(false);
          expect(result.error).toContain('Region coordinates must be non-negative');
        }
      });
    });

    describe('unknown tool', () => {
      it('should pass through input for unknown tools', async () => {
        const input = { anyParam: 'anyValue' };
        const result = await validateToolInput('unknown_tool', input);
        
        expect(result.valid).toBe(true);
        expect(result.parsedInput).toEqual(input);
      });
    });

    describe('error handling', () => {
      it('should handle Zod validation errors', async () => {
        const input = { x: 'invalid', y: 200 }; // x should be number
        const result = await validateToolInput('click', input);
        
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('x');
      });

      it('should handle multiple Zod validation errors', async () => {
        const input = { x: 'invalid', y: 'also_invalid' }; // both should be numbers
        const result = await validateToolInput('click', input);
        
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('x');
        expect(result.error).toContain('y');
      });

      it('should handle non-Zod errors', async () => {
        const input = { x: 2000, y: 100 }; // coordinates out of bounds
        const result = await validateToolInput('click', input);
        
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should handle non-Error objects', async () => {
        // Clear cache first to force a fresh screen dimensions call
        clearScreenDimensionsCache();
        // Mock screen dimensions to throw a string instead of Error
        mockScreen.width.mockRejectedValue('Some string error');
        
        const input = { x: 100, y: 200 };
        const result = await validateToolInput('click', input);
        
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Some string error');
      });
    });
  });
});