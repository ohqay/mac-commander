import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import '../mocks/nut-js.mock';
import '../mocks/canvas.mock';
import '../mocks/tesseract.mock';
import { mockMouse, mockKeyboard, mockScreen, mockGetWindows, mockGetActiveWindow, Button, Key, Point, Region } from '../mocks/nut-js.mock';
import { promises as fs } from 'fs';

// Mock file system
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock utilities
vi.mock('../../src/image-utils', () => ({
  imageToBase64: vi.fn().mockResolvedValue('data:image/png;base64,mockBase64String'),
  saveImage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/ocr-utils', () => ({
  extractTextFromImage: vi.fn().mockResolvedValue('Mock OCR text'),
  getTextLocations: vi.fn().mockResolvedValue([
    {
      text: 'Mock',
      x: 10,
      y: 10,
      width: 40,
      height: 20,
      confidence: 95,
    },
  ]),
  terminateOCR: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/error-detection', () => ({
  ErrorDetector: vi.fn().mockImplementation(() => ({
    detectErrors: vi.fn().mockResolvedValue([]),
  })),
  commonErrorPatterns: [],
}));

import { imageToBase64, saveImage } from '../../src/image-utils';
import { extractTextFromImage, getTextLocations } from '../../src/ocr-utils';
import { ErrorDetector } from '../../src/error-detection';

// Import the main module to test
import '../../src/index';

// We need to capture the server instance and its handler
let serverInstance: Server;
let toolHandler: any;

