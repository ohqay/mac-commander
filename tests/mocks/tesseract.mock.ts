import { vi } from 'vitest';

// Mock worker instance that simulates Tesseract.js worker
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
  load: vi.fn().mockResolvedValue(undefined),
  loadLanguage: vi.fn().mockResolvedValue(undefined),
  initialize: vi.fn().mockResolvedValue(undefined),
  setParameters: vi.fn().mockResolvedValue(undefined),
};

// Mock createWorker function
export const createWorker = vi.fn().mockImplementation(async (language?: string) => {
  // Simulate the initialization process
  await mockWorker.load();
  await mockWorker.loadLanguage(language || 'eng');
  await mockWorker.initialize(language || 'eng');
  return mockWorker;
});

// Mock the entire tesseract.js module - hoisted to top level
vi.mock('tesseract.js', () => ({
  createWorker,
  Worker: vi.fn().mockImplementation(() => mockWorker),
}));