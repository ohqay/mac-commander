import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock fs first
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('mock-file-data')),
    stat: vi.fn().mockResolvedValue({
      size: 1024,
      birthtime: new Date('2024-01-01'),
      mtime: new Date('2024-01-01')
    }),
    readdir: vi.fn().mockResolvedValue(['screenshot_2024-01-01T10-00-00.png', 'other-file.txt']),
    unlink: vi.fn().mockResolvedValue(undefined)
  }
}));

// Mock os
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    tmpdir: () => '/tmp',
    homedir: () => '/Users/test'
  };
});

import { screenshotAnalyzer, ScreenshotAnalyzer, UIElement, ScreenshotMetadata } from '../../src/screenshot-analysis';
import '../mocks/nut-js.mock';
import '../mocks/canvas.mock';
import '../mocks/tesseract.mock';
import { mockWorker } from '../mocks/tesseract.mock';
import { promises as fs } from 'fs';

const mockFs = fs as any;

describe('ScreenshotAnalyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default max screenshots', () => {
      const analyzer = new ScreenshotAnalyzer();
      expect(analyzer).toBeDefined();
    });

    it('should initialize with custom max screenshots', () => {
      const analyzer = new ScreenshotAnalyzer(25);
      expect(analyzer).toBeDefined();
    });
  });

  describe('saveScreenshot', () => {
    it('should save a screenshot and return metadata', async () => {
      const mockImage = {
        width: 800,
        height: 600,
        channels: 3,
        data: new Uint8Array(800 * 600 * 3),
        toRGB: vi.fn().mockResolvedValue({
          width: 800,
          height: 600,
          channels: 3,
          data: new Uint8Array(800 * 600 * 3),
        }),
      };

      const analyzer = new ScreenshotAnalyzer();
      const metadata = await analyzer.saveScreenshot(mockImage as any, 'test');

      expect(metadata).toBeDefined();
      expect(metadata.filename).toMatch(/^test_.*\.png$/);
      expect(metadata.dimensions.width).toBe(800);
      expect(metadata.dimensions.height).toBe(600);
      expect(metadata.format).toBe('png');
      expect(mockFs.writeFile).toHaveBeenCalled();
    });
  });

  describe('listRecentScreenshots', () => {
    it('should list recent screenshots', async () => {
      const analyzer = new ScreenshotAnalyzer();
      const screenshots = await analyzer.listRecentScreenshots(5);

      expect(Array.isArray(screenshots)).toBe(true);
      expect(mockFs.readdir).toHaveBeenCalled();
    });

    it('should limit results correctly', async () => {
      const analyzer = new ScreenshotAnalyzer();
      const screenshots = await analyzer.listRecentScreenshots(2);

      expect(screenshots.length).toBeLessThanOrEqual(2);
    });
  });

  describe('analyzeScreenshot', () => {
    it('should perform comprehensive screenshot analysis', async () => {
      const mockImage = {
        width: 800,
        height: 600,
        channels: 3,
        data: new Uint8Array(800 * 600 * 3),
        toRGB: vi.fn().mockResolvedValue({
          width: 800,
          height: 600,
          channels: 3,
          data: new Uint8Array(800 * 600 * 3),
        }),
      };

      // Mock OCR response
      const mockOCRData = {
        data: {
          text: 'Click OK to continue Submit Cancel',
          words: [
            {
              text: 'Click',
              bbox: { x0: 100, y0: 200, x1: 150, y1: 220 },
              confidence: 95,
            },
            {
              text: 'OK',
              bbox: { x0: 160, y0: 200, x1: 180, y1: 220 },
              confidence: 98,
            },
            {
              text: 'Submit',
              bbox: { x0: 200, y0: 200, x1: 250, y1: 220 },
              confidence: 92,
            },
            {
              text: 'Cancel',
              bbox: { x0: 300, y0: 200, x1: 350, y1: 220 },
              confidence: 90,
            },
          ],
        },
      };

      mockWorker.recognize
        .mockResolvedValueOnce(mockOCRData)
        .mockResolvedValueOnce(mockOCRData);

      const analyzer = new ScreenshotAnalyzer();
      const analysis = await analyzer.analyzeScreenshot(mockImage as any);

      expect(analysis).toBeDefined();
      expect(analysis.extractedText).toBe('Click OK to continue Submit Cancel');
      expect(analysis.detectedElements).toBeDefined();
      expect(analysis.summary).toBeDefined();
      expect(analysis.metadata).toBeDefined();
      expect(analysis.metadata.hasOCRData).toBe(true);
    });
  });

  describe('UI element detection', () => {
    it('should detect button elements', async () => {
      const mockImage = {
        width: 400,
        height: 300,
        channels: 3,
        data: new Uint8Array(400 * 300 * 3),
        toRGB: vi.fn().mockResolvedValue({
          width: 400,
          height: 300,
          channels: 3,
          data: new Uint8Array(400 * 300 * 3),
        }),
      };

      const mockOCRData = {
        data: {
          text: 'OK Cancel Save Delete',
          words: [
            {
              text: 'OK',
              bbox: { x0: 50, y0: 100, x1: 80, y1: 120 },
              confidence: 95,
            },
            {
              text: 'Cancel',
              bbox: { x0: 100, y0: 100, x1: 150, y1: 120 },
              confidence: 92,
            },
            {
              text: 'Save',
              bbox: { x0: 200, y0: 100, x1: 240, y1: 120 },
              confidence: 90,
            },
            {
              text: 'Delete',
              bbox: { x0: 300, y0: 100, x1: 350, y1: 120 },
              confidence: 88,
            },
          ],
        },
      };

      mockWorker.recognize
        .mockResolvedValueOnce(mockOCRData)
        .mockResolvedValueOnce(mockOCRData);

      const analyzer = new ScreenshotAnalyzer();
      const analysis = await analyzer.analyzeScreenshot(mockImage as any);

      const buttonElements = analysis.detectedElements.filter(e => e.type === 'button');
      expect(buttonElements.length).toBeGreaterThan(0);
      
      const clickableElements = analysis.detectedElements.filter(e => e.clickable);
      expect(clickableElements.length).toBeGreaterThan(0);
    });

    it('should detect dialog elements', async () => {
      const mockImage = {
        width: 400,
        height: 300,
        channels: 3,
        data: new Uint8Array(400 * 300 * 3),
        toRGB: vi.fn().mockResolvedValue({
          width: 400,
          height: 300,
          channels: 3,
          data: new Uint8Array(400 * 300 * 3),
        }),
      };

      const mockOCRData = {
        data: {
          text: 'Error: Operation failed',
          words: [
            {
              text: 'Error:',
              bbox: { x0: 100, y0: 150, x1: 150, y1: 170 },
              confidence: 95,
            },
            {
              text: 'Operation',
              bbox: { x0: 160, y0: 150, x1: 230, y1: 170 },
              confidence: 92,
            },
            {
              text: 'failed',
              bbox: { x0: 240, y0: 150, x1: 290, y1: 170 },
              confidence: 90,
            },
          ],
        },
      };

      mockWorker.recognize
        .mockResolvedValueOnce(mockOCRData)
        .mockResolvedValueOnce(mockOCRData);

      const analyzer = new ScreenshotAnalyzer();
      const analysis = await analyzer.analyzeScreenshot(mockImage as any);

      expect(analysis.summary).toContain('Error messages detected');
    });
  });

  describe('compareScreenshots', () => {
    it('should compare two screenshots', async () => {
      const analyzer = new ScreenshotAnalyzer();
      
      const comparison = await analyzer.compareScreenshots(
        '/tmp/screenshot1.png',
        '/tmp/screenshot2.png'
      );

      expect(comparison).toBeDefined();
      expect(comparison.similarity).toBeDefined();
      expect(comparison.differences).toBeDefined();
      expect(comparison.summary).toBeDefined();
      expect(mockFs.stat).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should handle file system errors gracefully', async () => {
      mockFs.mkdir.mockRejectedValueOnce(new Error('Permission denied'));

      const analyzer = new ScreenshotAnalyzer();
      
      await expect(async () => {
        const mockImage = {
          width: 100,
          height: 100,
          channels: 3,
          data: new Uint8Array(100 * 100 * 3),
          toRGB: vi.fn().mockResolvedValue({
            width: 100,
            height: 100,
            channels: 3,
            data: new Uint8Array(100 * 100 * 3),
          }),
        };
        await analyzer.saveScreenshot(mockImage as any);
      }).rejects.toThrow();
    });

    it('should handle OCR failures gracefully', async () => {
      const mockImage = {
        width: 100,
        height: 100,
        channels: 3,
        data: new Uint8Array(100 * 100 * 3),
        toRGB: vi.fn().mockResolvedValue({
          width: 100,
          height: 100,
          channels: 3,
          data: new Uint8Array(100 * 100 * 3),
        }),
      };

      mockWorker.recognize.mockRejectedValueOnce(new Error('OCR failed'));

      const analyzer = new ScreenshotAnalyzer();
      
      await expect(analyzer.analyzeScreenshot(mockImage as any)).rejects.toThrow();
    });
  });

  describe('cleanup functionality', () => {
    it('should clean up old screenshots', async () => {
      mockFs.readdir.mockResolvedValueOnce([
        'screenshot_2024-01-01.png',
        'screenshot_2024-01-02.png',
        'screenshot_2024-01-03.png',
        'screenshot_2024-01-04.png',
        'screenshot_2024-01-05.png',
        'screenshot_2024-01-06.png'
      ]);

      const analyzer = new ScreenshotAnalyzer(3); // Keep only 3
      
      // This would normally be called internally
      await (analyzer as any).cleanupOldScreenshots();
      
      // Verify cleanup was attempted
      expect(mockFs.readdir).toHaveBeenCalled();
    });
  });
});

