import { EventEmitter } from 'events';
import { cpus, freemem, totalmem, loadavg } from 'os';
import { logger } from '../logger.js';
import { 
  MovingAverage, 
  ExponentialMovingAverage, 
  ThresholdMonitor, 
  ThresholdViolation,
  PerformanceReportGenerator,
  PerformanceReport,
  PerformanceUtils,
  calculatePercentiles
} from '../utils/performance-utils.js';

/**
 * Performance metrics interfaces
 */
export interface ToolExecutionMetrics {
  toolName: string;
  executionTimes: number[];
  successCount: number;
  errorCount: number;
  lastExecution: number;
  averageExecutionTime: number;
  p95ExecutionTime: number;
  throughput: number; // operations per second
}

export interface ResourceUsageMetrics {
  timestamp: number;
  cpuUsagePercent: number;
  memoryUsageBytes: number;
  memoryUsagePercent: number;
  loadAverage: number[];
  gcStats?: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
}

export interface QueueMetrics {
  name: string;
  length: number;
  processingTime: number;
  waitTime: number;
  throughput: number;
}

export interface CacheMetrics {
  name: string;
  hitCount: number;
  missCount: number;
  hitRate: number;
  evictionCount: number;
  size: number;
}

export interface OCRMetrics {
  workerId: string;
  tasksCompleted: number;
  averageTaskTime: number;
  errorCount: number;
  isHealthy: boolean;
}

export interface SystemHealthStatus {
  overall: 'healthy' | 'warning' | 'critical';
  components: {
    tools: 'healthy' | 'warning' | 'critical';
    resources: 'healthy' | 'warning' | 'critical';
    cache: 'healthy' | 'warning' | 'critical';
    queues: 'healthy' | 'warning' | 'critical';
    ocr: 'healthy' | 'warning' | 'critical';
  };
  alerts: ThresholdViolation[];
  uptime: number;
  lastHealthCheck: number;
}

export interface PerformanceMonitorConfig {
  resourceMonitoringIntervalMs: number;
  metricsRetentionMs: number;
  alertCooldownMs: number;
  enableAnomalyDetection: boolean;
  performanceReportIntervalMs: number;
  thresholds: {
    cpuUsageWarning: number;
    cpuUsageCritical: number;
    memoryUsageWarning: number;
    memoryUsageCritical: number;
    executionTimeWarning: number;
    executionTimeCritical: number;
    errorRateWarning: number;
    errorRateCritical: number;
    queueLengthWarning: number;
    queueLengthCritical: number;
  };
}

/**
 * Comprehensive performance monitoring system for macOS Simulator MCP server
 */
export class PerformanceMonitor extends EventEmitter {
  private static instance: PerformanceMonitor | null = null;
  private config: PerformanceMonitorConfig;
  private isRunning = false;
  private startTime = Date.now();

  // Metrics storage
  private toolMetrics = new Map<string, ToolExecutionMetrics>();
  private resourceHistory: ResourceUsageMetrics[] = [];
  private queueMetrics = new Map<string, QueueMetrics>();
  private cacheMetrics = new Map<string, CacheMetrics>();
  private ocrMetrics = new Map<string, OCRMetrics>();

  // Real-time tracking
  private cpuUsageMA = new MovingAverage(10);
  private memoryUsageMA = new MovingAverage(10);
  private executionTimeEMA = new Map<string, ExponentialMovingAverage>();

  // Threshold monitoring
  private thresholdMonitors = new Map<string, ThresholdMonitor>();

  // Performance reporting
  private reportGenerator = new PerformanceReportGenerator();
  private lastReport: PerformanceReport | null = null;

  // Intervals and timers
  private resourceMonitorInterval: NodeJS.Timeout | null = null;
  private metricsCleanupInterval: NodeJS.Timeout | null = null;
  private reportGenerationInterval: NodeJS.Timeout | null = null;

