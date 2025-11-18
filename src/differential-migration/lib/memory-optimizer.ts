/**
 * Memory Optimization Utility
 *
 * Implements memory management strategies for large-scale database migrations
 * including streaming processing, garbage collection optimization, and memory monitoring
 */

import { EventEmitter } from 'events';
import * as process from 'process';
import * as v8 from 'v8';

export interface MemoryMetrics {
  heapUsed: number;           // MB
  heapTotal: number;          // MB
  heapLimit: number;          // MB
  external: number;           // MB
  arrayBuffers: number;       // MB
  rss: number;               // MB (Resident Set Size)

  heapUtilization: number;    // 0.0 - 1.0
  memoryPressure: 'low' | 'medium' | 'high' | 'critical';

  gcStats: {
    collections: number;
    totalTime: number;        // milliseconds
    avgPauseTime: number;     // milliseconds
    lastCollection: Date | null;
  };
}

export interface MemoryOptimizationConfig {
  // Memory thresholds (MB)
  lowMemoryThreshold: number;
  highMemoryThreshold: number;
  criticalMemoryThreshold: number;

  // GC configuration
  enableAutoGC: boolean;
  gcIntervalMs: number;
  gcMemoryThreshold: number;    // MB

  // Streaming configuration
  streamingThreshold: number;   // Records count
  batchSizeReduction: number;   // Factor to reduce batch size

  // Memory leak detection
  enableLeakDetection: boolean;
  leakDetectionInterval: number; // ms
  memoryGrowthThreshold: number; // MB per minute
}

export interface StreamingProcessor<T> {
  processChunk(chunk: T[]): Promise<void>;
  onComplete(): Promise<void>;
  onError(error: Error): Promise<void>;
}

export interface MemoryOptimizationRecommendation {
  type: 'gc' | 'streaming' | 'batchSize' | 'poolSize' | 'system';
  priority: 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
  expectedImprovement: string;
  implementationSteps: string[];
  estimatedImpact: number; // MB memory savings
}

/**
 * Memory Optimizer
 *
 * Provides comprehensive memory management for migration operations
 */
export class MemoryOptimizer extends EventEmitter {
  private config: MemoryOptimizationConfig;
  private metrics: MemoryMetrics;
  private memoryHistory: number[] = [];
  private gcTimer?: NodeJS.Timeout;
  private leakDetectionTimer?: NodeJS.Timeout;
  private initialGCStats: any;

  private readonly DEFAULT_CONFIG: MemoryOptimizationConfig = {
    lowMemoryThreshold: 256,      // 256 MB
    highMemoryThreshold: 512,     // 512 MB
    criticalMemoryThreshold: 1024, // 1 GB
    enableAutoGC: true,
    gcIntervalMs: 30000,          // 30 seconds
    gcMemoryThreshold: 128,       // 128 MB
    streamingThreshold: 10000,     // 10K records
    batchSizeReduction: 0.5,      // Reduce by 50%
    enableLeakDetection: true,
    leakDetectionInterval: 60000,  // 1 minute
    memoryGrowthThreshold: 50     // 50 MB per minute
  };

  constructor(config?: Partial<MemoryOptimizationConfig>) {
    super();

    this.config = { ...this.DEFAULT_CONFIG, ...config };
    this.metrics = this.initializeMetrics();

    // Initialize GC monitoring
    try {
      this.initialGCStats = v8.getHeapStatistics();
    } catch (error) {
      console.warn('V8 heap statistics not available');
    }

    this.startMonitoring();
  }

