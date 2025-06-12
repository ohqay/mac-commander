import { z } from 'zod';

/**
 * Core types and interfaces for the MCP server
 */

export interface ToolResult {
  content: Array<{
    type: string;
    text: string;
  }>;
  isError?: boolean;
}

export interface ExecutionContext {
  sessionId: string;
  startTime: number;
  sharedResources: Map<string, any>;
  cacheManager: CacheManager;
  performanceTracker: PerformanceTracker;
  
  shareResource(key: string, value: any): void;
  getSharedResource<T>(key: string): T | undefined;
  shareScreenshot(screenshot: any, key?: string): void;
  getSharedScreenshot(key?: string): Promise<any>;
}

export interface ToolHandler {
  name: string;
  description: string;
  schema: z.ZodSchema<any>;
  execute(args: any, context: ExecutionContext): Promise<ToolResult>;
  validatePermissions?(): Promise<void>;
}

export interface CacheManager {
  getScreenshotCache(): TimedCache<any>;
  getOCRCache(): TimedCache<any>;
  getWindowCache(): TimedCache<any>;
  getPermissionCache(): TimedCache<any>;
  invalidate(pattern?: string): void;
}

export interface TimedCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T, ttlMs?: number): void;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
}

export interface PerformanceTracker {
  startTimer(operation: string): void;
  endTimer(operation: string): void;
  getMetrics(operation: string): PerformanceMetrics;
}

export interface PerformanceMetrics {
  count: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
}

export interface ScreenshotOptions {
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  outputPath?: string;
}

export interface ClickOptions {
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  doubleClick?: boolean;
  verify?: boolean;
}

export interface TypeTextOptions {
  text: string;
  delay?: number;
}

export interface WindowInfo {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}