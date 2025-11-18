/**
 * BatchProcessingStatus Model
 *
 * Detailed tracking of batch-level processing for performance monitoring.
 * Provides granular insight into migration performance, retry patterns,
 * and batch-level success/failure rates for optimization and debugging.
 */

import { Pool, PoolClient } from 'pg';
import {
  BatchProcessingStatus,
  CreateBatchProcessingStatusData,
  UpdateBatchProcessingStatusData,
  BatchProcessingStatusFilters,
  BatchStatus,
  MigrationModelValidation
} from './migration-models';
import { getLogger, Logger, DatabaseError, ValidationError, generateCorrelationId } from '../lib/error-handler';

export interface BatchPerformanceMetrics {
  total_batches: number;
  completed_batches: number;
  failed_batches: number;
  retrying_batches: number;
  average_batch_size: number;
  average_processing_time_ms: number;
  median_processing_time_ms: number;
  min_processing_time_ms: number;
  max_processing_time_ms: number;
  total_records_processed: number;
  total_records_failed: number;
  overall_success_rate: number;
  throughput_records_per_second: number;
  peak_throughput_records_per_second: number;
}

export interface BatchRetryAnalysis {
  total_retries: number;
  batches_with_retries: number;
  average_retries_per_failed_batch: number;
  max_retries_reached: number;
  retry_success_rate: number;
  most_common_retry_reasons: Array<{
    reason: string;
    count: number;
    percentage: number;
  }>;
}

export class BatchProcessingStatusModel {
  private db: Pool;
  private logger: Logger;
  private readonly tableName = 'batch_processing_statuses';

  constructor(db: Pool) {
    this.db = db;
    this.logger = getLogger();
  }

