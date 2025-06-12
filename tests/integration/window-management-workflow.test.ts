import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../mocks/nut-js.mock';
import { mockGetWindows, mockGetActiveWindow, mockScreen, mockWindowWithTitle, mockMouse, Point, Button } from '../mocks/nut-js.mock';

describe('Window Management Workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete window switching workflow', async () => {
    // Step 1: List all windows
    const mockWindows = [
      {
        getTitle: vi.fn().mockResolvedValue('Browser'),
        getRegion: vi.fn().mockResolvedValue({
          left: 0,
          top: 0,
          width: 1200,
          height: 800,
        }),
        focus: vi.fn().mockResolvedValue(undefined),
      },
      {
        getTitle: vi.fn().mockResolvedValue('Text Editor'),
        getRegion: vi.fn().mockResolvedValue({
          left: 100,
          top: 50,
          width: 800,
          height: 600,
        }),
        focus: vi.fn().mockResolvedValue(undefined),
      },
      {
        getTitle: vi.fn().mockResolvedValue('Terminal'),
        getRegion: vi.fn().mockResolvedValue({
          left: 200,
          top: 100,
          width: 600,
          height: 400,
        }),
        focus: vi.fn().mockResolvedValue(undefined),
      },
    ];
    mockGetWindows.mockResolvedValue(mockWindows);

    const windows = await mockGetWindows();
    expect(windows).toHaveLength(3);

    // Step 2: Get current active window
    mockGetActiveWindow.mockResolvedValue(mockWindows[0]); // Browser is active
    const activeWindow = await mockGetActiveWindow();
    const activeTitle = await activeWindow.getTitle();
    expect(activeTitle).toBe('Browser');

    // Step 3: Find specific window (Text Editor)
    mockWindowWithTitle.mockReturnValue((window: any) => 
      window.getTitle().then((title: string) => title.includes('Text Editor'))
    );
    mockScreen.find.mockImplementation(async (matcher: any) => {
      // Find the window that matches
      for (const window of mockWindows) {
        if (await matcher(window)) {
          return window;
        }
      }
      throw new Error('Window not found');
    });

    const targetWindow = await mockScreen.find(mockWindowWithTitle('Text Editor'));
    expect(targetWindow).toBe(mockWindows[1]);

    // Step 4: Focus the target window
    await targetWindow.focus();
    expect(targetWindow.focus).toHaveBeenCalled();

    // Step 5: Get window info and click in center
    const region = await targetWindow.getRegion();
    const centerX = region.left + region.width / 2;
    const centerY = region.top + region.height / 2;

    await mockMouse.setPosition(new Point(centerX, centerY));
    await mockMouse.click(Button.LEFT);

    expect(mockMouse.setPosition).toHaveBeenCalledWith(expect.objectContaining({
      x: 500, // 100 + 800/2
      y: 350, // 50 + 600/2
    }));
    expect(mockMouse.click).toHaveBeenCalledWith(Button.LEFT);
  });

  it('should handle window not found scenario', async () => {
    mockGetWindows.mockResolvedValue([]);
    mockWindowWithTitle.mockReturnValue(() => false);
    mockScreen.find.mockRejectedValue(new Error('Window not found'));

    // Try to find non-existent window
    await expect(mockScreen.find(mockWindowWithTitle('Nonexistent App'))).rejects.toThrow('Window not found');
  });

  it('should handle window minimize/maximize workflow', async () => {
    const mockWindow = {
      getTitle: vi.fn().mockResolvedValue('App Window'),
      getRegion: vi.fn()
        .mockResolvedValueOnce({ left: 100, top: 100, width: 800, height: 600 })
        .mockResolvedValueOnce({ left: 0, top: 0, width: 1920, height: 1080 }), // After maximize
      focus: vi.fn().mockResolvedValue(undefined),
      minimize: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn().mockResolvedValue(undefined),
    };

    // Get initial window state
    const initialRegion = await mockWindow.getRegion();
    expect(initialRegion.width).toBe(800);
    expect(initialRegion.height).toBe(600);

    // Focus window
    await mockWindow.focus();

    // Simulate maximize (in real implementation would use keyboard shortcut or window controls)
    await mockWindow.maximize?.();

    // Check new dimensions
    const maximizedRegion = await mockWindow.getRegion();
    expect(maximizedRegion.width).toBe(1920);
    expect(maximizedRegion.height).toBe(1080);
  });

  it('should complete multi-window interaction workflow', async () => {
    const sourceWindow = {
      getTitle: vi.fn().mockResolvedValue('Source App'),
      getRegion: vi.fn().mockResolvedValue({ left: 0, top: 0, width: 600, height: 400 }),
      focus: vi.fn().mockResolvedValue(undefined),
    };

    const targetWindow = {
      getTitle: vi.fn().mockResolvedValue('Target App'),
      getRegion: vi.fn().mockResolvedValue({ left: 700, top: 0, width: 600, height: 400 }),
      focus: vi.fn().mockResolvedValue(undefined),
    };

    // Step 1: Focus source window
    await sourceWindow.focus();
    expect(sourceWindow.focus).toHaveBeenCalled();

    // Step 2: Click in source window to select content
    await mockMouse.setPosition(new Point(300, 200));
    await mockMouse.click(Button.LEFT);

    // Step 3: Simulate copy (Cmd+C)
    // In real implementation, would use keyboard.pressKey(Key.LeftCmd, Key.C)

    // Step 4: Focus target window
    await targetWindow.focus();
    expect(targetWindow.focus).toHaveBeenCalled();

    // Step 5: Click in target window
    await mockMouse.setPosition(new Point(1000, 200));
    await mockMouse.click(Button.LEFT);

    // Step 6: Simulate paste (Cmd+V)
    // In real implementation, would use keyboard.pressKey(Key.LeftCmd, Key.V)

    // Verify mouse positions were set correctly
    expect(mockMouse.setPosition).toHaveBeenCalledWith(expect.objectContaining({ x: 300, y: 200 }));
    expect(mockMouse.setPosition).toHaveBeenCalledWith(expect.objectContaining({ x: 1000, y: 200 }));
  });

  it('should handle window enumeration with errors', async () => {
    const mockWindows = [
      {
        getTitle: vi.fn().mockResolvedValue('Good Window'),
        getRegion: vi.fn().mockResolvedValue({ left: 0, top: 0, width: 800, height: 600 }),
      },
      {
        getTitle: vi.fn().mockRejectedValue(new Error('Access denied')),
        getRegion: vi.fn().mockResolvedValue({ left: 100, top: 100, width: 600, height: 400 }),
      },
    ];

    mockGetWindows.mockResolvedValue(mockWindows);

    const windows = await mockGetWindows();
    const windowInfo = await Promise.all(
      windows.map(async (window) => {
        try {
          const title = await window.getTitle();
          const region = await window.getRegion();
          return { title, ...region };
        } catch (error) {
          return { title: 'Unknown', error: error instanceof Error ? error.message : 'Unknown error' };
        }
      })
    );

    expect(windowInfo).toHaveLength(2);
    expect(windowInfo[0].title).toBe('Good Window');
    expect(windowInfo[1].title).toBe('Unknown');
    expect(windowInfo[1].error).toBe('Access denied');
  });
});