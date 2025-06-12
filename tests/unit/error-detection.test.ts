import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorDetector, commonErrorPatterns } from '../../src/error-detection';
import { Region } from '@nut-tree-fork/nut-js';
import '../mocks/nut-js.mock';
import '../mocks/tesseract.mock';
import { mockScreen } from '../mocks/nut-js.mock';

vi.mock('../../src/ocr-utils', () => ({
  extractTextFromImage: vi.fn(),
  findTextInImage: vi.fn(),
  getTextLocations: vi.fn(),
}));

import { extractTextFromImage, findTextInImage, getTextLocations } from '../../src/ocr-utils';

describe('ErrorDetector', () => {
  let errorDetector: ErrorDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    errorDetector = new ErrorDetector();
  });

  describe('detectErrors', () => {
    it('should detect errors on entire screen when no region specified', async () => {
      vi.mocked(extractTextFromImage).mockResolvedValue('Error: Application crashed unexpectedly');
      vi.mocked(getTextLocations).mockResolvedValue([
        {
          text: 'Error',
          x: 100,
          y: 50,
          width: 50,
          height: 20,
          confidence: 95,
        },
        {
          text: 'crashed',
          x: 200,
          y: 50,
          width: 60,
          height: 20,
          confidence: 92,
        },
      ]);

      const errors = await errorDetector.detectErrors();

      expect(mockScreen.grab).toHaveBeenCalledOnce();
      expect(errors).toHaveLength(2); // Should match both 'error' and 'crashed' patterns
      expect(errors[0].pattern.name).toBe('red_error_badge');
      expect(errors[1].pattern.name).toBe('crash_dialog');
    });

    it('should detect errors in specific region', async () => {
      const region = new Region(100, 100, 200, 200);
      vi.mocked(extractTextFromImage).mockResolvedValue('Permission required: Allow access');
      vi.mocked(getTextLocations).mockResolvedValue([
        {
          text: 'Permission',
          x: 10,
          y: 10,
          width: 80,
          height: 20,
          confidence: 90,
        },
        {
          text: 'Allow',
          x: 100,
          y: 10,
          width: 40,
          height: 20,
          confidence: 88,
        },
      ]);

      const errors = await errorDetector.detectErrors(region);

      expect(mockScreen.grabRegion).toHaveBeenCalledWith(region);
      expect(errors).toHaveLength(2); // 'permission' and 'allow' match permission_dialog
      expect(errors[0].pattern.name).toBe('permission_dialog');
      expect(errors[0].pattern.severity).toBe('info');
    });

    it('should return empty array when no errors detected', async () => {
      vi.mocked(extractTextFromImage).mockResolvedValue('Everything is working fine');
      vi.mocked(getTextLocations).mockResolvedValue([]);

      const errors = await errorDetector.detectErrors();

      expect(errors).toHaveLength(0);
    });

    it('should include location information when text locations are found', async () => {
      vi.mocked(extractTextFromImage).mockResolvedValue('Warning dialog appeared');
      vi.mocked(getTextLocations).mockResolvedValue([
        {
          text: 'Warning',
          x: 50,
          y: 100,
          width: 70,
          height: 25,
          confidence: 93,
        },
      ]);

      const errors = await errorDetector.detectErrors();

      expect(errors).toHaveLength(1);
      expect(errors[0].location).toBeDefined();
      expect(errors[0].location?.left).toBe(50);
      expect(errors[0].location?.top).toBe(100);
      expect(errors[0].location?.width).toBe(70);
      expect(errors[0].location?.height).toBe(25);
      expect(errors[0].confidence).toBe(93);
    });

    it('should handle OCR errors gracefully', async () => {
      vi.mocked(extractTextFromImage).mockRejectedValue(new Error('OCR failed'));

      const errors = await errorDetector.detectErrors();

      expect(errors).toHaveLength(0);
      expect(console.error).toHaveBeenCalledWith('Error during error detection:', expect.any(Error));
    });

    it('should detect multiple error patterns', async () => {
      vi.mocked(extractTextFromImage).mockResolvedValue('Error! Click OK or Cancel to continue');
      vi.mocked(getTextLocations).mockResolvedValue([
        {
          text: 'Error!',
          x: 10,
          y: 10,
          width: 50,
          height: 20,
          confidence: 95,
        },
        {
          text: 'OK',
          x: 100,
          y: 50,
          width: 30,
          height: 20,
          confidence: 98,
        },
        {
          text: 'Cancel',
          x: 150,
          y: 50,
          width: 50,
          height: 20,
          confidence: 97,
        },
      ]);

      const errors = await errorDetector.detectErrors();

      // Should detect both red_error_badge (error) and modal_dialog (OK, Cancel)
      const errorBadges = errors.filter(e => e.pattern.name === 'red_error_badge');
      const modalDialogs = errors.filter(e => e.pattern.name === 'modal_dialog');

      expect(errorBadges).toHaveLength(1);
      expect(modalDialogs).toHaveLength(2); // OK and Cancel
    });
  });

  describe('findTextInRegion', () => {
    it('should find text in entire screen', async () => {
      vi.mocked(findTextInImage).mockResolvedValue(true);

      const result = await errorDetector.findTextInRegion('search text');

      expect(mockScreen.grab).toHaveBeenCalledOnce();
      expect(findTextInImage).toHaveBeenCalledWith(expect.any(Object), 'search text');
      expect(result).toBe(true);
    });

    it('should find text in specific region', async () => {
      const region = new Region(50, 50, 100, 100);
      vi.mocked(findTextInImage).mockResolvedValue(false);

      const result = await errorDetector.findTextInRegion('not found', region);

      expect(mockScreen.grabRegion).toHaveBeenCalledWith(region);
      expect(findTextInImage).toHaveBeenCalledWith(expect.any(Object), 'not found');
      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(findTextInImage).mockRejectedValue(new Error('Search failed'));

      const result = await errorDetector.findTextInRegion('test');

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith('Error during text search:', expect.any(Error));
    });
  });

  describe('checkForCommonErrors', () => {
    it('should delegate to detectErrors with no region', async () => {
      vi.mocked(extractTextFromImage).mockResolvedValue('No errors');
      vi.mocked(getTextLocations).mockResolvedValue([]);

      const errors = await errorDetector.checkForCommonErrors();

      expect(mockScreen.grab).toHaveBeenCalledOnce();
      expect(mockScreen.grabRegion).not.toHaveBeenCalled();
      expect(errors).toHaveLength(0);
    });
  });

  describe('captureErrorContext', () => {
    it('should capture screenshot of error region', async () => {
      const mockError = {
        pattern: commonErrorPatterns[0],
        location: new Region(10, 20, 100, 50),
        confidence: 95,
        timestamp: new Date(),
      };

      const context = await errorDetector.captureErrorContext(mockError);

      expect(mockScreen.grabRegion).toHaveBeenCalledWith(mockError.location);
      expect(context.screenshot).toBeDefined();
      expect(context.description).toBe('red_error_badge: Red circular error badge often used in macOS apps');
    });

    it('should capture entire screen when error has no location', async () => {
      const mockError = {
        pattern: commonErrorPatterns[1],
        timestamp: new Date(),
      };

      const context = await errorDetector.captureErrorContext(mockError);

      expect(mockScreen.grab).toHaveBeenCalledOnce();
      expect(context.screenshot).toBeDefined();
      expect(context.description).toBe('modal_dialog: Modal dialog boxes that might contain errors');
    });

    it('should handle screenshot capture errors', async () => {
      mockScreen.grab.mockRejectedValueOnce(new Error('Screenshot failed'));

      const mockError = {
        pattern: commonErrorPatterns[0],
        timestamp: new Date(),
      };

      const context = await errorDetector.captureErrorContext(mockError);

      expect(context.screenshot).toBeNull();
      expect(context.description).toContain('Failed to capture context');
    });
  });

  describe('custom error patterns', () => {
    it('should allow custom error patterns', async () => {
      const customPatterns = [
        {
          name: 'custom_error',
          description: 'Custom error pattern',
          patterns: ['custom', 'specific'],
          severity: 'error' as const,
        },
      ];

      const customDetector = new ErrorDetector(customPatterns);
      vi.mocked(extractTextFromImage).mockResolvedValue('This is a custom specific error');
      vi.mocked(getTextLocations).mockResolvedValue([
        {
          text: 'custom',
          x: 0,
          y: 0,
          width: 50,
          height: 20,
          confidence: 90,
        },
      ]);

      const errors = await customDetector.detectErrors();

      expect(errors).toHaveLength(2); // Both 'custom' and 'specific' should match
      expect(errors[0].pattern.name).toBe('custom_error');
    });
  });
});