  /**
   * Create new batch processing status
   */
  async create(data: CreateBatchProcessingStatusData): Promise<BatchProcessingStatus> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    try {
      this.logger.info('Creating batch processing status', {
        entity_status_id: data.entity_status_id,
        batch_number: data.batch_number,
        batch_size: data.batch_size
      });

      // Validate input data
      await this.validateCreateData(data);

      const query = `
        INSERT INTO ${this.tableName} (
          id, entity_status_id, batch_number, batch_size, status,
          records_successful, records_failed, started_at, processing_duration_ms,
          retry_count, error_summary, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, NOW(), NOW()
        )
        RETURNING *
      `;

      const values = [
        data.entity_status_id,
        data.batch_number,
        data.batch_size,
        data.status || BatchStatus.PENDING,
        data.records_successful || 0,
        data.records_failed || 0,
        data.processing_duration_ms || 0,
        data.retry_count || 0,
        data.error_summary
      ];

      const result = await this.db.query(query, values);
      const batchStatus = this.mapDatabaseRow(result.rows[0]);

      this.logger.info('Batch processing status created successfully', {
        batch_status_id: batchStatus.id,
        entity_status_id: batchStatus.entity_status_id,
        batch_number: batchStatus.batch_number,
        correlation_id: correlationId
      });

      return batchStatus;

    } catch (error) {
      this.logger.error('Failed to create batch processing status', error);
      throw new DatabaseError(
        `Failed to create batch processing status: ${(error as Error).message}`,
        'BATCH_PROCESSING_STATUS_CREATE_ERROR',
        { data, correlation_id: correlationId }
      );
    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Update existing batch processing status
   */
  async update(id: string, data: UpdateBatchProcessingStatusData): Promise<BatchProcessingStatus> {
    const correlationId = generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    try {
      this.logger.info('Updating batch processing status', {
        batch_status_id: id,
        update_fields: Object.keys(data)
      });

      // Validate input data
      this.validateUpdateData(data);

      // Get current state for validation
      const current = await this.findById(id);
      if (!current) {
        throw new ValidationError(
          `Batch processing status with ID ${id} not found`,
          'BATCH_STATUS_NOT_FOUND',
          { batch_status_id: id }
        );
      }

      // Validate record counts
      if (data.records_successful !== undefined || data.records_failed !== undefined) {
        const newSuccessful = data.records_successful ?? current.records_successful;
        const newFailed = data.records_failed ?? current.records_failed;

        if (!MigrationModelValidation.validateBatchRecords(newSuccessful, newFailed, current.batch_size)) {
          throw new ValidationError(
            'Successful + failed records cannot exceed batch size',
            'INVALID_BATCH_RECORD_COUNTS',
            {
              records_successful: newSuccessful,
              records_failed: newFailed,
              batch_size: current.batch_size
            }
          );
        }
      }

      // Build dynamic update query
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (data.status !== undefined) {
        updateFields.push(`status = $${paramIndex++}`);
        values.push(data.status);
      }

      if (data.records_successful !== undefined) {
        updateFields.push(`records_successful = $${paramIndex++}`);
        values.push(data.records_successful);
      }

      if (data.records_failed !== undefined) {
        updateFields.push(`records_failed = $${paramIndex++}`);
        values.push(data.records_failed);
      }

      if (data.completed_at !== undefined) {
        if (data.completed_at && !MigrationModelValidation.validateTimestamps(current.started_at, data.completed_at)) {
          throw new ValidationError(
            'Completion time must be after start time',
            'INVALID_TIMESTAMP_SEQUENCE',
            {
              started_at: current.started_at,
              completed_at: data.completed_at
            }
          );
        }
        updateFields.push(`completed_at = $${paramIndex++}`);
        values.push(data.completed_at);
      }

      if (data.processing_duration_ms !== undefined) {
        updateFields.push(`processing_duration_ms = $${paramIndex++}`);
        values.push(data.processing_duration_ms);
      }

      if (data.retry_count !== undefined) {
        updateFields.push(`retry_count = $${paramIndex++}`);
        values.push(data.retry_count);
      }

      if (data.error_summary !== undefined) {
        updateFields.push(`error_summary = $${paramIndex++}`);
        values.push(data.error_summary);
      }

      if (updateFields.length === 0) {
        this.logger.warn('No fields to update', { batch_status_id: id });
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
          `Batch processing status with ID ${id} not found`,
          'BATCH_STATUS_NOT_FOUND',
          { batch_status_id: id }
        );
      }

      const batchStatus = this.mapDatabaseRow(result.rows[0]);

      this.logger.info('Batch processing status updated successfully', {
        batch_status_id: batchStatus.id,
        updated_fields: Object.keys(data),
        correlation_id: correlationId
      });

      return batchStatus;

    } catch (error) {
      this.logger.error('Failed to update batch processing status', error);
      throw new DatabaseError(
        `Failed to update batch processing status: ${(error as Error).message}`,
        'BATCH_PROCESSING_STATUS_UPDATE_ERROR',
        { batch_status_id: id, data, correlation_id: correlationId }
      );
    } finally {
      this.logger.clearContext();
    }
  }

