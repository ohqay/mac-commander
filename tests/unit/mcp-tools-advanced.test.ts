import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import '../mocks/nut-js.mock';
import '../mocks/canvas.mock';
import '../mocks/tesseract.mock';
import { mockScreen, mockGetWindows, mockGetActiveWindow, mockWindowWithTitle, Region } from '../mocks/nut-js.mock';

// Mock utilities
vi.mock('../../src/error-detection', () => ({
  ErrorDetector: vi.fn().mockImplementation(() => ({
    detectErrors: vi.fn().mockResolvedValue([
      {
        pattern: {
          name: 'test_error',
          description: 'Test error pattern',
          severity: 'error',
        },
        confidence: 95,
        timestamp: new Date(),
      },
    ]),
  })),
  commonErrorPatterns: [],
}));

vi.mock('../../src/ocr-utils', () => ({
  extractTextFromImage: vi.fn().mockResolvedValue('Extracted text from screen'),
  getTextLocations: vi.fn().mockResolvedValue([
    {
      text: 'Found',
      x: 100,
      y: 50,
      width: 50,
      height: 20,
      confidence: 95,
    },
    {
      text: 'text',
      x: 160,
      y: 50,
      width: 40,
      height: 20,
      confidence: 92,
    },
  ]),
  terminateOCR: vi.fn().mockResolvedValue(undefined),
}));

import { extractTextFromImage, getTextLocations } from '../../src/ocr-utils';

// Import and setup similar to previous test file
import '../../src/index';

let toolHandler: any;

vi.mock('@modelcontextprotocol/sdk/server/index.js', async () => {
  const actual = await vi.importActual('@modelcontextprotocol/sdk/server/index.js');
  return {
    ...actual,
    Server: vi.fn().mockImplementation((...args) => {
      const serverInstance = new (actual as any).Server(...args);
      const originalSetRequestHandler = serverInstance.setRequestHandler.bind(serverInstance);
      serverInstance.setRequestHandler = (schema: any, handler: any) => {
        if (schema === CallToolRequestSchema) {
          toolHandler = handler;
        }
        return originalSetRequestHandler(schema, handler);
      };
      return serverInstance;
    }),
  };
});

