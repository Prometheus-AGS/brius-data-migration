/**
 * Performance Optimization Service
 *
 * Integrates performance monitoring, memory optimization, and connection pool tuning
 * to provide comprehensive performance management for differential migration operations
 */

import { EventEmitter } from 'events';
import { PerformanceMonitor, type PerformanceMetrics, type PerformanceAlert } from '../lib/performance-monitor';
import { MemoryOptimizer, type MemoryMetrics, type MemoryOptimizationRecommendation } from '../lib/memory-optimizer';
import { OptimizedConnectionPool, type ConnectionPoolMetrics, type OptimizationResult } from '../lib/connection-pool-optimizer';
import { Pool, PoolConfig } from 'pg';

export interface PerformanceOptimizationConfig {
  // Performance monitoring
  enablePerformanceMonitoring: boolean;
  performanceThresholds: {
    maxMemoryUsageMB: number;
    minThroughputPerSecond: number;
    maxErrorRate: number;
    maxResponseTimeMs: number;
    maxCpuUsagePercent: number;
  };

  // Memory optimization
  memoryOptimization: {
    enabled: boolean;
    lowMemoryThreshold: number;
    highMemoryThreshold: number;
    criticalMemoryThreshold: number;
    enableAutoGC: boolean;
    streamingThreshold: number;
  };

  // Connection pool optimization
  connectionPoolOptimization: {
    enabled: boolean;
    dynamicSizing: boolean;
    autoOptimize: boolean;
    targetUtilization: number;
    maxWaitTime: number;
  };

  // Batch processing optimization
  batchProcessing: {
    baseBatchSize: number;
    adaptiveBatchSizing: boolean;
    maxBatchSize: number;
    minBatchSize: number;
  };

  // Reporting and alerting
  reporting: {
    enableRealTimeMetrics: boolean;
    metricsUpdateInterval: number;
    enableAlerting: boolean;
    alertThresholds: {
      criticalMemoryUsage: number;
      lowThroughput: number;
      highErrorRate: number;
    };
  };
}

export interface OptimizationSummary {
  timestamp: Date;
  performanceMetrics: PerformanceMetrics;
  memoryMetrics: MemoryMetrics;
  connectionPoolMetrics: ConnectionPoolMetrics;

  currentOptimizations: {
    batchSize: number;
    parallelism: number;
    connectionPoolSize: number;
    memoryConfiguration: string;
  };

  recommendations: {
    performance: string[];
    memory: MemoryOptimizationRecommendation[];
    connectionPool: OptimizationResult | null;
    immediate: string[];
    longTerm: string[];
  };

  alerts: PerformanceAlert[];
  healthStatus: 'optimal' | 'good' | 'warning' | 'critical';
}

export interface MigrationPerformanceProfile {
  entityType: string;
  optimalBatchSize: number;
  optimalParallelism: number;
  avgRecordsPerSecond: number;
  avgMemoryUsage: number;
  errorRate: number;
  recommendations: string[];
}

/**
 * Performance Optimization Service
 *
 * Main service that coordinates all performance optimization components
 */
export class PerformanceOptimizationService extends EventEmitter {
  private config: PerformanceOptimizationConfig;
  private performanceMonitor: PerformanceMonitor;
  private memoryOptimizer: MemoryOptimizer;
  private connectionPool: OptimizedConnectionPool;

  private migrationProfiles: Map<string, MigrationPerformanceProfile> = new Map();
  private currentBatchSize: number;
  private currentParallelism: number;
  private optimizationTimer?: NodeJS.Timeout;

