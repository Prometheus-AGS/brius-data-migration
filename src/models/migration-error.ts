/**
 * MigrationError Model
 *
 * Comprehensive error tracking and diagnostic information.
 * Provides detailed error classification, tracking, resolution management,
 * and analytics for debugging and improving migration processes.
 */

import { Pool, PoolClient } from 'pg';
import {
  MigrationError,
  CreateMigrationErrorData,
  UpdateMigrationErrorData,
  MigrationErrorFilters,
  ErrorType,
  MigrationModelValidation
} from './migration-models';
import { getLogger, Logger, DatabaseError, ValidationError, generateCorrelationId } from '../lib/error-handler';

export interface ErrorStatistics {
  total_errors: number;
  unresolved_errors: number;
  resolved_errors: number;
  resolution_rate: number;
  by_type: Record<string, number>;
  by_entity: Record<string, number>;
  recent_errors: number;
  critical_errors: number;
  most_common_errors: Array<{
    error_code: string;
    error_message: string;
    count: number;
    percentage: number;
  }>;
}

export interface ErrorTrendAnalysis {
  daily_error_counts: Array<{
    date: string;
    error_count: number;
    resolved_count: number;
  }>;
  error_rate_trend: 'increasing' | 'decreasing' | 'stable';
  resolution_time_average_hours: number;
  recurring_issues: Array<{
    error_pattern: string;
    occurrences: number;
    first_seen: Date;
    last_seen: Date;
    entities_affected: string[];
  }>;
}

export class MigrationErrorModel {
  private db: Pool;
  private logger: Logger;
  private readonly tableName = 'migration_errors';

  constructor(db: Pool) {
    this.db = db;
    this.logger = getLogger();
  }