describe('UI Element Classification', () => {
  let analyzer: ScreenshotAnalyzer;

  beforeEach(() => {
    analyzer = new ScreenshotAnalyzer();
  });

  it('should classify button text correctly', () => {
    const classifyMethod = (analyzer as any).classifyUIElement.bind(analyzer);
    
    const buttonLocation = {
      text: 'OK',
      x: 100,
      y: 100,
      width: 50,
      height: 20,
      confidence: 95
    };

    const element = classifyMethod(buttonLocation);
    expect(element).toBeDefined();
    expect(element.type).toBe('button');
    expect(element.clickable).toBe(true);
  });

  it('should classify link text correctly', () => {
    const classifyMethod = (analyzer as any).classifyUIElement.bind(analyzer);
    
    const linkLocation = {
      text: 'Click here',
      x: 100,
      y: 100,
      width: 80,
      height: 20,
      confidence: 90
    };

    const element = classifyMethod(linkLocation);
    expect(element).toBeDefined();
    expect(element.type).toBe('link');
    expect(element.clickable).toBe(true);
  });

  it('should classify dialog text correctly', () => {
    const classifyMethod = (analyzer as any).classifyUIElement.bind(analyzer);
    
    const dialogLocation = {
      text: 'Error occurred',
      x: 100,
      y: 100,
      width: 120,
      height: 20,
      confidence: 88
    };

    const element = classifyMethod(dialogLocation);
    expect(element).toBeDefined();
    expect(element.type).toBe('dialog');
    expect(element.clickable).toBe(false);
  });
});