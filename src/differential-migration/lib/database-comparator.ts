/**
 * DatabaseComparator Library
 * Implements connection pooling, efficient querying, and data comparison utilities
 */

import { Pool, PoolClient, QueryResult } from 'pg';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

// Type definitions
export interface ConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  maxConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

export interface ComparisonQuery {
  name: string;
  database: 'source' | 'destination';
  query: string;
  params: any[];
}

export interface ComparisonResult {
  name: string;
  success: boolean;
  rows: any[];
  rowCount: number;
  executionTimeMs: number;
  error?: string;
}

export interface RecordCountComparison {
  sourceTable: string;
  destinationTable: string;
  sourceCount: number;
  destinationCount: number;
  gap: number;
  gapPercentage: number;
  timestamp: Date;
}

export interface RecordSetComparison {
  totalSourceRecords: number;
  totalDestinationRecords: number;
  matchingRecords: number;
  missingInDestination: any[];
  orphanedInDestination: any[];
  matchPercentage: number;
  differences: Array<{
    recordId: any;
    field: string;
    sourceValue: any;
    destinationValue: any;
  }>;
}

export interface SchemaDifference {
  sourceTable: string;
  destinationTable: string;
  columnDifferences: Array<{
    columnName: string;
    differenceType: 'added' | 'removed' | 'type_changed' | 'constraint_changed';
    sourceType?: string;
    destinationType?: string;
    details: string;
  }>;
  isCompatible: boolean;
  migrationComplexity: 'low' | 'medium' | 'high';
}

export interface QueryOptimization {
  query: string;
  database: 'source' | 'destination';
  executionPlan: string[];
  hasSeqScan: boolean;
  estimatedCost: number;
  estimatedRows: number;
  recommendations: string[];
}

export interface IndexRecommendation {
  tableName: string;
  recommendations: Array<{
    columnName: string;
    indexType: 'btree' | 'hash' | 'unique' | 'composite';
    priority: 'high' | 'medium' | 'low';
    estimatedImprovement: string;
    createStatement: string;
  }>;
}

export interface BatchOptimization {
  recommendedBatchSize: number;
  reasoning: string;
  memoryEstimate: string;
  timeEstimate: string;
}

export interface ConnectionTestResult {
  isConnected: boolean;
  latencyMs?: number;
  error?: string;
  version?: string;
}

export interface ConnectionPoolStats {
  totalConnections: number;
  idleConnections: number;
  waitingConnections: number;
  activeConnections: number;
}

export interface PerformanceMetrics {
  totalQueries: number;
  averageExecutionTimeMs: number;
  slowestQueryMs: number;
  fastestQueryMs: number;
  totalDataTransferred: number;
  queriesPerSecond: number;
}

export interface SlowQuery {
  query: string;
  executionTimeMs: number;
  timestamp: Date;
  database: 'source' | 'destination';
}

export interface PoolHealth {
  isHealthy: boolean;
  utilizationPercentage: number;
  issuesDetected: string[];
  recommendations: string[];
}

/**
 * DatabaseComparator Implementation
 *
 * Provides comprehensive database comparison functionality with optimized connection pooling,
 * efficient querying, and advanced data comparison utilities.
 */
export class DatabaseComparator {
  private sourcePool: Pool;
  private destinationPool: Pool;
  private performanceMetrics: Map<string, number> = new Map();
  private queryHistory: Array<{ query: string; executionTime: number; timestamp: Date; database: string }> = [];
  private startTime: Date = new Date();