// Mock the Server constructor to capture the instance
vi.mock('@modelcontextprotocol/sdk/server/index.js', async () => {
  const actual = await vi.importActual('@modelcontextprotocol/sdk/server/index.js');
  return {
    ...actual,
    Server: vi.fn().mockImplementation((...args) => {
      serverInstance = new (actual as any).Server(...args);
      // Override setRequestHandler to capture the handler
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

describe('MCP Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('screenshot tool', () => {
    it('should capture entire screen and return base64', async () => {
      const request = {
        params: {
          name: 'screenshot',
          arguments: {},
        },
      };

      const result = await toolHandler(request);

      expect(mockScreen.grab).toHaveBeenCalledOnce();
      expect(imageToBase64).toHaveBeenCalledWith(expect.any(Object));
      expect(result.content[0].text).toBe('data:image/png;base64,mockBase64String');
    });

    it('should capture specific region', async () => {
      const request = {
        params: {
          name: 'screenshot',
          arguments: {
            region: { x: 100, y: 200, width: 300, height: 400 },
          },
        },
      };

      const result = await toolHandler(request);

      expect(mockScreen.grabRegion).toHaveBeenCalledWith(expect.any(Region));
      const calledRegion = mockScreen.grabRegion.mock.calls[0][0];
      expect(calledRegion.left).toBe(100);
      expect(calledRegion.top).toBe(200);
      expect(calledRegion.width).toBe(300);
      expect(calledRegion.height).toBe(400);
    });

    it('should save screenshot to file', async () => {
      const request = {
        params: {
          name: 'screenshot',
          arguments: {
            outputPath: '/tmp/screenshot.png',
          },
        },
      };

      const result = await toolHandler(request);

      expect(fs.mkdir).toHaveBeenCalledWith('/tmp', { recursive: true });
      expect(saveImage).toHaveBeenCalledWith(expect.any(Object), '/tmp/screenshot.png');
      expect(result.content[0].text).toBe('Screenshot saved to: /tmp/screenshot.png');
    });
  });

  describe('click tool', () => {
    it('should perform left click', async () => {
      const request = {
        params: {
          name: 'click',
          arguments: { x: 100, y: 200 },
        },
      };

      const result = await toolHandler(request);

      expect(mockMouse.setPosition).toHaveBeenCalledWith(expect.any(Point));
      const point = mockMouse.setPosition.mock.calls[0][0];
      expect(point.x).toBe(100);
      expect(point.y).toBe(200);
      expect(mockMouse.click).toHaveBeenCalledWith(Button.LEFT);
      expect(result.content[0].text).toBe('Clicked at (100, 200) with left button');
    });

    it('should perform right click', async () => {
      const request = {
        params: {
          name: 'click',
          arguments: { x: 50, y: 75, button: 'right' },
        },
      };

      const result = await toolHandler(request);

      expect(mockMouse.click).toHaveBeenCalledWith(Button.RIGHT);
      expect(result.content[0].text).toBe('Clicked at (50, 75) with right button');
    });

    it('should perform double click', async () => {
      const request = {
        params: {
          name: 'click',
          arguments: { x: 200, y: 300, doubleClick: true },
        },
      };

      const result = await toolHandler(request);

      expect(mockMouse.doubleClick).toHaveBeenCalledWith(Button.LEFT);
      expect(result.content[0].text).toBe('Clicked at (200, 300) with left button (double-click)');
    });
  });

  describe('type_text tool', () => {
    it('should type text with default delay', async () => {
      const request = {
        params: {
          name: 'type_text',
          arguments: { text: 'Hello World' },
        },
      };

      const result = await toolHandler(request);

      expect(mockKeyboard.config.autoDelayMs).toBe(50);
      expect(mockKeyboard.type).toHaveBeenCalledWith('Hello World');
      expect(result.content[0].text).toBe('Typed: "Hello World"');
    });

    it('should type text with custom delay', async () => {
      const request = {
        params: {
          name: 'type_text',
          arguments: { text: 'Custom delay', delay: 100 },
        },
      };

      const result = await toolHandler(request);

      expect(mockKeyboard.config.autoDelayMs).toBe(100);
      expect(mockKeyboard.type).toHaveBeenCalledWith('Custom delay');
    });
  });

  describe('mouse_move tool', () => {
    it('should move mouse to position', async () => {
      const request = {
        params: {
          name: 'mouse_move',
          arguments: { x: 500, y: 600 },
        },
      };

      const result = await toolHandler(request);

      expect(mockMouse.setPosition).toHaveBeenCalledWith(expect.any(Point));
      const point = mockMouse.setPosition.mock.calls[0][0];
      expect(point.x).toBe(500);
      expect(point.y).toBe(600);
      expect(result.content[0].text).toBe('Moved mouse to (500, 600)');
    });
  });

  describe('get_screen_info tool', () => {
    it('should return screen dimensions', async () => {
      const request = {
        params: {
          name: 'get_screen_info',
          arguments: {},
        },
      };

      const result = await toolHandler(request);

      expect(mockScreen.width).toHaveBeenCalled();
      expect(mockScreen.height).toHaveBeenCalled();
      const info = JSON.parse(result.content[0].text);
      expect(info.width).toBe(1920);
      expect(info.height).toBe(1080);
    });
  });

  describe('key_press tool', () => {
    it('should press single key', async () => {
      const request = {
        params: {
          name: 'key_press',
          arguments: { key: 'Enter' },
        },
      };

      const result = await toolHandler(request);

      expect(mockKeyboard.pressKey).toHaveBeenCalledWith(Key.Enter);
      expect(mockKeyboard.releaseKey).toHaveBeenCalledWith(Key.Enter);
      expect(result.content[0].text).toBe('Pressed key(s): Enter');
    });

    it('should press key combination', async () => {
      const request = {
        params: {
          name: 'key_press',
          arguments: { key: 'cmd+a' },
        },
      };

      const result = await toolHandler(request);

      expect(mockKeyboard.type).toHaveBeenCalledWith('a');
      expect(result.content[0].text).toBe('Pressed key(s): cmd+a');
    });
  });

  describe('wait tool', () => {
    it('should wait for specified time', async () => {
      const request = {
        params: {
          name: 'wait',
          arguments: { milliseconds: 500 },
        },
      };

      const startTime = Date.now();
      const result = await toolHandler(request);
      const endTime = Date.now();

      // Allow some tolerance for test execution
      expect(endTime - startTime).toBeGreaterThanOrEqual(400);
      expect(result.content[0].text).toBe('Waited for 500ms');
    });
  });

  describe('error handling', () => {
    it('should handle unknown tool', async () => {
      const request = {
        params: {
          name: 'unknown_tool',
          arguments: {},
        },
      };

      const result = await toolHandler(request);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool: unknown_tool');
    });

    it('should handle tool execution errors', async () => {
      mockScreen.grab.mockRejectedValueOnce(new Error('Screen capture failed'));

      const request = {
        params: {
          name: 'screenshot',
          arguments: {},
        },
      };

      const result = await toolHandler(request);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error: Screen capture failed');
    });

    it('should handle invalid arguments', async () => {
      const request = {
        params: {
          name: 'click',
          arguments: { x: 'invalid' }, // Invalid type
        },
      };

      const result = await toolHandler(request);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error');
    });
  });
});