  /**
   * Find batch processing status by ID
   */
  async findById(id: string): Promise<BatchProcessingStatus | null> {
    try {
      const query = `SELECT * FROM ${this.tableName} WHERE id = $1`;
      const result = await this.db.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapDatabaseRow(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find batch processing status by ID', error);
      throw new DatabaseError(
        `Failed to find batch processing status: ${(error as Error).message}`,
        'BATCH_PROCESSING_STATUS_FIND_ERROR',
        { batch_status_id: id }
      );
    }
  }

  /**
   * Find batch by entity status and batch number
   */
  async findByEntityAndBatchNumber(
    entityStatusId: string,
    batchNumber: number
  ): Promise<BatchProcessingStatus | null> {
    try {
      const query = `
        SELECT * FROM ${this.tableName}
        WHERE entity_status_id = $1 AND batch_number = $2
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const result = await this.db.query(query, [entityStatusId, batchNumber]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapDatabaseRow(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find batch by entity and batch number', error);
      throw new DatabaseError(
        `Failed to find batch processing status: ${(error as Error).message}`,
        'BATCH_PROCESSING_STATUS_FIND_BY_BATCH_ERROR',
        { entity_status_id: entityStatusId, batch_number: batchNumber }
      );
    }
  }

  /**
   * List batch processing statuses with filters
   */
  async list(filters: BatchProcessingStatusFilters = {}): Promise<BatchProcessingStatus[]> {
    try {
      const whereClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      // Build WHERE clauses based on filters
      if (filters.entity_status_id) {
        whereClauses.push(`entity_status_id = $${paramIndex++}`);
        values.push(filters.entity_status_id);
      }

      if (filters.status) {
        whereClauses.push(`status = $${paramIndex++}`);
        values.push(filters.status);
      }

      if (filters.batch_number !== undefined) {
        whereClauses.push(`batch_number = $${paramIndex++}`);
        values.push(filters.batch_number);
      }

      // Build complete query
      let query = `SELECT * FROM ${this.tableName}`;

      if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      query += ` ORDER BY batch_number ASC, created_at DESC`;

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
      this.logger.error('Failed to list batch processing statuses', error);
      throw new DatabaseError(
        `Failed to list batch processing statuses: ${(error as Error).message}`,
        'BATCH_PROCESSING_STATUS_LIST_ERROR',
        { filters }
      );
    }
  }

  /**
   * Get performance metrics for an entity
   */
  async getPerformanceMetrics(entityStatusId: string): Promise<BatchPerformanceMetrics> {
    try {
      const query = `
        SELECT
          COUNT(*) as total_batches,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_batches,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_batches,
          COUNT(CASE WHEN status = 'retrying' THEN 1 END) as retrying_batches,
          AVG(batch_size) as avg_batch_size,
          AVG(CASE WHEN status = 'completed' THEN processing_duration_ms END) as avg_processing_time_ms,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY processing_duration_ms) as median_processing_time_ms,
          MIN(CASE WHEN status = 'completed' THEN processing_duration_ms END) as min_processing_time_ms,
          MAX(processing_duration_ms) as max_processing_time_ms,
          SUM(records_successful) as total_records_processed,
          SUM(records_failed) as total_records_failed,
          MAX(CASE
            WHEN processing_duration_ms > 0 THEN
              (records_successful + records_failed) * 1000.0 / processing_duration_ms
            ELSE 0
          END) as peak_throughput_records_per_second
        FROM ${this.tableName}
        WHERE entity_status_id = $1
      `;

      const result = await this.db.query(query, [entityStatusId]);
      const row = result.rows[0];

      const totalRecordsProcessed = parseInt(row.total_records_processed) || 0;
      const totalRecordsFailed = parseInt(row.total_records_failed) || 0;
      const totalRecords = totalRecordsProcessed + totalRecordsFailed;

      const overallSuccessRate = totalRecords > 0
        ? Math.round((totalRecordsProcessed / totalRecords) * 100)
        : 0;

      const avgProcessingTime = parseFloat(row.avg_processing_time_ms) || 0;
      const avgBatchSize = parseFloat(row.avg_batch_size) || 0;

      const throughputRecordsPerSecond = avgProcessingTime > 0
        ? Math.round((avgBatchSize * 1000) / avgProcessingTime)
        : 0;

      return {
        total_batches: parseInt(row.total_batches) || 0,
        completed_batches: parseInt(row.completed_batches) || 0,
        failed_batches: parseInt(row.failed_batches) || 0,
        retrying_batches: parseInt(row.retrying_batches) || 0,
        average_batch_size: Math.round(avgBatchSize),
        average_processing_time_ms: Math.round(avgProcessingTime),
        median_processing_time_ms: Math.round(parseFloat(row.median_processing_time_ms) || 0),
        min_processing_time_ms: Math.round(parseFloat(row.min_processing_time_ms) || 0),
        max_processing_time_ms: Math.round(parseFloat(row.max_processing_time_ms) || 0),
        total_records_processed: totalRecordsProcessed,
        total_records_failed: totalRecordsFailed,
        overall_success_rate: overallSuccessRate,
        throughput_records_per_second: throughputRecordsPerSecond,
        peak_throughput_records_per_second: Math.round(parseFloat(row.peak_throughput_records_per_second) || 0)
      };

    } catch (error) {
      this.logger.error('Failed to get performance metrics', error);
      throw new DatabaseError(
        `Failed to get performance metrics: ${(error as Error).message}`,
        'BATCH_PROCESSING_METRICS_ERROR',
        { entity_status_id: entityStatusId }
      );
    }
  }

  /**
   * Get retry analysis for an entity
   */
  async getRetryAnalysis(entityStatusId: string): Promise<BatchRetryAnalysis> {
    try {
      const query = `
        SELECT
          SUM(retry_count) as total_retries,
          COUNT(CASE WHEN retry_count > 0 THEN 1 END) as batches_with_retries,
          AVG(CASE WHEN status = 'failed' THEN retry_count END) as avg_retries_per_failed_batch,
          COUNT(CASE WHEN retry_count >= 3 THEN 1 END) as max_retries_reached, -- Assuming max is 3
          COUNT(CASE WHEN retry_count > 0 AND status = 'completed' THEN 1 END) as retry_successes,
          COUNT(CASE WHEN retry_count > 0 THEN 1 END) as total_retry_attempts
        FROM ${this.tableName}
        WHERE entity_status_id = $1
      `;

      const result = await this.db.query(query, [entityStatusId]);
      const row = result.rows[0];

      const totalRetries = parseInt(row.total_retries) || 0;
      const totalRetryAttempts = parseInt(row.total_retry_attempts) || 0;
      const retrySuccesses = parseInt(row.retry_successes) || 0;

      const retrySuccessRate = totalRetryAttempts > 0
        ? Math.round((retrySuccesses / totalRetryAttempts) * 100)
        : 0;

      // Get most common retry reasons from error summaries
      const reasonQuery = `
        SELECT error_summary, COUNT(*) as count
        FROM ${this.tableName}
        WHERE entity_status_id = $1 AND retry_count > 0 AND error_summary IS NOT NULL
        GROUP BY error_summary
        ORDER BY count DESC
        LIMIT 5
      `;

      const reasonResult = await this.db.query(reasonQuery, [entityStatusId]);

      const mostCommonRetryReasons = reasonResult.rows.map(reasonRow => ({
        reason: reasonRow.error_summary,
        count: parseInt(reasonRow.count),
        percentage: totalRetryAttempts > 0
          ? Math.round((parseInt(reasonRow.count) / totalRetryAttempts) * 100)
          : 0
      }));

      return {
        total_retries: totalRetries,
        batches_with_retries: parseInt(row.batches_with_retries) || 0,
        average_retries_per_failed_batch: Math.round(parseFloat(row.avg_retries_per_failed_batch) || 0),
        max_retries_reached: parseInt(row.max_retries_reached) || 0,
        retry_success_rate: retrySuccessRate,
        most_common_retry_reasons: mostCommonRetryReasons
      };

    } catch (error) {
      this.logger.error('Failed to get retry analysis', error);
      throw new DatabaseError(
        `Failed to get retry analysis: ${(error as Error).message}`,
        'BATCH_PROCESSING_RETRY_ANALYSIS_ERROR',
        { entity_status_id: entityStatusId }
      );
    }
  }

  /**
   * Get batches needing retry
   */
  async getBatchesNeedingRetry(
    entityStatusId: string,
    maxRetryCount: number = 3
  ): Promise<BatchProcessingStatus[]> {
    try {
      const query = `
        SELECT * FROM ${this.tableName}
        WHERE entity_status_id = $1
          AND status = 'failed'
          AND retry_count < $2
        ORDER BY batch_number ASC
      `;

      const result = await this.db.query(query, [entityStatusId, maxRetryCount]);
      return result.rows.map(row => this.mapDatabaseRow(row));

    } catch (error) {
      this.logger.error('Failed to get batches needing retry', error);
      throw new DatabaseError(
        `Failed to get batches needing retry: ${(error as Error).message}`,
        'BATCH_PROCESSING_RETRY_LIST_ERROR',
        { entity_status_id: entityStatusId }
      );
    }
  }

  /**
   * Get slowest performing batches for analysis
   */
  async getSlowestBatches(
    entityStatusId: string,
    limit: number = 10
  ): Promise<Array<BatchProcessingStatus & { records_per_second: number }>> {
    try {
      const query = `
        SELECT *,
               CASE
                 WHEN processing_duration_ms > 0 THEN
                   ((records_successful + records_failed) * 1000.0 / processing_duration_ms)
                 ELSE 0
               END as records_per_second
        FROM ${this.tableName}
        WHERE entity_status_id = $1
          AND status = 'completed'
          AND processing_duration_ms > 0
        ORDER BY records_per_second ASC
        LIMIT $2
      `;

      const result = await this.db.query(query, [entityStatusId, limit]);

      return result.rows.map(row => ({
        ...this.mapDatabaseRow(row),
        records_per_second: Math.round(parseFloat(row.records_per_second))
      }));

    } catch (error) {
      this.logger.error('Failed to get slowest batches', error);
      throw new DatabaseError(
        `Failed to get slowest batches: ${(error as Error).message}`,
        'BATCH_PROCESSING_SLOWEST_ERROR',
        { entity_status_id: entityStatusId }
      );
    }
  }

  /**
   * Delete batch processing status
   */
  async delete(id: string): Promise<boolean> {
    try {
      this.logger.info('Deleting batch processing status', { batch_status_id: id });

      const query = `DELETE FROM ${this.tableName} WHERE id = $1`;
      const result = await this.db.query(query, [id]);

      const deleted = result.rowCount > 0;

      if (deleted) {
        this.logger.info('Batch processing status deleted successfully', { batch_status_id: id });
      } else {
        this.logger.warn('Batch processing status not found for deletion', { batch_status_id: id });
      }

      return deleted;

    } catch (error) {
      this.logger.error('Failed to delete batch processing status', error);
      throw new DatabaseError(
        `Failed to delete batch processing status: ${(error as Error).message}`,
        'BATCH_PROCESSING_STATUS_DELETE_ERROR',
        { batch_status_id: id }
      );
    }
  }

  /**
   * Ensure batch processing statuses table exists
   */
  async ensureTableExists(): Promise<void> {
    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          entity_status_id UUID NOT NULL,
          batch_number INTEGER NOT NULL CHECK (batch_number >= 0),
          batch_size INTEGER NOT NULL CHECK (batch_size > 0),
          status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retrying')),
          records_successful INTEGER NOT NULL DEFAULT 0 CHECK (records_successful >= 0),
          records_failed INTEGER NOT NULL DEFAULT 0 CHECK (records_failed >= 0),
          started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMP WITH TIME ZONE,
          processing_duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (processing_duration_ms >= 0),
          retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
          error_summary TEXT,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

          CONSTRAINT valid_batch_records CHECK (records_successful + records_failed <= batch_size),
          CONSTRAINT valid_timestamps CHECK (completed_at IS NULL OR completed_at >= started_at),
          CONSTRAINT unique_entity_batch UNIQUE (entity_status_id, batch_number)
        )
      `;

      await this.db.query(createTableQuery);

      // Create indexes for performance
      const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_entity_status_id ON ${this.tableName} (entity_status_id)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_status ON ${this.tableName} (status)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_batch_number ON ${this.tableName} (entity_status_id, batch_number)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_created_at ON ${this.tableName} (created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_failed_retries ON ${this.tableName} (entity_status_id, retry_count) WHERE status = 'failed'`,
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_performance ON ${this.tableName} (entity_status_id, processing_duration_ms) WHERE status = 'completed'`
      ];

      for (const indexQuery of indexes) {
        await this.db.query(indexQuery);
      }

      this.logger.info(`Batch processing statuses table and indexes ensured`);

    } catch (error) {
      this.logger.error('Failed to ensure batch processing statuses table exists', error);
      throw new DatabaseError(
        `Failed to create batch processing statuses table: ${(error as Error).message}`,
        'TABLE_CREATION_ERROR'
      );
    }
  }

