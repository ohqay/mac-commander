import { vi } from 'vitest';

export const mockContext = {
  createImageData: vi.fn().mockReturnValue({
    data: new Uint8Array(400), // 100x100x4 (RGBA)
    width: 100,
    height: 100,
  }),
  putImageData: vi.fn(),
};

export const mockCanvas = {
  getContext: vi.fn().mockReturnValue(mockContext),
  toDataURL: vi.fn().mockReturnValue('data:image/png;base64,mockBase64String'),
  toBuffer: vi.fn().mockReturnValue(Buffer.from('mock-png-data')),
};

export const createCanvas = vi.fn().mockReturnValue(mockCanvas);

export class ImageData {
  data: Uint8Array;
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }
}

vi.mock('canvas', () => ({
  createCanvas,
  ImageData,
}));