  private initializeMetrics(): MemoryMetrics {
    const memUsage = process.memoryUsage();
    const heapStats = this.getHeapStatistics();

    return {
      heapUsed: memUsage.heapUsed / 1024 / 1024,
      heapTotal: memUsage.heapTotal / 1024 / 1024,
      heapLimit: heapStats.heap_size_limit / 1024 / 1024,
      external: memUsage.external / 1024 / 1024,
      arrayBuffers: memUsage.arrayBuffers / 1024 / 1024,
      rss: memUsage.rss / 1024 / 1024,
      heapUtilization: 0,
      memoryPressure: 'low',
      gcStats: {
        collections: 0,
        totalTime: 0,
        avgPauseTime: 0,
        lastCollection: null
      }
    };
  }

  private getHeapStatistics(): any {
    try {
      return v8.getHeapStatistics();
    } catch (error) {
      return {
        heap_size_limit: 1.4 * 1024 * 1024 * 1024, // Default 1.4GB limit
        total_heap_size: 0,
        used_heap_size: 0,
        malloced_memory: 0,
        peak_malloced_memory: 0
      };
    }
  }

  private startMonitoring(): void {
    // Update metrics every 5 seconds
    setInterval(() => {
      this.updateMetrics();
    }, 5000);

    if (this.config.enableAutoGC) {
      this.startAutoGC();
    }

    if (this.config.enableLeakDetection) {
      this.startLeakDetection();
    }
  }

  private updateMetrics(): void {
    const memUsage = process.memoryUsage();
    const heapStats = this.getHeapStatistics();

    this.metrics.heapUsed = memUsage.heapUsed / 1024 / 1024;
    this.metrics.heapTotal = memUsage.heapTotal / 1024 / 1024;
    this.metrics.heapLimit = heapStats.heap_size_limit / 1024 / 1024;
    this.metrics.external = memUsage.external / 1024 / 1024;
    this.metrics.arrayBuffers = memUsage.arrayBuffers / 1024 / 1024;
    this.metrics.rss = memUsage.rss / 1024 / 1024;

    this.metrics.heapUtilization = this.metrics.heapUsed / this.metrics.heapLimit;

    // Determine memory pressure
    if (this.metrics.heapUsed > this.config.criticalMemoryThreshold) {
      this.metrics.memoryPressure = 'critical';
    } else if (this.metrics.heapUsed > this.config.highMemoryThreshold) {
      this.metrics.memoryPressure = 'high';
    } else if (this.metrics.heapUsed > this.config.lowMemoryThreshold) {
      this.metrics.memoryPressure = 'medium';
    } else {
      this.metrics.memoryPressure = 'low';
    }

    // Track memory history for trend analysis
    this.memoryHistory.push(this.metrics.heapUsed);
    if (this.memoryHistory.length > 120) { // Keep last 2 hours at 1-minute intervals
      this.memoryHistory.shift();
    }

    // Emit metrics update
    this.emit('metrics_updated', this.metrics);

    // Check for memory pressure and emit alerts
    if (this.metrics.memoryPressure === 'critical') {
      this.emit('memory_critical', {
        currentUsage: this.metrics.heapUsed,
        threshold: this.config.criticalMemoryThreshold,
        recommendations: this.generateRecommendations()
      });
    } else if (this.metrics.memoryPressure === 'high') {
      this.emit('memory_warning', {
        currentUsage: this.metrics.heapUsed,
        threshold: this.config.highMemoryThreshold,
        recommendations: this.generateRecommendations()
      });
    }
  }

  private startAutoGC(): void {
    this.gcTimer = setInterval(() => {
      if (this.metrics.heapUsed > this.config.gcMemoryThreshold) {
        this.forceGarbageCollection();
      }
    }, this.config.gcIntervalMs);
  }

  private startLeakDetection(): void {
    this.leakDetectionTimer = setInterval(() => {
      this.detectMemoryLeaks();
    }, this.config.leakDetectionInterval);
  }

