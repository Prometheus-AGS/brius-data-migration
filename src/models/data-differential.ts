// Data Differential Model
// Handles comparison results between source and target databases

import { Pool, PoolClient } from 'pg';
import {
  DataDifferential,
  ComparisonType,
  ResolutionStrategy,
  DataComparisonResult,
  ConflictResolutionResult
} from '../types/migration-types';

export class DataDifferentialModel {
  constructor(private db: Pool) {}

  /**
   * Create a new data differential record
   */
  async create(differential: Omit<DataDifferential, 'id' | 'created_at'>): Promise<DataDifferential> {
    const query = `
      INSERT INTO data_differentials (
        source_table, target_table, comparison_type, legacy_ids,
        record_count, comparison_criteria, resolution_strategy,
        resolved, resolved_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      differential.source_table,
      differential.target_table,
      differential.comparison_type,
      JSON.stringify(differential.legacy_ids),
      differential.record_count,
      JSON.stringify(differential.comparison_criteria),
      differential.resolution_strategy,
      differential.resolved,
      differential.resolved_at,
      JSON.stringify(differential.metadata)
    ];

    try {
      const result = await this.db.query(query, values);
      return this.mapRowToDifferential(result.rows[0]);
    } catch (error) {
      throw new Error(`Failed to create data differential: ${error.message}`);
    }
  }

  /**
   * Update an existing differential
   */
  async update(id: string, updates: Partial<DataDifferential>): Promise<DataDifferential> {
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'created_at' && value !== undefined) {
        if (key === 'legacy_ids' || key === 'comparison_criteria' || key === 'metadata') {
          updateFields.push(`${key} = $${paramCount}`);
          values.push(JSON.stringify(value));
        } else {
          updateFields.push(`${key} = $${paramCount}`);
          values.push(value);
        }
        paramCount++;
      }
    });

    if (updateFields.length === 0) {
      throw new Error('No valid fields provided for update');
    }

    const query = `
      UPDATE data_differentials
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    values.push(id);

    try {
      const result = await this.db.query(query, values);
      if (result.rows.length === 0) {
        throw new Error(`Data differential not found: ${id}`);
      }
      return this.mapRowToDifferential(result.rows[0]);
    } catch (error) {
      throw new Error(`Failed to update data differential: ${error.message}`);
    }
  }

  /**
   * Find differential by ID
   */
  async findById(id: string): Promise<DataDifferential | null> {
    const query = 'SELECT * FROM data_differentials WHERE id = $1';

    try {
      const result = await this.db.query(query, [id]);
      return result.rows.length > 0 ? this.mapRowToDifferential(result.rows[0]) : null;
    } catch (error) {
      throw new Error(`Failed to find data differential: ${error.message}`);
    }
  }

  /**
   * Find differentials by table and comparison type
   */
  async findByTableAndType(
    sourceTable: string,
    targetTable: string,
    comparisonType?: ComparisonType
  ): Promise<DataDifferential[]> {
    let query = `
      SELECT * FROM data_differentials
      WHERE source_table = $1 AND target_table = $2
    `;
    const values = [sourceTable, targetTable];

    if (comparisonType) {
      query += ' AND comparison_type = $3';
      values.push(comparisonType);
    }

    query += ' ORDER BY created_at DESC';

    try {
      const result = await this.db.query(query, values);
      return result.rows.map(row => this.mapRowToDifferential(row));
    } catch (error) {
      throw new Error(`Failed to find differentials by table and type: ${error.message}`);
    }
  }

