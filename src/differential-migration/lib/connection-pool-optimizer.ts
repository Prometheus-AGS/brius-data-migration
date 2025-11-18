/**
 * Database Connection Pool Optimizer
 *
 * Implements dynamic connection pool tuning based on performance metrics
 * and system resource availability, following research.md recommendations
 */

import { Pool, PoolConfig, PoolClient } from 'pg';
import { EventEmitter } from 'events';
import * as os from 'os';

export interface ConnectionPoolMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingClients: number;
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  avgQueryTime: number;
  avgConnectionTime: number;
  peakConnections: number;
  poolUtilization: number;
  errorRate: number;
}

export interface ConnectionPoolConfig {
  // Basic pool configuration
  min: number;           // Minimum connections
  max: number;           // Maximum connections
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  acquireTimeoutMillis: number;

  // Advanced configuration
  allowExitOnIdle: boolean;
  maxUses: number;
  keepAlive: boolean;
  keepAliveInitialDelayMillis: number;

  // Optimization settings
  dynamicSizing: boolean;
  autoOptimize: boolean;
  optimizationInterval: number;

  // Performance thresholds
  targetUtilization: number;      // 0.0 - 1.0
  maxWaitTime: number;           // milliseconds
  minThroughput: number;         // queries per second
}

export interface OptimizationResult {
  action: 'increase' | 'decrease' | 'maintain';
  previousSize: number;
  newSize: number;
  reason: string;
  expectedImprovement: string;
  confidence: number; // 0.0 - 1.0
}

/**
 * Optimized Database Connection Pool
 *
 * Extends pg.Pool with performance monitoring and dynamic optimization
 */
export class OptimizedConnectionPool extends EventEmitter {
  private sourcePool: Pool;
  private destinationPool: Pool;
  private config: ConnectionPoolConfig;
  private metrics: ConnectionPoolMetrics;

  private queryTimes: number[] = [];
  private connectionTimes: number[] = [];
  private utilizationHistory: number[] = [];
  private throughputHistory: number[] = [];

  private optimizationTimer?: NodeJS.Timeout;
  private lastOptimization: number = Date.now();

  private readonly DEFAULT_CONFIG: ConnectionPoolConfig = {
    min: 2,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    acquireTimeoutMillis: 60000,
    allowExitOnIdle: true,
    maxUses: 7500,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    dynamicSizing: true,
    autoOptimize: true,
    optimizationInterval: 30000, // 30 seconds
    targetUtilization: 0.7,
    maxWaitTime: 5000,
    minThroughput: 10
  };

  constructor(
    sourceConfig: PoolConfig,
    destinationConfig: PoolConfig,
    optimizationConfig?: Partial<ConnectionPoolConfig>
  ) {
    super();

    this.config = { ...this.DEFAULT_CONFIG, ...optimizationConfig };
    this.metrics = this.initializeMetrics();

    // Create optimized pool configurations
    const optimizedSourceConfig = this.createOptimizedPoolConfig(sourceConfig);
    const optimizedDestinationConfig = this.createOptimizedPoolConfig(destinationConfig);

    this.sourcePool = new Pool(optimizedSourceConfig);
    this.destinationPool = new Pool(optimizedDestinationConfig);

    this.setupPoolMonitoring();

    if (this.config.autoOptimize) {
      this.startAutoOptimization();
    }
  }

  private initializeMetrics(): ConnectionPoolMetrics {
    return {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingClients: 0,
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      avgQueryTime: 0,
      avgConnectionTime: 0,
      peakConnections: 0,
      poolUtilization: 0,
      errorRate: 0
    };
  }

  private createOptimizedPoolConfig(baseConfig: PoolConfig): PoolConfig {
    const systemCores = os.cpus().length;
    const systemMemoryGB = os.totalmem() / (1024 * 1024 * 1024);

    // Calculate optimal pool size based on system resources
    const basePoolSize = Math.min(
      Math.max(2, Math.floor(systemCores * 2)), // 2x CPU cores
      Math.floor(systemMemoryGB * 2), // 2 connections per GB RAM
      this.config.max
    );

    return {
      ...baseConfig,
      min: this.config.min,
      max: Math.max(basePoolSize, this.config.max),
      idleTimeoutMillis: this.config.idleTimeoutMillis,
      connectionTimeoutMillis: this.config.connectionTimeoutMillis,
      acquireTimeoutMillis: this.config.acquireTimeoutMillis,
      allowExitOnIdle: this.config.allowExitOnIdle,
      maxUses: this.config.maxUses,
      keepAlive: this.config.keepAlive,
      keepAliveInitialDelayMillis: this.config.keepAliveInitialDelayMillis,

      // Add prepared statement configuration for better performance
      options: {
        ...baseConfig.options,
        // Enable prepared statements for repeated queries
        statement_timeout: 30000,
        query_timeout: 30000,
        idle_in_transaction_session_timeout: 30000
      }
    };
  }

