/**
 * Performance utilities for metrics calculation, analysis, and reporting
 */

/**
 * Calculates percentiles from a sorted array of numbers
 */
export function calculatePercentiles(
  values: number[],
  percentiles: number[] = [50, 95, 99]
): Record<string, number> {
  if (values.length === 0) {
    return percentiles.reduce((acc, p) => ({ ...acc, [`p${p}`]: 0 }), {});
  }

  const sorted = [...values].sort((a, b) => a - b);
  const result: Record<string, number> = {};

  for (const percentile of percentiles) {
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    const clampedIndex = Math.max(0, Math.min(index, sorted.length - 1));
    result[`p${percentile}`] = sorted[clampedIndex];
  }

  return result;
}

/**
 * Moving average calculator with configurable window size
 */
export class MovingAverage {
  private values: number[] = [];
  private windowSize: number;
  private sum = 0;

  constructor(windowSize: number = 10) {
    if (windowSize <= 0) {
      throw new Error('Window size must be positive');
    }
    this.windowSize = windowSize;
  }

  /**
   * Add a new value and return the current moving average
   */
  add(value: number): number {
    this.values.push(value);
    this.sum += value;

    // Remove oldest value if window is full
    if (this.values.length > this.windowSize) {
      const removed = this.values.shift()!;
      this.sum -= removed;
    }

    return this.getAverage();
  }

  /**
   * Get current moving average
   */
  getAverage(): number {
    return this.values.length > 0 ? this.sum / this.values.length : 0;
  }

  /**
   * Get current values in the window
   */
  getValues(): number[] {
    return [...this.values];
  }

  /**
   * Clear all values
   */
  clear(): void {
    this.values = [];
    this.sum = 0;
  }

  /**
   * Get window statistics
   */
  getStats(): {
    count: number;
    average: number;
    min: number;
    max: number;
    sum: number;
  } {
    if (this.values.length === 0) {
      return { count: 0, average: 0, min: 0, max: 0, sum: 0 };
    }

    return {
      count: this.values.length,
      average: this.getAverage(),
      min: Math.min(...this.values),
      max: Math.max(...this.values),
      sum: this.sum
    };
  }
}

/**
 * Exponential moving average calculator
 */
export class ExponentialMovingAverage {
  private average: number | null = null;
  private alpha: number;

  constructor(alpha: number = 0.1) {
    if (alpha <= 0 || alpha > 1) {
      throw new Error('Alpha must be between 0 and 1 (exclusive of 0)');
    }
    this.alpha = alpha;
  }

  /**
   * Add a new value and return the current EMA
   */
  add(value: number): number {
    if (this.average === null) {
      this.average = value;
    } else {
      this.average = this.alpha * value + (1 - this.alpha) * this.average;
    }
    return this.average;
  }

  /**
   * Get current EMA value
   */
  getValue(): number {
    return this.average ?? 0;
  }

  /**
   * Reset the EMA
   */
  reset(): void {
    this.average = null;
  }
}

/**
 * Threshold monitor with configurable alerting
 */
export interface ThresholdConfig {
  warningThreshold: number;
  criticalThreshold: number;
  consecutiveViolations: number;
  cooldownMs: number;
}

export interface ThresholdViolation {
  type: 'warning' | 'critical';
  value: number;
  threshold: number;
  timestamp: number;
  consecutiveCount: number;
}

export class ThresholdMonitor {
  private config: ThresholdConfig;
  private violations: ThresholdViolation[] = [];
  private consecutiveWarnings = 0;
  private consecutiveCriticals = 0;
  private lastAlertTime = 0;
  private callbacks: {
    onWarning?: (violation: ThresholdViolation) => void;
    onCritical?: (violation: ThresholdViolation) => void;
    onRecovery?: (metric: string) => void;
  } = {};

  constructor(
    private metricName: string,
    config: Partial<ThresholdConfig> = {}
  ) {
    this.config = {
      warningThreshold: 1000,
      criticalThreshold: 2000,
      consecutiveViolations: 3,
      cooldownMs: 60000, // 1 minute
      ...config
    };
  }

