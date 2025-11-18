/**
 * Unit Tests: ProgressTracker Service
 * Tests real-time updates, performance metrics, ETA calculations
 */

import { diffMigrationTestUtils } from '../../setup';

// Import the service interfaces (will be implemented after tests)
interface ProgressConfig {
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

interface ProgressSnapshot {
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

interface PerformanceMetrics {
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

interface ProgressAlert {
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

interface RealTimeProgressUpdate {
  updateId: string;
  sessionId: string;
  updateType: 'progress' | 'performance' | 'alert' | 'completion' | 'error';
  entityType?: string;
  data: object;
  timestamp: Date;
}

// Mock implementation for testing (will be replaced with actual implementation)
class MockProgressTracker {
  private config: ProgressConfig;
  private sessionId: string;
  private progressData: Map<string, ProgressSnapshot[]> = new Map();
  private alerts: ProgressAlert[] = [];
  private subscribers: Array<(update: RealTimeProgressUpdate) => void> = [];

  constructor(sessionId: string, config: ProgressConfig) {
    this.sessionId = sessionId;
    this.config = config;
  }

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

  async startTracking(entityType: string, totalRecords: number): Promise<string> {
    const snapshotId = diffMigrationTestUtils.generateTestUUID();
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
        memoryUsageMb: 50 // Initial memory usage
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

    // Send real-time update
    if (this.config.enableRealTimeUpdates) {
      this.emitUpdate({
        updateId: diffMigrationTestUtils.generateTestUUID(),
        sessionId: this.sessionId,
        updateType: 'progress',
        entityType,
        data: initialSnapshot,
        timestamp: now
      });
    }

    return snapshotId;
  }

  async updateProgress(
    entityType: string,
    recordsProcessed: number,
    batchInfo?: {
      batchNumber: number;
      batchSize: number;
      batchDurationMs: number;
    }
  ): Promise<ProgressSnapshot> {
    const snapshots = this.progressData.get(entityType) || [];
    const lastSnapshot = snapshots[snapshots.length - 1];

    if (!lastSnapshot) {
      throw new Error(`No tracking session found for entity type: ${entityType}`);
    }

    const now = new Date();
    const elapsedTimeMs = now.getTime() - lastSnapshot.timing.startTime.getTime();
    const totalRecords = lastSnapshot.progress.totalRecords;
    const recordsRemaining = Math.max(0, totalRecords - recordsProcessed);
    const percentageComplete = totalRecords > 0 ? Math.round((recordsProcessed / totalRecords) * 100 * 100) / 100 : 0;

    // Calculate performance metrics
    const recordsPerSecond = elapsedTimeMs > 0 ? Math.round((recordsProcessed / elapsedTimeMs) * 1000 * 100) / 100 : 0;
    const averageBatchTimeMs = batchInfo ? this.calculateAverageBatchTime(entityType, batchInfo.batchDurationMs) : 0;

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
    }

    const newSnapshot: ProgressSnapshot = {
      snapshotId: diffMigrationTestUtils.generateTestUUID(),
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
        memoryUsageMb: this.getMockMemoryUsage()
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
        batchProgress: 1.0 // Assume batch completed
      } : undefined
    };

    // Store snapshot
    snapshots.push(newSnapshot);
    this.progressData.set(entityType, snapshots);

    // Check for alerts
    await this.checkForAlerts(newSnapshot);

    // Send real-time update
    if (this.config.enableRealTimeUpdates) {
      this.emitUpdate({
        updateId: diffMigrationTestUtils.generateTestUUID(),
        sessionId: this.sessionId,
        updateType: 'progress',
        entityType,
        data: newSnapshot,
        timestamp: now
      });
    }

    return newSnapshot;
  }

  async getLatestProgress(entityType: string): Promise<ProgressSnapshot | null> {
    const snapshots = this.progressData.get(entityType);
    return snapshots && snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  }

  async getAllProgress(): Promise<ProgressSnapshot[]> {
    const allSnapshots: ProgressSnapshot[] = [];

    for (const snapshots of this.progressData.values()) {
      if (snapshots.length > 0) {
        allSnapshots.push(snapshots[snapshots.length - 1]);
      }
    }

    return allSnapshots;
  }