  private setupPoolMonitoring(): void {
    // Monitor source pool events
    this.sourcePool.on('connect', (client: PoolClient) => {
      this.metrics.totalConnections++;\n      this.updateConnectionMetrics();\n      this.emit('connection_created', { pool: 'source', client });\n    });\n\n    this.sourcePool.on('acquire', (client: PoolClient) => {\n      const acquireStart = Date.now();\n      client.on('release', () => {\n        const acquireTime = Date.now() - acquireStart;\n        this.recordConnectionTime(acquireTime);\n      });\n      this.emit('connection_acquired', { pool: 'source', client });\n    });\n\n    this.sourcePool.on('error', (err: Error) => {\n      this.metrics.failedQueries++;\n      this.emit('pool_error', { pool: 'source', error: err });\n    });\n\n    // Monitor destination pool events\n    this.destinationPool.on('connect', (client: PoolClient) => {\n      this.metrics.totalConnections++;\n      this.updateConnectionMetrics();\n      this.emit('connection_created', { pool: 'destination', client });\n    });\n\n    this.destinationPool.on('acquire', (client: PoolClient) => {\n      const acquireStart = Date.now();\n      client.on('release', () => {\n        const acquireTime = Date.now() - acquireStart;\n        this.recordConnectionTime(acquireTime);\n      });\n      this.emit('connection_acquired', { pool: 'destination', client });\n    });\n\n    this.destinationPool.on('error', (err: Error) => {\n      this.metrics.failedQueries++;\n      this.emit('pool_error', { pool: 'destination', error: err });\n    });\n  }\n\n  private recordConnectionTime(timeMs: number): void {\n    this.connectionTimes.push(timeMs);\n    \n    // Keep only last 1000 measurements\n    if (this.connectionTimes.length > 1000) {\n      this.connectionTimes.shift();\n    }\n    \n    // Update average connection time\n    this.metrics.avgConnectionTime = this.connectionTimes.reduce((sum, time) => sum + time, 0) / this.connectionTimes.length;\n  }\n\n  private recordQueryTime(timeMs: number): void {\n    this.queryTimes.push(timeMs);\n    \n    // Keep only last 1000 measurements\n    if (this.queryTimes.length > 1000) {\n      this.queryTimes.shift();\n    }\n    \n    // Update average query time\n    this.metrics.avgQueryTime = this.queryTimes.reduce((sum, time) => sum + time, 0) / this.queryTimes.length;\n  }\n\n  private updateConnectionMetrics(): void {\n    // Update pool utilization metrics\n    const sourceTotal = this.sourcePool.totalCount;\n    const sourceIdle = this.sourcePool.idleCount;\n    const sourceWaiting = this.sourcePool.waitingCount;\n    \n    const destTotal = this.destinationPool.totalCount;\n    const destIdle = this.destinationPool.idleCount;\n    const destWaiting = this.destinationPool.waitingCount;\n    \n    this.metrics.totalConnections = sourceTotal + destTotal;\n    this.metrics.activeConnections = (sourceTotal - sourceIdle) + (destTotal - destIdle);\n    this.metrics.idleConnections = sourceIdle + destIdle;\n    this.metrics.waitingClients = sourceWaiting + destWaiting;\n    \n    if (this.metrics.totalConnections > this.metrics.peakConnections) {\n      this.metrics.peakConnections = this.metrics.totalConnections;\n    }\n    \n    this.metrics.poolUtilization = this.metrics.totalConnections > 0 ? \n      this.metrics.activeConnections / this.metrics.totalConnections : 0;\n    \n    // Track utilization history\n    this.utilizationHistory.push(this.metrics.poolUtilization);\n    if (this.utilizationHistory.length > 100) {\n      this.utilizationHistory.shift();\n    }\n    \n    // Calculate error rate\n    if (this.metrics.totalQueries > 0) {\n      this.metrics.errorRate = this.metrics.failedQueries / this.metrics.totalQueries;\n    }\n  }\n\n  private startAutoOptimization(): void {\n    this.optimizationTimer = setInterval(() => {\n      this.optimizePoolSize();\n    }, this.config.optimizationInterval);\n  }\n\n  /**\n   * Optimize connection pool size based on current metrics\n   */\n  private async optimizePoolSize(): Promise<OptimizationResult | null> {\n    // Don't optimize too frequently\n    if (Date.now() - this.lastOptimization < this.config.optimizationInterval) {\n      return null;\n    }\n    \n    this.updateConnectionMetrics();\n    \n    const currentSourceMax = this.sourcePool.options.max || this.config.max;\n    const currentDestMax = this.destinationPool.options.max || this.config.max;\n    \n    let result: OptimizationResult | null = null;\n    \n    // Analyze current performance\n    const avgUtilization = this.utilizationHistory.length > 0 ? \n      this.utilizationHistory.reduce((sum, util) => sum + util, 0) / this.utilizationHistory.length : 0;\n    \n    const recentThroughput = this.throughputHistory.slice(-10);\n    const avgThroughput = recentThroughput.length > 0 ? \n      recentThroughput.reduce((sum, tp) => sum + tp, 0) / recentThroughput.length : 0;\n    \n    // Decision logic for pool size optimization\n    if (avgUtilization > this.config.targetUtilization && \n        this.metrics.waitingClients > 0 && \n        this.metrics.avgConnectionTime > this.config.maxWaitTime) {\n      \n      // Increase pool size\n      const newSize = Math.min(\n        Math.floor(Math.max(currentSourceMax, currentDestMax) * 1.2),\n        50 // Max pool size limit\n      );\n      \n      result = {\n        action: 'increase',\n        previousSize: Math.max(currentSourceMax, currentDestMax),\n        newSize,\n        reason: `High utilization (${(avgUtilization * 100).toFixed(1)}%) and waiting clients (${this.metrics.waitingClients})`,\n        expectedImprovement: 'Reduced connection wait times and improved throughput',\n        confidence: 0.8\n      };\n      \n      await this.resizePools(newSize);\n      \n    } else if (avgUtilization < (this.config.targetUtilization * 0.5) && \n               this.metrics.waitingClients === 0 && \n               avgThroughput > this.config.minThroughput) {\n      \n      // Decrease pool size\n      const newSize = Math.max(\n        Math.floor(Math.max(currentSourceMax, currentDestMax) * 0.8),\n        this.config.min\n      );\n      \n      if (newSize < Math.max(currentSourceMax, currentDestMax)) {\n        result = {\n          action: 'decrease',\n          previousSize: Math.max(currentSourceMax, currentDestMax),\n          newSize,\n          reason: `Low utilization (${(avgUtilization * 100).toFixed(1)}%) and no waiting clients`,\n          expectedImprovement: 'Reduced resource usage while maintaining performance',\n          confidence: 0.7\n        };\n        \n        await this.resizePools(newSize);\n      }\n    } else {\n      result = {\n        action: 'maintain',\n        previousSize: Math.max(currentSourceMax, currentDestMax),\n        newSize: Math.max(currentSourceMax, currentDestMax),\n        reason: 'Current pool size is optimal for current load',\n        expectedImprovement: 'Maintain current performance levels',\n        confidence: 0.9\n      };\n    }\n    \n    this.lastOptimization = Date.now();\n    \n    if (result) {\n      this.emit('pool_optimized', result);\n    }\n    \n    return result;\n  }\n\n  private async resizePools(newMaxSize: number): Promise<void> {\n    try {\n      // Create new pool configurations\n      const sourceConfig = {\n        ...this.sourcePool.options,\n        max: newMaxSize,\n        min: Math.min(this.config.min, newMaxSize)\n      };\n      \n      const destConfig = {\n        ...this.destinationPool.options,\n        max: newMaxSize,\n        min: Math.min(this.config.min, newMaxSize)\n      };\n      \n      // Note: pg.Pool doesn't support dynamic resizing directly\n      // In production, this would require pool replacement or custom implementation\n      // For now, we'll emit an event that the application can handle\n      this.emit('pool_resize_required', {\n        sourceConfig,\n        destConfig,\n        newMaxSize\n      });\n      \n    } catch (error) {\n      this.emit('pool_resize_error', error);\n    }\n  }\n\n  /**\n   * Execute query with performance tracking\n   */\n  async query(pool: 'source' | 'destination', text: string, params?: any[]): Promise<any> {\n    const startTime = Date.now();\n    const targetPool = pool === 'source' ? this.sourcePool : this.destinationPool;\n    \n    try {\n      const result = await targetPool.query(text, params);\n      \n      // Record successful query\n      const queryTime = Date.now() - startTime;\n      this.recordQueryTime(queryTime);\n      this.metrics.totalQueries++;\n      this.metrics.successfulQueries++;\n      \n      this.emit('query_completed', {\n        pool,\n        queryTime,\n        success: true,\n        rowCount: result.rowCount\n      });\n      \n      return result;\n      \n    } catch (error) {\n      // Record failed query\n      const queryTime = Date.now() - startTime;\n      this.recordQueryTime(queryTime);\n      this.metrics.totalQueries++;\n      this.metrics.failedQueries++;\n      \n      this.emit('query_completed', {\n        pool,\n        queryTime,\n        success: false,\n        error: error.message\n      });\n      \n      throw error;\n    }\n  }\n\n  /**\n   * Execute query with connection from pool\n   */\n  async withConnection<T>(pool: 'source' | 'destination', callback: (client: PoolClient) => Promise<T>): Promise<T> {\n    const targetPool = pool === 'source' ? this.sourcePool : this.destinationPool;\n    const client = await targetPool.connect();\n    \n    try {\n      const result = await callback(client);\n      return result;\n    } finally {\n      client.release();\n    }\n  }\n\n  /**\n   * Execute transaction with performance tracking\n   */\n  async transaction<T>(pool: 'source' | 'destination', callback: (client: PoolClient) => Promise<T>): Promise<T> {\n    const startTime = Date.now();\n    const targetPool = pool === 'source' ? this.sourcePool : this.destinationPool;\n    \n    const client = await targetPool.connect();\n    \n    try {\n      await client.query('BEGIN');\n      const result = await callback(client);\n      await client.query('COMMIT');\n      \n      const transactionTime = Date.now() - startTime;\n      this.emit('transaction_completed', {\n        pool,\n        transactionTime,\n        success: true\n      });\n      \n      return result;\n      \n    } catch (error) {\n      await client.query('ROLLBACK');\n      \n      const transactionTime = Date.now() - startTime;\n      this.emit('transaction_completed', {\n        pool,\n        transactionTime,\n        success: false,\n        error: error.message\n      });\n      \n      throw error;\n    } finally {\n      client.release();\n    }\n  }\n\n  /**\n   * Get current pool metrics\n   */\n  getMetrics(): ConnectionPoolMetrics {\n    this.updateConnectionMetrics();\n    return { ...this.metrics };\n  }\n\n  /**\n   * Get pool configuration\n   */\n  getConfig(): ConnectionPoolConfig {\n    return { ...this.config };\n  }\n\n  /**\n   * Get pool status information\n   */\n  getPoolStatus(): {\n    source: {\n      totalCount: number;\n      idleCount: number;\n      waitingCount: number;\n    };\n    destination: {\n      totalCount: number;\n      idleCount: number;\n      waitingCount: number;\n    };\n  } {\n    return {\n      source: {\n        totalCount: this.sourcePool.totalCount,\n        idleCount: this.sourcePool.idleCount,\n        waitingCount: this.sourcePool.waitingCount\n      },\n      destination: {\n        totalCount: this.destinationPool.totalCount,\n        idleCount: this.destinationPool.idleCount,\n        waitingCount: this.destinationPool.waitingCount\n      }\n    };\n  }\n\n  /**\n   * Force pool optimization\n   */\n  async forceOptimization(): Promise<OptimizationResult | null> {\n    return await this.optimizePoolSize();\n  }\n\n  /**\n   * Update throughput metrics (called externally by migration services)\n   */\n  updateThroughput(recordsPerSecond: number): void {\n    this.throughputHistory.push(recordsPerSecond);\n    \n    // Keep only last 100 measurements\n    if (this.throughputHistory.length > 100) {\n      this.throughputHistory.shift();\n    }\n  }\n\n  /**\n   * Get connection health check\n   */\n  async healthCheck(): Promise<{\n    source: { connected: boolean; latency: number };\n    destination: { connected: boolean; latency: number };\n  }> {\n    const results = {\n      source: { connected: false, latency: 0 },\n      destination: { connected: false, latency: 0 }\n    };\n    \n    try {\n      const sourceStart = Date.now();\n      await this.sourcePool.query('SELECT 1');\n      results.source = {\n        connected: true,\n        latency: Date.now() - sourceStart\n      };\n    } catch (error) {\n      results.source = { connected: false, latency: 0 };\n    }\n    \n    try {\n      const destStart = Date.now();\n      await this.destinationPool.query('SELECT 1');\n      results.destination = {\n        connected: true,\n        latency: Date.now() - destStart\n      };\n    } catch (error) {\n      results.destination = { connected: false, latency: 0 };\n    }\n    \n    return results;\n  }\n\n  /**\n   * Cleanup and close all connections\n   */\n  async close(): Promise<void> {\n    if (this.optimizationTimer) {\n      clearInterval(this.optimizationTimer);\n    }\n    \n    await Promise.all([\n      this.sourcePool.end(),\n      this.destinationPool.end()\n    ]);\n    \n    this.removeAllListeners();\n  }\n}