  private detectMemoryLeaks(): void {
    if (this.memoryHistory.length < 10) {
      return; // Need more data points
    }

    // Calculate memory growth rate (MB per minute)
    const recentHistory = this.memoryHistory.slice(-10);
    const oldestMemory = recentHistory[0];
    const newestMemory = recentHistory[recentHistory.length - 1];
    const timeSpanMinutes = (recentHistory.length - 1) * (this.config.leakDetectionInterval / 60000);

    const growthRate = (newestMemory - oldestMemory) / timeSpanMinutes;

    if (growthRate > this.config.memoryGrowthThreshold) {
      this.emit('memory_leak_detected', {
        growthRate,
        threshold: this.config.memoryGrowthThreshold,
        currentUsage: this.metrics.heapUsed,
        timeSpan: timeSpanMinutes,
        recommendations: [
          'Review recent code changes for potential memory leaks',
          'Check for unclosed resources (database connections, file handles)',
          'Monitor object retention and circular references',
          'Consider enabling detailed heap snapshots for analysis'
        ]
      });
    }
  }

  /**
   * Force garbage collection
   */
  forceGarbageCollection(): boolean {
    try {
      const beforeGC = process.memoryUsage();
      const gcStart = Date.now();

      if (global.gc) {
        global.gc();

        const gcTime = Date.now() - gcStart;
        const afterGC = process.memoryUsage();

        this.metrics.gcStats.collections++;
        this.metrics.gcStats.totalTime += gcTime;
        this.metrics.gcStats.avgPauseTime = this.metrics.gcStats.totalTime / this.metrics.gcStats.collections;
        this.metrics.gcStats.lastCollection = new Date();

        const memoryFreed = (beforeGC.heapUsed - afterGC.heapUsed) / 1024 / 1024;

        this.emit('gc_completed', {
          duration: gcTime,
          memoryFreed,
          beforeHeap: beforeGC.heapUsed / 1024 / 1024,
          afterHeap: afterGC.heapUsed / 1024 / 1024
        });

        return true;
      } else {
        this.emit('gc_unavailable', {
          message: 'Garbage collection not available. Start Node.js with --expose-gc flag.'
        });
        return false;
      }
    } catch (error) {
      this.emit('gc_error', error);
      return false;
    }
  }

  /**
   * Create streaming processor for large datasets
   */
  createStreamingProcessor<T>(
    chunkSize: number,
    processor: StreamingProcessor<T>
  ): {
    processStream: (data: T[]) => Promise<void>;
    getProcessingStats: () => {
      chunksProcessed: number;
      totalRecords: number;
      avgChunkTime: number;
      memoryUsagePattern: number[];
    };
  } {
    let chunksProcessed = 0;
    let totalRecords = 0;
    let chunkTimes: number[] = [];
    let memoryUsagePattern: number[] = [];

    const processStream = async (data: T[]): Promise<void> => {
      if (data.length <= this.config.streamingThreshold) {
        // Small dataset, process normally
        await processor.processChunk(data);
        return;
      }

      try {
        // Process in chunks to manage memory
        for (let i = 0; i < data.length; i += chunkSize) {
          const chunk = data.slice(i, i + chunkSize);
          const chunkStart = Date.now();
          const memoryBefore = this.metrics.heapUsed;

          await processor.processChunk(chunk);

          const chunkTime = Date.now() - chunkStart;
          chunkTimes.push(chunkTime);

          chunksProcessed++;
          totalRecords += chunk.length;

          // Track memory usage pattern
          const memoryAfter = process.memoryUsage().heapUsed / 1024 / 1024;
          memoryUsagePattern.push(memoryAfter - memoryBefore);

          // Force GC if memory pressure is high
          if (this.metrics.memoryPressure === 'high' || this.metrics.memoryPressure === 'critical') {
            this.forceGarbageCollection();
          }

          // Adaptive delay based on memory pressure
          if (this.metrics.memoryPressure === 'critical') {
            await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
          } else if (this.metrics.memoryPressure === 'high') {
            await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay
          }

          this.emit('chunk_processed', {
            chunkIndex: Math.floor(i / chunkSize),
            totalChunks: Math.ceil(data.length / chunkSize),
            recordsInChunk: chunk.length,
            processingTime: chunkTime,
            memoryUsage: memoryAfter
          });
        }

        await processor.onComplete();

      } catch (error) {
        await processor.onError(error);
        throw error;
      }
    };

    const getProcessingStats = () => ({
      chunksProcessed,
      totalRecords,
      avgChunkTime: chunkTimes.length > 0 ?
        chunkTimes.reduce((sum, time) => sum + time, 0) / chunkTimes.length : 0,
      memoryUsagePattern: [...memoryUsagePattern]
    });

    return { processStream, getProcessingStats };
  }

