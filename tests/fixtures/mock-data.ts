export const mockScreenshots = {
  errorDialog: {
    width: 600,
    height: 400,
    text: 'Error: The operation couldn't be completed. (OSStatus error -1743.)',
    elements: [
      { type: 'icon', x: 50, y: 100, width: 64, height: 64 },
      { type: 'text', x: 130, y: 120, text: 'Error' },
      { type: 'text', x: 130, y: 150, text: 'The operation couldn't be completed.' },
      { type: 'button', x: 450, y: 330, width: 80, height: 30, text: 'OK' },
    ],
  },
  
  loginForm: {
    width: 800,
    height: 600,
    text: 'Login Username: [_____] Password: [_____] [Login] [Cancel]',
    elements: [
      { type: 'label', x: 200, y: 200, text: 'Username:' },
      { type: 'input', x: 300, y: 195, width: 200, height: 30 },
      { type: 'label', x: 200, y: 250, text: 'Password:' },
      { type: 'input', x: 300, y: 245, width: 200, height: 30, inputType: 'password' },
      { type: 'button', x: 300, y: 320, width: 80, height: 35, text: 'Login' },
      { type: 'button', x: 400, y: 320, width: 80, height: 35, text: 'Cancel' },
    ],
  },
  
  applicationMenu: {
    width: 300,
    height: 400,
    text: 'File Edit View Window Help',
    elements: [
      { type: 'menuItem', x: 10, y: 10, text: 'File' },
      { type: 'menuItem', x: 50, y: 10, text: 'Edit' },
      { type: 'menuItem', x: 90, y: 10, text: 'View' },
      { type: 'menuItem', x: 130, y: 10, text: 'Window' },
      { type: 'menuItem', x: 190, y: 10, text: 'Help' },
    ],
  },
};

export const mockWindows = {
  browser: {
    title: 'Safari - Apple',
    x: 100,
    y: 50,
    width: 1200,
    height: 800,
    focused: true,
    minimized: false,
  },
  
  textEditor: {
    title: 'TextEdit - Untitled',
    x: 200,
    y: 100,
    width: 800,
    height: 600,
    focused: false,
    minimized: false,
  },
  
  finder: {
    title: 'Finder - Documents',
    x: 50,
    y: 50,
    width: 900,
    height: 600,
    focused: false,
    minimized: true,
  },
};

export const mockOCRResults = {
  simple: {
    text: 'Hello World',
    words: [
      { text: 'Hello', bbox: { x0: 10, y0: 10, x1: 50, y1: 30 }, confidence: 98 },
      { text: 'World', bbox: { x0: 60, y0: 10, x1: 100, y1: 30 }, confidence: 97 },
    ],
  },
  
  complex: {
    text: 'File Edit View\nNew Document\nOpen...\nSave\nSave As...',
    words: [
      { text: 'File', bbox: { x0: 10, y0: 10, x1: 40, y1: 25 }, confidence: 99 },
      { text: 'Edit', bbox: { x0: 50, y0: 10, x1: 80, y1: 25 }, confidence: 98 },
      { text: 'View', bbox: { x0: 90, y0: 10, x1: 120, y1: 25 }, confidence: 97 },
      { text: 'New', bbox: { x0: 10, y0: 40, x1: 40, y1: 55 }, confidence: 96 },
      { text: 'Document', bbox: { x0: 45, y0: 40, x1: 100, y1: 55 }, confidence: 95 },
      { text: 'Open...', bbox: { x0: 10, y0: 60, x1: 60, y1: 75 }, confidence: 94 },
      { text: 'Save', bbox: { x0: 10, y0: 80, x1: 45, y1: 95 }, confidence: 98 },
      { text: 'Save', bbox: { x0: 10, y0: 100, x1: 45, y1: 115 }, confidence: 97 },
      { text: 'As...', bbox: { x0: 50, y0: 100, x1: 80, y1: 115 }, confidence: 93 },
    ],
  },
  
  withErrors: {
    text: 'Error: Connection failed. Please check your internet connection and try again.',
    words: [
      { text: 'Error:', bbox: { x0: 100, y0: 200, x1: 150, y1: 220 }, confidence: 99 },
      { text: 'Connection', bbox: { x0: 160, y0: 200, x1: 240, y1: 220 }, confidence: 95 },
      { text: 'failed.', bbox: { x0: 250, y0: 200, x1: 300, y1: 220 }, confidence: 94 },
    ],
  },
};

export const mockMousePositions = {
  center: { x: 960, y: 540 }, // 1920x1080 center
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1919, y: 0 },
  bottomLeft: { x: 0, y: 1079 },
  bottomRight: { x: 1919, y: 1079 },
  
  // Common UI element positions
  menuBar: { x: 100, y: 10 },
  dock: { x: 960, y: 1050 },
  closeButton: { x: 15, y: 15 },
  minimizeButton: { x: 35, y: 15 },
  maximizeButton: { x: 55, y: 15 },
};

export const mockKeySequences = {
  selectAll: ['cmd+a'],
  copy: ['cmd+c'],
  paste: ['cmd+v'],
  cut: ['cmd+x'],
  undo: ['cmd+z'],
  redo: ['cmd+shift+z'],
  save: ['cmd+s'],
  open: ['cmd+o'],
  newWindow: ['cmd+n'],
  closeWindow: ['cmd+w'],
  quit: ['cmd+q'],
  
  // Navigation
  nextField: ['tab'],
  previousField: ['shift+tab'],
  submit: ['enter'],
  cancel: ['escape'],
};

export const mockErrorPatterns = {
  crashDialog: {
    patterns: ['quit unexpectedly', 'crashed', 'not responding'],
    severity: 'error',
    commonActions: ['Report...', 'Reopen', 'OK'],
  },
  
  permissionDialog: {
    patterns: ['would like to access', 'wants to use', 'requesting permission'],
    severity: 'info',
    commonActions: ['Allow', 'Don't Allow', 'OK'],
  },
  
  networkError: {
    patterns: ['connection failed', 'network error', 'unable to connect'],
    severity: 'error',
    commonActions: ['Retry', 'Cancel', 'OK'],
  },
  
  validationError: {
    patterns: ['invalid', 'required field', 'must be', 'incorrect format'],
    severity: 'warning',
    commonActions: ['OK', 'Fix', 'Cancel'],
  },
};