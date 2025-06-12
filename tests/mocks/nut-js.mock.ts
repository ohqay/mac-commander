import { vi } from 'vitest';

export const mockMouse = {
  setPosition: vi.fn().mockResolvedValue(undefined),
  click: vi.fn().mockResolvedValue(undefined),
  doubleClick: vi.fn().mockResolvedValue(undefined),
  leftClick: vi.fn().mockResolvedValue(undefined),
  rightClick: vi.fn().mockResolvedValue(undefined),
  middleClick: vi.fn().mockResolvedValue(undefined),
  getPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
};

export const mockKeyboard = {
  type: vi.fn().mockResolvedValue(undefined),
  pressKey: vi.fn().mockResolvedValue(undefined),
  releaseKey: vi.fn().mockResolvedValue(undefined),
  config: {
    autoDelayMs: 50,
  },
};

export const mockScreen = {
  width: vi.fn().mockResolvedValue(1920),
  height: vi.fn().mockResolvedValue(1080),
  grab: vi.fn().mockResolvedValue({
    width: 1920,
    height: 1080,
    channels: 3,
    data: new Uint8Array(1920 * 1080 * 3),
    toRGB: vi.fn().mockResolvedValue({
      width: 1920,
      height: 1080,
      channels: 3,
      data: new Uint8Array(1920 * 1080 * 3),
    }),
  }),
  grabRegion: vi.fn().mockResolvedValue({
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
  }),
  find: vi.fn(),
};

export const mockGetWindows = vi.fn().mockResolvedValue([]);
export const mockGetActiveWindow = vi.fn();
export const mockWindowWithTitle = vi.fn();

export const Button = {
  LEFT: 0,
  RIGHT: 1,
  MIDDLE: 2,
};

export const Key = {
  LeftCmd: 'LeftCmd',
  LeftControl: 'LeftControl',
  LeftAlt: 'LeftAlt',
  LeftShift: 'LeftShift',
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Space: 'Space',
  Backspace: 'Backspace',
  Up: 'Up',
  Down: 'Down',
  Left: 'Left',
  Right: 'Right',
};

export class Region {
  constructor(
    public left: number,
    public top: number,
    public width: number,
    public height: number
  ) {}
}

export class Point {
  constructor(public x: number, public y: number) {}
}

export const Image = vi.fn();

// Mock module
vi.mock('@nut-tree-fork/nut-js', () => ({
  mouse: mockMouse,
  keyboard: mockKeyboard,
  screen: mockScreen,
  getWindows: mockGetWindows,
  getActiveWindow: mockGetActiveWindow,
  windowWithTitle: mockWindowWithTitle,
  Button,
  Key,
  Region,
  Point,
  Image,
}));