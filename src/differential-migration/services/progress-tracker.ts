/**
 * ProgressTracker Service
 * Implements real-time progress tracking, performance monitoring, status reporting
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

// Import our models
import {
  MigrationStatusModel,
  type MigrationStatus
} from '../models/migration-status';
import {
  MigrationExecutionLogModel,
  type MigrationExecutionLog
} from '../models/execution-log';

// Service interfaces
export interface ProgressConfig {
  updateIntervalMs: number;
  retentionPeriodHours: number;
  performanceWindowSize: number; // Number of samples for performance calculations
  enableRealTimeUpdates: boolean;
  thresholds: {
    lowThroughputWarning: number; // Records per second
    highMemoryWarning: number; // MB
    stalledProgressWarning: number; // Minutes without updates
  };
}

export interface ProgressSnapshot {
  snapshotId: string;
  sessionId: string;
  entityType: string;
  timestamp: Date;
  progress: {
    recordsProcessed: number;
    recordsRemaining: number;
    totalRecords: number;
    percentageComplete: number;
  };
  performance: {
    recordsPerSecond: number;
    averageBatchTimeMs: number;
    memoryUsageMb: number;
    cpuUsagePercent?: number;
  };
  timing: {
    startTime: Date;
    estimatedCompletionTime: Date | null;
    elapsedTimeMs: number;
    remainingTimeMs: number | null;
  };
  status: 'starting' | 'running' | 'completing' | 'completed' | 'paused' | 'error';
  currentBatch?: {
    batchNumber: number;
    batchSize: number;
    batchProgress: number; // 0-1
  };
}

export interface PerformanceMetrics {
  entityType: string;
  timeWindow: {
    startTime: Date;
    endTime: Date;
    durationMs: number;
  };
  throughput: {
    current: number; // Records per second
    average: number;
    peak: number;
    minimum: number;
  };
  memory: {
    current: number; // MB
    average: number;
    peak: number;
  };
  timing: {
    averageBatchTimeMs: number;
    fastestBatchMs: number;
    slowestBatchMs: number;
    varianceMs: number;
  };
  efficiency: {
    cpuEfficiency: number; // 0-1 (records per CPU usage)
    memoryEfficiency: number; // 0-1 (records per MB)
    overallScore: number; // 0-100
  };
}

export interface ProgressAlert {
  alertId: string;
  severity: 'info' | 'warning' | 'error';
  type: 'low_throughput' | 'high_memory' | 'stalled_progress' | 'error_rate' | 'eta_deviation';
  entityType: string;
  message: string;
  details: object;
  timestamp: Date;
  resolved?: boolean;
  resolvedAt?: Date;
}

export interface RealTimeProgressUpdate {
  updateId: string;
  sessionId: string;
  updateType: 'progress' | 'performance' | 'alert' | 'completion' | 'error';
  entityType?: string;
  data: object;
  timestamp: Date;
}

/**
 * ProgressTracker Service Implementation
 *
 * Provides comprehensive real-time progress tracking, performance monitoring,
 * and alert management for differential migration operations.
 */
export class ProgressTracker extends EventEmitter {
  private config: ProgressConfig;
  private sessionId: string;
  private progressData: Map<string, ProgressSnapshot[]> = new Map();
  private performanceHistory: Map<string, PerformanceMetrics[]> = new Map();
  private alerts: ProgressAlert[] = [];
  private updateIntervalId: NodeJS.Timeout | null = null;

  constructor(sessionId: string, config: ProgressConfig) {
    super();

    // Validate configuration
    const validation = ProgressTracker.validateProgressConfig(config);
    if (!validation.isValid) {
      throw new Error(`Invalid progress config: ${validation.errors.join(', ')}`);
    }

    this.sessionId = sessionId;
    this.config = config;

    // Start real-time updates if enabled
    if (config.enableRealTimeUpdates) {
      this.startRealTimeUpdates();
    }

    // Setup cleanup for old data
    this.setupDataRetentionCleanup();
  }