  /**
   * Get optimal batch size based on current memory conditions
   */
  getOptimalBatchSize(baseBatchSize: number, recordSize: number = 1024): number {
    const availableMemory = this.metrics.heapLimit - this.metrics.heapUsed;
    const memoryPerRecord = recordSize / 1024 / 1024; // Convert to MB

    // Conservative approach: use only 20% of available memory for batch
    const maxRecordsForMemory = Math.floor((availableMemory * 0.2) / memoryPerRecord);

    let optimalBatchSize = baseBatchSize;

    switch (this.metrics.memoryPressure) {
      case 'critical':
        optimalBatchSize = Math.min(baseBatchSize * 0.25, maxRecordsForMemory, 100);
        break;
      case 'high':
        optimalBatchSize = Math.min(baseBatchSize * 0.5, maxRecordsForMemory, 250);
        break;
      case 'medium':
        optimalBatchSize = Math.min(baseBatchSize * 0.75, maxRecordsForMemory, 500);
        break;
      case 'low':
        optimalBatchSize = Math.min(baseBatchSize, maxRecordsForMemory);
        break;
    }

    return Math.max(10, optimalBatchSize); // Minimum batch size of 10
  }

  /**
   * Generate memory optimization recommendations
   */
  generateRecommendations(): MemoryOptimizationRecommendation[] {
    const recommendations: MemoryOptimizationRecommendation[] = [];

    // GC recommendations
    if (!global.gc) {
      recommendations.push({
        type: 'gc',
        priority: 'high',
        recommendation: 'Enable garbage collection by starting Node.js with --expose-gc flag',
        expectedImprovement: 'Manual GC control for memory pressure situations',
        implementationSteps: [
          'Restart application with --expose-gc flag',
          'Enable automatic GC in memory optimizer configuration'
        ],
        estimatedImpact: 50
      });
    } else if (this.metrics.memoryPressure === 'high' || this.metrics.memoryPressure === 'critical') {
      recommendations.push({
        type: 'gc',
        priority: 'medium',
        recommendation: 'Increase garbage collection frequency during high memory pressure',
        expectedImprovement: 'Reduced memory usage and prevention of out-of-memory errors',
        implementationSteps: [
          'Reduce GC interval to 10-15 seconds',
          'Lower GC memory threshold to 64MB',
          'Force GC after large batch operations'
        ],
        estimatedImpact: 100
      });
    }

    // Streaming recommendations
    if (this.metrics.heapUsed > this.config.highMemoryThreshold) {
      recommendations.push({
        type: 'streaming',
        priority: 'high',
        recommendation: 'Enable streaming processing for large datasets',
        expectedImprovement: 'Constant memory usage regardless of dataset size',
        implementationSteps: [
          'Implement streaming processor for datasets > 10K records',
          'Process data in chunks of 500-1000 records',
          'Add memory pressure monitoring between chunks'
        ],
        estimatedImpact: 200
      });
    }

    // Batch size recommendations
    if (this.metrics.memoryPressure === 'high' || this.metrics.memoryPressure === 'critical') {
      recommendations.push({
        type: 'batchSize',
        priority: 'high',
        recommendation: 'Reduce batch size to lower memory pressure',
        expectedImprovement: 'Immediate reduction in memory usage per operation',
        implementationSteps: [
          `Reduce batch size by ${((1 - this.config.batchSizeReduction) * 100).toFixed(0)}%`,
          'Monitor throughput impact',
          'Gradually increase if memory permits'
        ],
        estimatedImpact: 75
      });
    }

    // System recommendations
    if (this.metrics.heapUtilization > 0.8) {
      recommendations.push({
        type: 'system',
        priority: 'critical',
        recommendation: 'Increase Node.js heap size or system memory',
        expectedImprovement: 'Higher memory ceiling and reduced out-of-memory risk',
        implementationSteps: [
          'Start Node.js with --max-old-space-size=4096 or higher',
          'Consider upgrading system memory',
          'Implement memory monitoring alerts'
        ],
        estimatedImpact: 500
      });
    }

    return recommendations;
  }

