import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../mocks/nut-js.mock';
import '../mocks/canvas.mock';
import '../mocks/tesseract.mock';
import { 
  mockMouse, 
  mockKeyboard, 
  mockScreen, 
  mockGetWindows, 
  mockGetActiveWindow,
  mockWindowWithTitle,
  Point, 
  Button, 
  Key,
  Region 
} from '../mocks/nut-js.mock';
import { mockWorker } from '../mocks/tesseract.mock';

describe('E2E: Complete User Automation Scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete a form filling automation scenario', async () => {
    // Scenario: Automate filling a form in a web application
    
    // Step 1: Find and focus the browser window
    const browserWindow = {
      getTitle: vi.fn().mockResolvedValue('Chrome - Application Form'),
      getRegion: vi.fn().mockResolvedValue({ left: 100, top: 50, width: 1200, height: 800 }),
      focus: vi.fn().mockResolvedValue(undefined),
    };
    
    mockGetWindows.mockResolvedValue([browserWindow]);
    mockWindowWithTitle.mockReturnValue('browser-matcher');
    mockScreen.find.mockResolvedValue(browserWindow);

    // Focus the browser
    await browserWindow.focus();
    expect(browserWindow.focus).toHaveBeenCalled();

    // Step 2: Take a screenshot to analyze the form
    const formScreenshot = {
      width: 1200,
      height: 800,
      channels: 3,
      data: new Uint8Array(1200 * 800 * 3),
      toRGB: vi.fn().mockResolvedValue({
        width: 1200,
        height: 800,
        channels: 3,
        data: new Uint8Array(1200 * 800 * 3),
      }),
    };
    mockScreen.grab.mockResolvedValue(formScreenshot);

    const screenshot = await mockScreen.grab();
    expect(screenshot).toBe(formScreenshot);

    // Step 3: Use OCR to find form fields
    mockWorker.recognize.mockResolvedValue({
      data: {
        text: 'First Name: [____] Last Name: [____] Email: [____] Submit',
        words: [
          { text: 'First', bbox: { x0: 200, y0: 200, x1: 240, y1: 220 }, confidence: 95 },
          { text: 'Name:', bbox: { x0: 245, y0: 200, x1: 290, y1: 220 }, confidence: 94 },
          { text: 'Last', bbox: { x0: 200, y0: 250, x1: 235, y1: 270 }, confidence: 93 },
          { text: 'Name:', bbox: { x0: 240, y0: 250, x1: 285, y1: 270 }, confidence: 94 },
          { text: 'Email:', bbox: { x0: 200, y0: 300, x1: 250, y1: 320 }, confidence: 96 },
          { text: 'Submit', bbox: { x0: 300, y0: 400, x1: 360, y1: 430 }, confidence: 98 },
        ],
      },
    });

    // Step 4: Click on first name field (after the label)
    const firstNameFieldX = 300; // After "First Name:"
    const firstNameFieldY = 210;
    await mockMouse.setPosition(new Point(firstNameFieldX, firstNameFieldY));
    await mockMouse.click(Button.LEFT);

    expect(mockMouse.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ x: firstNameFieldX, y: firstNameFieldY })
    );

    // Step 5: Clear field and type first name
    // Select all (Cmd+A) and delete
    await mockKeyboard.pressKey(Key.LeftCmd, Key.A);
    await mockKeyboard.releaseKey(Key.LeftCmd, Key.A);
    await mockKeyboard.pressKey(Key.Backspace);
    await mockKeyboard.releaseKey(Key.Backspace);

    // Type first name
    mockKeyboard.config.autoDelayMs = 50;
    await mockKeyboard.type('John');
    expect(mockKeyboard.type).toHaveBeenCalledWith('John');

    // Step 6: Tab to next field
    await mockKeyboard.pressKey(Key.Tab);
    await mockKeyboard.releaseKey(Key.Tab);

    // Step 7: Type last name
    await mockKeyboard.type('Doe');
    expect(mockKeyboard.type).toHaveBeenCalledWith('Doe');

    // Step 8: Tab to email field
    await mockKeyboard.pressKey(Key.Tab);
    await mockKeyboard.releaseKey(Key.Tab);

    // Step 9: Type email
    await mockKeyboard.type('john.doe@example.com');
    expect(mockKeyboard.type).toHaveBeenCalledWith('john.doe@example.com');

    // Step 10: Click submit button
    const submitX = 330; // Center of "Submit" button
    const submitY = 415;
    await mockMouse.setPosition(new Point(submitX, submitY));
    await mockMouse.click(Button.LEFT);

    // Step 11: Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 12: Check for success or error messages
    const resultScreenshot = {
      width: 1200,
      height: 800,
      channels: 3,
      data: new Uint8Array(1200 * 800 * 3),
      toRGB: vi.fn().mockResolvedValue({
        width: 1200,
        height: 800,
        channels: 3,
        data: new Uint8Array(1200 * 800 * 3),
      }),
    };
    mockScreen.grab.mockResolvedValue(resultScreenshot);

    mockWorker.recognize.mockResolvedValue({
      data: {
        text: 'Success! Form submitted successfully.',
        words: [
          { text: 'Success!', bbox: { x0: 500, y0: 300, x1: 580, y1: 330 }, confidence: 98 },
        ],
      },
    });

    // Verify all interactions happened in correct order
    const typeCallOrder = mockKeyboard.type.mock.invocationCallOrder;
    expect(typeCallOrder[0]).toBeLessThan(typeCallOrder[1]); // John before Doe
    expect(typeCallOrder[1]).toBeLessThan(typeCallOrder[2]); // Doe before email
  });

  it('should handle error recovery scenario', async () => {
    // Scenario: Application shows error, need to detect and recover

    // Step 1: Perform action that triggers error
    await mockMouse.setPosition(new Point(500, 400));
    await mockMouse.click(Button.LEFT);

    // Step 2: Check for errors
    const errorScreenshot = {
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
    mockScreen.grab.mockResolvedValue(errorScreenshot);

    mockWorker.recognize.mockResolvedValue({
      data: {
        text: 'Error: Invalid input. Please try again. OK Cancel',
        words: [
          { text: 'Error:', bbox: { x0: 300, y0: 250, x1: 350, y1: 270 }, confidence: 96 },
          { text: 'Invalid', bbox: { x0: 360, y0: 250, x1: 420, y1: 270 }, confidence: 94 },
          { text: 'OK', bbox: { x0: 350, y0: 350, x1: 380, y1: 370 }, confidence: 98 },
          { text: 'Cancel', bbox: { x0: 420, y0: 350, x1: 480, y1: 370 }, confidence: 97 },
        ],
      },
    });

    // Step 3: Click OK to dismiss error
    const okButtonX = 365; // Center of OK button
    const okButtonY = 360;
    await mockMouse.setPosition(new Point(okButtonX, okButtonY));
    await mockMouse.click(Button.LEFT);

    // Step 4: Retry with corrected input
    await mockMouse.setPosition(new Point(400, 300));
    await mockMouse.click(Button.LEFT);
    await mockKeyboard.type('Corrected Input');

    // Verify error recovery flow
    expect(mockMouse.click).toHaveBeenCalledTimes(3); // Initial click, OK button, retry click
    expect(mockKeyboard.type).toHaveBeenCalledWith('Corrected Input');
  });

  it('should complete multi-application workflow', async () => {
    // Scenario: Copy data from one app to another

    // Step 1: List all windows
    const textEditor = {
      getTitle: vi.fn().mockResolvedValue('TextEdit - Document.txt'),
      getRegion: vi.fn().mockResolvedValue({ left: 50, top: 50, width: 600, height: 400 }),
      focus: vi.fn().mockResolvedValue(undefined),
    };

    const spreadsheet = {
      getTitle: vi.fn().mockResolvedValue('Numbers - Data.xlsx'),
      getRegion: vi.fn().mockResolvedValue({ left: 700, top: 50, width: 600, height: 400 }),
      focus: vi.fn().mockResolvedValue(undefined),
    };

    mockGetWindows.mockResolvedValue([textEditor, spreadsheet]);

    // Step 2: Focus text editor
    await textEditor.focus();

    // Step 3: Select all text (Cmd+A)
    await mockKeyboard.pressKey(Key.LeftCmd, Key.A);
    await mockKeyboard.releaseKey(Key.LeftCmd, Key.A);

    // Step 4: Copy (Cmd+C)
    await mockKeyboard.pressKey(Key.LeftCmd, Key.C);
    await mockKeyboard.releaseKey(Key.LeftCmd, Key.C);

    // Step 5: Switch to spreadsheet
    await spreadsheet.focus();
    expect(spreadsheet.focus).toHaveBeenCalled();

    // Step 6: Click on target cell
    const cellX = 800;
    const cellY = 200;
    await mockMouse.setPosition(new Point(cellX, cellY));
    await mockMouse.click(Button.LEFT);

    // Step 7: Paste (Cmd+V)
    await mockKeyboard.pressKey(Key.LeftCmd, Key.V);
    await mockKeyboard.releaseKey(Key.LeftCmd, Key.V);

    // Verify workflow completion
    expect(textEditor.focus).toHaveBeenCalled();
    expect(spreadsheet.focus).toHaveBeenCalled();
    expect(mockKeyboard.pressKey).toHaveBeenCalledWith(Key.LeftCmd, Key.C);
    expect(mockKeyboard.pressKey).toHaveBeenCalledWith(Key.LeftCmd, Key.V);
  });

  it('should handle complex navigation scenario', async () => {
    // Scenario: Navigate through menu system

    // Step 1: Click on menu bar
    await mockMouse.setPosition(new Point(100, 10));
    await mockMouse.click(Button.LEFT);

    // Step 2: Wait for menu to appear
    await new Promise(resolve => setTimeout(resolve, 200));

    // Step 3: Use arrow keys to navigate
    await mockKeyboard.pressKey(Key.Down);
    await mockKeyboard.releaseKey(Key.Down);
    await mockKeyboard.pressKey(Key.Down);
    await mockKeyboard.releaseKey(Key.Down);

    // Step 4: Press Enter to select
    await mockKeyboard.pressKey(Key.Enter);
    await mockKeyboard.releaseKey(Key.Enter);

    // Step 5: Handle sub-menu
    await mockKeyboard.pressKey(Key.Right);
    await mockKeyboard.releaseKey(Key.Right);
    await mockKeyboard.pressKey(Key.Down);
    await mockKeyboard.releaseKey(Key.Down);
    await mockKeyboard.pressKey(Key.Enter);
    await mockKeyboard.releaseKey(Key.Enter);

    // Verify navigation sequence
    const keyPresses = mockKeyboard.pressKey.mock.calls;
    const downPresses = keyPresses.filter(call => call[0] === Key.Down);
    const enterPresses = keyPresses.filter(call => call[0] === Key.Enter);
    
    expect(downPresses).toHaveLength(3);
    expect(enterPresses).toHaveLength(2);
  });
});