  /**
   * Validates progress configuration
   */
  static validateProgressConfig(config: ProgressConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (config.updateIntervalMs < 100 || config.updateIntervalMs > 30000) {
      errors.push('updateIntervalMs must be between 100 and 30000');
    }

    if (config.retentionPeriodHours < 1 || config.retentionPeriodHours > 720) {
      errors.push('retentionPeriodHours must be between 1 and 720 (30 days)');
    }

    if (config.performanceWindowSize < 5 || config.performanceWindowSize > 1000) {
      errors.push('performanceWindowSize must be between 5 and 1000');
    }

    if (config.thresholds.lowThroughputWarning < 0) {
      errors.push('lowThroughputWarning threshold must be non-negative');
    }

    if (config.thresholds.highMemoryWarning < 0) {
      errors.push('highMemoryWarning threshold must be non-negative');
    }

    if (config.thresholds.stalledProgressWarning < 1) {
      errors.push('stalledProgressWarning threshold must be at least 1 minute');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Starts tracking progress for an entity
   */
  async startTracking(entityType: string, totalRecords: number): Promise<string> {
    const snapshotId = uuidv4();
    const now = new Date();

    const initialSnapshot: ProgressSnapshot = {
      snapshotId,
      sessionId: this.sessionId,
      entityType,
      timestamp: now,
      progress: {
        recordsProcessed: 0,
        recordsRemaining: totalRecords,
        totalRecords,
        percentageComplete: 0
      },
      performance: {
        recordsPerSecond: 0,
        averageBatchTimeMs: 0,
        memoryUsageMb: this.getCurrentMemoryUsage()
      },
      timing: {
        startTime: now,
        estimatedCompletionTime: null,
        elapsedTimeMs: 0,
        remainingTimeMs: null
      },
      status: 'starting'
    };

    // Store snapshot
    if (!this.progressData.has(entityType)) {
      this.progressData.set(entityType, []);
    }
    this.progressData.get(entityType)!.push(initialSnapshot);

    // Log tracking start
    await this.logProgress('info',
      `Started progress tracking for ${entityType}`,
      { entityType, totalRecords, snapshotId }
    );

    // Emit real-time update
    if (this.config.enableRealTimeUpdates) {
      this.emitUpdate({
        updateId: uuidv4(),
        sessionId: this.sessionId,
        updateType: 'progress',
        entityType,
        data: initialSnapshot,
        timestamp: now
      });
    }

    return snapshotId;
  }

  /**
   * Updates progress for an entity
   */
  async updateProgress(
    entityType: string,
    recordsProcessed: number,
    batchInfo?: {
      batchNumber: number;
      batchSize: number;
      batchDurationMs: number;
    }
  ): Promise<ProgressSnapshot> {
    const snapshots = this.progressData.get(entityType);
    if (!snapshots || snapshots.length === 0) {
      throw new Error(`No tracking session found for entity type: ${entityType}`);
    }

    const lastSnapshot = snapshots[snapshots.length - 1];
    const now = new Date();
    const elapsedTimeMs = now.getTime() - lastSnapshot.timing.startTime.getTime();
    const totalRecords = lastSnapshot.progress.totalRecords;
    const recordsRemaining = Math.max(0, totalRecords - recordsProcessed);
    const percentageComplete = totalRecords > 0 ? Math.round((recordsProcessed / totalRecords) * 100 * 100) / 100 : 0;

    // Calculate performance metrics
    const recordsPerSecond = elapsedTimeMs > 0 ? Math.round((recordsProcessed / elapsedTimeMs) * 1000 * 100) / 100 : 0;
    const averageBatchTimeMs = batchInfo ? this.calculateAverageBatchTime(entityType, batchInfo.batchDurationMs) : 0;
    const memoryUsageMb = this.getCurrentMemoryUsage();

    // Calculate ETA
    let estimatedCompletionTime: Date | null = null;
    let remainingTimeMs: number | null = null;

    if (recordsPerSecond > 0 && recordsRemaining > 0) {
      remainingTimeMs = Math.round((recordsRemaining / recordsPerSecond) * 1000);
      estimatedCompletionTime = new Date(now.getTime() + remainingTimeMs);
    }

    // Determine status
    let status: ProgressSnapshot['status'] = 'running';
    if (recordsRemaining === 0) {
      status = 'completed';
    } else if (recordsProcessed === 0) {
      status = 'starting';
    } else if (percentageComplete > 95) {
      status = 'completing';
    }

    const newSnapshot: ProgressSnapshot = {
      snapshotId: uuidv4(),
      sessionId: this.sessionId,
      entityType,
      timestamp: now,
      progress: {
        recordsProcessed,
        recordsRemaining,
        totalRecords,
        percentageComplete
      },
      performance: {
        recordsPerSecond,
        averageBatchTimeMs,
        memoryUsageMb,
        cpuUsagePercent: this.getCurrentCpuUsage()
      },
      timing: {
        startTime: lastSnapshot.timing.startTime,
        estimatedCompletionTime,
        elapsedTimeMs,
        remainingTimeMs
      },
      status,
      currentBatch: batchInfo ? {
        batchNumber: batchInfo.batchNumber,
        batchSize: batchInfo.batchSize,
        batchProgress: 1.0 // Assume batch completed when updating
      } : undefined
    };

    // Store snapshot
    snapshots.push(newSnapshot);
    this.progressData.set(entityType, snapshots);

    // Clean up old snapshots if needed
    await this.cleanupOldSnapshots(entityType);

    // Check for alerts
    await this.checkForAlerts(newSnapshot);

    // Log significant progress milestones
    if (percentageComplete > 0 && percentageComplete % 25 === 0) {
      await this.logProgress('info',
        `Progress milestone: ${entityType} at ${percentageComplete}%`,
        {
          entityType,
          percentageComplete,
          recordsProcessed,
          recordsPerSecond,
          eta: estimatedCompletionTime?.toISOString()
        }
      );
    }

    // Emit real-time update
    if (this.config.enableRealTimeUpdates) {
      this.emitUpdate({
        updateId: uuidv4(),
        sessionId: this.sessionId,
        updateType: 'progress',
        entityType,
        data: newSnapshot,
        timestamp: now
      });
    }

    return newSnapshot;
  }

  /**
   * Gets the latest progress snapshot for an entity
   */
  async getLatestProgress(entityType: string): Promise<ProgressSnapshot | null> {
    const snapshots = this.progressData.get(entityType);
    return snapshots && snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  }

  /**
   * Gets progress snapshots for all tracked entities
   */
  async getAllProgress(): Promise<ProgressSnapshot[]> {
    const allSnapshots: ProgressSnapshot[] = [];

    for (const snapshots of this.progressData.values()) {
      if (snapshots.length > 0) {
        allSnapshots.push(snapshots[snapshots.length - 1]);
      }
    }

    return allSnapshots.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Calculates comprehensive performance metrics for an entity
   */
  async calculatePerformanceMetrics(
    entityType: string,
    timeWindowMs?: number
  ): Promise<PerformanceMetrics> {
    const snapshots = this.progressData.get(entityType);
    if (!snapshots || snapshots.length < 2) {
      throw new Error('Insufficient data for performance calculation');
    }

    const now = new Date();
    const windowStart = timeWindowMs
      ? new Date(now.getTime() - timeWindowMs)
      : snapshots[0].timestamp;

    const relevantSnapshots = snapshots.filter(s => s.timestamp >= windowStart);

    if (relevantSnapshots.length < 2) {
      throw new Error('Insufficient data in specified time window');
    }

    // Calculate throughput metrics
    const throughputValues = relevantSnapshots.map(s => s.performance.recordsPerSecond).filter(v => v > 0);
    const throughputCurrent = throughputValues[throughputValues.length - 1] || 0;
    const throughputAverage = throughputValues.length > 0
      ? Math.round((throughputValues.reduce((sum, val) => sum + val, 0) / throughputValues.length) * 100) / 100
      : 0;
    const throughputPeak = throughputValues.length > 0 ? Math.max(...throughputValues) : 0;
    const throughputMinimum = throughputValues.length > 0 ? Math.min(...throughputValues) : 0;

    // Calculate memory metrics
    const memoryValues = relevantSnapshots.map(s => s.performance.memoryUsageMb);
    const memoryCurrent = memoryValues[memoryValues.length - 1];
    const memoryAverage = Math.round((memoryValues.reduce((sum, val) => sum + val, 0) / memoryValues.length) * 100) / 100;
    const memoryPeak = Math.max(...memoryValues);

    // Calculate timing metrics
    const batchTimes = relevantSnapshots
      .filter(s => s.performance.averageBatchTimeMs > 0)
      .map(s => s.performance.averageBatchTimeMs);

    const averageBatchTimeMs = batchTimes.length > 0
      ? Math.round((batchTimes.reduce((sum, val) => sum + val, 0) / batchTimes.length) * 100) / 100
      : 0;

    const fastestBatchMs = batchTimes.length > 0 ? Math.min(...batchTimes) : 0;
    const slowestBatchMs = batchTimes.length > 0 ? Math.max(...batchTimes) : 0;
    const varianceMs = batchTimes.length > 1 ? this.calculateVariance(batchTimes) : 0;

    // Calculate efficiency scores
    const cpuEfficiency = Math.min(1.0, throughputAverage / 1000); // Normalize against 1000 records/sec
    const memoryEfficiency = memoryAverage > 0 ? Math.min(1.0, throughputAverage / memoryAverage) : 0;
    const overallScore = Math.round(((cpuEfficiency + memoryEfficiency) / 2) * 100);

    // Store performance history
    const performanceMetrics: PerformanceMetrics = {
      entityType,
      timeWindow: {
        startTime: windowStart,
        endTime: now,
        durationMs: now.getTime() - windowStart.getTime()
      },
      throughput: {
        current: throughputCurrent,
        average: throughputAverage,
        peak: throughputPeak,
        minimum: throughputMinimum
      },
      memory: {
        current: memoryCurrent,
        average: memoryAverage,
        peak: memoryPeak
      },
      timing: {
        averageBatchTimeMs,
        fastestBatchMs,
        slowestBatchMs,
        varianceMs
      },
      efficiency: {
        cpuEfficiency,
        memoryEfficiency,
        overallScore
      }
    };

    // Store in performance history
    if (!this.performanceHistory.has(entityType)) {
      this.performanceHistory.set(entityType, []);
    }
    const history = this.performanceHistory.get(entityType)!;
    history.push(performanceMetrics);

    // Keep only recent performance data
    if (history.length > this.config.performanceWindowSize) {
      history.splice(0, history.length - this.config.performanceWindowSize);
    }

    return performanceMetrics;
  }

  /**
   * Gets currently active alerts
   */
  async getActiveAlerts(): Promise<ProgressAlert[]> {
    return this.alerts.filter(alert => !alert.resolved);
  }

  /**
   * Resolves an alert by ID
   */
  async resolveAlert(alertId: string): Promise<boolean> {
    const alert = this.alerts.find(a => a.alertId === alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = new Date();

      // Log alert resolution
      await this.logProgress('info',
        `Alert resolved: ${alert.type} for ${alert.entityType}`,
        { alertId, alertType: alert.type, entityType: alert.entityType }
      );

      // Emit update
      if (this.config.enableRealTimeUpdates) {
        this.emitUpdate({
          updateId: uuidv4(),
          sessionId: this.sessionId,
          updateType: 'alert',
          data: { action: 'resolved', alert },
          timestamp: new Date()
        });
      }

      return true;
    }
    return false;
  }

  /**
   * Subscribes to real-time progress updates
   */
  subscribeToUpdates(callback: (update: RealTimeProgressUpdate) => void): () => void {
    this.on('progress_update', callback);

    // Return unsubscribe function
    return () => {
      this.off('progress_update', callback);
    };
  }

  /**
   * Generates a comprehensive progress report
   */
  async generateProgressReport(
    entityTypes?: string[],
    includePerformanceMetrics?: boolean
  ): Promise<{
    reportId: string;
    sessionId: string;
    generatedAt: Date;
    summary: {
      totalEntities: number;
      completedEntities: number;
      activeEntities: number;
      totalRecordsProcessed: number;
      overallProgress: number;
      estimatedTimeRemaining: number | null;
    };
    entityProgress: Array<{
      entityType: string;
      status: string;
      progress: number;
      recordsProcessed: number;
      throughput: number;
      eta: Date | null;
    }>;
    performanceMetrics?: PerformanceMetrics[];
    alerts: ProgressAlert[];
    recommendations: string[];
  }> {
    const reportId = uuidv4();
    const now = new Date();

    const relevantTypes = entityTypes || Array.from(this.progressData.keys());
    const entityProgress = [];
    let totalRecordsProcessed = 0;
    let totalRecords = 0;
    let completedEntities = 0;
    let activeEntities = 0;

    // Gather entity progress data
    for (const entityType of relevantTypes) {
      const latest = await this.getLatestProgress(entityType);
      if (latest) {
        entityProgress.push({
          entityType,
          status: latest.status,
          progress: latest.progress.percentageComplete,
          recordsProcessed: latest.progress.recordsProcessed,
          throughput: latest.performance.recordsPerSecond,
          eta: latest.timing.estimatedCompletionTime
        });

        totalRecordsProcessed += latest.progress.recordsProcessed;
        totalRecords += latest.progress.totalRecords;

        if (latest.status === 'completed') {
          completedEntities++;
        } else if (['running', 'completing'].includes(latest.status)) {
          activeEntities++;
        }
      }
    }

    const overallProgress = totalRecords > 0 ? Math.round((totalRecordsProcessed / totalRecords) * 100 * 100) / 100 : 0;

    // Calculate overall estimated time remaining
    let estimatedTimeRemaining: number | null = null;
    const activeSnapshots = entityProgress.filter(ep => ep.status === 'running');
    if (activeSnapshots.length > 0) {
      const avgThroughput = activeSnapshots.reduce((sum, ep) => sum + ep.throughput, 0) / activeSnapshots.length;
      const remainingRecords = totalRecords - totalRecordsProcessed;
      if (avgThroughput > 0) {
        estimatedTimeRemaining = Math.round((remainingRecords / avgThroughput) * 1000);
      }
    }

    // Generate performance metrics if requested
    let performanceMetrics: PerformanceMetrics[] | undefined;
    if (includePerformanceMetrics) {
      performanceMetrics = [];
      for (const entityType of relevantTypes) {
        try {
          const metrics = await this.calculatePerformanceMetrics(entityType);
          performanceMetrics.push(metrics);
        } catch (error) {
          // Skip entities with insufficient data
        }
      }
    }

    // Get current alerts
    const activeAlerts = await this.getActiveAlerts();

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      entityProgress,
      activeAlerts,
      overallProgress,
      activeEntities
    );

    const report = {
      reportId,
      sessionId: this.sessionId,
      generatedAt: now,
      summary: {
        totalEntities: relevantTypes.length,
        completedEntities,
        activeEntities,
        totalRecordsProcessed,
        overallProgress,
        estimatedTimeRemaining
      },
      entityProgress,
      performanceMetrics,
      alerts: activeAlerts,
      recommendations
    };

    // Log report generation
    await this.logProgress('info',
      'Progress report generated',
      {
        reportId,
        entityCount: relevantTypes.length,
        overallProgress,
        activeAlerts: activeAlerts.length
      }
    );

    return report;
  }

  /**
   * Checks for performance and progress alerts
   */
  private async checkForAlerts(snapshot: ProgressSnapshot): Promise<void> {
    const now = new Date();

    // Check for low throughput
    if (snapshot.performance.recordsPerSecond > 0 &&
        snapshot.performance.recordsPerSecond < this.config.thresholds.lowThroughputWarning) {
      await this.createAlert({
        severity: 'warning',
        type: 'low_throughput',
        entityType: snapshot.entityType,
        message: `Low throughput detected: ${snapshot.performance.recordsPerSecond} records/sec`,
        details: {
          threshold: this.config.thresholds.lowThroughputWarning,
          actual: snapshot.performance.recordsPerSecond,
          recommendedAction: 'Consider reducing batch size or optimizing queries'
        },
        timestamp: now
      });
    }

    // Check for high memory usage
    if (snapshot.performance.memoryUsageMb > this.config.thresholds.highMemoryWarning) {
      await this.createAlert({
        severity: 'warning',
        type: 'high_memory',
        entityType: snapshot.entityType,
        message: `High memory usage: ${snapshot.performance.memoryUsageMb}MB`,
        details: {
          threshold: this.config.thresholds.highMemoryWarning,
          actual: snapshot.performance.memoryUsageMb,
          recommendedAction: 'Reduce batch size or restart process'
        },
        timestamp: now
      });
    }

    // Check for stalled progress
    await this.checkStalledProgress(snapshot);

    // Check for ETA deviations
    await this.checkETADeviation(snapshot);
  }

  /**
   * Checks for stalled progress
   */
  private async checkStalledProgress(snapshot: ProgressSnapshot): Promise<void> {
    const snapshots = this.progressData.get(snapshot.entityType) || [];

    if (snapshots.length > 1) {
      const previousSnapshot = snapshots[snapshots.length - 2];
      const timeSinceLastUpdate = snapshot.timestamp.getTime() - previousSnapshot.timestamp.getTime();
      const stalledThresholdMs = this.config.thresholds.stalledProgressWarning * 60 * 1000;

      if (timeSinceLastUpdate > stalledThresholdMs &&
          snapshot.progress.recordsProcessed === previousSnapshot.progress.recordsProcessed &&
          snapshot.status === 'running') {

        await this.createAlert({
          severity: 'error',
          type: 'stalled_progress',
          entityType: snapshot.entityType,
          message: `Progress stalled for ${Math.round(timeSinceLastUpdate / 60000)} minutes`,
          details: {
            lastUpdateMinutesAgo: Math.round(timeSinceLastUpdate / 60000),
            threshold: this.config.thresholds.stalledProgressWarning,
            recommendedAction: 'Check for deadlocks or connection issues'
          },
          timestamp: snapshot.timestamp
        });
      }
    }
  }

  /**
   * Checks for significant ETA deviations
   */
  private async checkETADeviation(snapshot: ProgressSnapshot): Promise<void> {
    if (!snapshot.timing.estimatedCompletionTime) return;

    const snapshots = this.progressData.get(snapshot.entityType) || [];
    if (snapshots.length > 5) { // Need history to detect deviation
      const previousETA = snapshots[snapshots.length - 3].timing.estimatedCompletionTime;

      if (previousETA) {
        const etaDifferenceMs = Math.abs(
          snapshot.timing.estimatedCompletionTime.getTime() - previousETA.getTime()
        );

        // Alert if ETA changed by more than 30 minutes
        if (etaDifferenceMs > 30 * 60 * 1000) {
          await this.createAlert({
            severity: 'info',
            type: 'eta_deviation',
            entityType: snapshot.entityType,
            message: `ETA changed by ${Math.round(etaDifferenceMs / 60000)} minutes`,
            details: {
              previousETA: previousETA.toISOString(),
              currentETA: snapshot.timing.estimatedCompletionTime.toISOString(),
              deviationMinutes: Math.round(etaDifferenceMs / 60000)
            },
            timestamp: snapshot.timestamp
          });
        }
      }
    }
  }

  /**
   * Creates a new alert
   */
  private async createAlert(alertData: Omit<ProgressAlert, 'alertId'>): Promise<void> {
    // Check for duplicate alerts (same type and entity within last 5 minutes)
    const existingAlert = this.alerts.find(alert =>
      !alert.resolved &&
      alert.type === alertData.type &&
      alert.entityType === alertData.entityType &&
      (Date.now() - alert.timestamp.getTime()) < 5 * 60 * 1000
    );

    if (existingAlert) {
      return; // Don't create duplicate alerts
    }

    const alert: ProgressAlert = {
      alertId: uuidv4(),
      ...alertData
    };

    this.alerts.push(alert);

    // Log alert creation
    await this.logProgress('warn',
      `Alert created: ${alert.type} for ${alert.entityType}`,
      { alertId: alert.alertId, alertType: alert.type, severity: alert.severity }
    );

    // Emit real-time alert update
    if (this.config.enableRealTimeUpdates) {
      this.emitUpdate({
        updateId: uuidv4(),
        sessionId: this.sessionId,
        updateType: 'alert',
        data: alert,
        timestamp: alert.timestamp
      });
    }
  }

  /**
   * Generates recommendations based on current state
   */
  private generateRecommendations(
    entityProgress: Array<{ entityType: string; status: string; progress: number; throughput: number }>,
    activeAlerts: ProgressAlert[],
    overallProgress: number,
    activeEntities: number
  ): string[] {
    const recommendations: string[] = [];

    if (activeAlerts.length > 0) {
      recommendations.push(`${activeAlerts.length} active alert(s) require attention`);
    }

    if (activeEntities === 0 && overallProgress === 100) {
      recommendations.push('All entities completed successfully');
    } else if (overallProgress < 25) {
      recommendations.push('Migration in early stages - monitor for performance issues');
    } else if (overallProgress > 90) {
      recommendations.push('Migration nearing completion - prepare for final validation');
    }

    const lowThroughputEntities = entityProgress.filter(ep => ep.throughput > 0 && ep.throughput < this.config.thresholds.lowThroughputWarning);
    if (lowThroughputEntities.length > 0) {
      recommendations.push(`Low throughput detected for: ${lowThroughputEntities.map(e => e.entityType).join(', ')}`);
    }

    const stalledEntities = entityProgress.filter(ep => ep.status === 'running' && ep.throughput === 0);
    if (stalledEntities.length > 0) {
      recommendations.push(`Stalled entities detected: ${stalledEntities.map(e => e.entityType).join(', ')}`);
    }

    if (recommendations.length === 0) {
      recommendations.push('Progress tracking normal - no issues detected');
    }

    return recommendations;
  }

  /**
   * Utility methods
   */
  private calculateAverageBatchTime(entityType: string, currentBatchTime: number): number {
    const snapshots = this.progressData.get(entityType) || [];
    const batchTimes = snapshots
      .filter(s => s.performance.averageBatchTimeMs > 0)
      .map(s => s.performance.averageBatchTimeMs);

    batchTimes.push(currentBatchTime);

    return Math.round((batchTimes.reduce((sum, time) => sum + time, 0) / batchTimes.length) * 100) / 100;
  }

  private calculateVariance(values: number[]): number {
    if (values.length < 2) return 0;

    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.round(Math.sqrt(variance) * 100) / 100;
  }

  private getCurrentMemoryUsage(): number {
    const memUsage = process.memoryUsage();
    return Math.round(memUsage.heapUsed / 1024 / 1024); // Convert to MB
  }

  private getCurrentCpuUsage(): number {
    // Mock CPU usage calculation
    return Math.round((process.cpuUsage().user / 1000000) * 100) / 100;
  }

  private emitUpdate(update: RealTimeProgressUpdate): void {
    this.emit('progress_update', update);
  }

  private startRealTimeUpdates(): void {
    this.updateIntervalId = setInterval(async () => {
      // Emit periodic updates for all active entities
      const allProgress = await this.getAllProgress();
      const activeEntities = allProgress.filter(p => ['starting', 'running', 'completing'].includes(p.status));

      for (const progress of activeEntities) {
        this.emitUpdate({
          updateId: uuidv4(),
          sessionId: this.sessionId,
          updateType: 'progress',
          entityType: progress.entityType,
          data: progress,
          timestamp: new Date()
        });
      }
    }, this.config.updateIntervalMs);
  }

  private setupDataRetentionCleanup(): void {
    // Setup periodic cleanup of old data
    setInterval(async () => {
      await this.cleanupOldData();
    }, 60 * 60 * 1000); // Run every hour
  }

  private async cleanupOldSnapshots(entityType: string): Promise<void> {
    const snapshots = this.progressData.get(entityType);
    if (!snapshots) return;

    const cutoffTime = new Date(Date.now() - this.config.retentionPeriodHours * 60 * 60 * 1000);
    const recentSnapshots = snapshots.filter(s => s.timestamp > cutoffTime);

    if (recentSnapshots.length !== snapshots.length) {
      this.progressData.set(entityType, recentSnapshots);
    }
  }

  private async cleanupOldData(): Promise<void> {
    const cutoffTime = new Date(Date.now() - this.config.retentionPeriodHours * 60 * 60 * 1000);

    // Clean up old alerts
    this.alerts = this.alerts.filter(alert => alert.timestamp > cutoffTime || !alert.resolved);

    // Clean up old progress data
    for (const [entityType] of this.progressData) {
      await this.cleanupOldSnapshots(entityType);
    }

    // Clean up performance history
    for (const [entityType, history] of this.performanceHistory) {
      const recentHistory = history.filter(h => h.timeWindow.endTime > cutoffTime);
      this.performanceHistory.set(entityType, recentHistory);
    }
  }

  /**
   * Stops the progress tracker and cleans up resources
   */
  async stop(): Promise<void> {
    if (this.updateIntervalId) {
      clearInterval(this.updateIntervalId);
      this.updateIntervalId = null;
    }

    await this.logProgress('info',
      'Progress tracker stopped',
      { sessionId: this.sessionId }
    );

    this.removeAllListeners();
  }

  /**
   * Logs progress operations
   */
  private async logProgress(
    level: 'info' | 'warn' | 'error',
    message: string,
    contextData: object = {}
  ): Promise<void> {
    try {
      const log = MigrationExecutionLogModel.create({
        migration_session_id: this.sessionId,
        operation_type: 'record_migration',
        log_level: level,
        message,
        context_data: {
          service: 'ProgressTracker',
          timestamp: new Date().toISOString(),
          ...contextData
        }
      });

      // In a real implementation, this would be persisted to the database
      console.log(`[${level.toUpperCase()}] ProgressTracker: ${message}`, contextData);
    } catch (error) {
      // Don't let logging errors break the main functionality
      console.error('Failed to log progress operation:', error);
    }
  }
}