  /**
   * Validate create data
   */
  private async validateCreateData(data: CreateBatchProcessingStatusData): Promise<void> {
    if (!data.entity_status_id || !MigrationModelValidation.validateUUID(data.entity_status_id)) {
      throw new ValidationError('Valid entity status ID is required', 'MISSING_ENTITY_STATUS_ID');
    }

    if (data.batch_number < 0) {
      throw new ValidationError('Batch number must be non-negative', 'INVALID_BATCH_NUMBER');
    }

    if (data.batch_size <= 0) {
      throw new ValidationError('Batch size must be positive', 'INVALID_BATCH_SIZE');
    }

    if (data.status && !Object.values(BatchStatus).includes(data.status)) {
      throw new ValidationError(
        `Invalid batch status: ${data.status}`,
        'INVALID_BATCH_STATUS',
        { status: data.status }
      );
    }

    // Check for existing batch number for same entity
    const existing = await this.findByEntityAndBatchNumber(data.entity_status_id, data.batch_number);
    if (existing) {
      throw new ValidationError(
        `Batch number ${data.batch_number} already exists for entity status ${data.entity_status_id}`,
        'DUPLICATE_BATCH_NUMBER',
        {
          entity_status_id: data.entity_status_id,
          batch_number: data.batch_number
        }
      );
    }

    // Validate record counts
    const recordsSuccessful = data.records_successful || 0;
    const recordsFailed = data.records_failed || 0;

    if (!MigrationModelValidation.validateBatchRecords(recordsSuccessful, recordsFailed, data.batch_size)) {
      throw new ValidationError(
        'Successful + failed records cannot exceed batch size',
        'INVALID_BATCH_RECORD_COUNTS',
        {
          records_successful: recordsSuccessful,
          records_failed: recordsFailed,
          batch_size: data.batch_size
        }
      );
    }
  }

