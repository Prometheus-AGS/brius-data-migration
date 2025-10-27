/**
 * Performance Monitoring and Optimization System
 *
 * Implements comprehensive performance tracking, memory optimization, and
 * connection pool tuning based on research.md recommendations
 */

import { EventEmitter } from 'events';
import * as os from 'os';
import * as process from 'process';

export interface PerformanceMetrics {
  // Processing metrics
  totalRecordsProcessed: number;
  recordsPerSecond: number;
  averageBatchTime: number;
  peakThroughput: number;

  // Memory metrics
  heapUsedMB: number;
  heapTotalMB: number;
  heapUtilization: number;
  peakMemoryUsageMB: number;
  gcCount: number;
  gcTotalTimeMs: number;

  // Connection metrics
  activeConnections: number;
  idleConnections: number;
  connectionPoolUtilization: number;
  avgConnectionTime: number;

  // System metrics
  cpuUsagePercent: number;
  systemLoadAverage: number[];
  freeMemoryMB: number;
  totalMemoryMB: number;

  // Error metrics
  totalErrors: number;
  errorRate: number;
  retryCount: number;

  // Timing metrics
  totalDurationMs: number;
  batchProcessingTime: number[];
  checkpointTime: number[];
  validationTime: number[];
}

export interface OptimizationRecommendations {
  batchSize: {
    current: number;
    recommended: number;
    reason: string;
  };
  parallelism: {
    current: number;
    recommended: number;
    reason: string;
  };
  connectionPool: {
    current: number;
    recommended: number;
    reason: string;
  };
  memoryOptimization: {
    gcRecommendation: string;
    heapSizeRecommendation: string;
    streamingRecommendation: string;
  };
  systemOptimization: {
    cpuRecommendation: string;
    memoryRecommendation: string;
    ioRecommendation: string;
  };
}

export interface PerformanceThresholds {
  maxMemoryUsageMB: number;
  minThroughputPerSecond: number;
  maxErrorRate: number;  // percentage
  maxResponseTimeMs: number;
  maxCpuUsagePercent: number;
  maxConnectionPoolUtilization: number;
}

export interface PerformanceAlert {
  type: 'memory' | 'throughput' | 'error' | 'connection' | 'cpu';
  severity: 'warning' | 'critical';
  message: string;
  currentValue: number;
  threshold: number;
  timestamp: Date;
  recommendations: string[];
}

/**
 * Performance Monitor Class
 *
 * Provides real-time performance monitoring with optimization recommendations
 */
export class PerformanceMonitor extends EventEmitter {
  private metrics: PerformanceMetrics;
  private thresholds: PerformanceThresholds;
  private alerts: PerformanceAlert[] = [];

  private startTime: number = Date.now();
  private lastMetricsUpdate: number = Date.now();
  private batchTimes: number[] = [];
  private throughputHistory: number[] = [];
  private memoryHistory: number[] = [];

  // GC monitoring
  private initialGCStats: any;
  private currentGCStats: any;

  // Connection tracking
  private connectionMetrics = {
    active: 0,
    idle: 0,
    created: 0,
    destroyed: 0,
    errors: 0,
    totalLatency: 0,
    latencyCount: 0
  };

