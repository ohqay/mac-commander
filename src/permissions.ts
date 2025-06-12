import { exec } from 'child_process';
import { promisify } from 'util';
import { PermissionError } from './errors.js';

const execAsync = promisify(exec);

export interface PermissionStatus {
  screenRecording: boolean;
  accessibility: boolean;
  errors: string[];
}

/**
 * Check if the current process has Screen Recording permission
 */
export async function checkScreenRecordingPermission(): Promise<boolean> {
  try {
    // Try to execute a simple screen capture command
    // If it fails, we likely don't have permission
    const { stderr } = await execAsync('screencapture -x -t png /dev/null 2>&1');
    return !stderr.includes('screencapture: cannot run without screen recording permission');
  } catch (error) {
    // If the command itself fails, we might not have permission
    return false;
  }
}

/**
 * Check if the current process has Accessibility permission
 */
export async function checkAccessibilityPermission(): Promise<boolean> {
  try {
    // Use AppleScript to check accessibility permission
    const script = `
      tell application "System Events"
        set isEnabled to UI elements enabled
      end tell
      return isEnabled
    `;
    
    const { stdout } = await execAsync(`osascript -e '${script}'`);
    return stdout.trim() === 'true';
  } catch (error) {
    return false;
  }
}

/**
 * Check all required permissions
 */
export async function checkAllPermissions(): Promise<PermissionStatus> {
  const errors: string[] = [];
  
  const [screenRecording, accessibility] = await Promise.all([
    checkScreenRecordingPermission(),
    checkAccessibilityPermission()
  ]);
  
  if (!screenRecording) {
    errors.push('Screen Recording permission is required. Grant it in System Preferences > Security & Privacy > Privacy > Screen Recording.');
  }
  
  if (!accessibility) {
    errors.push('Accessibility permission is required. Grant it in System Preferences > Security & Privacy > Privacy > Accessibility.');
  }
  
  return {
    screenRecording,
    accessibility,
    errors
  };
}

/**
 * Ensure required permissions are granted, throw error if not
 */
export async function ensurePermissions(requiredPermissions: {
  screenRecording?: boolean;
  accessibility?: boolean;
}): Promise<void> {
  const status = await checkAllPermissions();
  
  if (requiredPermissions.screenRecording && !status.screenRecording) {
    throw new PermissionError(
      'Screen Recording permission is required for this operation',
      'screenRecording',
      { status }
    );
  }
  
  if (requiredPermissions.accessibility && !status.accessibility) {
    throw new PermissionError(
      'Accessibility permission is required for this operation',
      'accessibility',
      { status }
    );
  }
}

/**
 * Open System Preferences to the appropriate permission page
 */
export async function openPermissionSettings(permission: 'screenRecording' | 'accessibility'): Promise<void> {
  const urls = {
    screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  };
  
  try {
    await execAsync(`open "${urls[permission]}"`);
  } catch (error) {
    throw new Error(`Failed to open System Preferences: ${error}`);
  }
}

/**
 * Get helpful instructions for granting permissions
 */
export function getPermissionInstructions(): string {
  return `
To use macOS Simulator MCP, you need to grant the following permissions:

1. Screen Recording Permission:
   - Open System Preferences > Security & Privacy > Privacy
   - Select "Screen Recording" from the left sidebar
   - Check the box next to your terminal application or Node.js
   - You may need to restart the application

2. Accessibility Permission:
   - Open System Preferences > Security & Privacy > Privacy
   - Select "Accessibility" from the left sidebar
   - Check the box next to your terminal application or Node.js
   - You may need to restart the application

Note: You may need to unlock the preferences (click the lock icon) to make changes.
  `.trim();
}