  /**
   * Validate update data
   */
  private validateUpdateData(data: UpdateBatchProcessingStatusData): void {
    if (data.status && !Object.values(BatchStatus).includes(data.status)) {
      throw new ValidationError(
        `Invalid batch status: ${data.status}`,
        'INVALID_BATCH_STATUS',
        { status: data.status }
      );
    }

    if (data.records_successful !== undefined && data.records_successful < 0) {
      throw new ValidationError('Records successful must be non-negative', 'INVALID_RECORDS_SUCCESSFUL');
    }

    if (data.records_failed !== undefined && data.records_failed < 0) {
      throw new ValidationError('Records failed must be non-negative', 'INVALID_RECORDS_FAILED');
    }

    if (data.processing_duration_ms !== undefined && data.processing_duration_ms < 0) {
      throw new ValidationError('Processing duration must be non-negative', 'INVALID_PROCESSING_DURATION');
    }

    if (data.retry_count !== undefined && data.retry_count < 0) {
      throw new ValidationError('Retry count must be non-negative', 'INVALID_RETRY_COUNT');
    }
  }

  /**
   * Map database row to domain object
   */
  private mapDatabaseRow(row: any): BatchProcessingStatus {
    return {
      id: row.id,
      entity_status_id: row.entity_status_id,
      batch_number: row.batch_number,
      batch_size: row.batch_size,
      status: row.status,
      records_successful: row.records_successful,
      records_failed: row.records_failed,
      started_at: new Date(row.started_at),
      completed_at: row.completed_at ? new Date(row.completed_at) : undefined,
      processing_duration_ms: row.processing_duration_ms,
      retry_count: row.retry_count,
      error_summary: row.error_summary,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at)
    };
  }
}