  private constructor(config: Partial<PerformanceMonitorConfig> = {}) {
    super();
    
    this.config = {
      resourceMonitoringIntervalMs: 5000, // 5 seconds
      metricsRetentionMs: 3600000, // 1 hour
      alertCooldownMs: 300000, // 5 minutes
      enableAnomalyDetection: true,
      performanceReportIntervalMs: 300000, // 5 minutes
      thresholds: {
        cpuUsageWarning: 70,
        cpuUsageCritical: 90,
        memoryUsageWarning: 80,
        memoryUsageCritical: 95,
        executionTimeWarning: 2000,
        executionTimeCritical: 5000,
        errorRateWarning: 0.05, // 5%
        errorRateCritical: 0.15, // 15%
        queueLengthWarning: 20,
        queueLengthCritical: 50
      },
      ...config
    };

    this.initializeThresholdMonitors();
    logger.info('PerformanceMonitor initialized', { config: this.config });
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<PerformanceMonitorConfig>): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor(config);
    }
    return PerformanceMonitor.instance;
  }

  /**
   * Start performance monitoring
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('PerformanceMonitor is already running');
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();

    // Start resource monitoring
    this.resourceMonitorInterval = setInterval(() => {
      this.collectResourceMetrics();
    }, this.config.resourceMonitoringIntervalMs);

    // Start metrics cleanup
    this.metricsCleanupInterval = setInterval(() => {
      this.cleanupOldMetrics();
    }, this.config.metricsRetentionMs / 4); // Cleanup 4 times per retention period

    // Start performance report generation
    this.reportGenerationInterval = setInterval(() => {
      this.generatePerformanceReport();
    }, this.config.performanceReportIntervalMs);

    logger.info('PerformanceMonitor started');
    this.emit('started');
  }

  /**
   * Stop performance monitoring
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.resourceMonitorInterval) {
      clearInterval(this.resourceMonitorInterval);
      this.resourceMonitorInterval = null;
    }

    if (this.metricsCleanupInterval) {
      clearInterval(this.metricsCleanupInterval);
      this.metricsCleanupInterval = null;
    }

    if (this.reportGenerationInterval) {
      clearInterval(this.reportGenerationInterval);
      this.reportGenerationInterval = null;
    }

    logger.info('PerformanceMonitor stopped');
    this.emit('stopped');
  }

  /**
   * Record tool execution metrics
   */
  recordToolExecution(
    toolName: string, 
    executionTime: number, 
    success: boolean
  ): void {
    const now = Date.now();
    
    // Get or create tool metrics
    let metrics = this.toolMetrics.get(toolName);
    if (!metrics) {
      metrics = {
        toolName,
        executionTimes: [],
        successCount: 0,
        errorCount: 0,
        lastExecution: now,
        averageExecutionTime: 0,
        p95ExecutionTime: 0,
        throughput: 0
      };
      this.toolMetrics.set(toolName, metrics);
    }

    // Update metrics
    metrics.executionTimes.push(executionTime);
    metrics.lastExecution = now;
    
    if (success) {
      metrics.successCount++;
    } else {
      metrics.errorCount++;
    }

    // Keep only recent execution times
    const maxHistorySize = 1000;
    if (metrics.executionTimes.length > maxHistorySize) {
      metrics.executionTimes = metrics.executionTimes.slice(-maxHistorySize);
    }

    // Calculate derived metrics
    this.updateToolMetrics(metrics);

    // Track with EMA
    if (!this.executionTimeEMA.has(toolName)) {
      this.executionTimeEMA.set(toolName, new ExponentialMovingAverage(0.1));
    }
    this.executionTimeEMA.get(toolName)!.add(executionTime);

    // Check thresholds
    this.checkExecutionTimeThresholds(toolName, executionTime);
    this.checkErrorRateThresholds(toolName, metrics);

    logger.debug('Tool execution recorded', { 
      toolName, 
      executionTime, 
      success,
      averageTime: metrics.averageExecutionTime
    });
  }

  /**
   * Record queue metrics
   */
  recordQueueMetrics(
    queueName: string,
    length: number,
    processingTime: number,
    waitTime: number = 0
  ): void {
    const now = Date.now();
    const existing = this.queueMetrics.get(queueName);
    
    // Calculate throughput based on processing time
    const throughput = processingTime > 0 ? 1000 / processingTime : 0;

    const metrics: QueueMetrics = {
      name: queueName,
      length,
      processingTime,
      waitTime,
      throughput
    };

    this.queueMetrics.set(queueName, metrics);

    // Check queue length thresholds
    this.checkQueueThresholds(queueName, length);

    logger.debug('Queue metrics recorded', { queueName, length, processingTime, throughput });
  }

  /**
   * Record cache metrics
   */
  recordCacheMetrics(
    cacheName: string,
    hitCount: number,
    missCount: number,
    evictionCount: number = 0,
    size: number = 0
  ): void {
    const totalRequests = hitCount + missCount;
    const hitRate = totalRequests > 0 ? hitCount / totalRequests : 0;

    const metrics: CacheMetrics = {
      name: cacheName,
      hitCount,
      missCount,
      hitRate,
      evictionCount,
      size
    };

    this.cacheMetrics.set(cacheName, metrics);

    logger.debug('Cache metrics recorded', { 
      cacheName, 
      hitRate: (hitRate * 100).toFixed(1) + '%',
      totalRequests
    });
  }

  /**
   * Record OCR worker metrics
   */
  recordOCRWorkerMetrics(
    workerId: string,
    tasksCompleted: number,
    averageTaskTime: number,
    errorCount: number,
    isHealthy: boolean
  ): void {
    const metrics: OCRMetrics = {
      workerId,
      tasksCompleted,
      averageTaskTime,
      errorCount,
      isHealthy
    };

    this.ocrMetrics.set(workerId, metrics);

    logger.debug('OCR worker metrics recorded', { 
      workerId, 
      tasksCompleted, 
      averageTaskTime,
      isHealthy
    });
  }

  /**
   * Get current system health status
   */
  getSystemHealth(): SystemHealthStatus {
    const now = Date.now();
    const uptime = now - this.startTime;

    // Collect all active alerts
    const allAlerts: ThresholdViolation[] = [];
    for (const monitor of this.thresholdMonitors.values()) {
      allAlerts.push(...monitor.getViolations(now - this.config.alertCooldownMs));
    }

    // Assess component health
    const components = {
      tools: this.assessToolsHealth(),
      resources: this.assessResourceHealth(),
      cache: this.assessCacheHealth(),
      queues: this.assessQueueHealth(),
      ocr: this.assessOCRHealth()
    };

    // Determine overall health
    const componentStatuses = Object.values(components);
    const overall = componentStatuses.includes('critical') ? 'critical' :
                   componentStatuses.includes('warning') ? 'warning' : 'healthy';

    return {
      overall,
      components,
      alerts: allAlerts,
      uptime,
      lastHealthCheck: now
    };
  }

  /**
   * Get performance dashboard data
   */
  getDashboardData(): {
    systemHealth: SystemHealthStatus;
    toolMetrics: ToolExecutionMetrics[];
    resourceMetrics: ResourceUsageMetrics | null;
    queueMetrics: QueueMetrics[];
    cacheMetrics: CacheMetrics[];
    ocrMetrics: OCRMetrics[];
    lastReport: PerformanceReport | null;
    recommendations: string[];
  } {
    const systemHealth = this.getSystemHealth();
    const latestResource = this.resourceHistory[this.resourceHistory.length - 1] || null;

    return {
      systemHealth,
      toolMetrics: Array.from(this.toolMetrics.values()),
      resourceMetrics: latestResource,
      queueMetrics: Array.from(this.queueMetrics.values()),
      cacheMetrics: Array.from(this.cacheMetrics.values()),
      ocrMetrics: Array.from(this.ocrMetrics.values()),
      lastReport: this.lastReport,
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * Get performance trends for a specific metric
   */
  getPerformanceTrends(metricName: string, timeRangeMs: number = 3600000): {
    timestamps: number[];
    values: number[];
    trend: 'improving' | 'degrading' | 'stable';
    anomalies: { timestamp: number; value: number }[];
  } {
    const now = Date.now();
    const cutoff = now - timeRangeMs;
    
    let timestamps: number[] = [];
    let values: number[] = [];

    // Extract data based on metric type
    if (metricName.startsWith('tool_')) {
      const toolName = metricName.replace('tool_', '');
      const toolMetrics = this.toolMetrics.get(toolName);
      if (toolMetrics) {
        // Use execution times with artificial timestamps
        values = toolMetrics.executionTimes.slice(-100); // Last 100 executions
        timestamps = values.map((_, i) => now - (values.length - i) * 60000); // Spread over time
      }
    } else if (metricName === 'cpu_usage' || metricName === 'memory_usage') {
      const resourceData = this.resourceHistory.filter(r => r.timestamp >= cutoff);
      timestamps = resourceData.map(r => r.timestamp);
      values = resourceData.map(r => 
        metricName === 'cpu_usage' ? r.cpuUsagePercent : r.memoryUsagePercent
      );
    }

    // Calculate trend
    let trend: 'improving' | 'degrading' | 'stable' = 'stable';
    if (values.length > 5) {
      const recentAvg = values.slice(-Math.floor(values.length / 3)).reduce((a, b) => a + b, 0) / Math.floor(values.length / 3);
      const earlierAvg = values.slice(0, Math.floor(values.length / 3)).reduce((a, b) => a + b, 0) / Math.floor(values.length / 3);
      const percentChange = ((recentAvg - earlierAvg) / earlierAvg) * 100;
      
      if (Math.abs(percentChange) > 10) {
        trend = percentChange < 0 ? 'improving' : 'degrading';
      }
    }

    // Detect anomalies
    const anomalies: { timestamp: number; value: number }[] = [];
    if (this.config.enableAnomalyDetection && values.length > 10) {
      const anomalyValues = PerformanceUtils.detectAnomalies(values, 2);
      for (const anomalyValue of anomalyValues) {
        const index = values.indexOf(anomalyValue);
        if (index !== -1 && index < timestamps.length) {
          anomalies.push({
            timestamp: timestamps[index],
            value: anomalyValue
          });
        }
      }
    }

    return { timestamps, values, trend, anomalies };
  }

  // Private methods

  private initializeThresholdMonitors(): void {
    // CPU usage monitor
    const cpuMonitor = new ThresholdMonitor('cpu_usage', {
      warningThreshold: this.config.thresholds.cpuUsageWarning,
      criticalThreshold: this.config.thresholds.cpuUsageCritical,
      cooldownMs: this.config.alertCooldownMs
    });
    cpuMonitor.setCallbacks({
      onWarning: (violation) => this.handleThresholdViolation('cpu_usage', violation),
      onCritical: (violation) => this.handleThresholdViolation('cpu_usage', violation)
    });
    this.thresholdMonitors.set('cpu_usage', cpuMonitor);

    // Memory usage monitor
    const memoryMonitor = new ThresholdMonitor('memory_usage', {
      warningThreshold: this.config.thresholds.memoryUsageWarning,
      criticalThreshold: this.config.thresholds.memoryUsageCritical,
      cooldownMs: this.config.alertCooldownMs
    });
    memoryMonitor.setCallbacks({
      onWarning: (violation) => this.handleThresholdViolation('memory_usage', violation),
      onCritical: (violation) => this.handleThresholdViolation('memory_usage', violation)
    });
    this.thresholdMonitors.set('memory_usage', memoryMonitor);
  }

  private collectResourceMetrics(): void {
    const now = Date.now();
    
    // Get system metrics
    const totalMemory = totalmem();
    const freeMemory = freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsagePercent = (usedMemory / totalMemory) * 100;
    
    // Simple CPU usage estimation (this is approximate)
    const loadAverages = loadavg();
    const cpuCount = cpus().length;
    const cpuUsagePercent = Math.min((loadAverages[0] / cpuCount) * 100, 100);

    // Node.js memory stats
    const memUsage = process.memoryUsage();
    const gcStats = {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external
    };

    const metrics: ResourceUsageMetrics = {
      timestamp: now,
      cpuUsagePercent,
      memoryUsageBytes: usedMemory,
      memoryUsagePercent,
      loadAverage: loadAverages,
      gcStats
    };

    this.resourceHistory.push(metrics);

    // Update moving averages
    this.cpuUsageMA.add(cpuUsagePercent);
    this.memoryUsageMA.add(memoryUsagePercent);

    // Check thresholds
    this.thresholdMonitors.get('cpu_usage')?.check(cpuUsagePercent);
    this.thresholdMonitors.get('memory_usage')?.check(memoryUsagePercent);

    logger.debug('Resource metrics collected', {
      cpuUsage: cpuUsagePercent.toFixed(1) + '%',
      memoryUsage: memoryUsagePercent.toFixed(1) + '%',
      loadAverage: loadAverages[0].toFixed(2)
    });
  }

  private cleanupOldMetrics(): void {
    const cutoff = Date.now() - this.config.metricsRetentionMs;
    
    // Clean up resource history
    this.resourceHistory = this.resourceHistory.filter(m => m.timestamp >= cutoff);
    
    // Clean up tool execution times
    for (const metrics of this.toolMetrics.values()) {
      if (metrics.executionTimes.length > 1000) {
        metrics.executionTimes = metrics.executionTimes.slice(-500);
      }
    }

    // Clean up threshold violations
    for (const monitor of this.thresholdMonitors.values()) {
      monitor.clearViolations();
    }

    logger.debug('Old metrics cleaned up', { cutoff: new Date(cutoff) });
  }

  private updateToolMetrics(metrics: ToolExecutionMetrics): void {
    const { executionTimes, successCount, errorCount } = metrics;
    
    if (executionTimes.length === 0) return;

    // Calculate average execution time
    metrics.averageExecutionTime = executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length;

    // Calculate p95 execution time
    const percentiles = calculatePercentiles(executionTimes, [95]);
    metrics.p95ExecutionTime = percentiles.p95;

    // Calculate throughput (operations per second over last minute)
    const oneMinuteAgo = Date.now() - 60000;
    const recentExecutions = executionTimes.length; // Approximation
    metrics.throughput = recentExecutions / 60; // Operations per second
  }

  private checkExecutionTimeThresholds(toolName: string, executionTime: number): void {
    const monitorKey = `execution_time_${toolName}`;
    
    if (!this.thresholdMonitors.has(monitorKey)) {
      const monitor = new ThresholdMonitor(monitorKey, {
        warningThreshold: this.config.thresholds.executionTimeWarning,
        criticalThreshold: this.config.thresholds.executionTimeCritical,
        cooldownMs: this.config.alertCooldownMs
      });
      monitor.setCallbacks({
        onWarning: (violation) => this.handleThresholdViolation(monitorKey, violation),
        onCritical: (violation) => this.handleThresholdViolation(monitorKey, violation)
      });
      this.thresholdMonitors.set(monitorKey, monitor);
    }

    this.thresholdMonitors.get(monitorKey)?.check(executionTime);
  }

  private checkErrorRateThresholds(toolName: string, metrics: ToolExecutionMetrics): void {
    const totalOperations = metrics.successCount + metrics.errorCount;
    if (totalOperations === 0) return;

    const errorRate = metrics.errorCount / totalOperations;
    const monitorKey = `error_rate_${toolName}`;

    if (!this.thresholdMonitors.has(monitorKey)) {
      const monitor = new ThresholdMonitor(monitorKey, {
        warningThreshold: this.config.thresholds.errorRateWarning,
        criticalThreshold: this.config.thresholds.errorRateCritical,
        cooldownMs: this.config.alertCooldownMs
      });
      monitor.setCallbacks({
        onWarning: (violation) => this.handleThresholdViolation(monitorKey, violation),
        onCritical: (violation) => this.handleThresholdViolation(monitorKey, violation)
      });
      this.thresholdMonitors.set(monitorKey, monitor);
    }

    this.thresholdMonitors.get(monitorKey)?.check(errorRate);
  }

  private checkQueueThresholds(queueName: string, length: number): void {
    const monitorKey = `queue_length_${queueName}`;

    if (!this.thresholdMonitors.has(monitorKey)) {
      const monitor = new ThresholdMonitor(monitorKey, {
        warningThreshold: this.config.thresholds.queueLengthWarning,
        criticalThreshold: this.config.thresholds.queueLengthCritical,
        cooldownMs: this.config.alertCooldownMs
      });
      monitor.setCallbacks({
        onWarning: (violation) => this.handleThresholdViolation(monitorKey, violation),
        onCritical: (violation) => this.handleThresholdViolation(monitorKey, violation)
      });
      this.thresholdMonitors.set(monitorKey, monitor);
    }

    this.thresholdMonitors.get(monitorKey)?.check(length);
  }

  private handleThresholdViolation(metricName: string, violation: ThresholdViolation): void {
    logger.warn(`Performance threshold violation: ${metricName}`, {
      type: violation.type,
      value: violation.value,
      threshold: violation.threshold,
      consecutiveCount: violation.consecutiveCount
    });

    this.emit('thresholdViolation', { metricName, violation });
  }

  private assessToolsHealth(): 'healthy' | 'warning' | 'critical' {
    const now = Date.now();
    let criticalCount = 0;
    let warningCount = 0;

    for (const metrics of this.toolMetrics.values()) {
      const totalOps = metrics.successCount + metrics.errorCount;
      if (totalOps === 0) continue;

      const errorRate = metrics.errorCount / totalOps;
      const avgTime = metrics.averageExecutionTime;

      if (errorRate >= this.config.thresholds.errorRateCritical || 
          avgTime >= this.config.thresholds.executionTimeCritical) {
        criticalCount++;
      } else if (errorRate >= this.config.thresholds.errorRateWarning || 
                 avgTime >= this.config.thresholds.executionTimeWarning) {
        warningCount++;
      }
    }

    if (criticalCount > 0) return 'critical';
    if (warningCount > 0) return 'warning';
    return 'healthy';
  }

  private assessResourceHealth(): 'healthy' | 'warning' | 'critical' {
    const cpuAvg = this.cpuUsageMA.getAverage();
    const memoryAvg = this.memoryUsageMA.getAverage();

    if (cpuAvg >= this.config.thresholds.cpuUsageCritical || 
        memoryAvg >= this.config.thresholds.memoryUsageCritical) {
      return 'critical';
    }

    if (cpuAvg >= this.config.thresholds.cpuUsageWarning || 
        memoryAvg >= this.config.thresholds.memoryUsageWarning) {
      return 'warning';
    }

    return 'healthy';
  }

  private assessCacheHealth(): 'healthy' | 'warning' | 'critical' {
    let lowHitRateCount = 0;

    for (const metrics of this.cacheMetrics.values()) {
      if (metrics.hitRate < 0.5) { // Less than 50% hit rate
        lowHitRateCount++;
      }
    }

    if (lowHitRateCount > this.cacheMetrics.size / 2) return 'warning';
    return 'healthy';
  }

  private assessQueueHealth(): 'healthy' | 'warning' | 'critical' {
    let criticalQueues = 0;
    let warningQueues = 0;

    for (const metrics of this.queueMetrics.values()) {
      if (metrics.length >= this.config.thresholds.queueLengthCritical) {
        criticalQueues++;
      } else if (metrics.length >= this.config.thresholds.queueLengthWarning) {
        warningQueues++;
      }
    }

    if (criticalQueues > 0) return 'critical';
    if (warningQueues > 0) return 'warning';
    return 'healthy';
  }

  private assessOCRHealth(): 'healthy' | 'warning' | 'critical' {
    const workers = Array.from(this.ocrMetrics.values());
    if (workers.length === 0) return 'healthy';

    const unhealthyWorkers = workers.filter(w => !w.isHealthy).length;
    const unhealthyRatio = unhealthyWorkers / workers.length;

    if (unhealthyRatio >= 0.5) return 'critical';
    if (unhealthyRatio > 0) return 'warning';
    return 'healthy';
  }

  private generatePerformanceReport(): void {
    const metrics = new Map<string, number[]>();

    // Collect tool execution times
    for (const [toolName, toolMetrics] of this.toolMetrics.entries()) {
      metrics.set(`tool_${toolName}_execution_time`, toolMetrics.executionTimes);
    }

    // Collect resource usage
    if (this.resourceHistory.length > 0) {
      metrics.set('cpu_usage', this.resourceHistory.map(r => r.cpuUsagePercent));
      metrics.set('memory_usage', this.resourceHistory.map(r => r.memoryUsagePercent));
    }

    // Collect queue lengths
    for (const [queueName, queueMetrics] of this.queueMetrics.entries()) {
      metrics.set(`queue_${queueName}_length`, [queueMetrics.length]);
    }

    // Generate report
    const violations: ThresholdViolation[] = [];
    for (const monitor of this.thresholdMonitors.values()) {
      violations.push(...monitor.getViolations());
    }

    this.lastReport = this.reportGenerator.generateReport(metrics, violations);
    this.lastReport.duration = Date.now() - this.startTime;

    logger.info('Performance report generated', {
      metricsCount: Object.keys(this.lastReport.metrics).length,
      alertsCount: violations.length,
      recommendationsCount: this.lastReport.recommendations.length
    });

    this.emit('reportGenerated', this.lastReport);
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const systemHealth = this.getSystemHealth();

    // Resource-based recommendations
    const cpuAvg = this.cpuUsageMA.getAverage();
    const memoryAvg = this.memoryUsageMA.getAverage();

    if (cpuAvg > this.config.thresholds.cpuUsageWarning) {
      recommendations.push(`High CPU usage (${cpuAvg.toFixed(1)}%): Consider reducing concurrent operations or optimizing tool algorithms`);
    }

    if (memoryAvg > this.config.thresholds.memoryUsageWarning) {
      recommendations.push(`High memory usage (${memoryAvg.toFixed(1)}%): Review cache sizes and consider implementing memory-efficient data structures`);
    }

    // Tool-specific recommendations
    for (const [toolName, metrics] of this.toolMetrics.entries()) {
      const errorRate = metrics.errorCount / (metrics.successCount + metrics.errorCount);
      
      if (errorRate > this.config.thresholds.errorRateWarning) {
        recommendations.push(`High error rate for ${toolName} (${(errorRate * 100).toFixed(1)}%): Investigate error causes and improve error handling`);
      }

      if (metrics.averageExecutionTime > this.config.thresholds.executionTimeWarning) {
        recommendations.push(`Slow execution time for ${toolName} (${metrics.averageExecutionTime.toFixed(0)}ms): Consider performance optimizations or caching`);
      }
    }

    // Queue-based recommendations
    for (const [queueName, metrics] of this.queueMetrics.entries()) {
      if (metrics.length > this.config.thresholds.queueLengthWarning) {
        recommendations.push(`Queue ${queueName} is backing up (${metrics.length} items): Consider increasing processing capacity or reducing queue input rate`);
      }
    }

    // Cache-based recommendations
    for (const [cacheName, metrics] of this.cacheMetrics.entries()) {
      if (metrics.hitRate < 0.7) {
        recommendations.push(`Low cache hit rate for ${cacheName} (${(metrics.hitRate * 100).toFixed(1)}%): Review cache configuration, TTL settings, or caching strategy`);
      }
    }

    return recommendations;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<PerformanceMonitorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Update threshold monitors if thresholds changed
    if (newConfig.thresholds) {
      for (const [key, monitor] of this.thresholdMonitors.entries()) {
        if (key === 'cpu_usage' && newConfig.thresholds.cpuUsageWarning) {
          monitor.updateConfig({
            warningThreshold: newConfig.thresholds.cpuUsageWarning,
            criticalThreshold: newConfig.thresholds.cpuUsageCritical
          });
        }
        // Add other threshold updates as needed
      }
    }

    logger.info('PerformanceMonitor configuration updated', { config: this.config });
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.toolMetrics.clear();
    this.resourceHistory = [];
    this.queueMetrics.clear();
    this.cacheMetrics.clear();
    this.ocrMetrics.clear();
    
    this.cpuUsageMA.clear();
    this.memoryUsageMA.clear();
    this.executionTimeEMA.clear();
    
    for (const monitor of this.thresholdMonitors.values()) {
      monitor.clearViolations();
    }
    
    this.reportGenerator.clearBaselines();
    this.lastReport = null;
    
    this.startTime = Date.now();
    
    logger.info('PerformanceMonitor reset');
    this.emit('reset');
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stop();
    this.removeAllListeners();
    PerformanceMonitor.instance = null;
  }
}

/**
 * Get the singleton PerformanceMonitor instance
 */
export function getPerformanceMonitor(config?: Partial<PerformanceMonitorConfig>): PerformanceMonitor {
  return PerformanceMonitor.getInstance(config);
}