  private readonly DEFAULT_CONFIG: PerformanceOptimizationConfig = {
    enablePerformanceMonitoring: true,
    performanceThresholds: {
      maxMemoryUsageMB: 512,
      minThroughputPerSecond: 50,
      maxErrorRate: 5.0,
      maxResponseTimeMs: 5000,
      maxCpuUsagePercent: 80
    },
    memoryOptimization: {
      enabled: true,
      lowMemoryThreshold: 256,
      highMemoryThreshold: 512,
      criticalMemoryThreshold: 1024,
      enableAutoGC: true,
      streamingThreshold: 10000
    },
    connectionPoolOptimization: {
      enabled: true,
      dynamicSizing: true,
      autoOptimize: true,
      targetUtilization: 0.7,
      maxWaitTime: 5000
    },
    batchProcessing: {
      baseBatchSize: 500,
      adaptiveBatchSizing: true,
      maxBatchSize: 2000,
      minBatchSize: 50
    },
    reporting: {
      enableRealTimeMetrics: true,
      metricsUpdateInterval: 5000,
      enableAlerting: true,
      alertThresholds: {
        criticalMemoryUsage: 1024,
        lowThroughput: 25,
        highErrorRate: 10.0
      }
    }
  };

  constructor(
    sourceDbConfig: PoolConfig,
    destinationDbConfig: PoolConfig,
    config?: Partial<PerformanceOptimizationConfig>
  ) {
    super();

    this.config = { ...this.DEFAULT_CONFIG, ...config };
    this.currentBatchSize = this.config.batchProcessing.baseBatchSize;
    this.currentParallelism = 2; // Default parallelism

    // Initialize performance monitoring
    this.performanceMonitor = new PerformanceMonitor(this.config.performanceThresholds);

    // Initialize memory optimization
    this.memoryOptimizer = new MemoryOptimizer(this.config.memoryOptimization);

    // Initialize connection pool optimization
    this.connectionPool = new OptimizedConnectionPool(
      sourceDbConfig,
      destinationDbConfig,
      this.config.connectionPoolOptimization
    );

    this.setupEventHandlers();
    this.startOptimizationMonitoring();
  }

  private setupEventHandlers(): void {
    // Performance monitor events
    this.performanceMonitor.on('performance_alert', (alert: PerformanceAlert) => {
      this.handlePerformanceAlert(alert);
    });

    this.performanceMonitor.on('metrics_updated', (metrics: PerformanceMetrics) => {
      if (this.config.reporting.enableRealTimeMetrics) {
        this.emit('performance_metrics', metrics);
      }
    });

    // Memory optimizer events
    this.memoryOptimizer.on('memory_critical', (data) => {
      this.handleCriticalMemoryUsage(data);
    });

    this.memoryOptimizer.on('memory_warning', (data) => {
      this.handleMemoryWarning(data);
    });

    this.memoryOptimizer.on('memory_leak_detected', (data) => {
      this.emit('memory_leak_alert', data);
    });

    // Connection pool events
    this.connectionPool.on('pool_optimized', (result: OptimizationResult) => {
      this.emit('pool_optimization', result);
    });

    this.connectionPool.on('pool_error', (error) => {
      this.emit('connection_pool_error', error);
    });
  }

  private startOptimizationMonitoring(): void {
    if (this.config.reporting.enableRealTimeMetrics) {
      this.optimizationTimer = setInterval(() => {
        this.performContinuousOptimization();
      }, this.config.reporting.metricsUpdateInterval);
    }
  }

  private async performContinuousOptimization(): Promise<void> {
    try {
      // Get current metrics
      const performanceMetrics = this.performanceMonitor.getMetrics();
      const memoryMetrics = this.memoryOptimizer.getMetrics();
      const connectionPoolMetrics = this.connectionPool.getMetrics();

      // Adaptive batch size optimization
      if (this.config.batchProcessing.adaptiveBatchSizing) {
        this.optimizeBatchSize(performanceMetrics, memoryMetrics);
      }

      // Connection pool optimization
      if (this.config.connectionPoolOptimization.enabled) {
        await this.connectionPool.forceOptimization();
        this.connectionPool.updateThroughput(performanceMetrics.recordsPerSecond);
      }

      // Generate optimization summary
      const summary = this.generateOptimizationSummary();
      this.emit('optimization_summary', summary);

    } catch (error) {
      this.emit('optimization_error', error);
    }
  }