  /**
   * Create new migration error
   */
  async create(data: CreateMigrationErrorData): Promise<MigrationError> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    try {
      this.logger.info('Creating migration error', {
        migration_id: data.migration_id,
        entity_status_id: data.entity_status_id,
        error_type: data.error_type,
        error_code: data.error_code,
        error_message: data.error_message.substring(0, 100) + '...' // Truncate for logging
      });

      // Validate input data
      this.validateCreateData(data);

      const query = `
        INSERT INTO ${this.tableName} (
          id, migration_id, entity_status_id, batch_id, error_type,
          error_code, error_message, source_record_id, source_data,
          context, stack_trace, occurred_at, is_resolved,
          resolution_notes, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, NOW(), NOW()
        )
        RETURNING *
      `;

      const values = [
        data.migration_id,
        data.entity_status_id,
        data.batch_id,
        data.error_type,
        data.error_code,
        data.error_message,
        data.source_record_id,
        JSON.stringify(data.source_data),
        JSON.stringify(data.context),
        data.stack_trace,
        data.is_resolved || false,
        data.resolution_notes
      ];

      const result = await this.db.query(query, values);
      const migrationError = this.mapDatabaseRow(result.rows[0]);

      this.logger.info('Migration error created successfully', {
        error_id: migrationError.id,
        error_code: migrationError.error_code,
        migration_id: migrationError.migration_id,
        correlation_id: correlationId
      });

      return migrationError;

    } catch (error) {
      this.logger.error('Failed to create migration error', error);
      throw new DatabaseError(
        `Failed to create migration error: ${(error as Error).message}`,
        'MIGRATION_ERROR_CREATE_ERROR',
        { data, correlation_id: correlationId }
      );
    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Update existing migration error (typically for resolution)
   */
  async update(id: string, data: UpdateMigrationErrorData): Promise<MigrationError> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    try {
      this.logger.info('Updating migration error', {
        error_id: id,
        update_fields: Object.keys(data)
      });

      // Validate input data
      this.validateUpdateData(data);

      // Get current state for validation
      const current = await this.findById(id);
      if (!current) {
        throw new ValidationError(
          `Migration error with ID ${id} not found`,
          'MIGRATION_ERROR_NOT_FOUND',
          { error_id: id }
        );
      }

      // Build dynamic update query
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (data.is_resolved !== undefined) {
        updateFields.push(`is_resolved = $${paramIndex++}`);
        values.push(data.is_resolved);
      }

      if (data.resolution_notes !== undefined) {
        updateFields.push(`resolution_notes = $${paramIndex++}`);
        values.push(data.resolution_notes);
      }

      if (updateFields.length === 0) {
        this.logger.warn('No fields to update', { error_id: id });
        return current;
      }

      // Always update the updated_at timestamp
      updateFields.push(`updated_at = NOW()`);
      values.push(id);

      const query = `
        UPDATE ${this.tableName}
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const result = await this.db.query(query, values);

      if (result.rows.length === 0) {
        throw new ValidationError(
          `Migration error with ID ${id} not found`,
          'MIGRATION_ERROR_NOT_FOUND',
          { error_id: id }
        );
      }

      const migrationError = this.mapDatabaseRow(result.rows[0]);

      this.logger.info('Migration error updated successfully', {
        error_id: migrationError.id,
        updated_fields: Object.keys(data),
        is_resolved: migrationError.is_resolved,
        correlation_id: correlationId
      });

      return migrationError;

    } catch (error) {
      this.logger.error('Failed to update migration error', error);
      throw new DatabaseError(
        `Failed to update migration error: ${(error as Error).message}`,
        'MIGRATION_ERROR_UPDATE_ERROR',
        { error_id: id, data, correlation_id: correlationId }
      );
    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Find migration error by ID
   */
  async findById(id: string): Promise<MigrationError | null> {
    try {
      const query = `SELECT * FROM ${this.tableName} WHERE id = $1`;
      const result = await this.db.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapDatabaseRow(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find migration error by ID', error);
      throw new DatabaseError(
        `Failed to find migration error: ${(error as Error).message}`,
        'MIGRATION_ERROR_FIND_ERROR',
        { error_id: id }
      );
    }
  }

  /**
   * List migration errors with filters
   */
  async list(filters: MigrationErrorFilters = {}): Promise<MigrationError[]> {
    try {
      const whereClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      // Build WHERE clauses based on filters
      if (filters.migration_id) {
        whereClauses.push(`migration_id = $${paramIndex++}`);
        values.push(filters.migration_id);
      }

      if (filters.entity_status_id) {
        whereClauses.push(`entity_status_id = $${paramIndex++}`);
        values.push(filters.entity_status_id);
      }

      if (filters.error_type) {
        whereClauses.push(`error_type = $${paramIndex++}`);
        values.push(filters.error_type);
      }

      if (filters.is_resolved !== undefined) {
        whereClauses.push(`is_resolved = $${paramIndex++}`);
        values.push(filters.is_resolved);
      }

      if (filters.occurred_after) {
        whereClauses.push(`occurred_at >= $${paramIndex++}`);
        values.push(filters.occurred_after);
      }

      if (filters.occurred_before) {
        whereClauses.push(`occurred_at <= $${paramIndex++}`);
        values.push(filters.occurred_before);
      }

      // Build complete query
      let query = `SELECT * FROM ${this.tableName}`;

      if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      query += ` ORDER BY occurred_at DESC`;

      if (filters.limit) {
        query += ` LIMIT $${paramIndex++}`;
        values.push(filters.limit);
      }

      if (filters.offset) {
        query += ` OFFSET $${paramIndex++}`;
        values.push(filters.offset);
      }

      const result = await this.db.query(query, values);
      return result.rows.map(row => this.mapDatabaseRow(row));

    } catch (error) {
      this.logger.error('Failed to list migration errors', error);
      throw new DatabaseError(
        `Failed to list migration errors: ${(error as Error).message}`,
        'MIGRATION_ERROR_LIST_ERROR',
        { filters }
      );
    }
  }

  /**
   * Get unresolved errors for a migration
   */
  async getUnresolvedErrors(migrationId: string): Promise<MigrationError[]> {
    return this.list({ migration_id: migrationId, is_resolved: false });
  }

  /**
   * Get errors by type for a migration
   */
  async getErrorsByType(migrationId: string, errorType: ErrorType): Promise<MigrationError[]> {
    return this.list({ migration_id: migrationId, error_type: errorType });
  }

  /**
   * Get recent errors (last 24 hours)
   */
  async getRecentErrors(hours: number = 24, migrationId?: string): Promise<MigrationError[]> {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.list({
      migration_id: migrationId,
      occurred_after: cutoffTime
    });
  }

  /**
   * Resolve error with notes
   */
  async resolveError(id: string, resolutionNotes: string): Promise<MigrationError> {
    return this.update(id, {
      is_resolved: true,
      resolution_notes: resolutionNotes
    });
  }

  /**
   * Bulk resolve errors with same pattern
   */
  async bulkResolveByPattern(
    migrationId: string,
    errorCode: string,
    resolutionNotes: string
  ): Promise<{ resolved_count: number; resolved_errors: MigrationError[] }> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    try {
      this.logger.info('Bulk resolving errors by pattern', {
        migration_id: migrationId,
        error_code: errorCode,
        correlation_id: correlationId
      });

      const query = `
        UPDATE ${this.tableName}
        SET is_resolved = true, resolution_notes = $1, updated_at = NOW()
        WHERE migration_id = $2 AND error_code = $3 AND is_resolved = false
        RETURNING *
      `;

      const result = await this.db.query(query, [resolutionNotes, migrationId, errorCode]);
      const resolvedErrors = result.rows.map(row => this.mapDatabaseRow(row));

      this.logger.info('Bulk error resolution completed', {
        resolved_count: resolvedErrors.length,
        error_code: errorCode,
        migration_id: migrationId,
        correlation_id: correlationId
      });

      return {
        resolved_count: resolvedErrors.length,
        resolved_errors: resolvedErrors
      };

    } catch (error) {
      this.logger.error('Failed to bulk resolve errors', error);
      throw new DatabaseError(
        `Failed to bulk resolve errors: ${(error as Error).message}`,
        'MIGRATION_ERROR_BULK_RESOLVE_ERROR',
        { migration_id: migrationId, error_code: errorCode, correlation_id: correlationId }
      );
    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Get error statistics
   */
  async getStatistics(migrationId?: string): Promise<ErrorStatistics> {
    try {
      // Get overall statistics
      let query = `
        SELECT
          COUNT(*) as total_errors,
          COUNT(CASE WHEN is_resolved = true THEN 1 END) as resolved_errors,
          COUNT(CASE WHEN is_resolved = false THEN 1 END) as unresolved_errors,
          COUNT(CASE WHEN occurred_at > NOW() - INTERVAL '24 hours' THEN 1 END) as recent_errors
        FROM ${this.tableName}
      `;

      const values: any[] = [];
      if (migrationId) {
        query += ` WHERE migration_id = $1`;
        values.push(migrationId);
      }

      const result = await this.db.query(query, values);
      const row = result.rows[0];

      const totalErrors = parseInt(row.total_errors) || 0;
      const resolvedErrors = parseInt(row.resolved_errors) || 0;
      const resolutionRate = totalErrors > 0 ? Math.round((resolvedErrors / totalErrors) * 100) : 0;

      // Get statistics by error type
      let typeQuery = `
        SELECT error_type, COUNT(*) as count
        FROM ${this.tableName}
      `;

      if (migrationId) {
        typeQuery += ` WHERE migration_id = $1`;
      }

      typeQuery += ` GROUP BY error_type ORDER BY count DESC`;

      const typeResult = await this.db.query(typeQuery, values);

      const byType: Record<string, number> = {};
      typeResult.rows.forEach(typeRow => {
        byType[typeRow.error_type] = parseInt(typeRow.count);
      });

      // Get statistics by entity (from context)
      let entityQuery = `
        SELECT
          COALESCE(context->>'entity_name', 'unknown') as entity_name,
          COUNT(*) as count
        FROM ${this.tableName}
      `;

      if (migrationId) {
        entityQuery += ` WHERE migration_id = $1`;
      }

      entityQuery += ` GROUP BY COALESCE(context->>'entity_name', 'unknown') ORDER BY count DESC LIMIT 10`;

      const entityResult = await this.db.query(entityQuery, values);

      const byEntity: Record<string, number> = {};
      entityResult.rows.forEach(entityRow => {
        byEntity[entityRow.entity_name] = parseInt(entityRow.count);
      });

      // Get most common error patterns
      let commonQuery = `
        SELECT
          error_code,
          error_message,
          COUNT(*) as count
        FROM ${this.tableName}
      `;

      if (migrationId) {
        commonQuery += ` WHERE migration_id = $1`;
      }

      commonQuery += `
        GROUP BY error_code, error_message
        ORDER BY count DESC
        LIMIT 10
      `;

      const commonResult = await this.db.query(commonQuery, values);

      const mostCommonErrors = commonResult.rows.map(commonRow => ({
        error_code: commonRow.error_code,
        error_message: commonRow.error_message.length > 100
          ? commonRow.error_message.substring(0, 100) + '...'
          : commonRow.error_message,
        count: parseInt(commonRow.count),
        percentage: totalErrors > 0 ? Math.round((parseInt(commonRow.count) / totalErrors) * 100) : 0
      }));

      return {
        total_errors: totalErrors,
        unresolved_errors: parseInt(row.unresolved_errors) || 0,
        resolved_errors: resolvedErrors,
        resolution_rate: resolutionRate,
        by_type: byType,
        by_entity: byEntity,
        recent_errors: parseInt(row.recent_errors) || 0,
        critical_errors: byType['critical'] || 0,
        most_common_errors: mostCommonErrors
      };

    } catch (error) {
      this.logger.error('Failed to get error statistics', error);
      throw new DatabaseError(
        `Failed to get error statistics: ${(error as Error).message}`,
        'MIGRATION_ERROR_STATS_ERROR',
        { migration_id: migrationId }
      );
    }
  }

  /**
   * Get error trend analysis
   */
  async getErrorTrendAnalysis(migrationId: string, daysPast: number = 7): Promise<ErrorTrendAnalysis> {
    try {
      // Get daily error counts
      const dailyQuery = `
        SELECT
          DATE(occurred_at) as error_date,
          COUNT(*) as error_count,
          COUNT(CASE WHEN is_resolved = true THEN 1 END) as resolved_count
        FROM ${this.tableName}
        WHERE migration_id = $1
          AND occurred_at >= NOW() - INTERVAL '${daysPast} days'
        GROUP BY DATE(occurred_at)
        ORDER BY error_date DESC
      `;

      const dailyResult = await this.db.query(dailyQuery, [migrationId]);

      const dailyErrorCounts = dailyResult.rows.map(row => ({
        date: row.error_date,
        error_count: parseInt(row.error_count),
        resolved_count: parseInt(row.resolved_count)
      }));

      // Determine trend
      let errorRateTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
      if (dailyErrorCounts.length >= 2) {
        const recentAvg = dailyErrorCounts.slice(0, Math.ceil(dailyErrorCounts.length / 2))
          .reduce((sum, day) => sum + day.error_count, 0) / Math.ceil(dailyErrorCounts.length / 2);
        const olderAvg = dailyErrorCounts.slice(Math.floor(dailyErrorCounts.length / 2))
          .reduce((sum, day) => sum + day.error_count, 0) / Math.floor(dailyErrorCounts.length / 2);

        if (recentAvg > olderAvg * 1.2) {
          errorRateTrend = 'increasing';
        } else if (recentAvg < olderAvg * 0.8) {
          errorRateTrend = 'decreasing';
        }
      }

      // Calculate average resolution time
      const resolutionTimeQuery = `
        SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600) as avg_resolution_hours
        FROM ${this.tableName}
        WHERE migration_id = $1 AND is_resolved = true
      `;

      const resolutionResult = await this.db.query(resolutionTimeQuery, [migrationId]);
      const avgResolutionHours = parseFloat(resolutionResult.rows[0]?.avg_resolution_hours) || 0;

      // Find recurring issues
      const recurringQuery = `
        SELECT
          error_code,
          COUNT(*) as occurrences,
          MIN(occurred_at) as first_seen,
          MAX(occurred_at) as last_seen,
          array_agg(DISTINCT COALESCE(context->>'entity_name', 'unknown')) as entities_affected
        FROM ${this.tableName}
        WHERE migration_id = $1
        GROUP BY error_code
        HAVING COUNT(*) >= 3
        ORDER BY occurrences DESC
        LIMIT 5
      `;

      const recurringResult = await this.db.query(recurringQuery, [migrationId]);

      const recurringIssues = recurringResult.rows.map(row => ({
        error_pattern: row.error_code,
        occurrences: parseInt(row.occurrences),
        first_seen: new Date(row.first_seen),
        last_seen: new Date(row.last_seen),
        entities_affected: row.entities_affected.filter((entity: string) => entity !== 'unknown')
      }));

      return {
        daily_error_counts: dailyErrorCounts,
        error_rate_trend: errorRateTrend,
        resolution_time_average_hours: Math.round(avgResolutionHours * 10) / 10, // Round to 1 decimal
        recurring_issues: recurringIssues
      };

    } catch (error) {
      this.logger.error('Failed to get error trend analysis', error);
      throw new DatabaseError(
        `Failed to get error trend analysis: ${(error as Error).message}`,
        'MIGRATION_ERROR_TREND_ANALYSIS_ERROR',
        { migration_id: migrationId }
      );
    }
  }

  /**
   * Get error context analysis for debugging
   */
  async getErrorContextAnalysis(migrationId: string, errorCode: string): Promise<{
    error_instances: number;
    affected_entities: string[];
    affected_batches: string[];
    common_context_patterns: Record<string, any>;
    source_record_patterns: Record<string, any>;
  }> {
    try {
      const query = `
        SELECT
          COUNT(*) as error_instances,
          array_agg(DISTINCT entity_status_id) as entity_ids,
          array_agg(DISTINCT batch_id) FILTER (WHERE batch_id IS NOT NULL) as batch_ids,
          jsonb_object_agg(
            'context_' || row_number() OVER (),
            context
          ) as contexts,
          jsonb_object_agg(
            'source_' || row_number() OVER (),
            source_data
          ) as source_data_samples
        FROM ${this.tableName}
        WHERE migration_id = $1 AND error_code = $2
      `;

      const result = await this.db.query(query, [migrationId, errorCode]);
      const row = result.rows[0];

      return {
        error_instances: parseInt(row.error_instances) || 0,
        affected_entities: row.entity_ids || [],
        affected_batches: row.batch_ids || [],
        common_context_patterns: row.contexts || {},
        source_record_patterns: row.source_data_samples || {}
      };

    } catch (error) {
      this.logger.error('Failed to get error context analysis', error);
      throw new DatabaseError(
        `Failed to get error context analysis: ${(error as Error).message}`,
        'MIGRATION_ERROR_CONTEXT_ANALYSIS_ERROR',
        { migration_id: migrationId, error_code: errorCode }
      );
    }
  }

  /**
   * Delete migration error
   */
  async delete(id: string): Promise<boolean> {
    try {
      this.logger.info('Deleting migration error', { error_id: id });

      const query = `DELETE FROM ${this.tableName} WHERE id = $1`;
      const result = await this.db.query(query, [id]);

      const deleted = result.rowCount > 0;

      if (deleted) {
        this.logger.info('Migration error deleted successfully', { error_id: id });
      } else {
        this.logger.warn('Migration error not found for deletion', { error_id: id });
      }

      return deleted;

    } catch (error) {
      this.logger.error('Failed to delete migration error', error);
      throw new DatabaseError(
        `Failed to delete migration error: ${(error as Error).message}`,
        'MIGRATION_ERROR_DELETE_ERROR',
        { error_id: id }
      );
    }
  }

  /**
   * Ensure migration errors table exists
   */
  async ensureTableExists(): Promise<void> {
    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          migration_id UUID NOT NULL,
          entity_status_id UUID,
          batch_id UUID,
          error_type VARCHAR(50) NOT NULL CHECK (error_type IN ('connection_error', 'data_validation', 'constraint_violation', 'timeout', 'unknown')),
          error_code VARCHAR(100) NOT NULL,
          error_message TEXT NOT NULL,
          source_record_id VARCHAR(255),
          source_data JSONB NOT NULL DEFAULT '{}',
          context JSONB NOT NULL DEFAULT '{}',
          stack_trace TEXT,
          occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          is_resolved BOOLEAN NOT NULL DEFAULT false,
          resolution_notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

          CONSTRAINT non_empty_error_message CHECK (LENGTH(error_message) > 0),
          CONSTRAINT non_empty_error_code CHECK (LENGTH(error_code) > 0)
        )
      `;

      await this.db.query(createTableQuery);

      // Create indexes for performance
      const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_migration_id ON ${this.tableName} (migration_id)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_entity_status_id ON ${this.tableName} (entity_status_id)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_batch_id ON ${this.tableName} (batch_id)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_error_type ON ${this.tableName} (error_type)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_error_code ON ${this.tableName} (error_code)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_occurred_at ON ${this.tableName} (occurred_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_unresolved ON ${this.tableName} (migration_id, is_resolved) WHERE is_resolved = false`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_recent ON ${this.tableName} (occurred_at DESC) WHERE occurred_at > NOW() - INTERVAL '24 hours'`
      ];

      for (const indexQuery of indexes) {
        await this.db.query(indexQuery);
      }

      this.logger.info(`Migration errors table and indexes ensured`);

    } catch (error) {
      this.logger.error('Failed to ensure migration errors table exists', error);
      throw new DatabaseError(
        `Failed to create migration errors table: ${(error as Error).message}`,
        'TABLE_CREATION_ERROR'
      );
    }
  }

  /**
   * Validate create data
   */
  private validateCreateData(data: CreateMigrationErrorData): void {
    if (!data.migration_id || !MigrationModelValidation.validateUUID(data.migration_id)) {
      throw new ValidationError('Valid migration ID is required', 'MISSING_MIGRATION_ID');
    }

    if (data.entity_status_id && !MigrationModelValidation.validateUUID(data.entity_status_id)) {
      throw new ValidationError('Entity status ID must be valid UUID', 'INVALID_ENTITY_STATUS_ID');
    }

    if (data.batch_id && !MigrationModelValidation.validateUUID(data.batch_id)) {
      throw new ValidationError('Batch ID must be valid UUID', 'INVALID_BATCH_ID');
    }

    if (!Object.values(ErrorType).includes(data.error_type)) {
      throw new ValidationError(
        `Invalid error type: ${data.error_type}`,
        'INVALID_ERROR_TYPE',
        { error_type: data.error_type }
      );
    }

    if (!data.error_code || data.error_code.trim() === '') {
      throw new ValidationError('Error code is required', 'MISSING_ERROR_CODE');
    }

    if (!data.error_message || data.error_message.trim() === '') {
      throw new ValidationError('Error message is required', 'MISSING_ERROR_MESSAGE');
    }

    if (!MigrationModelValidation.validateJSON(data.source_data)) {
      throw new ValidationError('Source data must be valid JSON', 'INVALID_SOURCE_DATA_JSON');
    }

    if (!MigrationModelValidation.validateJSON(data.context)) {
      throw new ValidationError('Context must be valid JSON', 'INVALID_CONTEXT_JSON');
    }
  }

  /**
   * Validate update data
   */
  private validateUpdateData(data: UpdateMigrationErrorData): void {
    // Only is_resolved and resolution_notes are allowed to be updated
    if (data.is_resolved === undefined && data.resolution_notes === undefined) {
      throw new ValidationError('At least one field must be provided for update', 'NO_UPDATE_FIELDS');
    }

    if (data.is_resolved === true && (!data.resolution_notes || data.resolution_notes.trim() === '')) {
      throw new ValidationError('Resolution notes are required when marking error as resolved', 'MISSING_RESOLUTION_NOTES');
    }
  }

  /**
   * Map database row to domain object
   */
  private mapDatabaseRow(row: any): MigrationError {
    return {
      id: row.id,
      migration_id: row.migration_id,
      entity_status_id: row.entity_status_id,
      batch_id: row.batch_id,
      error_type: row.error_type,
      error_code: row.error_code,
      error_message: row.error_message,
      source_record_id: row.source_record_id,
      source_data: typeof row.source_data === 'string' ? JSON.parse(row.source_data) : row.source_data,
      context: typeof row.context === 'string' ? JSON.parse(row.context) : row.context,
      stack_trace: row.stack_trace,
      occurred_at: new Date(row.occurred_at),
      is_resolved: row.is_resolved,
      resolution_notes: row.resolution_notes,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }
}