  /**
   * Get current memory metrics
   */
  getMetrics(): MemoryMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Get memory trend analysis
   */
  getMemoryTrend(): {
    trend: 'increasing' | 'decreasing' | 'stable';
    growthRate: number; // MB per minute
    projectedExhaustion?: Date;
  } {
    if (this.memoryHistory.length < 5) {
      return { trend: 'stable', growthRate: 0 };
    }

    // Calculate linear trend
    const n = this.memoryHistory.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = this.memoryHistory;

    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const growthRate = slope * (60000 / this.config.leakDetectionInterval); // Convert to MB per minute

    let trend: 'increasing' | 'decreasing' | 'stable';
    if (Math.abs(growthRate) < 1) {
      trend = 'stable';
    } else if (growthRate > 0) {
      trend = 'increasing';
    } else {
      trend = 'decreasing';
    }

    // Project memory exhaustion if trend is increasing
    let projectedExhaustion: Date | undefined;
    if (trend === 'increasing' && growthRate > 0) {
      const availableMemory = this.metrics.heapLimit - this.metrics.heapUsed;
      const minutesToExhaustion = availableMemory / growthRate;
      projectedExhaustion = new Date(Date.now() + minutesToExhaustion * 60000);
    }

    return {
      trend,
      growthRate,
      projectedExhaustion
    };
  }

  /**
   * Memory health check
   */
  getHealthStatus(): {
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (this.metrics.memoryPressure === 'critical') {
      issues.push(`Critical memory usage: ${this.metrics.heapUsed.toFixed(1)}MB`);
      recommendations.push('Immediately reduce batch sizes and force garbage collection');
    } else if (this.metrics.memoryPressure === 'high') {
      issues.push(`High memory usage: ${this.metrics.heapUsed.toFixed(1)}MB`);
      recommendations.push('Consider reducing batch sizes or enabling streaming');
    }

    if (this.metrics.heapUtilization > 0.9) {
      issues.push(`Heap utilization very high: ${(this.metrics.heapUtilization * 100).toFixed(1)}%`);
      recommendations.push('Increase heap size with --max-old-space-size flag');
    }

    const memoryTrend = this.getMemoryTrend();
    if (memoryTrend.trend === 'increasing' && memoryTrend.growthRate > 10) {
      issues.push(`Rapid memory growth: ${memoryTrend.growthRate.toFixed(1)}MB/min`);
      recommendations.push('Investigate potential memory leaks');
    }

    let status: 'healthy' | 'warning' | 'critical';
    if (this.metrics.memoryPressure === 'critical' || this.metrics.heapUtilization > 0.9) {
      status = 'critical';
    } else if (this.metrics.memoryPressure === 'high' || issues.length > 0) {
      status = 'warning';
    } else {
      status = 'healthy';
    }

    return { status, issues, recommendations };
  }

  /**
   * Stop monitoring and cleanup
   */
  stop(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
    }

    if (this.leakDetectionTimer) {
      clearInterval(this.leakDetectionTimer);
    }

    this.removeAllListeners();
  }
}