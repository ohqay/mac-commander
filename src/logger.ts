import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: any;
  error?: Error;
}

export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel;
  private logToFile: boolean;
  private logFilePath: string;
  private performanceMetrics: Map<string, number[]> = new Map();

  private constructor() {
    // Get log level from environment
    const envLogLevel = process.env.MCP_LOG_LEVEL?.toUpperCase();
    this.logLevel = LogLevel[envLogLevel as keyof typeof LogLevel] ?? LogLevel.INFO;
    
    // Check if we should log to file
    this.logToFile = process.env.MCP_LOG_TO_FILE === 'true';
    
    // Set up log file path
    const logDir = join(homedir(), '.mac-commander', 'logs');
    if (this.logToFile && !existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFilePath = join(logDir, `mcp-${timestamp}.log`);
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private formatMessage(entry: LogEntry): string {
    const levelStr = LogLevel[entry.level];
    const timestamp = entry.timestamp.toISOString();
    let message = `[${timestamp}] [${levelStr}] ${entry.message}`;
    
    if (entry.context) {
      message += ` | Context: ${JSON.stringify(entry.context)}`;
    }
    
    if (entry.error) {
      message += ` | Error: ${entry.error.message}`;
      if (entry.error.stack && this.logLevel === LogLevel.DEBUG) {
        message += `\nStack: ${entry.error.stack}`;
      }
    }
    
    return message;
  }

  private log(entry: LogEntry): void {
    if (entry.level < this.logLevel) return;
    
    const formattedMessage = this.formatMessage(entry);
    
    // Log to stderr (MCP servers should use stderr for logging)
    console.error(formattedMessage);
    
    // Log to file if enabled
    if (this.logToFile) {
      try {
        appendFileSync(this.logFilePath, formattedMessage + '\n');
      } catch (error) {
        console.error('Failed to write to log file:', error);
      }
    }
  }

  debug(message: string, context?: any): void {
    this.log({
      timestamp: new Date(),
      level: LogLevel.DEBUG,
      message,
      context
    });
  }

  info(message: string, context?: any): void {
    this.log({
      timestamp: new Date(),
      level: LogLevel.INFO,
      message,
      context
    });
  }

  warn(message: string, context?: any): void {
    this.log({
      timestamp: new Date(),
      level: LogLevel.WARN,
      message,
      context
    });
  }

  error(message: string, error?: Error, context?: any): void {
    this.log({
      timestamp: new Date(),
      level: LogLevel.ERROR,
      message,
      context,
      error
    });
  }

  // Performance tracking methods
  startTimer(operation: string): void {
    const start = Date.now();
    if (!this.performanceMetrics.has(operation)) {
      this.performanceMetrics.set(operation, []);
    }
    this.performanceMetrics.get(operation)!.push(start);
  }

  endTimer(operation: string): number {
    const end = Date.now();
    const starts = this.performanceMetrics.get(operation);
    if (!starts || starts.length === 0) {
      this.warn(`No start time found for operation: ${operation}`);
      return 0;
    }
    
    const start = starts.pop()!;
    const duration = end - start;
    
    this.debug(`Operation "${operation}" took ${duration}ms`, { duration });
    
    return duration;
  }

  getPerformanceStats(operation: string): { count: number; average: number; min: number; max: number } | null {
    const metrics = this.performanceMetrics.get(operation);
    if (!metrics || metrics.length === 0) return null;
    
    const sorted = [...metrics].sort((a, b) => a - b);
    return {
      count: metrics.length,
      average: metrics.reduce((a, b) => a + b, 0) / metrics.length,
      min: sorted[0],
      max: sorted[sorted.length - 1]
    };
  }

  clearPerformanceMetrics(): void {
    this.performanceMetrics.clear();
  }
}

// Export singleton instance
export const logger = Logger.getInstance();