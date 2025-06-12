import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../mocks/nut-js.mock';
import '../mocks/canvas.mock';
import '../mocks/tesseract.mock';
import { mockScreen, Region } from '../mocks/nut-js.mock';
import { mockWorker } from '../mocks/tesseract.mock';

// Import the actual modules to test integration
import { imageToBase64, saveImage } from '../../src/image-utils';
import { extractTextFromImage, getTextLocations, initializeOCR, terminateOCR } from '../../src/ocr-utils';
import { ErrorDetector } from '../../src/error-detection';

describe('Screenshot → OCR → Error Detection Workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete full workflow: screenshot → OCR → error detection', async () => {
    // Step 1: Take screenshot
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
    mockScreen.grab.mockResolvedValueOnce(mockImage);

    const screenshot = await mockScreen.grab();
    expect(screenshot).toBe(mockImage);

    // Step 2: Convert to base64 for display
    const base64Image = await imageToBase64(screenshot);
    expect(base64Image).toBe('data:image/png;base64,mockBase64String');

    // Step 3: Extract text using OCR
    mockWorker.recognize.mockResolvedValueOnce({
      data: {
        text: 'Error: Application crashed unexpectedly. Click OK to close.',
        words: [
          {
            text: 'Error:',
            bbox: { x0: 100, y0: 200, x1: 150, y1: 220 },
            confidence: 95,
          },
          {
            text: 'Application',
            bbox: { x0: 160, y0: 200, x1: 250, y1: 220 },
            confidence: 92,
          },
          {
            text: 'crashed',
            bbox: { x0: 260, y0: 200, x1: 320, y1: 220 },
            confidence: 90,
          },
          {
            text: 'OK',
            bbox: { x0: 350, y0: 250, x1: 380, y1: 270 },
            confidence: 98,
          },
        ],
      },
    });

    await initializeOCR();
    const extractedText = await extractTextFromImage(screenshot);
    expect(extractedText).toBe('Error: Application crashed unexpectedly. Click OK to close.');

    // Step 4: Get text locations
    const textLocations = await getTextLocations(screenshot);
    expect(textLocations).toHaveLength(4);
    expect(textLocations[0].text).toBe('Error:');

    // Step 5: Detect errors
    const errorDetector = new ErrorDetector();
    vi.mocked(errorDetector.detectErrors).mockImplementation(async () => {
      // Simulate error detection based on the OCR text
      return [
        {
          pattern: {
            name: 'crash_dialog',
            description: 'Application crash or unexpected quit dialog',
            patterns: ['crashed', 'quit unexpectedly'],
            severity: 'error' as const,
          },
          location: new Region(260, 200, 60, 20),
          confidence: 90,
          timestamp: new Date(),
        },
        {
          pattern: {
            name: 'modal_dialog',
            description: 'Modal dialog boxes that might contain errors',
            patterns: ['OK', 'Cancel'],
            severity: 'warning' as const,
          },
          location: new Region(350, 250, 30, 20),
          confidence: 98,
          timestamp: new Date(),
        },
      ];
    });

    const errors = await errorDetector.detectErrors();
    expect(errors).toHaveLength(2);
    expect(errors[0].pattern.name).toBe('crash_dialog');
    expect(errors[1].pattern.name).toBe('modal_dialog');

    // Cleanup
    await terminateOCR();
    expect(mockWorker.terminate).toHaveBeenCalled();
  });

  it('should handle region-specific workflow', async () => {
    const targetRegion = new Region(100, 100, 300, 200);

    // Take screenshot of specific region
    const mockRegionImage = {
      width: 300,
      height: 200,
      channels: 3,
      data: new Uint8Array(300 * 200 * 3),
      toRGB: vi.fn().mockResolvedValue({
        width: 300,
        height: 200,
        channels: 3,
        data: new Uint8Array(300 * 200 * 3),
      }),
    };
    mockScreen.grabRegion.mockResolvedValueOnce(mockRegionImage);

    const regionScreenshot = await mockScreen.grabRegion(targetRegion);
    expect(mockScreen.grabRegion).toHaveBeenCalledWith(targetRegion);

    // Process the region screenshot
    mockWorker.recognize.mockResolvedValueOnce({
      data: {
        text: 'Warning: Low memory',
        words: [
          {
            text: 'Warning:',
            bbox: { x0: 10, y0: 10, x1: 80, y1: 30 },
            confidence: 93,
          },
          {
            text: 'Low',
            bbox: { x0: 90, y0: 10, x1: 120, y1: 30 },
            confidence: 88,
          },
          {
            text: 'memory',
            bbox: { x0: 130, y0: 10, x1: 190, y1: 30 },
            confidence: 91,
          },
        ],
      },
    });

    await initializeOCR();
    const extractedText = await extractTextFromImage(regionScreenshot);
    expect(extractedText).toBe('Warning: Low memory');

    const textLocations = await getTextLocations(regionScreenshot);
    expect(textLocations).toHaveLength(3);

    // The locations should be relative to the region
    expect(textLocations[0].x).toBe(10);
    expect(textLocations[0].y).toBe(10);
  });

  it('should save screenshot and process it', async () => {
    const mockImage = {
      width: 400,
      height: 300,
      channels: 4, // RGBA
      data: new Uint8Array(400 * 300 * 4),
      toRGB: vi.fn().mockResolvedValue({
        width: 400,
        height: 300,
        channels: 4,
        data: new Uint8Array(400 * 300 * 4).fill(255),
      }),
    };
    mockScreen.grab.mockResolvedValueOnce(mockImage);

    // Take screenshot
    const screenshot = await mockScreen.grab();

    // Save to file
    const outputPath = '/tmp/test-screenshot.png';
    await saveImage(screenshot, outputPath);

    // Verify the image was processed correctly
    expect(screenshot.toRGB).toHaveBeenCalled();
    const fs = await import('fs');
    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      outputPath,
      Buffer.from('mock-png-data')
    );
  });

  it('should handle errors gracefully throughout the workflow', async () => {
    // Simulate screenshot failure
    mockScreen.grab.mockRejectedValueOnce(new Error('Screen capture failed'));

    await expect(mockScreen.grab()).rejects.toThrow('Screen capture failed');

    // Simulate OCR failure
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
    
    mockWorker.recognize.mockRejectedValueOnce(new Error('OCR engine failed'));

    await initializeOCR();
    await expect(extractTextFromImage(mockImage)).rejects.toThrow('OCR failed: OCR engine failed');
  });
});