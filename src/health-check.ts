import { screen, mouse, Region } from '@nut-tree-fork/nut-js';
import { checkAllPermissions } from './permissions.js';
import { logger } from './logger.js';
import { initializeOCR, terminateOCR, extractTextFromImage } from './ocr-utils.js';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  checks: {
    permissions: {
      status: boolean;
      details: any;
    };
    screenCapture: {
      status: boolean;
      error?: string;
    };
    mouseControl: {
      status: boolean;
      error?: string;
    };
    ocr: {
      status: boolean;
      error?: string;
    };
  };
  errors: string[];
  warnings: string[];
}

/**
 * Perform a comprehensive health check of the MCP server
 */
export async function performHealthCheck(): Promise<HealthCheckResult> {
  const result: HealthCheckResult = {
    status: 'healthy',
    timestamp: new Date(),
    checks: {
      permissions: { status: false, details: {} },
      screenCapture: { status: false },
      mouseControl: { status: false },
      ocr: { status: false }
    },
    errors: [],
    warnings: []
  };

  // Check permissions
  try {
    logger.debug('Checking permissions...');
    const permissionStatus = await checkAllPermissions();
    result.checks.permissions.status = permissionStatus.screenRecording && permissionStatus.accessibility;
    result.checks.permissions.details = permissionStatus;
    
    if (!permissionStatus.screenRecording) {
      result.errors.push('Screen Recording permission not granted');
    }
    if (!permissionStatus.accessibility) {
      result.errors.push('Accessibility permission not granted');
    }
  } catch (error) {
    result.checks.permissions.status = false;
    result.errors.push(`Permission check failed: ${error}`);
  }

  // Check screen capture capability
  try {
    logger.debug('Testing screen capture...');
    const testScreenshot = await screen.grab();
    if (testScreenshot) {
      result.checks.screenCapture.status = true;
    } else {
      result.checks.screenCapture.status = false;
      result.checks.screenCapture.error = 'Screenshot returned null';
    }
  } catch (error) {
    result.checks.screenCapture.status = false;
    result.checks.screenCapture.error = error instanceof Error ? error.message : String(error);
    result.errors.push(`Screen capture test failed: ${error}`);
  }

  // Check mouse control capability
  try {
    logger.debug('Testing mouse control...');
    const currentPos = await mouse.getPosition();
    if (currentPos) {
      result.checks.mouseControl.status = true;
    } else {
      result.checks.mouseControl.status = false;
      result.checks.mouseControl.error = 'Could not get mouse position';
    }
  } catch (error) {
    result.checks.mouseControl.status = false;
    result.checks.mouseControl.error = error instanceof Error ? error.message : String(error);
    result.warnings.push(`Mouse control test failed: ${error}`);
  }

  // Check OCR capability
  try {
    logger.debug('Testing OCR...');
    await initializeOCR();
    
    // Try to capture and analyze a small region
    const testRegion = await screen.grabRegion(new Region(0, 0, 100, 100));
    
    const text = await extractTextFromImage(testRegion);
    result.checks.ocr.status = true;
    
    await terminateOCR();
  } catch (error) {
    result.checks.ocr.status = false;
    result.checks.ocr.error = error instanceof Error ? error.message : String(error);
    result.warnings.push(`OCR test failed: ${error}`);
  }

  // Determine overall health status
  const criticalChecks = [
    result.checks.permissions.status,
    result.checks.screenCapture.status
  ];
  
  const nonCriticalChecks = [
    result.checks.mouseControl.status,
    result.checks.ocr.status
  ];

  if (criticalChecks.every(check => check)) {
    if (nonCriticalChecks.every(check => check)) {
      result.status = 'healthy';
    } else {
      result.status = 'degraded';
    }
  } else {
    result.status = 'unhealthy';
  }

  logger.info(`Health check completed: ${result.status}`, {
    errors: result.errors.length,
    warnings: result.warnings.length
  });

  return result;
}

/**
 * Get a diagnostic report with system information
 */
export async function getDiagnosticReport(): Promise<any> {
  const healthCheck = await performHealthCheck();
  const screenDimensions = await getScreenInfo();
  
  return {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    nodeVersion: process.version,
    healthCheck,
    screen: screenDimensions,
    environment: {
      logLevel: process.env.MCP_LOG_LEVEL || 'INFO',
      logToFile: process.env.MCP_LOG_TO_FILE === 'true'
    }
  };
}

/**
 * Get screen information
 */
async function getScreenInfo(): Promise<any> {
  try {
    const width = await screen.width();
    const height = await screen.height();
    return { width, height };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}