  constructor(thresholds?: Partial<PerformanceThresholds>) {
    super();

    this.thresholds = {
      maxMemoryUsageMB: 512,
      minThroughputPerSecond: 50,
      maxErrorRate: 5.0,
      maxResponseTimeMs: 5000,
      maxCpuUsagePercent: 80,
      maxConnectionPoolUtilization: 0.8,
      ...thresholds
    };

    this.metrics = this.initializeMetrics();\n    this.startMonitoring();\n  }\n\n  private initializeMetrics(): PerformanceMetrics {\n    return {\n      totalRecordsProcessed: 0,\n      recordsPerSecond: 0,\n      averageBatchTime: 0,\n      peakThroughput: 0,\n      heapUsedMB: 0,\n      heapTotalMB: 0,\n      heapUtilization: 0,\n      peakMemoryUsageMB: 0,\n      gcCount: 0,\n      gcTotalTimeMs: 0,\n      activeConnections: 0,\n      idleConnections: 0,\n      connectionPoolUtilization: 0,\n      avgConnectionTime: 0,\n      cpuUsagePercent: 0,\n      systemLoadAverage: [],\n      freeMemoryMB: 0,\n      totalMemoryMB: 0,\n      totalErrors: 0,\n      errorRate: 0,\n      retryCount: 0,\n      totalDurationMs: 0,\n      batchProcessingTime: [],\n      checkpointTime: [],\n      validationTime: []\n    };\n  }\n\n  private startMonitoring(): void {\n    // Initialize GC monitoring if available\n    try {\n      const v8 = require('v8');\n      this.initialGCStats = v8.getHeapStatistics();\n    } catch (error) {\n      // V8 not available, skip GC monitoring\n    }\n\n    // Update metrics every 1 second\n    setInterval(() => {\n      this.updateMetrics();\n      this.checkThresholds();\n    }, 1000);\n  }\n\n  /**\n   * Record batch processing completion\n   */\n  recordBatchCompletion(recordCount: number, processingTimeMs: number): void {\n    this.metrics.totalRecordsProcessed += recordCount;\n    this.batchTimes.push(processingTimeMs);\n    this.metrics.batchProcessingTime.push(processingTimeMs);\n    \n    // Calculate throughput\n    const throughput = recordCount / (processingTimeMs / 1000);\n    this.throughputHistory.push(throughput);\n    \n    if (throughput > this.metrics.peakThroughput) {\n      this.metrics.peakThroughput = throughput;\n    }\n    \n    // Keep last 100 data points for calculations\n    if (this.batchTimes.length > 100) {\n      this.batchTimes.shift();\n    }\n    if (this.throughputHistory.length > 100) {\n      this.throughputHistory.shift();\n    }\n    \n    this.emit('batch_completed', {\n      recordCount,\n      processingTimeMs,\n      throughput,\n      totalProcessed: this.metrics.totalRecordsProcessed\n    });\n  }\n\n  /**\n   * Record checkpoint operation timing\n   */\n  recordCheckpoint(durationMs: number): void {\n    this.metrics.checkpointTime.push(durationMs);\n    \n    this.emit('checkpoint_completed', {\n      durationMs,\n      totalCheckpoints: this.metrics.checkpointTime.length\n    });\n  }\n\n  /**\n   * Record validation operation timing\n   */\n  recordValidation(durationMs: number): void {\n    this.metrics.validationTime.push(durationMs);\n    \n    this.emit('validation_completed', {\n      durationMs,\n      totalValidations: this.metrics.validationTime.length\n    });\n  }\n\n  /**\n   * Record error occurrence\n   */\n  recordError(errorType: string, retryable: boolean = false): void {\n    this.metrics.totalErrors++;\n    if (retryable) {\n      this.metrics.retryCount++;\n    }\n    \n    this.emit('error_recorded', {\n      errorType,\n      retryable,\n      totalErrors: this.metrics.totalErrors,\n      errorRate: this.metrics.errorRate\n    });\n  }\n\n  /**\n   * Update connection metrics\n   */\n  updateConnectionMetrics(active: number, idle: number, total: number): void {\n    this.connectionMetrics.active = active;\n    this.connectionMetrics.idle = idle;\n    \n    this.metrics.activeConnections = active;\n    this.metrics.idleConnections = idle;\n    this.metrics.connectionPoolUtilization = total > 0 ? active / total : 0;\n  }\n\n  /**\n   * Record connection timing\n   */\n  recordConnectionTime(latencyMs: number): void {\n    this.connectionMetrics.totalLatency += latencyMs;\n    this.connectionMetrics.latencyCount++;\n    this.metrics.avgConnectionTime = this.connectionMetrics.totalLatency / this.connectionMetrics.latencyCount;\n  }\n\n  /**\n   * Update all performance metrics\n   */\n  private updateMetrics(): void {\n    const now = Date.now();\n    this.metrics.totalDurationMs = now - this.startTime;\n    \n    // Memory metrics\n    const memUsage = process.memoryUsage();\n    this.metrics.heapUsedMB = memUsage.heapUsed / 1024 / 1024;\n    this.metrics.heapTotalMB = memUsage.heapTotal / 1024 / 1024;\n    this.metrics.heapUtilization = this.metrics.heapUsedMB / this.metrics.heapTotalMB;\n    \n    if (this.metrics.heapUsedMB > this.metrics.peakMemoryUsageMB) {\n      this.metrics.peakMemoryUsageMB = this.metrics.heapUsedMB;\n    }\n    \n    this.memoryHistory.push(this.metrics.heapUsedMB);\n    if (this.memoryHistory.length > 100) {\n      this.memoryHistory.shift();\n    }\n    \n    // GC metrics\n    try {\n      const v8 = require('v8');\n      this.currentGCStats = v8.getHeapStatistics();\n      // GC metrics would need additional monitoring setup\n    } catch (error) {\n      // V8 not available\n    }\n    \n    // System metrics\n    this.metrics.freeMemoryMB = os.freemem() / 1024 / 1024;\n    this.metrics.totalMemoryMB = os.totalmem() / 1024 / 1024;\n    this.metrics.systemLoadAverage = os.loadavg();\n    \n    // Calculate CPU usage (simplified)\n    const cpus = os.cpus();\n    let totalIdle = 0;\n    let totalTick = 0;\n    \n    cpus.forEach(cpu => {\n      for (const type in cpu.times) {\n        totalTick += cpu.times[type as keyof typeof cpu.times];\n      }\n      totalIdle += cpu.times.idle;\n    });\n    \n    this.metrics.cpuUsagePercent = 100 - (totalIdle / totalTick * 100);\n    \n    // Calculate current throughput\n    if (this.throughputHistory.length > 0) {\n      this.metrics.recordsPerSecond = this.throughputHistory\n        .slice(-10) // Last 10 measurements\n        .reduce((sum, val) => sum + val, 0) / Math.min(10, this.throughputHistory.length);\n    }\n    \n    // Calculate average batch time\n    if (this.batchTimes.length > 0) {\n      this.metrics.averageBatchTime = this.batchTimes\n        .reduce((sum, val) => sum + val, 0) / this.batchTimes.length;\n    }\n    \n    // Calculate error rate\n    if (this.metrics.totalRecordsProcessed > 0) {\n      this.metrics.errorRate = (this.metrics.totalErrors / this.metrics.totalRecordsProcessed) * 100;\n    }\n    \n    this.lastMetricsUpdate = now;\n    \n    this.emit('metrics_updated', this.metrics);\n  }\n\n  /**\n   * Check performance thresholds and generate alerts\n   */\n  private checkThresholds(): void {\n    const newAlerts: PerformanceAlert[] = [];\n    \n    // Memory threshold check\n    if (this.metrics.heapUsedMB > this.thresholds.maxMemoryUsageMB) {\n      newAlerts.push({\n        type: 'memory',\n        severity: this.metrics.heapUsedMB > (this.thresholds.maxMemoryUsageMB * 1.2) ? 'critical' : 'warning',\n        message: `Memory usage ${this.metrics.heapUsedMB.toFixed(1)}MB exceeds threshold ${this.thresholds.maxMemoryUsageMB}MB`,\n        currentValue: this.metrics.heapUsedMB,\n        threshold: this.thresholds.maxMemoryUsageMB,\n        timestamp: new Date(),\n        recommendations: [\n          'Reduce batch size to decrease memory usage',\n          'Enable garbage collection optimization',\n          'Consider streaming processing for large datasets'\n        ]\n      });\n    }\n    \n    // Throughput threshold check\n    if (this.metrics.recordsPerSecond < this.thresholds.minThroughputPerSecond && this.metrics.totalRecordsProcessed > 100) {\n      newAlerts.push({\n        type: 'throughput',\n        severity: this.metrics.recordsPerSecond < (this.thresholds.minThroughputPerSecond * 0.5) ? 'critical' : 'warning',\n        message: `Throughput ${this.metrics.recordsPerSecond.toFixed(1)} records/sec below threshold ${this.thresholds.minThroughputPerSecond}`,\n        currentValue: this.metrics.recordsPerSecond,\n        threshold: this.thresholds.minThroughputPerSecond,\n        timestamp: new Date(),\n        recommendations: [\n          'Increase batch size for better throughput',\n          'Optimize database queries with better indexing',\n          'Increase parallel processing if system resources allow'\n        ]\n      });\n    }\n    \n    // Error rate threshold check\n    if (this.metrics.errorRate > this.thresholds.maxErrorRate) {\n      newAlerts.push({\n        type: 'error',\n        severity: this.metrics.errorRate > (this.thresholds.maxErrorRate * 2) ? 'critical' : 'warning',\n        message: `Error rate ${this.metrics.errorRate.toFixed(2)}% exceeds threshold ${this.thresholds.maxErrorRate}%`,\n        currentValue: this.metrics.errorRate,\n        threshold: this.thresholds.maxErrorRate,\n        timestamp: new Date(),\n        recommendations: [\n          'Review error logs for patterns',\n          'Check data quality in source database',\n          'Verify network connectivity stability'\n        ]\n      });\n    }\n    \n    // CPU threshold check\n    if (this.metrics.cpuUsagePercent > this.thresholds.maxCpuUsagePercent) {\n      newAlerts.push({\n        type: 'cpu',\n        severity: this.metrics.cpuUsagePercent > (this.thresholds.maxCpuUsagePercent * 1.1) ? 'critical' : 'warning',\n        message: `CPU usage ${this.metrics.cpuUsagePercent.toFixed(1)}% exceeds threshold ${this.thresholds.maxCpuUsagePercent}%`,\n        currentValue: this.metrics.cpuUsagePercent,\n        threshold: this.thresholds.maxCpuUsagePercent,\n        timestamp: new Date(),\n        recommendations: [\n          'Reduce parallel processing to lower CPU load',\n          'Optimize batch processing logic',\n          'Consider running during off-peak hours'\n        ]\n      });\n    }\n    \n    // Connection pool threshold check\n    if (this.metrics.connectionPoolUtilization > this.thresholds.maxConnectionPoolUtilization) {\n      newAlerts.push({\n        type: 'connection',\n        severity: this.metrics.connectionPoolUtilization > 0.95 ? 'critical' : 'warning',\n        message: `Connection pool utilization ${(this.metrics.connectionPoolUtilization * 100).toFixed(1)}% exceeds threshold ${(this.thresholds.maxConnectionPoolUtilization * 100).toFixed(1)}%`,\n        currentValue: this.metrics.connectionPoolUtilization * 100,\n        threshold: this.thresholds.maxConnectionPoolUtilization * 100,\n        timestamp: new Date(),\n        recommendations: [\n          'Increase connection pool size',\n          'Optimize connection usage patterns',\n          'Reduce parallel operations if needed'\n        ]\n      });\n    }\n    \n    // Emit new alerts\n    newAlerts.forEach(alert => {\n      this.alerts.push(alert);\n      this.emit('performance_alert', alert);\n    });\n    \n    // Keep only last 50 alerts\n    if (this.alerts.length > 50) {\n      this.alerts = this.alerts.slice(-50);\n    }\n  }\n\n  /**\n   * Get current performance metrics\n   */\n  getMetrics(): PerformanceMetrics {\n    return { ...this.metrics };\n  }\n\n  /**\n   * Get recent performance alerts\n   */\n  getAlerts(severity?: 'warning' | 'critical'): PerformanceAlert[] {\n    if (severity) {\n      return this.alerts.filter(alert => alert.severity === severity);\n    }\n    return [...this.alerts];\n  }\n\n  /**\n   * Generate optimization recommendations based on current metrics\n   */\n  getOptimizationRecommendations(currentConfig: {\n    batchSize: number;\n    parallelism: number;\n    connectionPoolSize: number;\n  }): OptimizationRecommendations {\n    const recommendations: OptimizationRecommendations = {\n      batchSize: {\n        current: currentConfig.batchSize,\n        recommended: currentConfig.batchSize,\n        reason: 'Current batch size is optimal'\n      },\n      parallelism: {\n        current: currentConfig.parallelism,\n        recommended: currentConfig.parallelism,\n        reason: 'Current parallelism is optimal'\n      },\n      connectionPool: {\n        current: currentConfig.connectionPoolSize,\n        recommended: currentConfig.connectionPoolSize,\n        reason: 'Current connection pool size is optimal'\n      },\n      memoryOptimization: {\n        gcRecommendation: 'Current GC settings are adequate',\n        heapSizeRecommendation: 'Current heap size is sufficient',\n        streamingRecommendation: 'Consider streaming for datasets > 100MB'\n      },\n      systemOptimization: {\n        cpuRecommendation: 'CPU usage is within acceptable range',\n        memoryRecommendation: 'Memory usage is optimized',\n        ioRecommendation: 'I/O performance is adequate'\n      }\n    };\n    \n    // Batch size recommendations\n    if (this.metrics.heapUsedMB > this.thresholds.maxMemoryUsageMB * 0.8) {\n      recommendations.batchSize.recommended = Math.max(100, Math.floor(currentConfig.batchSize * 0.7));\n      recommendations.batchSize.reason = 'Reduce batch size to lower memory usage';\n    } else if (this.metrics.recordsPerSecond < this.thresholds.minThroughputPerSecond && this.metrics.heapUsedMB < this.thresholds.maxMemoryUsageMB * 0.5) {\n      recommendations.batchSize.recommended = Math.min(2000, Math.floor(currentConfig.batchSize * 1.5));\n      recommendations.batchSize.reason = 'Increase batch size to improve throughput';\n    }\n    \n    // Parallelism recommendations\n    if (this.metrics.cpuUsagePercent > this.thresholds.maxCpuUsagePercent * 0.9) {\n      recommendations.parallelism.recommended = Math.max(1, Math.floor(currentConfig.parallelism * 0.8));\n      recommendations.parallelism.reason = 'Reduce parallelism to lower CPU usage';\n    } else if (this.metrics.cpuUsagePercent < 50 && this.metrics.recordsPerSecond < this.thresholds.minThroughputPerSecond) {\n      const maxParallelism = Math.min(8, os.cpus().length);\n      recommendations.parallelism.recommended = Math.min(maxParallelism, currentConfig.parallelism + 1);\n      recommendations.parallelism.reason = 'Increase parallelism to utilize available CPU resources';\n    }\n    \n    // Connection pool recommendations\n    if (this.metrics.connectionPoolUtilization > 0.8) {\n      recommendations.connectionPool.recommended = Math.floor(currentConfig.connectionPoolSize * 1.5);\n      recommendations.connectionPool.reason = 'Increase pool size to reduce connection contention';\n    } else if (this.metrics.connectionPoolUtilization < 0.3) {\n      recommendations.connectionPool.recommended = Math.max(5, Math.floor(currentConfig.connectionPoolSize * 0.8));\n      recommendations.connectionPool.reason = 'Reduce pool size to optimize resource usage';\n    }\n    \n    // Memory optimization recommendations\n    if (this.metrics.heapUsedMB > this.thresholds.maxMemoryUsageMB * 0.8) {\n      recommendations.memoryOptimization.gcRecommendation = 'Enable frequent garbage collection: --max-old-space-size=4096 --gc-global';\n      recommendations.memoryOptimization.heapSizeRecommendation = 'Increase heap size: --max-old-space-size=8192';\n      recommendations.memoryOptimization.streamingRecommendation = 'Implement streaming processing to reduce memory footprint';\n    }\n    \n    // System optimization recommendations\n    if (this.metrics.cpuUsagePercent > 80) {\n      recommendations.systemOptimization.cpuRecommendation = 'Schedule migration during off-peak hours or reduce parallelism';\n    }\n    \n    if (this.metrics.freeMemoryMB < 1000) {\n      recommendations.systemOptimization.memoryRecommendation = 'System memory is low, consider reducing batch sizes or adding more RAM';\n    }\n    \n    return recommendations;\n  }\n\n  /**\n   * Get performance summary report\n   */\n  getPerformanceReport(): {\n    summary: PerformanceMetrics;\n    recommendations: OptimizationRecommendations;\n    alerts: PerformanceAlert[];\n    trends: {\n      throughputTrend: 'improving' | 'declining' | 'stable';\n      memoryTrend: 'increasing' | 'decreasing' | 'stable';\n      errorTrend: 'improving' | 'worsening' | 'stable';\n    };\n  } {\n    // Calculate trends\n    const recentThroughput = this.throughputHistory.slice(-10);\n    const olderThroughput = this.throughputHistory.slice(-20, -10);\n    \n    const recentMemory = this.memoryHistory.slice(-10);\n    const olderMemory = this.memoryHistory.slice(-20, -10);\n    \n    const avgRecentThroughput = recentThroughput.reduce((sum, val) => sum + val, 0) / recentThroughput.length;\n    const avgOlderThroughput = olderThroughput.reduce((sum, val) => sum + val, 0) / olderThroughput.length;\n    \n    const avgRecentMemory = recentMemory.reduce((sum, val) => sum + val, 0) / recentMemory.length;\n    const avgOlderMemory = olderMemory.reduce((sum, val) => sum + val, 0) / olderMemory.length;\n    \n    const throughputTrend = avgRecentThroughput > avgOlderThroughput * 1.05 ? 'improving' : \n                           avgRecentThroughput < avgOlderThroughput * 0.95 ? 'declining' : 'stable';\n    \n    const memoryTrend = avgRecentMemory > avgOlderMemory * 1.05 ? 'increasing' : \n                       avgRecentMemory < avgOlderMemory * 0.95 ? 'decreasing' : 'stable';\n    \n    return {\n      summary: this.getMetrics(),\n      recommendations: this.getOptimizationRecommendations({\n        batchSize: 500,\n        parallelism: 2,\n        connectionPoolSize: 20\n      }),\n      alerts: this.getAlerts(),\n      trends: {\n        throughputTrend,\n        memoryTrend,\n        errorTrend: 'stable' // Simplified for now\n      }\n    };\n  }\n\n  /**\n   * Reset all metrics (useful for new migration sessions)\n   */\n  reset(): void {\n    this.metrics = this.initializeMetrics();\n    this.alerts = [];\n    this.startTime = Date.now();\n    this.lastMetricsUpdate = Date.now();\n    this.batchTimes = [];\n    this.throughputHistory = [];\n    this.memoryHistory = [];\n    this.connectionMetrics = {\n      active: 0,\n      idle: 0,\n      created: 0,\n      destroyed: 0,\n      errors: 0,\n      totalLatency: 0,\n      latencyCount: 0\n    };\n    \n    this.emit('metrics_reset');\n  }\n\n  /**\n   * Stop monitoring and cleanup\n   */\n  stop(): void {\n    this.removeAllListeners();\n  }\n}