  constructor(
    sourceConfig: ConnectionConfig,
    destinationConfig: ConnectionConfig
  ) {
    // Validate configurations
    const sourceValidation = DatabaseComparator.validateConfig(sourceConfig);
    if (!sourceValidation.isValid) {
      throw new Error(`Invalid source config: ${sourceValidation.errors.join(', ')}`);
    }

    const destValidation = DatabaseComparator.validateConfig(destinationConfig);
    if (!destValidation.isValid) {
      throw new Error(`Invalid destination config: ${destValidation.errors.join(', ')}`);
    }

    // Create connection pools with optimized settings
    this.sourcePool = new Pool({
      host: sourceConfig.host,
      port: sourceConfig.port,
      database: sourceConfig.database,
      user: sourceConfig.user,
      password: sourceConfig.password,
      ssl: sourceConfig.ssl || false,
      max: sourceConfig.maxConnections || 10,
      idleTimeoutMillis: sourceConfig.idleTimeoutMs || 30000,
      connectionTimeoutMillis: sourceConfig.connectionTimeoutMs || 10000,
      // Optimization settings
      allowExitOnIdle: false,
      maxUses: 7500, // Rotate connections periodically
      application_name: 'differential_migration_source'
    });

    this.destinationPool = new Pool({
      host: destinationConfig.host,
      port: destinationConfig.port,
      database: destinationConfig.database,
      user: destinationConfig.user,
      password: destinationConfig.password,
      ssl: destinationConfig.ssl || false,
      max: destinationConfig.maxConnections || 10,
      idleTimeoutMillis: destinationConfig.idleTimeoutMs || 30000,
      connectionTimeoutMillis: destinationConfig.connectionTimeoutMs || 10000,
      allowExitOnIdle: false,
      maxUses: 7500,
      application_name: 'differential_migration_destination'
    });

    // Setup connection pool error handlers
    this.sourcePool.on('error', (err) => {
      console.error('Source pool error:', err);
    });

    this.destinationPool.on('error', (err) => {
      console.error('Destination pool error:', err);
    });
  }

  /**
   * Validates database connection configuration
   */
  static validateConfig(config: ConnectionConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.host || config.host.trim().length === 0) {
      errors.push('host is required');
    }

    if (!config.database || config.database.trim().length === 0) {
      errors.push('database is required');
    }

    if (!config.user || config.user.trim().length === 0) {
      errors.push('user is required');
    }

    if (!config.password || config.password.trim().length === 0) {
      errors.push('password is required');
    }

    if (config.port && (config.port < 1 || config.port > 65535)) {
      errors.push('port must be between 1 and 65535');
    }

    if (config.maxConnections && (config.maxConnections < 1 || config.maxConnections > 20)) {
      errors.push('maxConnections must be between 1 and 20');
    }

    if (config.idleTimeoutMs && config.idleTimeoutMs < 1000) {
      errors.push('idleTimeoutMs must be at least 1000ms');
    }