  private optimizeBatchSize(performanceMetrics: PerformanceMetrics, memoryMetrics: MemoryMetrics): void {
    const optimalBatchSize = this.memoryOptimizer.getOptimalBatchSize(
      this.currentBatchSize,
      1024 // Estimated record size in bytes
    );

    // Consider throughput in batch size optimization
    if (performanceMetrics.recordsPerSecond < this.config.performanceThresholds.minThroughputPerSecond) {
      // Low throughput - try increasing batch size if memory allows
      if (memoryMetrics.memoryPressure === 'low' || memoryMetrics.memoryPressure === 'medium') {
        const increasedBatchSize = Math.min(
          this.currentBatchSize * 1.2,
          this.config.batchProcessing.maxBatchSize
        );
        if (increasedBatchSize !== this.currentBatchSize) {
          this.currentBatchSize = Math.floor(increasedBatchSize);
          this.emit('batch_size_optimized', {
            previousSize: this.currentBatchSize,
            newSize: this.currentBatchSize,
            reason: 'Increased for better throughput',
            memoryPressure: memoryMetrics.memoryPressure
          });
        }
      }
    }

    // Use memory-optimized batch size if different from current
    if (optimalBatchSize !== this.currentBatchSize && Math.abs(optimalBatchSize - this.currentBatchSize) > 10) {
      const previousSize = this.currentBatchSize;
      this.currentBatchSize = Math.max(
        this.config.batchProcessing.minBatchSize,
        Math.min(optimalBatchSize, this.config.batchProcessing.maxBatchSize)
      );

      this.emit('batch_size_optimized', {
        previousSize,
        newSize: this.currentBatchSize,
        reason: `Memory optimization (pressure: ${memoryMetrics.memoryPressure})`,
        memoryPressure: memoryMetrics.memoryPressure
      });
    }
  }

  private handlePerformanceAlert(alert: PerformanceAlert): void {
    this.emit('performance_alert', alert);

    // Automatic responses to critical alerts
    if (alert.severity === 'critical') {
      switch (alert.type) {
        case 'memory':
          this.memoryOptimizer.forceGarbageCollection();
          this.currentBatchSize = Math.max(
            this.config.batchProcessing.minBatchSize,
            Math.floor(this.currentBatchSize * 0.5)
          );
          break;

        case 'throughput':
          if (this.currentParallelism < 4) {
            this.currentParallelism++;
          }
          break;

        case 'error':
          // Reduce batch size and parallelism for error recovery
          this.currentBatchSize = Math.max(
            this.config.batchProcessing.minBatchSize,
            Math.floor(this.currentBatchSize * 0.7)
          );
          this.currentParallelism = Math.max(1, this.currentParallelism - 1);
          break;
      }
    }
  }

  private handleCriticalMemoryUsage(data: any): void {
    // Immediate response to critical memory usage
    this.memoryOptimizer.forceGarbageCollection();

    // Drastically reduce batch size
    this.currentBatchSize = Math.max(
      this.config.batchProcessing.minBatchSize,
      Math.floor(this.currentBatchSize * 0.3)
    );

    // Reduce parallelism to minimum
    this.currentParallelism = 1;

    this.emit('critical_memory_response', {
      action: 'Emergency optimization',
      newBatchSize: this.currentBatchSize,
      newParallelism: this.currentParallelism,
      memoryUsage: data.currentUsage
    });
  }

  private handleMemoryWarning(data: any): void {
    // Gradual response to memory warnings
    this.currentBatchSize = Math.max(
      this.config.batchProcessing.minBatchSize,
      Math.floor(this.currentBatchSize * 0.8)
    );

    this.emit('memory_warning_response', {
      action: 'Preventive optimization',
      newBatchSize: this.currentBatchSize,
      memoryUsage: data.currentUsage
    });
  }