describe('MCP Tools - Advanced', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('check_for_errors tool', () => {
    it('should detect errors on entire screen', async () => {
      const request = {
        params: {
          name: 'check_for_errors',
          arguments: {},
        },
      };

      const result = await toolHandler(request);

      expect(result.content[0].text).toContain('Detected 1 potential error(s)');
      expect(result.content[0].text).toContain('test_error: Test error pattern');
    });

    it('should check specific region for errors', async () => {
      const request = {
        params: {
          name: 'check_for_errors',
          arguments: {
            region: { x: 100, y: 100, width: 200, height: 200 },
          },
        },
      };

      const result = await toolHandler(request);

      expect(result.content[0].text).toContain('Detected 1 potential error(s)');
    });

    it('should report no errors when none detected', async () => {
      const ErrorDetector = vi.mocked((await import('../../src/error-detection')).ErrorDetector);
      ErrorDetector.mockImplementationOnce(() => ({
        detectErrors: vi.fn().mockResolvedValue([]),
      }));

      const request = {
        params: {
          name: 'check_for_errors',
          arguments: {},
        },
      };

      const result = await toolHandler(request);

      expect(result.content[0].text).toBe('No errors detected on screen');
    });
  });

  describe('window management tools', () => {
    describe('list_windows', () => {
      it('should list all windows', async () => {
        const mockWindow1 = {
          getTitle: vi.fn().mockResolvedValue('Window 1'),
          getRegion: vi.fn().mockResolvedValue({
            left: 0,
            top: 0,
            width: 800,
            height: 600,
          }),
        };
        const mockWindow2 = {
          getTitle: vi.fn().mockResolvedValue('Window 2'),
          getRegion: vi.fn().mockResolvedValue({
            left: 100,
            top: 100,
            width: 600,
            height: 400,
          }),
        };
        mockGetWindows.mockResolvedValueOnce([mockWindow1, mockWindow2]);

        const request = {
          params: {
            name: 'list_windows',
            arguments: {},
          },
        };

        const result = await toolHandler(request);
        const windows = JSON.parse(result.content[0].text);

        expect(windows).toHaveLength(2);
        expect(windows[0].title).toBe('Window 1');
        expect(windows[0].x).toBe(0);
        expect(windows[0].y).toBe(0);
        expect(windows[1].title).toBe('Window 2');
      });

      it('should handle window listing errors', async () => {
        mockGetWindows.mockRejectedValueOnce(new Error('Failed to get windows'));

        const request = {
          params: {
            name: 'list_windows',
            arguments: {},
          },
        };

        const result = await toolHandler(request);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Failed to list windows');
      });
    });

    describe('get_active_window', () => {
      it('should get active window info', async () => {
        const mockActiveWindow = {
          getTitle: vi.fn().mockResolvedValue('Active Window'),
          getRegion: vi.fn().mockResolvedValue({
            left: 50,
            top: 50,
            width: 1000,
            height: 700,
          }),
        };
        mockGetActiveWindow.mockResolvedValueOnce(mockActiveWindow);

        const request = {
          params: {
            name: 'get_active_window',
            arguments: {},
          },
        };

        const result = await toolHandler(request);
        const windowInfo = JSON.parse(result.content[0].text);

        expect(windowInfo.title).toBe('Active Window');
        expect(windowInfo.x).toBe(50);
        expect(windowInfo.y).toBe(50);
        expect(windowInfo.width).toBe(1000);
        expect(windowInfo.height).toBe(700);
      });
    });

    describe('find_window', () => {
      it('should find window by title', async () => {
        const mockFoundWindow = {
          getRegion: vi.fn().mockResolvedValue({
            left: 200,
            top: 150,
            width: 800,
            height: 600,
          }),
        };
        mockScreen.find.mockResolvedValueOnce(mockFoundWindow);
        mockWindowWithTitle.mockReturnValue('window-matcher');

        const request = {
          params: {
            name: 'find_window',
            arguments: { title: 'Test Window' },
          },
        };

        const result = await toolHandler(request);
        const windowInfo = JSON.parse(result.content[0].text);

        expect(mockWindowWithTitle).toHaveBeenCalledWith('Test Window');
        expect(mockScreen.find).toHaveBeenCalledWith('window-matcher');
        expect(windowInfo.found).toBe(true);
        expect(windowInfo.title).toBe('Test Window');
      });

      it('should handle window not found', async () => {
        mockScreen.find.mockRejectedValueOnce(new Error('Window not found'));

        const request = {
          params: {
            name: 'find_window',
            arguments: { title: 'Nonexistent Window' },
          },
        };

        const result = await toolHandler(request);

        expect(result.content[0].text).toBe('Window with title "Nonexistent Window" not found');
      });
    });

    describe('focus_window', () => {
      it('should focus window by title', async () => {
        const mockWindow = {
          focus: vi.fn().mockResolvedValue(undefined),
        };
        mockScreen.find.mockResolvedValueOnce(mockWindow);

        const request = {
          params: {
            name: 'focus_window',
            arguments: { title: 'Target Window' },
          },
        };

        const result = await toolHandler(request);

        expect(mockWindow.focus).toHaveBeenCalled();
        expect(result.content[0].text).toBe('Focused window: "Target Window"');
      });
    });
  });

  describe('OCR tools', () => {
    describe('extract_text', () => {
      it('should extract text from entire screen', async () => {
        const request = {
          params: {
            name: 'extract_text',
            arguments: {},
          },
        };

        const result = await toolHandler(request);

        expect(mockScreen.grab).toHaveBeenCalled();
        expect(extractTextFromImage).toHaveBeenCalled();
        expect(result.content[0].text).toBe('Extracted text from screen');
      });

      it('should extract text from specific region', async () => {
        const request = {
          params: {
            name: 'extract_text',
            arguments: {
              region: { x: 50, y: 50, width: 200, height: 100 },
            },
          },
        };

        const result = await toolHandler(request);

        expect(mockScreen.grabRegion).toHaveBeenCalledWith(expect.any(Region));
        expect(extractTextFromImage).toHaveBeenCalled();
        expect(result.content[0].text).toBe('Extracted text from screen');
      });

      it('should handle empty text extraction', async () => {
        vi.mocked(extractTextFromImage).mockResolvedValueOnce('');

        const request = {
          params: {
            name: 'extract_text',
            arguments: {},
          },
        };

        const result = await toolHandler(request);

        expect(result.content[0].text).toBe('No text found in the specified region');
      });
    });

    describe('find_text', () => {
      it('should find text on screen', async () => {
        const request = {
          params: {
            name: 'find_text',
            arguments: { text: 'found' },
          },
        };

        const result = await toolHandler(request);
        const findResult = JSON.parse(result.content[0].text);

        expect(findResult.found).toBe(true);
        expect(findResult.searchText).toBe('found');
        expect(findResult.locations).toHaveLength(1);
        expect(findResult.locations[0].text).toBe('Found');
        expect(findResult.locations[0].confidence).toBe(95);
      });

      it('should search in specific region', async () => {
        const request = {
          params: {
            name: 'find_text',
            arguments: {
              text: 'text',
              region: { x: 100, y: 0, width: 200, height: 100 },
            },
          },
        };

        const result = await toolHandler(request);
        const findResult = JSON.parse(result.content[0].text);

        expect(mockScreen.grabRegion).toHaveBeenCalled();
        expect(findResult.found).toBe(true);
        expect(findResult.locations[0].x).toBe(260); // 160 + 100 (region offset)
      });

      it('should report text not found', async () => {
        vi.mocked(getTextLocations).mockResolvedValueOnce([
          {
            text: 'Different',
            x: 10,
            y: 10,
            width: 70,
            height: 20,
            confidence: 90,
          },
        ]);

        const request = {
          params: {
            name: 'find_text',
            arguments: { text: 'notfound' },
          },
        };

        const result = await toolHandler(request);

        expect(result.content[0].text).toBe('Text "notfound" not found on screen');
      });

      it('should handle OCR errors', async () => {
        vi.mocked(getTextLocations).mockRejectedValueOnce(new Error('OCR failed'));

        const request = {
          params: {
            name: 'find_text',
            arguments: { text: 'test' },
          },
        };

        const result = await toolHandler(request);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Failed to find text: OCR failed');
      });
    });
  });
});