  /**
   * Find unresolved differentials
   */
  async findUnresolved(
    sourceTable?: string,
    comparisonType?: ComparisonType
  ): Promise<DataDifferential[]> {
    let query = 'SELECT * FROM data_differentials WHERE resolved = false';
    const values: any[] = [];
    let paramCount = 1;

    if (sourceTable) {
      query += ` AND source_table = $${paramCount}`;
      values.push(sourceTable);
      paramCount++;
    }

    if (comparisonType) {
      query += ` AND comparison_type = $${paramCount}`;
      values.push(comparisonType);
    }

    query += ' ORDER BY created_at ASC';

    try {
      const result = await this.db.query(query, values);
      return result.rows.map(row => this.mapRowToDifferential(row));
    } catch (error) {
      throw new Error(`Failed to find unresolved differentials: ${error.message}`);
    }
  }

  /**
   * Mark differential as resolved
   */
  async markResolved(id: string, resolutionDetails?: any): Promise<DataDifferential> {
    const updates: Partial<DataDifferential> = {
      resolved: true,
      resolved_at: new Date()
    };

    if (resolutionDetails) {
      updates.metadata = {
        ...updates.metadata,
        resolution_details: resolutionDetails
      };
    }

    return this.update(id, updates);
  }

  /**
   * Create comparison result summary
   */
  async createComparisonSummary(
    sourceTable: string,
    targetTable: string,
    differentials: DataDifferential[]
  ): Promise<DataComparisonResult> {
    const missingRecords = differentials
      .filter(d => d.comparison_type === ComparisonType.MISSING_RECORDS)
      .reduce((sum, d) => sum + d.record_count, 0);

    const conflictedRecords = differentials
      .filter(d => d.comparison_type === ComparisonType.CONFLICTED_RECORDS)
      .reduce((sum, d) => sum + d.record_count, 0);

    const deletedRecords = differentials
      .filter(d => d.comparison_type === ComparisonType.DELETED_RECORDS)
      .reduce((sum, d) => sum + d.record_count, 0);

    // Get total record counts from databases
    const [sourceCount, targetCount] = await Promise.all([
      this.getTableRecordCount(sourceTable, 'source'),
      this.getTableRecordCount(targetTable, 'target')
    ]);

    const identicalRecords = Math.max(0, Math.min(sourceCount, targetCount) - conflictedRecords);

    return {
      missing_records: missingRecords,
      conflicted_records: conflictedRecords,
      deleted_records: deletedRecords,
      identical_records: identicalRecords,
      total_source_records: sourceCount,
      total_target_records: targetCount,
      comparison_timestamp: new Date()
    };
  }

  /**
   * Process conflict resolution
   */
  async processConflictResolution(
    differentialIds: string[],
    strategy: ResolutionStrategy
  ): Promise<ConflictResolutionResult> {
    const conflicts = await Promise.all(
      differentialIds.map(id => this.findById(id))
    );

    const validConflicts = conflicts.filter(c => c && !c.resolved) as DataDifferential[];

    if (validConflicts.length === 0) {
      return {
        conflicts_detected: 0,
        conflicts_resolved: 0,
        resolution_strategy: strategy,
        failed_resolutions: 0,
        resolution_details: {}
      };
    }

    let resolvedCount = 0;
    let failedCount = 0;
    const resolutionDetails: any = {
      records_updated: [],
      processing_time_ms: 0
    };

    const startTime = Date.now();

    for (const conflict of validConflicts) {
      try {
        // Apply resolution strategy
        await this.applyResolutionStrategy(conflict, strategy);
        await this.markResolved(conflict.id, { strategy, applied_at: new Date() });
        resolvedCount++;

        resolutionDetails.records_updated.push({
          differential_id: conflict.id,
          legacy_ids: conflict.legacy_ids,
          strategy_applied: strategy
        });
      } catch (error) {
        failedCount++;
        console.error(`Failed to resolve conflict ${conflict.id}:`, error);
      }
    }

    resolutionDetails.processing_time_ms = Date.now() - startTime;

    return {
      conflicts_detected: validConflicts.length,
      conflicts_resolved: resolvedCount,
      resolution_strategy: strategy,
      failed_resolutions: failedCount,
      resolution_details: resolutionDetails
    };
  }

