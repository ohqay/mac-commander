import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initializeOCR,
  terminateOCR,
  extractTextFromImage,
  findTextInImage,
  getTextLocations,
} from '../../src/ocr-utils';
import '../mocks/tesseract.mock';
import '../mocks/canvas.mock';
import { createWorker, mockWorker } from '../mocks/tesseract.mock';

vi.mock('../../src/image-utils', () => ({
  imageToBase64: vi.fn().mockResolvedValue('data:image/png;base64,mockBase64String'),
}));

describe('ocr-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await terminateOCR();
  });

  describe('initializeOCR', () => {
    it('should create a worker if not already initialized', async () => {
      await initializeOCR();
      expect(createWorker).toHaveBeenCalledWith('eng');
    });

    it('should not create multiple workers', async () => {
      await initializeOCR();
      await initializeOCR();
      expect(createWorker).toHaveBeenCalledTimes(1);
    });
  });

  describe('terminateOCR', () => {
    it('should terminate the worker if it exists', async () => {
      await initializeOCR();
      await terminateOCR();
      expect(mockWorker.terminate).toHaveBeenCalledOnce();
    });

    it('should handle termination when no worker exists', async () => {
      await terminateOCR();
      expect(mockWorker.terminate).not.toHaveBeenCalled();
    });
  });

  describe('extractTextFromImage', () => {
    it('should extract text from image', async () => {
      const mockImage = {
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
      };

      const result = await extractTextFromImage(mockImage as any);

      expect(result).toBe('Mock OCR text');
      expect(createWorker).toHaveBeenCalled();
      expect(mockWorker.recognize).toHaveBeenCalledWith('data:image/png;base64,mockBase64String');
    });

    it('should trim whitespace from extracted text', async () => {
      mockWorker.recognize.mockResolvedValueOnce({
        data: {
          text: '  Trimmed text  \n',
        },
      });

      const mockImage = {
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
      };

      const result = await extractTextFromImage(mockImage as any);
      expect(result).toBe('Trimmed text');
    });

    it('should handle OCR errors', async () => {
      mockWorker.recognize.mockRejectedValueOnce(new Error('OCR failed'));

      const mockImage = {
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
      };

      await expect(extractTextFromImage(mockImage as any)).rejects.toThrow('OCR failed: OCR failed');
    });
  });

  describe('findTextInImage', () => {
    it('should find text in image (case-insensitive)', async () => {
      const mockImage = {
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
      };

      const result = await findTextInImage(mockImage as any, 'mock');
      expect(result).toBe(true);
    });

    it('should return false when text is not found', async () => {
      const mockImage = {
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
      };

      const result = await findTextInImage(mockImage as any, 'notfound');
      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      mockWorker.recognize.mockRejectedValueOnce(new Error('OCR failed'));

      const mockImage = {
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
      };

      const result = await findTextInImage(mockImage as any, 'test');
      expect(result).toBe(false);
    });
  });

  describe('getTextLocations', () => {
    it('should return text locations with high confidence', async () => {
      const mockImage = {
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
      };

      const result = await getTextLocations(mockImage as any);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        text: 'Mock',
        x: 10,
        y: 10,
        width: 40,
        height: 20,
        confidence: 95,
      });
    });

    it('should filter out low confidence words', async () => {
      mockWorker.recognize.mockResolvedValueOnce({
        data: {
          text: 'Test text',
          words: [
            {
              text: 'Good',
              bbox: { x0: 0, y0: 0, x1: 40, y1: 20 },
              confidence: 80,
            },
            {
              text: 'Bad',
              bbox: { x0: 50, y0: 0, x1: 80, y1: 20 },
              confidence: 30,
            },
          ],
        },
      });

      const mockImage = {
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
      };

      const result = await getTextLocations(mockImage as any);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Good');
    });

    it('should handle missing words data', async () => {
      mockWorker.recognize.mockResolvedValueOnce({
        data: {
          text: 'No words data',
        },
      });

      const mockImage = {
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
      };

      const result = await getTextLocations(mockImage as any);
      expect(result).toHaveLength(0);
    });

    it('should handle errors', async () => {
      mockWorker.recognize.mockRejectedValueOnce(new Error('OCR failed'));

      const mockImage = {
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
      };

      await expect(getTextLocations(mockImage as any)).rejects.toThrow(
        'Failed to get text locations: OCR failed'
      );
    });
  });
});