  /**
   * Set callback functions for threshold violations
   */
  setCallbacks(callbacks: typeof this.callbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Check a value against thresholds
   */
  check(value: number): ThresholdViolation | null {
    const now = Date.now();
    let violation: ThresholdViolation | null = null;

    if (value >= this.config.criticalThreshold) {
      this.consecutiveCriticals++;
      this.consecutiveWarnings = 0;

      if (this.consecutiveCriticals >= this.config.consecutiveViolations) {
        violation = {
          type: 'critical',
          value,
          threshold: this.config.criticalThreshold,
          timestamp: now,
          consecutiveCount: this.consecutiveCriticals
        };

        if (this.shouldAlert(now)) {
          this.violations.push(violation);
          this.callbacks.onCritical?.(violation);
          this.lastAlertTime = now;
        }
      }
    } else if (value >= this.config.warningThreshold) {
      this.consecutiveWarnings++;
      this.consecutiveCriticals = 0;

      if (this.consecutiveWarnings >= this.config.consecutiveViolations) {
        violation = {
          type: 'warning',
          value,
          threshold: this.config.warningThreshold,
          timestamp: now,
          consecutiveCount: this.consecutiveWarnings
        };

        if (this.shouldAlert(now)) {
          this.violations.push(violation);
          this.callbacks.onWarning?.(violation);
          this.lastAlertTime = now;
        }
      }
    } else {
      // Value is below warning threshold - recovery
      const wasViolating = this.consecutiveWarnings > 0 || this.consecutiveCriticals > 0;
      this.consecutiveWarnings = 0;
      this.consecutiveCriticals = 0;

      if (wasViolating) {
        this.callbacks.onRecovery?.(this.metricName);
      }
    }

    return violation;
  }

  private shouldAlert(now: number): boolean {
    return now - this.lastAlertTime >= this.config.cooldownMs;
  }

  /**
   * Get recent violations
   */
  getViolations(sinceMs?: number): ThresholdViolation[] {
    const since = sinceMs ?? Date.now() - 3600000; // Last hour by default
    return this.violations.filter(v => v.timestamp >= since);
  }

  /**
   * Clear violation history
   */
  clearViolations(): void {
    this.violations = [];
  }

  /**
   * Update threshold configuration
   */
  updateConfig(config: Partial<ThresholdConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current status
   */
  getStatus(): {
    isViolating: boolean;
    violationType: 'none' | 'warning' | 'critical';
    consecutiveCount: number;
    lastViolation?: ThresholdViolation;
  } {
    const isWarning = this.consecutiveWarnings >= this.config.consecutiveViolations;
    const isCritical = this.consecutiveCriticals >= this.config.consecutiveViolations;

    return {
      isViolating: isWarning || isCritical,
      violationType: isCritical ? 'critical' : (isWarning ? 'warning' : 'none'),
      consecutiveCount: Math.max(this.consecutiveWarnings, this.consecutiveCriticals),
      lastViolation: this.violations[this.violations.length - 1]
    };
  }
}

/**
 * Performance report generator
 */
export interface PerformanceReport {
  timestamp: number;
  duration: number;
  metrics: {
    [metricName: string]: {
      count: number;
      total: number;
      average: number;
      min: number;
      max: number;
      percentiles: Record<string, number>;
      trend: 'improving' | 'degrading' | 'stable';
    };
  };
  recommendations: string[];
  alerts: ThresholdViolation[];
}

export class PerformanceReportGenerator {
  private baselineMetrics: Map<string, number[]> = new Map();
  private readonly maxHistorySize = 1000;

  /**
   * Record baseline metrics for trend analysis
   */
  recordBaseline(metricName: string, values: number[]): void {
    const existing = this.baselineMetrics.get(metricName) || [];
    const combined = [...existing, ...values];
    
    // Keep only recent values
    if (combined.length > this.maxHistorySize) {
      combined.splice(0, combined.length - this.maxHistorySize);
    }
    
    this.baselineMetrics.set(metricName, combined);
  }

  /**
   * Generate comprehensive performance report
   */
  generateReport(
    metrics: Map<string, number[]>,
    violations: ThresholdViolation[] = []
  ): PerformanceReport {
    const timestamp = Date.now();
    const reportMetrics: PerformanceReport['metrics'] = {};
    const recommendations: string[] = [];

    for (const [metricName, values] of metrics.entries()) {
      if (values.length === 0) continue;

      const total = values.reduce((sum, val) => sum + val, 0);
      const average = total / values.length;
      const sorted = [...values].sort((a, b) => a - b);

      const metricData = {
        count: values.length,
        total,
        average,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        percentiles: calculatePercentiles(sorted),
        trend: this.calculateTrend(metricName, average)
      };

      reportMetrics[metricName] = metricData;

      // Generate recommendations based on metrics
      this.addRecommendations(metricName, metricData, recommendations);
    }

    return {
      timestamp,
      duration: 0, // Will be set by caller
      metrics: reportMetrics,
      recommendations,
      alerts: violations
    };
  }

  private calculateTrend(metricName: string, currentAverage: number): 'improving' | 'degrading' | 'stable' {
    const baseline = this.baselineMetrics.get(metricName);
    if (!baseline || baseline.length < 5) {
      return 'stable';
    }

    const baselineAverage = baseline.reduce((sum, val) => sum + val, 0) / baseline.length;
    const percentChange = ((currentAverage - baselineAverage) / baselineAverage) * 100;

    // Consider trends significant if they're > 10% change
    if (Math.abs(percentChange) < 10) {
      return 'stable';
    }

    // For most metrics, lower is better (execution time, errors, etc.)
    // But for some metrics like throughput, higher is better
    const isImproving = metricName.includes('throughput') || metricName.includes('success_rate')
      ? percentChange > 0
      : percentChange < 0;

    return isImproving ? 'improving' : 'degrading';
  }

  private addRecommendations(
    metricName: string, 
    metricData: PerformanceReport['metrics'][string], 
    recommendations: string[]
  ): void {
    // High execution time recommendations
    if (metricName.includes('execution_time') && metricData.average > 1000) {
      recommendations.push(`High ${metricName}: Consider optimizing or increasing concurrency`);
    }

    // High p95/p99 recommendations
    if (metricData.percentiles.p95 > metricData.average * 2) {
      recommendations.push(`High ${metricName} p95 latency: Investigate performance outliers`);
    }

    // Queue length recommendations
    if (metricName.includes('queue') && metricData.average > 10) {
      recommendations.push(`High ${metricName}: Consider increasing worker capacity`);
    }

    // Error rate recommendations
    if (metricName.includes('error') && metricData.average > 0.05) {
      recommendations.push(`High ${metricName}: Investigate error patterns and causes`);
    }

    // Cache hit rate recommendations
    if (metricName.includes('cache_hit_rate') && metricData.average < 0.8) {
      recommendations.push(`Low ${metricName}: Review cache configuration and TTL settings`);
    }

    // Degrading trend recommendations
    if (metricData.trend === 'degrading') {
      recommendations.push(`${metricName} is degrading: Monitor resource usage and consider scaling`);
    }
  }

  /**
   * Clear baseline metrics
   */
  clearBaselines(): void {
    this.baselineMetrics.clear();
  }
}

/**
 * Rate limiter for performance monitoring
 */
export class RateLimiter {
  private requests: number[] = [];
  private windowMs: number;
  private maxRequests: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Check if request is allowed
   */
  isAllowed(): boolean {
    const now = Date.now();
    
    // Remove old requests outside the window
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      return false;
    }
    
    this.requests.push(now);
    return true;
  }

  /**
   * Get current usage
   */
  getUsage(): { current: number; max: number; resetTime: number } {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    const oldestRequest = this.requests[0];
    const resetTime = oldestRequest ? oldestRequest + this.windowMs : now;
    
    return {
      current: this.requests.length,
      max: this.maxRequests,
      resetTime
    };
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.requests = [];
  }
}

/**
 * Utility functions for common performance calculations
 */
export const PerformanceUtils = {
  /**
   * Calculate standard deviation
   */
  standardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    
    return Math.sqrt(avgSquaredDiff);
  },

  /**
   * Calculate coefficient of variation (relative standard deviation)
   */
  coefficientOfVariation(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    if (mean === 0) return 0;
    
    const stdDev = this.standardDeviation(values);
    return stdDev / mean;
  },

  /**
   * Detect anomalies using z-score
   */
  detectAnomalies(values: number[], threshold: number = 2): number[] {
    if (values.length < 3) return [];
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const stdDev = this.standardDeviation(values);
    
    if (stdDev === 0) return [];
    
    return values.filter(val => Math.abs((val - mean) / stdDev) > threshold);
  },

  /**
   * Calculate throughput (operations per second)
   */
  calculateThroughput(operationCount: number, durationMs: number): number {
    if (durationMs === 0) return 0;
    return (operationCount * 1000) / durationMs;
  },

  /**
   * Format duration to human readable string
   */
  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  },

  /**
   * Format bytes to human readable string
   */
  formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    
    return `${value.toFixed(1)}${units[unitIndex]}`;
  }
};