  /**
   * Get recent differentials for reporting
   */
  async getRecentDifferentials(
    limit: number = 50,
    comparisonType?: ComparisonType
  ): Promise<DataDifferential[]> {
    let query = 'SELECT * FROM data_differentials';
    const values: any[] = [];

    if (comparisonType) {
      query += ' WHERE comparison_type = $1';
      values.push(comparisonType);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (values.length + 1);
    values.push(limit);

    try {
      const result = await this.db.query(query, values);
      return result.rows.map(row => this.mapRowToDifferential(row));
    } catch (error) {
      throw new Error(`Failed to get recent differentials: ${error.message}`);
    }
  }

  /**
   * Get differential statistics
   */
  async getStatistics(sourceTable?: string): Promise<any> {
    let query = `
      SELECT
        comparison_type,
        resolution_strategy,
        COUNT(*) as count,
        SUM(record_count) as total_records,
        COUNT(*) FILTER (WHERE resolved = true) as resolved_count,
        COUNT(*) FILTER (WHERE resolved = false) as unresolved_count
      FROM data_differentials
    `;
    const values: any[] = [];

    if (sourceTable) {
      query += ' WHERE source_table = $1';
      values.push(sourceTable);
    }

    query += ' GROUP BY comparison_type, resolution_strategy ORDER BY comparison_type';

    try {
      const result = await this.db.query(query, values);
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to get differential statistics: ${error.message}`);
    }
  }

  /**
   * Cleanup old resolved differentials
   */
  async cleanup(olderThanDays: number = 7): Promise<number> {
    const query = `
      DELETE FROM data_differentials
      WHERE resolved = true
        AND resolved_at < NOW() - INTERVAL '${olderThanDays} days'
    `;

    try {
      const result = await this.db.query(query);
      return result.rowCount;
    } catch (error) {
      throw new Error(`Failed to cleanup differentials: ${error.message}`);
    }
  }

  /**
   * Apply resolution strategy (placeholder for actual implementation)
   */
  private async applyResolutionStrategy(
    differential: DataDifferential,
    strategy: ResolutionStrategy
  ): Promise<void> {
    // This would be implemented based on the specific resolution strategy
    // For now, we'll just simulate the resolution
    switch (strategy) {
      case ResolutionStrategy.SOURCE_WINS:
        // Apply source data to target
        break;
      case ResolutionStrategy.TARGET_WINS:
        // Keep target data as-is
        break;
      case ResolutionStrategy.MANUAL_REVIEW:
        // Flag for manual review
        break;
      case ResolutionStrategy.SKIP:
        // Skip resolution
        break;
    }

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  /**
   * Get record count for a table
   */
  private async getTableRecordCount(tableName: string, database: 'source' | 'target'): Promise<number> {
    try {
      // This would use the appropriate database connection
      // For now, return a placeholder value
      const query = `SELECT COUNT(*) as count FROM ${tableName}`;
      const result = await this.db.query(query);
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.warn(`Could not get record count for ${tableName}:`, error.message);
      return 0;
    }
  }

  /**
   * Map database row to DataDifferential object
   */
  private mapRowToDifferential(row: any): DataDifferential {
    return {
      id: row.id,
      source_table: row.source_table,
      target_table: row.target_table,
      comparison_type: row.comparison_type as ComparisonType,
      legacy_ids: typeof row.legacy_ids === 'string' ? JSON.parse(row.legacy_ids) : row.legacy_ids,
      record_count: parseInt(row.record_count),
      comparison_criteria: typeof row.comparison_criteria === 'string'
        ? JSON.parse(row.comparison_criteria)
        : row.comparison_criteria,
      resolution_strategy: row.resolution_strategy as ResolutionStrategy,
      resolved: row.resolved,
      resolved_at: row.resolved_at ? new Date(row.resolved_at) : undefined,
      created_at: new Date(row.created_at),
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
    };
  }
}