  /**
   * Record batch completion for performance tracking
   */
  recordBatchCompletion(entityType: string, recordCount: number, processingTimeMs: number): void {
    this.performanceMonitor.recordBatchCompletion(recordCount, processingTimeMs);

    // Update or create performance profile for entity
    const throughput = recordCount / (processingTimeMs / 1000);
    const memoryUsage = this.memoryOptimizer.getMetrics().heapUsed;

    if (this.migrationProfiles.has(entityType)) {
      const profile = this.migrationProfiles.get(entityType)!;
      profile.avgRecordsPerSecond = (profile.avgRecordsPerSecond + throughput) / 2;
      profile.avgMemoryUsage = (profile.avgMemoryUsage + memoryUsage) / 2;
    } else {
      this.migrationProfiles.set(entityType, {
        entityType,
        optimalBatchSize: this.currentBatchSize,
        optimalParallelism: this.currentParallelism,
        avgRecordsPerSecond: throughput,
        avgMemoryUsage: memoryUsage,
        errorRate: 0,
        recommendations: []
      });
    }
  }

  /**
   * Record error occurrence
   */
  recordError(entityType: string, errorType: string, retryable: boolean = false): void {
    this.performanceMonitor.recordError(errorType, retryable);

    // Update error rate in performance profile
    if (this.migrationProfiles.has(entityType)) {
      const profile = this.migrationProfiles.get(entityType)!;
      profile.errorRate = (profile.errorRate + 1) / 2; // Simplified error rate calculation
    }
  }

  /**
   * Get current optimization configuration
   */
  getCurrentOptimization(): {
    batchSize: number;
    parallelism: number;
    connectionPoolSize: number;
    memoryConfiguration: string;
  } {
    const poolStatus = this.connectionPool.getPoolStatus();
    const memoryMetrics = this.memoryOptimizer.getMetrics();

    return {
      batchSize: this.currentBatchSize,
      parallelism: this.currentParallelism,
      connectionPoolSize: poolStatus.source.totalCount + poolStatus.destination.totalCount,
      memoryConfiguration: `${memoryMetrics.memoryPressure} pressure (${memoryMetrics.heapUsed.toFixed(1)}MB)`
    };
  }

  /**
   * Generate comprehensive optimization summary
   */
  generateOptimizationSummary(): OptimizationSummary {
    const performanceMetrics = this.performanceMonitor.getMetrics();
    const memoryMetrics = this.memoryOptimizer.getMetrics();
    const connectionPoolMetrics = this.connectionPool.getMetrics();

    // Generate recommendations
    const performanceRecs = this.performanceMonitor.getOptimizationRecommendations({
      batchSize: this.currentBatchSize,
      parallelism: this.currentParallelism,
      connectionPoolSize: connectionPoolMetrics.totalConnections
    });

    const memoryRecs = this.memoryOptimizer.generateRecommendations();
    const poolOptimization = null; // Would be filled by pool optimizer

    // Determine health status
    let healthStatus: 'optimal' | 'good' | 'warning' | 'critical' = 'optimal';

    if (performanceMetrics.peakMemoryUsageMb > this.config.performanceThresholds.maxMemoryUsageMB ||
        performanceMetrics.errorRate > this.config.performanceThresholds.maxErrorRate) {
      healthStatus = 'critical';
    } else if (performanceMetrics.averageThroughput < this.config.performanceThresholds.minThroughputPerSecond ||
               memoryMetrics.memoryPressure === 'high') {
      healthStatus = 'warning';
    } else if (performanceMetrics.recordsPerSecond > this.config.performanceThresholds.minThroughputPerSecond * 1.5 &&
               memoryMetrics.memoryPressure === 'low') {
      healthStatus = 'optimal';
    } else {
      healthStatus = 'good';
    }

    // Compile immediate and long-term recommendations
    const immediateRecs: string[] = [];
    const longTermRecs: string[] = [];

    if (memoryMetrics.memoryPressure === 'critical') {
      immediateRecs.push('Force garbage collection and reduce batch size immediately');
    }
    if (performanceMetrics.errorRate > 10) {
      immediateRecs.push('Investigate and resolve data quality issues');
    }
    if (connectionPoolMetrics.connectionPoolUtilization > 0.9) {
      immediateRecs.push('Increase connection pool size to prevent bottlenecks');
    }

    longTermRecs.push('Consider upgrading system memory for better performance');
    longTermRecs.push('Implement automated scaling based on workload patterns');
    longTermRecs.push('Review and optimize database queries and indexes');

    return {
      timestamp: new Date(),
      performanceMetrics,
      memoryMetrics,
      connectionPoolMetrics,
      currentOptimizations: this.getCurrentOptimization(),
      recommendations: {
        performance: [
          performanceRecs.batchSize.reason,
          performanceRecs.parallelism.reason,
          performanceRecs.connectionPool.reason
        ],
        memory: memoryRecs,
        connectionPool: poolOptimization,
        immediate: immediateRecs,
        longTerm: longTermRecs
      },
      alerts: this.performanceMonitor.getAlerts(),
      healthStatus
    };
  }