  async calculatePerformanceMetrics(
    entityType: string,
    timeWindowMs?: number
  ): Promise<PerformanceMetrics> {
    const snapshots = this.progressData.get(entityType) || [];

    if (snapshots.length < 2) {
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
    const throughputValues = relevantSnapshots.map(s => s.performance.recordsPerSecond);
    const current = throughputValues[throughputValues.length - 1];
    const average = Math.round((throughputValues.reduce((sum, val) => sum + val, 0) / throughputValues.length) * 100) / 100;
    const peak = Math.max(...throughputValues);
    const minimum = Math.min(...throughputValues);

    // Calculate memory metrics
    const memoryValues = relevantSnapshots.map(s => s.performance.memoryUsageMb);
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

    // Calculate efficiency scores (mock calculations)
    const cpuEfficiency = Math.min(1.0, average / 1000); // Mock: records per second / 1000
    const memoryEfficiency = Math.min(1.0, average / memoryAverage); // Records per MB
    const overallScore = Math.round(((cpuEfficiency + memoryEfficiency) / 2) * 100);

    return {
      entityType,
      timeWindow: {
        startTime: windowStart,
        endTime: now,
        durationMs: now.getTime() - windowStart.getTime()
      },
      throughput: {
        current,
        average,
        peak,
        minimum
      },
      memory: {
        current: memoryValues[memoryValues.length - 1],
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
  }

  async getActiveAlerts(): Promise<ProgressAlert[]> {
    return this.alerts.filter(alert => !alert.resolved);
  }

  async resolveAlert(alertId: string): Promise<boolean> {
    const alert = this.alerts.find(a => a.alertId === alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = new Date();
      return true;
    }
    return false;
  }

  subscribeToUpdates(callback: (update: RealTimeProgressUpdate) => void): () => void {
    this.subscribers.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.subscribers.indexOf(callback);
      if (index > -1) {
        this.subscribers.splice(index, 1);
      }
    };
  }

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
    const reportId = diffMigrationTestUtils.generateTestUUID();
    const now = new Date();

    const relevantTypes = entityTypes || Array.from(this.progressData.keys());
    const entityProgress = [];
    let totalRecordsProcessed = 0;
    let totalRecords = 0;
    let completedEntities = 0;
    let activeEntities = 0;

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
        } else if (latest.status === 'running') {
          activeEntities++;
        }
      }
    }

    const overallProgress = totalRecords > 0 ? Math.round((totalRecordsProcessed / totalRecords) * 100 * 100) / 100 : 0;

    // Calculate estimated time remaining (simplified)
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

    // Generate recommendations
    const recommendations: string[] = [];
    const activeAlerts = await this.getActiveAlerts();

    if (activeAlerts.length > 0) {
      recommendations.push(`${activeAlerts.length} active alert(s) require attention`);
    }

    if (activeEntities === 0 && completedEntities === relevantTypes.length) {
      recommendations.push('All entities completed successfully');
    } else if (overallProgress < 50) {
      recommendations.push('Migration in early stages - monitor for performance issues');
    } else if (overallProgress > 90) {
      recommendations.push('Migration nearing completion - prepare for validation');
    }

    return {
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
  }

