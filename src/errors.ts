/**
 * Custom error classes for macOS Simulator MCP
 */

export class MCPError extends Error {
  constructor(message: string, public readonly code: string, public readonly details?: any) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class PermissionError extends MCPError {
  constructor(message: string, public readonly permission: string, details?: any) {
    super(message, 'PERMISSION_DENIED', details);
  }
}

export class ScreenCaptureError extends MCPError {
  constructor(message: string, details?: any) {
    super(message, 'SCREEN_CAPTURE_FAILED', details);
  }
}

export class WindowNotFoundError extends MCPError {
  constructor(windowTitle: string, details?: any) {
    super(`Window with title "${windowTitle}" not found`, 'WINDOW_NOT_FOUND', details);
  }
}

export class OCRError extends MCPError {
  constructor(message: string, details?: any) {
    super(message, 'OCR_FAILED', details);
  }
}

export class ValidationError extends MCPError {
  constructor(message: string, public readonly field: string, details?: any) {
    super(message, 'VALIDATION_ERROR', { field, ...details });
  }
}

export class TimeoutError extends MCPError {
  constructor(operation: string, timeoutMs: number, details?: any) {
    super(`Operation "${operation}" timed out after ${timeoutMs}ms`, 'TIMEOUT', details);
  }
}

export class CoordinateOutOfBoundsError extends MCPError {
  constructor(x: number, y: number, screenWidth: number, screenHeight: number) {
    super(
      `Coordinates (${x}, ${y}) are out of screen bounds (${screenWidth}x${screenHeight})`,
      'COORDINATES_OUT_OF_BOUNDS',
      { x, y, screenWidth, screenHeight }
    );
  }
}

export class FileSystemError extends MCPError {
  constructor(message: string, path: string, details?: any) {
    super(message, 'FILE_SYSTEM_ERROR', { path, ...details });
  }
}

export class AutomationError extends MCPError {
  constructor(message: string, operation: string, details?: any) {
    super(message, 'AUTOMATION_ERROR', { operation, ...details });
  }
}

/**
 * Helper function to determine if an error is retryable
 */
export function isRetryableError(error: Error): boolean {
  if (error instanceof TimeoutError) return true;
  if (error instanceof ScreenCaptureError) return true;
  if (error instanceof OCRError) return true;
  if (error instanceof AutomationError) {
    // Some automation errors might be retryable
    return error.message.includes('temporary') || error.message.includes('busy');
  }
  return false;
}

/**
 * Helper function to get user-friendly error message
 */
export function getUserFriendlyErrorMessage(error: Error): string {
  if (error instanceof PermissionError) {
    return `Permission denied: ${error.permission}. Please grant the required permission in System Preferences > Security & Privacy.`;
  }
  
  if (error instanceof ScreenCaptureError) {
    return `Screen capture failed: ${error.message}. Make sure Screen Recording permission is granted.`;
  }
  
  if (error instanceof WindowNotFoundError) {
    return error.message;
  }
  
  if (error instanceof OCRError) {
    return `Text recognition failed: ${error.message}. The image might be unclear or contain no text.`;
  }
  
  if (error instanceof ValidationError) {
    return `Invalid input for ${error.field}: ${error.message}`;
  }
  
  if (error instanceof TimeoutError) {
    return error.message;
  }
  
  if (error instanceof CoordinateOutOfBoundsError) {
    return error.message;
  }
  
  if (error instanceof FileSystemError) {
    return `File system error: ${error.message}`;
  }
  
  if (error instanceof AutomationError) {
    return `Automation failed: ${error.message}`;
  }
  
  // Generic error
  return `An unexpected error occurred: ${error.message}`;
}