  /**
   * Get performance profile for specific entity type
   */
  getEntityPerformanceProfile(entityType: string): MigrationPerformanceProfile | null {
    return this.migrationProfiles.get(entityType) || null;
  }

  /**
   * Get all performance profiles
   */
  getAllPerformanceProfiles(): MigrationPerformanceProfile[] {
    return Array.from(this.migrationProfiles.values());
  }

  /**
   * Execute query through optimized connection pool
   */
  async executeQuery(pool: 'source' | 'destination', query: string, params?: any[]): Promise<any> {
    return await this.connectionPool.query(pool, query, params);
  }

  /**
   * Execute transaction through optimized connection pool
   */
  async executeTransaction<T>(pool: 'source' | 'destination', callback: (client: any) => Promise<T>): Promise<T> {
    return await this.connectionPool.transaction(pool, callback);
  }

  /**
   * Create streaming processor with memory optimization
   */
  createOptimizedStreamingProcessor<T>(processor: {
    processChunk(chunk: T[]): Promise<void>;
    onComplete(): Promise<void>;
    onError(error: Error): Promise<void>;
  }) {
    return this.memoryOptimizer.createStreamingProcessor(this.currentBatchSize, processor);
  }

  /**
   * Get health check status
   */
  async getHealthCheck(): Promise<{
    overall: 'healthy' | 'warning' | 'critical';
    performance: 'good' | 'warning' | 'critical';
    memory: 'healthy' | 'warning' | 'critical';
    connectionPool: 'healthy' | 'warning' | 'critical';
    recommendations: string[];
  }> {
    const performanceMetrics = this.performanceMonitor.getMetrics();
    const memoryHealth = this.memoryOptimizer.getHealthStatus();
    const poolHealth = await this.connectionPool.healthCheck();

    const performance = performanceMetrics.errorRate > 10 ? 'critical' :
                       performanceMetrics.averageThroughput < this.config.performanceThresholds.minThroughputPerSecond ? 'warning' : 'good';

    const connectionPool = (!poolHealth.source.connected || !poolHealth.destination.connected) ? 'critical' :
                          (poolHealth.source.latency > 1000 || poolHealth.destination.latency > 1000) ? 'warning' : 'healthy';

    const overall = [performance, memoryHealth.status, connectionPool].includes('critical') ? 'critical' :
                   [performance, memoryHealth.status, connectionPool].includes('warning') ? 'warning' : 'healthy';

    const recommendations = [
      ...memoryHealth.recommendations,
      ...(performance === 'critical' ? ['Investigate performance bottlenecks immediately'] : []),
      ...(connectionPool === 'critical' ? ['Check database connectivity'] : [])
    ];

    return {
      overall,
      performance,
      memory: memoryHealth.status,
      connectionPool,
      recommendations
    };
  }

  /**
   * Stop all optimization processes and cleanup
   */
  async stop(): Promise<void> {
    if (this.optimizationTimer) {
      clearInterval(this.optimizationTimer);
    }

    this.performanceMonitor.stop();
    this.memoryOptimizer.stop();
    await this.connectionPool.close();

    this.removeAllListeners();
  }
}