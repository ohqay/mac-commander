import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'fs';

vi.mock('fs', () => ({
  promises: {
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock Canvas directly in the test file
vi.mock('canvas', () => {
  class MockImageData {
    data: Uint8Array;
    width: number;
    height: number;

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this.data = new Uint8Array(width * height * 4);
    }
  }

  const mockContext = {
    createImageData: vi.fn((width: number, height: number) => new MockImageData(width, height)),
    putImageData: vi.fn(),
  };

  const mockCanvas = {
    getContext: vi.fn().mockReturnValue(mockContext),
    toDataURL: vi.fn().mockReturnValue('data:image/png;base64,mockBase64String'),
    toBuffer: vi.fn().mockReturnValue(Buffer.from('mock-png-data')),
  };

  return {
    createCanvas: vi.fn().mockReturnValue(mockCanvas),
    ImageData: MockImageData,
  };
});

import { imageToBase64, saveImage } from '../../src/image-utils';

describe('image-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('imageToBase64', () => {
    it('should convert image with 3 channels (RGB) to base64', async () => {
      const mockImage = {
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
        toRGB: vi.fn().mockResolvedValue({
          width: 100,
          height: 100,
          channels: 3,
          data: new Uint8Array(100 * 100 * 3).fill(128),
        }),
      };

      const result = await imageToBase64(mockImage as any);

      expect(result).toBe('data:image/png;base64,mockBase64String');
      expect(mockImage.toRGB).toHaveBeenCalledOnce();
    });

    it('should convert image with 4 channels (RGBA) to base64', async () => {
      const mockImage = {
        width: 50,
        height: 50,
        channels: 4,
        data: new Uint8Array(50 * 50 * 4),
        toRGB: vi.fn().mockResolvedValue({
          width: 50,
          height: 50,
          channels: 4,
          data: new Uint8Array(50 * 50 * 4).fill(255),
        }),
      };

      const result = await imageToBase64(mockImage as any);

      expect(result).toBe('data:image/png;base64,mockBase64String');
      expect(mockImage.toRGB).toHaveBeenCalledOnce();
    });

    it('should handle errors during conversion', async () => {
      const mockImage = {
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
        toRGB: vi.fn().mockRejectedValue(new Error('Conversion failed')),
      };

      await expect(imageToBase64(mockImage as any)).rejects.toThrow(
        'Failed to convert image to base64: Error: Conversion failed'
      );
    });
  });

  describe('saveImage', () => {
    it('should save image with 3 channels (RGB) to file', async () => {
      const mockImage = {
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
        toRGB: vi.fn().mockResolvedValue({
          width: 100,
          height: 100,
          channels: 3,
          data: new Uint8Array(100 * 100 * 3).fill(128),
        }),
      };

      const outputPath = '/tmp/test-image.png';
      await saveImage(mockImage as any, outputPath);

      expect(mockImage.toRGB).toHaveBeenCalledOnce();
      expect(fs.writeFile).toHaveBeenCalledWith(outputPath, Buffer.from('mock-png-data'));
    });

    it('should save image with 4 channels (RGBA) to file', async () => {
      const mockImage = {
        width: 50,
        height: 50,
        channels: 4,
        data: new Uint8Array(50 * 50 * 4),
        toRGB: vi.fn().mockResolvedValue({
          width: 50,
          height: 50,
          channels: 4,
          data: new Uint8Array(50 * 50 * 4).fill(255),
        }),
      };

      const outputPath = '/tmp/test-image-rgba.png';
      await saveImage(mockImage as any, outputPath);

      expect(mockImage.toRGB).toHaveBeenCalledOnce();
      expect(fs.writeFile).toHaveBeenCalledWith(outputPath, Buffer.from('mock-png-data'));
    });

    it('should handle errors during save', async () => {
      const mockImage = {
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
        toRGB: vi.fn().mockRejectedValue(new Error('Save failed')),
      };

      await expect(saveImage(mockImage as any, '/tmp/error.png')).rejects.toThrow(
        'Failed to save image: Error: Save failed'
      );
    });
  });
});