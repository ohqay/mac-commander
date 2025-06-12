import { vi } from 'vitest';

export const mockWorker = {
  terminate: vi.fn().mockResolvedValue(undefined),
  recognize: vi.fn().mockResolvedValue({
    data: {
      text: 'Mock OCR text',
      words: [
        {
          text: 'Mock',
          bbox: { x0: 10, y0: 10, x1: 50, y1: 30 },
          confidence: 95,
        },
        {
          text: 'OCR',
          bbox: { x0: 60, y0: 10, x1: 90, y1: 30 },
          confidence: 92,
        },
        {
          text: 'text',
          bbox: { x0: 100, y0: 10, x1: 140, y1: 30 },
          confidence: 88,
        },
      ],
    },
  }),
};

export const createWorker = vi.fn().mockResolvedValue(mockWorker);

vi.mock('tesseract.js', () => ({
  createWorker,
  Worker: vi.fn(),
}));