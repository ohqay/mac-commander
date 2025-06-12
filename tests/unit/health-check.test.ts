import { describe, it, expect, beforeEach, vi } from 'vitest';
import { performHealthCheck, getDiagnosticReport } from '../../src/health-check';

// Mock dependencies
vi.mock('@nut-tree-fork/nut-js', () => ({
  screen: {
    grab: vi.fn(),
    grabRegion: vi.fn(),
    width: vi.fn(),
    height: vi.fn(),
  },
  mouse: {
    getPosition: vi.fn(),
  },
  Region: vi.fn().mockImplementation((x, y, w, h) => ({ x, y, width: w, height: h })),
}));

vi.mock('../../src/permissions.js', () => ({
  checkAllPermissions: vi.fn(),
}));

vi.mock('../../src/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/ocr-utils.js', () => ({
  initializeOCR: vi.fn(),
  terminateOCR: vi.fn(),
  extractTextFromImage: vi.fn(),
}));

import { screen, mouse, Region } from '@nut-tree-fork/nut-js';
import { checkAllPermissions } from '../../src/permissions.js';
import { logger } from '../../src/logger.js';
import { initializeOCR, terminateOCR, extractTextFromImage } from '../../src/ocr-utils.js';

describe('health-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default successful mocks
    vi.mocked(checkAllPermissions).mockResolvedValue({
      screenRecording: true,
      accessibility: true,
      errors: [],
    });
    
    vi.mocked(screen.grab).mockResolvedValue({
      width: 100,
      height: 100,
      data: new Uint8Array(100 * 100 * 4),
    });
    
    vi.mocked(screen.width).mockResolvedValue(1920);
    vi.mocked(screen.height).mockResolvedValue(1080);
    
    vi.mocked(mouse.getPosition).mockResolvedValue({ x: 100, y: 200 });
    
    vi.mocked(initializeOCR).mockResolvedValue(undefined);
    vi.mocked(terminateOCR).mockResolvedValue(undefined);
    vi.mocked(extractTextFromImage).mockResolvedValue('test text');
    
    vi.mocked(screen.grabRegion).mockResolvedValue({
      width: 100,
      height: 100,
      data: new Uint8Array(100 * 100 * 4),
    });
  });

  describe('performHealthCheck', () => {
    it('should return healthy status when all checks pass', async () => {
      const result = await performHealthCheck();
      
      expect(result.status).toBe('healthy');
      expect(result.checks.permissions.status).toBe(true);
      expect(result.checks.screenCapture.status).toBe(true);
      expect(result.checks.mouseControl.status).toBe(true);
      expect(result.checks.ocr.status).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should return degraded status when only critical checks pass', async () => {
      // Make non-critical checks fail
      vi.mocked(mouse.getPosition).mockRejectedValue(new Error('Mouse access denied'));
      vi.mocked(extractTextFromImage).mockRejectedValue(new Error('OCR failed'));
      
      const result = await performHealthCheck();
      
      expect(result.status).toBe('degraded');
      expect(result.checks.permissions.status).toBe(true);
      expect(result.checks.screenCapture.status).toBe(true);
      expect(result.checks.mouseControl.status).toBe(false);
      expect(result.checks.ocr.status).toBe(false);
      expect(result.warnings).toContain('Mouse control test failed: Error: Mouse access denied');
      expect(result.warnings).toContain('OCR test failed: Error: OCR failed');
    });

    it('should return unhealthy status when critical checks fail', async () => {
      vi.mocked(checkAllPermissions).mockResolvedValue({
        screenRecording: false,
        accessibility: false,
        errors: ['Screen Recording permission denied', 'Accessibility permission denied'],
      });
      
      const result = await performHealthCheck();
      
      expect(result.status).toBe('unhealthy');
      expect(result.checks.permissions.status).toBe(false);
      expect(result.errors).toContain('Screen Recording permission not granted');
      expect(result.errors).toContain('Accessibility permission not granted');
    });

    it('should handle permission check failure', async () => {
      vi.mocked(checkAllPermissions).mockRejectedValue(new Error('Permission check failed'));
      
      const result = await performHealthCheck();
      
      expect(result.status).toBe('unhealthy');
      expect(result.checks.permissions.status).toBe(false);
      expect(result.errors).toContain('Permission check failed: Error: Permission check failed');
    });

    it('should handle screen capture failure', async () => {
      vi.mocked(screen.grab).mockRejectedValue(new Error('Screen capture failed'));
      
      const result = await performHealthCheck();
      
      expect(result.status).toBe('unhealthy');
      expect(result.checks.screenCapture.status).toBe(false);
      expect(result.checks.screenCapture.error).toBe('Screen capture failed');
      expect(result.errors).toContain('Screen capture test failed: Error: Screen capture failed');
    });

    it('should handle null screenshot result', async () => {
      vi.mocked(screen.grab).mockResolvedValue(null);
      
      const result = await performHealthCheck();
      
      expect(result.status).toBe('unhealthy');
      expect(result.checks.screenCapture.status).toBe(false);
      expect(result.checks.screenCapture.error).toBe('Screenshot returned null');
    });

    it('should handle mouse control failure', async () => {
      vi.mocked(mouse.getPosition).mockRejectedValue(new Error('Mouse error'));
      
      const result = await performHealthCheck();
      
      expect(result.status).toBe('degraded');
      expect(result.checks.mouseControl.status).toBe(false);
      expect(result.checks.mouseControl.error).toBe('Mouse error');
      expect(result.warnings).toContain('Mouse control test failed: Error: Mouse error');
    });

    it('should handle null mouse position result', async () => {
      vi.mocked(mouse.getPosition).mockResolvedValue(null);
      
      const result = await performHealthCheck();
      
      expect(result.status).toBe('degraded');
      expect(result.checks.mouseControl.status).toBe(false);
      expect(result.checks.mouseControl.error).toBe('Could not get mouse position');
    });

    it('should handle OCR initialization failure', async () => {
      vi.mocked(initializeOCR).mockRejectedValue(new Error('OCR init failed'));
      
      const result = await performHealthCheck();
      
      expect(result.status).toBe('degraded');
      expect(result.checks.ocr.status).toBe(false);
      expect(result.checks.ocr.error).toBe('OCR init failed');
      expect(result.warnings).toContain('OCR test failed: Error: OCR init failed');
    });

    it('should handle OCR region capture failure', async () => {
      vi.mocked(screen.grabRegion).mockRejectedValue(new Error('Region capture failed'));
      
      const result = await performHealthCheck();
      
      expect(result.status).toBe('degraded');
      expect(result.checks.ocr.status).toBe(false);
      expect(result.warnings).toContain('OCR test failed: Error: Region capture failed');
    });

    it('should handle OCR text extraction failure', async () => {
      vi.mocked(extractTextFromImage).mockRejectedValue(new Error('Text extraction failed'));
      
      const result = await performHealthCheck();
      
      expect(result.status).toBe('degraded');
      expect(result.checks.ocr.status).toBe(false);
      expect(result.warnings).toContain('OCR test failed: Error: Text extraction failed');
    });

    it('should call terminateOCR after successful OCR test', async () => {
      await performHealthCheck();
      
      expect(terminateOCR).toHaveBeenCalled();
    });

    it('should log debug messages during health check', async () => {
      await performHealthCheck();
      
      expect(logger.debug).toHaveBeenCalledWith('Checking permissions...');
      expect(logger.debug).toHaveBeenCalledWith('Testing screen capture...');
      expect(logger.debug).toHaveBeenCalledWith('Testing mouse control...');
      expect(logger.debug).toHaveBeenCalledWith('Testing OCR...');
    });

    it('should log completion message with status', async () => {
      await performHealthCheck();
      
      expect(logger.info).toHaveBeenCalledWith('Health check completed: healthy', {
        errors: 0,
        warnings: 0,
      });
    });

    it('should handle mixed permission statuses', async () => {
      vi.mocked(checkAllPermissions).mockResolvedValue({
        screenRecording: true,
        accessibility: false,
        errors: ['Accessibility permission denied'],
      });
      
      const result = await performHealthCheck();
      
      expect(result.status).toBe('unhealthy');
      expect(result.checks.permissions.status).toBe(false);
      expect(result.errors).toContain('Accessibility permission not granted');
      expect(result.errors).not.toContain('Screen Recording permission not granted');
    });

    it('should correctly classify critical vs non-critical failures', async () => {
      // Only screen capture fails (critical)
      vi.mocked(screen.grab).mockRejectedValue(new Error('Screen failed'));
      
      const result = await performHealthCheck();
      
      expect(result.status).toBe('unhealthy');
      expect(result.checks.screenCapture.status).toBe(false);
      expect(result.checks.permissions.status).toBe(true);
      expect(result.checks.mouseControl.status).toBe(true);
      expect(result.checks.ocr.status).toBe(true);
    });

    it('should handle string errors properly', async () => {
      vi.mocked(screen.grab).mockRejectedValue('String error');
      
      const result = await performHealthCheck();
      
      expect(result.checks.screenCapture.error).toBe('String error');
    });

    it('should call grabRegion with correct dimensions', async () => {
      await performHealthCheck();
      
      expect(screen.grabRegion).toHaveBeenCalledWith(expect.objectContaining({
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      }));
    });
  });

  describe('getDiagnosticReport', () => {
    beforeEach(() => {
      // Mock process and environment
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });
      Object.defineProperty(process, 'version', {
        value: 'v18.0.0',
        configurable: true,
      });
      
      // Clear environment variables
      delete process.env.MCP_LOG_LEVEL;
      delete process.env.MCP_LOG_TO_FILE;
    });

    it('should return complete diagnostic report', async () => {
      const report = await getDiagnosticReport();
      
      expect(report).toMatchObject({
        timestamp: expect.any(String),
        platform: 'darwin',
        nodeVersion: 'v18.0.0',
        healthCheck: expect.objectContaining({
          status: 'healthy',
          checks: expect.any(Object),
        }),
        screen: expect.objectContaining({
          width: 1920,
          height: 1080,
        }),
        environment: expect.objectContaining({
          logLevel: 'INFO',
          logToFile: false,
        }),
      });
    });

    it('should include environment variables when set', async () => {
      process.env.MCP_LOG_LEVEL = 'DEBUG';
      process.env.MCP_LOG_TO_FILE = 'true';
      
      const report = await getDiagnosticReport();
      
      expect(report.environment.logLevel).toBe('DEBUG');
      expect(report.environment.logToFile).toBe(true);
    });

    it('should handle screen dimension errors', async () => {
      vi.mocked(screen.width).mockRejectedValue(new Error('Screen width failed'));
      vi.mocked(screen.height).mockRejectedValue(new Error('Screen height failed'));
      
      const report = await getDiagnosticReport();
      
      expect(report.screen.error).toBe('Screen width failed');
    });

    it('should handle string screen errors', async () => {
      vi.mocked(screen.width).mockRejectedValue('String screen error');
      
      const report = await getDiagnosticReport();
      
      expect(report.screen.error).toBe('String screen error');
    });

    it('should use default environment values', async () => {
      const report = await getDiagnosticReport();
      
      expect(report.environment.logLevel).toBe('INFO');
      expect(report.environment.logToFile).toBe(false);
    });

    it('should include health check results', async () => {
      // Make health check fail
      vi.mocked(checkAllPermissions).mockResolvedValue({
        screenRecording: false,
        accessibility: false,
        errors: [],
      });
      
      const report = await getDiagnosticReport();
      
      expect(report.healthCheck.status).toBe('unhealthy');
      expect(report.healthCheck.checks.permissions.status).toBe(false);
    });

    it('should format timestamp as ISO string', async () => {
      const report = await getDiagnosticReport();
      
      expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
});