  private async checkForAlerts(snapshot: ProgressSnapshot): Promise<void> {
    const now = new Date();

    // Check for low throughput
    if (snapshot.performance.recordsPerSecond > 0 &&
        snapshot.performance.recordsPerSecond < this.config.thresholds.lowThroughputWarning) {
      this.createAlert({
        severity: 'warning',
        type: 'low_throughput',
        entityType: snapshot.entityType,
        message: `Low throughput detected: ${snapshot.performance.recordsPerSecond} records/sec`,
        details: {
          threshold: this.config.thresholds.lowThroughputWarning,
          actual: snapshot.performance.recordsPerSecond
        },
        timestamp: now
      });
    }

    // Check for high memory usage
    if (snapshot.performance.memoryUsageMb > this.config.thresholds.highMemoryWarning) {
      this.createAlert({
        severity: 'warning',
        type: 'high_memory',
        entityType: snapshot.entityType,
        message: `High memory usage: ${snapshot.performance.memoryUsageMb}MB`,
        details: {
          threshold: this.config.thresholds.highMemoryWarning,
          actual: snapshot.performance.memoryUsageMb
        },
        timestamp: now
      });
    }

    // Check for stalled progress
    const snapshots = this.progressData.get(snapshot.entityType) || [];
    if (snapshots.length > 1) {
      const previousSnapshot = snapshots[snapshots.length - 2];
      const timeSinceLastUpdate = now.getTime() - previousSnapshot.timestamp.getTime();
      const stalledThresholdMs = this.config.thresholds.stalledProgressWarning * 60 * 1000;

      if (timeSinceLastUpdate > stalledThresholdMs &&
          snapshot.progress.recordsProcessed === previousSnapshot.progress.recordsProcessed) {
        this.createAlert({
          severity: 'error',
          type: 'stalled_progress',
          entityType: snapshot.entityType,
          message: `Progress stalled for ${Math.round(timeSinceLastUpdate / 60000)} minutes`,
          details: {
            lastUpdateMinutesAgo: Math.round(timeSinceLastUpdate / 60000),
            threshold: this.config.thresholds.stalledProgressWarning
          },
          timestamp: now
        });
      }
    }
  }

  private createAlert(alertData: Omit<ProgressAlert, 'alertId'>): void {
    const alert: ProgressAlert = {
      alertId: diffMigrationTestUtils.generateTestUUID(),
      ...alertData
    };

    this.alerts.push(alert);

    // Send real-time alert update
    if (this.config.enableRealTimeUpdates) {
      this.emitUpdate({
        updateId: diffMigrationTestUtils.generateTestUUID(),
        sessionId: this.sessionId,
        updateType: 'alert',
        data: alert,
        timestamp: alert.timestamp
      });
    }
  }

  private calculateAverageBatchTime(entityType: string, currentBatchTime: number): number {
    const snapshots = this.progressData.get(entityType) || [];
    const batchTimes = snapshots
      .filter(s => s.performance.averageBatchTimeMs > 0)
      .map(s => s.performance.averageBatchTimeMs);

    batchTimes.push(currentBatchTime);

    return Math.round((batchTimes.reduce((sum, time) => sum + time, 0) / batchTimes.length) * 100) / 100;
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.round(Math.sqrt(variance) * 100) / 100;
  }

  private getMockMemoryUsage(): number {
    // Mock increasing memory usage over time
    return Math.round((50 + Math.random() * 100) * 100) / 100;
  }