    if (config.connectionTimeoutMs && config.connectionTimeoutMs < 1000) {
      errors.push('connectionTimeoutMs must be at least 1000ms');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Tests both database connections
   */
  async testConnections(): Promise<{
    source: ConnectionTestResult;
    destination: ConnectionTestResult;
  }> {
    const testConnection = async (pool: Pool, name: string): Promise<ConnectionTestResult> => {
      const startTime = Date.now();
      try {
        const client = await pool.connect();

        try {
          const result = await client.query('SELECT version(), NOW() as server_time');
          const latencyMs = Date.now() - startTime;

          return {
            isConnected: true,
            latencyMs,
            version: result.rows[0].version.split(' ')[1] // Extract PostgreSQL version
          };
        } finally {
          client.release();
        }
      } catch (error) {
        return {
          isConnected: false,
          error: error instanceof Error ? error.message : 'Unknown connection error'
        };
      }
    };

    const [sourceResult, destResult] = await Promise.all([
      testConnection(this.sourcePool, 'source'),
      testConnection(this.destinationPool, 'destination')
    ]);

    return {
      source: sourceResult,
      destination: destResult
    };
  }

  /**
   * Gets connection pool statistics
   */
  async getConnectionStats(): Promise<{
    source: ConnectionPoolStats;
    destination: ConnectionPoolStats;
  }> {
    const getPoolStats = (pool: Pool): ConnectionPoolStats => ({
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingConnections: pool.waitingCount,
      activeConnections: pool.totalCount - pool.idleCount
    });

    return {
      source: getPoolStats(this.sourcePool),
      destination: getPoolStats(this.destinationPool)
    };
  }

  /**
   * Executes a query on the source database
   */
  async executeSourceQuery(query: string, params: any[] = []): Promise<QueryResult> {
    return this.executeQuery(this.sourcePool, 'source', query, params);
  }

  /**
   * Executes a query on the destination database
   */
  async executeDestinationQuery(query: string, params: any[] = []): Promise<QueryResult> {
    return this.executeQuery(this.destinationPool, 'destination', query, params);
  }

  /**
   * Executes multiple queries in parallel
   */
  async executeParallelQueries(queries: ComparisonQuery[]): Promise<ComparisonResult[]> {
    const promises = queries.map(async (query): Promise<ComparisonResult> => {
      const startTime = Date.now();

      try {
        const pool = query.database === 'source' ? this.sourcePool : this.destinationPool;
        const result = await this.executeQuery(pool, query.database, query.query, query.params);
        const executionTimeMs = Date.now() - startTime;

        return {
          name: query.name,
          success: true,
          rows: result.rows,
          rowCount: result.rowCount || 0,
          executionTimeMs
        };
      } catch (error) {
        const executionTimeMs = Date.now() - startTime;
        return {
          name: query.name,
          success: false,
          rows: [],
          rowCount: 0,
          executionTimeMs,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    return Promise.all(promises);
  }

  /**
   * Compares record counts between source and destination tables
   */
  async compareRecordCounts(
    sourceTable: string,
    destinationTable: string
  ): Promise<RecordCountComparison> {
    const queries: ComparisonQuery[] = [
      {
        name: 'source_count',
        database: 'source',
        query: `SELECT COUNT(*) as count FROM ${sourceTable}`,
        params: []
      },
      {
        name: 'dest_count',
        database: 'destination',
        query: `SELECT COUNT(*) as count FROM ${destinationTable}`,
        params: []
      }
    ];

    const results = await this.executeParallelQueries(queries);

    const sourceResult = results.find(r => r.name === 'source_count');
    const destResult = results.find(r => r.name === 'dest_count');

    if (!sourceResult?.success || !destResult?.success) {
      throw new Error('Failed to retrieve record counts');
    }

    const sourceCount = parseInt(sourceResult.rows[0].count);
    const destinationCount = parseInt(destResult.rows[0].count);
    const gap = sourceCount - destinationCount;
    const gapPercentage = sourceCount > 0
      ? Math.round((gap / sourceCount) * 100 * 100) / 100
      : 0;

    return {
      sourceTable,
      destinationTable,
      sourceCount,
      destinationCount,
      gap,
      gapPercentage,
      timestamp: new Date()
    };
  }

  /**
   * Compares record sets between source and destination
   */
  async compareRecordSets(
    sourceRecords: any[],
    destinationRecords: any[],
    sourceIdField: string,
    destinationIdField: string
  ): Promise<RecordSetComparison> {
    // Create maps for efficient lookup
    const sourceMap = new Map(sourceRecords.map(record => [record[sourceIdField], record]));
    const destMap = new Map(destinationRecords.map(record => [record[destinationIdField], record]));

    let matchingRecords = 0;
    const missingInDestination: any[] = [];
    const orphanedInDestination: any[] = [];
    const differences: RecordSetComparison['differences'] = [];

    // Check source records
    for (const sourceRecord of sourceRecords) {
      const sourceId = sourceRecord[sourceIdField];
      const destRecord = destMap.get(sourceId);

      if (!destRecord) {
        missingInDestination.push(sourceId);
      } else {
        matchingRecords++;

        // Compare fields for differences (excluding ID fields)
        const sourceFields = Object.keys(sourceRecord).filter(key => key !== sourceIdField);
        const destFields = Object.keys(destRecord).filter(key => key !== destinationIdField);

        for (const field of sourceFields) {
          const destFieldName = destFields.find(f => f === field || f === `legacy_${field}`) || field;

          if (destRecord[destFieldName] !== undefined &&
              sourceRecord[field] !== destRecord[destFieldName]) {
            differences.push({
              recordId: sourceId,
              field,
              sourceValue: sourceRecord[field],
              destinationValue: destRecord[destFieldName]
            });
          }
        }
      }
    }

    // Check for orphaned records in destination
    for (const destRecord of destinationRecords) {
      const destId = destRecord[destinationIdField];
      if (!sourceMap.has(destId)) {
        orphanedInDestination.push(destId);
      }
    }

    const matchPercentage = sourceRecords.length > 0
      ? Math.round((matchingRecords / sourceRecords.length) * 100 * 100) / 100
      : 0;

    return {
      totalSourceRecords: sourceRecords.length,
      totalDestinationRecords: destinationRecords.length,
      matchingRecords,
      missingInDestination,
      orphanedInDestination,
      matchPercentage,
      differences
    };
  }

  /**
   * Compares schemas between source and destination tables
   */
  async compareSchemas(
    sourceTable: string,
    destinationTable: string
  ): Promise<SchemaDifference> {
    const schemaQuery = `
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default,
        character_maximum_length,
        numeric_precision,
        numeric_scale
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `;

    const [sourceResult, destResult] = await Promise.all([
      this.executeSourceQuery(schemaQuery, [sourceTable]),
      this.executeDestinationQuery(schemaQuery, [destinationTable])
    ]);

    const sourceColumns = new Map(
      sourceResult.rows.map(row => [row.column_name, row])
    );
    const destColumns = new Map(
      destResult.rows.map(row => [row.column_name, row])
    );

    const columnDifferences: SchemaDifference['columnDifferences'] = [];

    // Check for added columns (in destination but not in source)
    for (const [columnName, columnInfo] of destColumns) {
      if (!sourceColumns.has(columnName) &&
          !columnName.startsWith('legacy_') &&
          !['id', 'created_at', 'updated_at'].includes(columnName)) {
        columnDifferences.push({
          columnName,
          differenceType: 'added',
          destinationType: columnInfo.data_type,
          details: `Column added in destination: ${columnInfo.data_type}`
        });
      }
    }

    // Check for removed columns and type changes
    for (const [columnName, columnInfo] of sourceColumns) {
      const destColumn = destColumns.get(columnName);

      if (!destColumn && !destColumns.has(`legacy_${columnName}`)) {
        columnDifferences.push({
          columnName,
          differenceType: 'removed',
          sourceType: columnInfo.data_type,
          details: `Column removed from destination: ${columnInfo.data_type}`
        });
      } else if (destColumn && columnInfo.data_type !== destColumn.data_type) {
        columnDifferences.push({
          columnName,
          differenceType: 'type_changed',
          sourceType: columnInfo.data_type,
          destinationType: destColumn.data_type,
          details: `Type changed: ${columnInfo.data_type} → ${destColumn.data_type}`
        });
      }
    }

    // Assess compatibility and complexity
    const removedColumns = columnDifferences.filter(d => d.differenceType === 'removed');
    const typeChanges = columnDifferences.filter(d => d.differenceType === 'type_changed');

    const isCompatible = removedColumns.length === 0 && typeChanges.length <= 2;
    let migrationComplexity: 'low' | 'medium' | 'high' = 'low';

    if (removedColumns.length > 0 || typeChanges.length > 3) {
      migrationComplexity = 'high';
    } else if (typeChanges.length > 1 || columnDifferences.length > 5) {
      migrationComplexity = 'medium';
    }

    return {
      sourceTable,
      destinationTable,
      columnDifferences,
      isCompatible,
      migrationComplexity
    };
  }

  /**
   * Analyzes query performance using EXPLAIN
   */
  async analyzeQueryPerformance(
    query: string,
    params: any[] = [],
    database: 'source' | 'destination'
  ): Promise<QueryOptimization> {
    const pool = database === 'source' ? this.sourcePool : this.destinationPool;
    const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`;

    const result = await this.executeQuery(pool, database, explainQuery, params);
    const plan = result.rows[0]['QUERY PLAN'][0];

    // Parse execution plan
    const executionPlan = this.parseExecutionPlan(plan);
    const hasSeqScan = JSON.stringify(plan).includes('Seq Scan');
    const estimatedCost = plan['Total Cost'] || 0;
    const estimatedRows = plan['Plan Rows'] || 0;

    // Generate recommendations
    const recommendations: string[] = [];

    if (hasSeqScan) {
      recommendations.push('Consider adding indexes to eliminate sequential scans');
    }

    if (estimatedCost > 1000) {
      recommendations.push('High query cost detected - optimize query structure');
    }

    if (estimatedRows > 10000) {
      recommendations.push('Large result set - consider adding LIMIT clause');
    }

    return {
      query,
      database,
      executionPlan,
      hasSeqScan,
      estimatedCost,
      estimatedRows,
      recommendations
    };
  }

  /**
   * Generates index recommendations for a table
   */
  async getIndexRecommendations(
    tableName: string,
    database: 'source' | 'destination'
  ): Promise<IndexRecommendation> {
    const pool = database === 'source' ? this.sourcePool : this.destinationPool;

    // Get table statistics
    const statsQuery = `
      SELECT
        schemaname,
        tablename,
        n_tup_ins + n_tup_upd + n_tup_del as total_operations,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes
      FROM pg_stat_user_tables
      WHERE tablename = $1
    `;

    // Get column statistics
    const columnStatsQuery = `
      SELECT
        attname as column_name,
        n_distinct,
        null_frac,
        avg_width
      FROM pg_stats
      WHERE tablename = $1
    `;

    const [tableStats, columnStats] = await Promise.all([
      this.executeQuery(pool, database, statsQuery, [tableName]),
      this.executeQuery(pool, database, columnStatsQuery, [tableName])
    ]);

    const recommendations: IndexRecommendation['recommendations'] = [];

    // Analyze each column for index potential
    for (const col of columnStats.rows) {
      const distinctness = col.n_distinct / (col.n_distinct + 1); // Normalize
      const nullFraction = col.null_frac;

      let indexType: 'btree' | 'hash' | 'unique' | 'composite' = 'btree';
      let priority: 'high' | 'medium' | 'low' = 'low';

      // High selectivity columns are good candidates
      if (distinctness > 0.8 && nullFraction < 0.1) {
        indexType = 'unique';
        priority = 'high';
      } else if (distinctness > 0.5) {
        indexType = 'btree';
        priority = 'medium';
      } else if (distinctness > 0.1) {
        indexType = 'btree';
        priority = 'low';
      }

      if (priority !== 'low') {
        recommendations.push({
          columnName: col.column_name,
          indexType,
          priority,
          estimatedImprovement: this.calculateIndexImprovement(distinctness, tableStats.rows[0]?.total_operations || 0),
          createStatement: `CREATE ${indexType === 'unique' ? 'UNIQUE ' : ''}INDEX ${tableName}_${col.column_name}_idx ON ${tableName} USING ${indexType === 'unique' ? 'btree' : indexType} (${col.column_name})`
        });
      }
    }

    return {
      tableName,
      recommendations
    };
  }

  /**
   * Optimizes batch size based on table characteristics
   */
  optimizeBatchSize(totalRecords: number, currentBatchSize: number): BatchOptimization {
    let recommendedBatchSize = currentBatchSize;
    let reasoning = '';

    if (totalRecords < 1000) {
      recommendedBatchSize = Math.max(50, Math.ceil(totalRecords / 4));
      reasoning = 'Small dataset detected - using smaller batches for better progress tracking';
    } else if (totalRecords < 100000) {
      recommendedBatchSize = Math.max(250, Math.min(1000, Math.ceil(totalRecords / 100)));
      reasoning = 'Medium dataset detected - balanced batch size for optimal performance';
    } else {
      recommendedBatchSize = Math.max(500, Math.min(2000, Math.ceil(totalRecords / 500)));
      reasoning = 'Large dataset detected - using larger batches for better throughput';
    }

    const memoryEstimate = `~${Math.round(recommendedBatchSize * 0.001)}MB per batch`;
    const estimatedBatches = Math.ceil(totalRecords / recommendedBatchSize);
    const timeEstimate = `~${Math.ceil(estimatedBatches * 0.1)} minutes estimated`;

    return {
      recommendedBatchSize,
      reasoning,
      memoryEstimate,
      timeEstimate
    };
  }

  /**
   * Gets performance metrics
   */
  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    const totalQueries = this.queryHistory.length;

    if (totalQueries === 0) {
      return {
        totalQueries: 0,
        averageExecutionTimeMs: 0,
        slowestQueryMs: 0,
        fastestQueryMs: 0,
        totalDataTransferred: 0,
        queriesPerSecond: 0
      };
    }

    const executionTimes = this.queryHistory.map(q => q.executionTime);
    const averageExecutionTimeMs = executionTimes.reduce((sum, time) => sum + time, 0) / totalQueries;
    const slowestQueryMs = Math.max(...executionTimes);
    const fastestQueryMs = Math.min(...executionTimes);

    const elapsedTimeMs = Date.now() - this.startTime.getTime();
    const queriesPerSecond = totalQueries / (elapsedTimeMs / 1000);

    return {
      totalQueries,
      averageExecutionTimeMs: Math.round(averageExecutionTimeMs * 100) / 100,
      slowestQueryMs,
      fastestQueryMs,
      totalDataTransferred: this.performanceMetrics.get('dataTransferred') || 0,
      queriesPerSecond: Math.round(queriesPerSecond * 100) / 100
    };
  }

  /**
   * Gets slow queries above threshold
   */
  async getSlowQueries(thresholdMs: number): Promise<SlowQuery[]> {
    return this.queryHistory
      .filter(q => q.executionTime > thresholdMs)
      .map(q => ({
        query: q.query,
        executionTimeMs: q.executionTime,
        timestamp: q.timestamp,
        database: q.database as 'source' | 'destination'
      }))
      .sort((a, b) => b.executionTimeMs - a.executionTimeMs);
  }

  /**
   * Gets connection pool health status
   */
  async getConnectionPoolHealth(): Promise<{
    source: PoolHealth;
    destination: PoolHealth;
  }> {
    const analyzePoolHealth = (pool: Pool, name: string): PoolHealth => {
      const utilizationPercentage = Math.round(((pool.totalCount - pool.idleCount) / pool.totalCount) * 100);
      const isHealthy = utilizationPercentage < 90 && pool.waitingCount === 0;

      const issuesDetected: string[] = [];
      const recommendations: string[] = [];

      if (utilizationPercentage > 90) {
        issuesDetected.push('High pool utilization');
        recommendations.push('Consider increasing maxConnections');
      }

      if (pool.waitingCount > 0) {
        issuesDetected.push('Connections waiting in queue');
        recommendations.push('Optimize query performance or increase pool size');
      }

      if (pool.totalCount === 0) {
        issuesDetected.push('No active connections');
        recommendations.push('Check database connectivity');
      }

      return {
        isHealthy,
        utilizationPercentage,
        issuesDetected,
        recommendations
      };
    };

    return {
      source: analyzePoolHealth(this.sourcePool, 'source'),
      destination: analyzePoolHealth(this.destinationPool, 'destination')
    };
  }

  /**
   * Closes all database connections
   */
  async close(): Promise<void> {
    try {
      await Promise.all([
        this.sourcePool.end(),
        this.destinationPool.end()
      ]);
    } catch (error) {
      console.error('Error closing database connections:', error);
      // Continue with cleanup even if there are errors
    }
  }

  /**
   * Private helper methods
   */

  private async executeQuery(
    pool: Pool,
    database: string,
    query: string,
    params: any[] = []
  ): Promise<QueryResult> {
    const startTime = Date.now();

    try {
      const result = await pool.query(query, params);
      const executionTime = Date.now() - startTime;

      // Record performance metrics
      this.queryHistory.push({
        query,
        executionTime,
        timestamp: new Date(),
        database
      });

      // Update data transfer metrics (rough estimate)
      const dataSize = JSON.stringify(result.rows).length;
      const currentTransferred = this.performanceMetrics.get('dataTransferred') || 0;
      this.performanceMetrics.set('dataTransferred', currentTransferred + dataSize);

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;

      // Still record failed queries for analysis
      this.queryHistory.push({
        query,
        executionTime,
        timestamp: new Date(),
        database
      });

      throw error;
    }
  }

  private parseExecutionPlan(plan: any): string[] {
    const planLines: string[] = [];

    const extractPlanInfo = (node: any, depth: number = 0) => {
      const indent = '  '.repeat(depth);
      const nodeType = node['Node Type'] || 'Unknown';
      const cost = node['Total Cost'] ? `(cost=${node['Total Cost']})` : '';
      const rows = node['Actual Rows'] ? `rows=${node['Actual Rows']}` : '';

      planLines.push(`${indent}${nodeType} ${cost} ${rows}`.trim());

      if (node.Plans) {
        node.Plans.forEach((childPlan: any) => extractPlanInfo(childPlan, depth + 1));
      }
    };

    extractPlanInfo(plan);
    return planLines;
  }

  private calculateIndexImprovement(distinctness: number, operations: number): string {
    const baseImprovement = distinctness * 100;
    const operationFactor = Math.min(operations / 1000000, 2); // Cap at 2x
    const totalImprovement = Math.round(baseImprovement * (1 + operationFactor));

    return `${totalImprovement}% query performance improvement estimated`;
  }
}