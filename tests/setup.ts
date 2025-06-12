import { vi } from 'vitest';

// Setup global test environment
beforeEach(() => {
  vi.clearAllMocks();
});

// Global test utilities
export const mockImage = (width: number = 100, height: number = 100, channels: number = 3) => ({
  width,
  height,
  channels,
  data: new Uint8Array(width * height * channels),
  toRGB: vi.fn().mockResolvedValue({
    width,
    height,
    channels,
    data: new Uint8Array(width * height * channels),
  }),
});

export const mockRegion = (x: number = 0, y: number = 0, width: number = 100, height: number = 100) => ({
  left: x,
  top: y,
  width,
  height,
});

export const mockPoint = (x: number = 0, y: number = 0) => ({ x, y });

export const mockWindow = (title: string = 'Test Window') => ({
  getTitle: vi.fn().mockResolvedValue(title),
  getRegion: vi.fn().mockResolvedValue(mockRegion()),
  focus: vi.fn().mockResolvedValue(undefined),
});

// Mock console methods to avoid noise in tests
global.console = {
  ...console,
  error: vi.fn(),
  warn: vi.fn(),
  log: vi.fn(),
};