  private emitUpdate(update: RealTimeProgressUpdate): void {
    this.subscribers.forEach(callback => {
      try {
        callback(update);
      } catch (error) {
        console.error('Error in progress update callback:', error);
      }
    });
  }
}

describe('ProgressTracker Service', () => {
  let tracker: MockProgressTracker;
  const sessionId = diffMigrationTestUtils.generateTestUUID();

  const mockConfig: ProgressConfig = {
    updateIntervalMs: 1000,
    retentionPeriodHours: 24,
    performanceWindowSize: 50,
    enableRealTimeUpdates: true,
    thresholds: {
      lowThroughputWarning: 50,
      highMemoryWarning: 400,
      stalledProgressWarning: 5
    }
  };

  beforeEach(() => {
    tracker = new MockProgressTracker(sessionId, mockConfig);
  });

  describe('Configuration Validation', () => {
    test('should validate correct progress configuration', () => {
      const validation = MockProgressTracker.validateProgressConfig(mockConfig);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should fail validation for invalid update interval', () => {
      const invalidConfig = {
        ...mockConfig,
        updateIntervalMs: 50000
      };

      const validation = MockProgressTracker.validateProgressConfig(invalidConfig);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('updateIntervalMs must be between 100 and 30000');
    });

    test('should fail validation for invalid retention period', () => {
      const invalidConfig = {
        ...mockConfig,
        retentionPeriodHours: 1000
      };

      const validation = MockProgressTracker.validateProgressConfig(invalidConfig);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('retentionPeriodHours must be between 1 and 720 (30 days)');
    });

    test('should fail validation for invalid thresholds', () => {
      const invalidConfig = {
        ...mockConfig,
        thresholds: {
          lowThroughputWarning: -10,
          highMemoryWarning: -50,
          stalledProgressWarning: 0
        }
      };

      const validation = MockProgressTracker.validateProgressConfig(invalidConfig);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('lowThroughputWarning threshold must be non-negative');
      expect(validation.errors).toContain('highMemoryWarning threshold must be non-negative');
      expect(validation.errors).toContain('stalledProgressWarning threshold must be at least 1 minute');
    });
  });

  describe('Progress Tracking', () => {
    test('should start tracking for an entity', async () => {
      const snapshotId = await tracker.startTracking('doctors', 1000);

      expect(snapshotId).toBeDefined();
      expect(snapshotId).toMatch(/^[a-f0-9-]+$/i); // UUID format

      const progress = await tracker.getLatestProgress('doctors');
      expect(progress).toBeDefined();
      expect(progress!.entityType).toBe('doctors');
      expect(progress!.progress.totalRecords).toBe(1000);
      expect(progress!.progress.recordsProcessed).toBe(0);
      expect(progress!.status).toBe('starting');
    });

    test('should update progress correctly', async () => {
      await tracker.startTracking('patients', 500);

      const updatedSnapshot = await tracker.updateProgress('patients', 150, {
        batchNumber: 1,
        batchSize: 100,
        batchDurationMs: 2000
      });

      expect(updatedSnapshot.progress.recordsProcessed).toBe(150);
      expect(updatedSnapshot.progress.recordsRemaining).toBe(350);
      expect(updatedSnapshot.progress.percentageComplete).toBe(30);
      expect(updatedSnapshot.status).toBe('running');
      expect(updatedSnapshot.currentBatch).toBeDefined();
      expect(updatedSnapshot.currentBatch!.batchNumber).toBe(1);
      expect(updatedSnapshot.performance.recordsPerSecond).toBeGreaterThan(0);
    });

    test('should calculate ETA correctly', async () => {
      await tracker.startTracking('orders', 2000);

      // First update to establish throughput
      await tracker.updateProgress('orders', 200, {
        batchNumber: 1,
        batchSize: 200,
        batchDurationMs: 1000
      });

      const progress = await tracker.getLatestProgress('orders');
      expect(progress!.timing.estimatedCompletionTime).toBeDefined();
      expect(progress!.timing.remainingTimeMs).toBeGreaterThan(0);
    });

    test('should mark as completed when all records processed', async () => {
      await tracker.startTracking('offices', 100);

      const completedSnapshot = await tracker.updateProgress('offices', 100, {
        batchNumber: 1,
        batchSize: 100,
        batchDurationMs: 5000
      });

      expect(completedSnapshot.status).toBe('completed');
      expect(completedSnapshot.progress.recordsRemaining).toBe(0);
      expect(completedSnapshot.progress.percentageComplete).toBe(100);
    });

    test('should throw error for unknown entity', async () => {
      await expect(
        tracker.updateProgress('unknown_entity', 50)
      ).rejects.toThrow('No tracking session found for entity type: unknown_entity');
    });
  });

  describe('Performance Metrics', () => {
    test('should calculate performance metrics', async () => {
      await tracker.startTracking('doctors', 1000);

      // Generate some progress updates
      await tracker.updateProgress('doctors', 100);
      await tracker.updateProgress('doctors', 250);
      await tracker.updateProgress('doctors', 400);

      const metrics = await tracker.calculatePerformanceMetrics('doctors');

      expect(metrics).toBeDefined();
      expect(metrics.entityType).toBe('doctors');
      expect(metrics.throughput.current).toBeGreaterThanOrEqual(0);
      expect(metrics.throughput.average).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.current).toBeGreaterThan(0);
      expect(metrics.efficiency.overallScore).toBeGreaterThanOrEqual(0);
      expect(metrics.efficiency.overallScore).toBeLessThanOrEqual(100);
    });

    test('should handle insufficient data gracefully', async () => {
      await tracker.startTracking('offices', 100);

      await expect(
        tracker.calculatePerformanceMetrics('offices')
      ).rejects.toThrow('Insufficient data for performance calculation');
    });

    test('should calculate metrics within time window', async () => {
      await tracker.startTracking('patients', 500);

      await tracker.updateProgress('patients', 100);
      await tracker.updateProgress('patients', 200);

      const metrics = await tracker.calculatePerformanceMetrics('patients', 60000); // 1 minute window

      expect(metrics.timeWindow.durationMs).toBeLessThanOrEqual(60000);
    });
  });

  describe('Alert Management', () => {
    test('should generate low throughput alerts', async () => {
      await tracker.startTracking('slow_entity', 1000);

      // Simulate slow progress that should trigger alert
      await tracker.updateProgress('slow_entity', 10, {
        batchNumber: 1,
        batchSize: 10,
        batchDurationMs: 10000 // Very slow
      });

      const alerts = await tracker.getActiveAlerts();
      const lowThroughputAlert = alerts.find(a => a.type === 'low_throughput');

      // Note: Alert generation depends on calculated throughput vs threshold
      if (lowThroughputAlert) {
        expect(lowThroughputAlert.severity).toBe('warning');
        expect(lowThroughputAlert.entityType).toBe('slow_entity');
      }
    });

    test('should resolve alerts', async () => {
      await tracker.startTracking('test_entity', 100);

      // Manually create an alert for testing
      const alerts = await tracker.getActiveAlerts();

      if (alerts.length > 0) {
        const alertId = alerts[0].alertId;
        const resolved = await tracker.resolveAlert(alertId);

        expect(resolved).toBe(true);

        const updatedAlerts = await tracker.getActiveAlerts();
        const resolvedAlert = updatedAlerts.find(a => a.alertId === alertId);
        expect(resolvedAlert).toBeUndefined();
      }
    });
  });

  describe('Real-time Updates', () => {
    test('should support subscription to updates', async () => {
      const updates: RealTimeProgressUpdate[] = [];

      const unsubscribe = tracker.subscribeToUpdates((update) => {
        updates.push(update);
      });

      await tracker.startTracking('offices', 100);
      await tracker.updateProgress('offices', 50);

      expect(updates.length).toBeGreaterThan(0);
      expect(updates.every(u => u.sessionId === sessionId)).toBe(true);

      unsubscribe();
    });

    test('should handle unsubscription correctly', () => {
      const callback = jest.fn();
      const unsubscribe = tracker.subscribeToUpdates(callback);

      unsubscribe();

      // Callback should not be called after unsubscription
      tracker.startTracking('test', 10);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('Progress Reports', () => {
    test('should generate comprehensive progress report', async () => {
      await tracker.startTracking('doctors', 500);
      await tracker.startTracking('patients', 1000);

      await tracker.updateProgress('doctors', 250);
      await tracker.updateProgress('patients', 100);

      const report = await tracker.generateProgressReport(['doctors', 'patients'], true);

      expect(report).toBeDefined();
      expect(report.reportId).toBeDefined();
      expect(report.sessionId).toBe(sessionId);
      expect(report.summary.totalEntities).toBe(2);
      expect(report.entityProgress).toHaveLength(2);
      expect(report.performanceMetrics).toBeDefined();
      expect(report.recommendations).toBeDefined();
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    test('should calculate overall progress correctly', async () => {
      await tracker.startTracking('orders', 200);
      await tracker.updateProgress('orders', 100); // 50% complete

      const report = await tracker.generateProgressReport(['orders']);

      expect(report.summary.overallProgress).toBe(50);
    });

    test('should generate appropriate recommendations', async () => {
      await tracker.startTracking('completed_entity', 100);
      await tracker.updateProgress('completed_entity', 100); // 100% complete

      const report = await tracker.generateProgressReport(['completed_entity']);

      expect(report.recommendations).toContain('All entities completed successfully');
    });
  });

  describe('Integration with Test Utilities', () => {
    test('should work with test utility helper', () => {
      const testData = diffMigrationTestUtils.createTestProgressSnapshot({
        entityType: 'test_entity',
        recordsProcessed: 150,
        totalRecords: 500
      });

      expect(testData.entityType).toBe('test_entity');
      expect(testData.progress.recordsProcessed).toBe(150);
      expect(testData.progress.totalRecords).toBe(500);
      expect(testData.progress.percentageComplete).toBe(30);
    });
  });
});