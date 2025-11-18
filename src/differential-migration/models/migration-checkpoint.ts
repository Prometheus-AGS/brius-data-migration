/**
 * MigrationCheckpoint Model
 * Stores resumable state information for interrupted migration operations
 */

import { v4 as uuidv4 } from 'uuid';

// Core interfaces
export interface MigrationCheckpoint {
  id: string;
  entity_type: string;
  migration_run_id: string;
  last_processed_id: string;
  batch_position: number;
  records_processed: number;
  records_remaining: number;
  checkpoint_data: object;
  created_at: Date;
  updated_at: Date;
}

export interface MigrationCheckpointCreateInput {
  entity_type: string;
  migration_run_id: string;
  last_processed_id?: string;
  batch_position?: number;
  records_processed?: number;
  records_remaining?: number;
  checkpoint_data?: object;
}

export interface MigrationCheckpointUpdateInput {
  last_processed_id?: string;
  batch_position?: number;
  records_processed?: number;
  records_remaining?: number;
  checkpoint_data?: object;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

// Valid entity types for checkpoint operations
const VALID_ENTITY_TYPES = [
  'offices', 'doctors', 'doctor_offices', 'patients', 'orders',
  'cases', 'files', 'case_files', 'messages', 'message_files',
  'jaw', 'dispatch_records', 'system_messages', 'message_attachments',
  'technician_roles', 'order_cases', 'purchases', 'treatment_discussions',
  'template_view_groups', 'template_view_roles'
] as const;

export type ValidEntityType = typeof VALID_ENTITY_TYPES[number];

/**
 * MigrationCheckpoint Model Implementation
 *
 * Provides functionality for creating, validating, and managing migration checkpoints
 * to enable pause/resume functionality for long-running differential migrations.
 */
export class MigrationCheckpointModel {
  /**
   * Creates a new migration checkpoint with validation
   */
  static create(input: MigrationCheckpointCreateInput): MigrationCheckpoint {
    // Input validation
    if (!input.entity_type || typeof input.entity_type !== 'string') {
      throw new Error('entity_type is required and must be a string');
    }

    if (!input.migration_run_id || typeof input.migration_run_id !== 'string') {
      throw new Error('migration_run_id is required and must be a string');
    }

    // Validate entity type
    if (!VALID_ENTITY_TYPES.includes(input.entity_type as ValidEntityType)) {
      throw new Error(`Invalid entity_type: ${input.entity_type}. Must be one of: ${VALID_ENTITY_TYPES.join(', ')}`);
    }

    // Validate numeric inputs
    if (input.batch_position !== undefined && (typeof input.batch_position !== 'number' || input.batch_position < 0)) {
      throw new Error('batch_position must be a non-negative number');
    }

    if (input.records_processed !== undefined && (typeof input.records_processed !== 'number' || input.records_processed < 0)) {
      throw new Error('records_processed must be a non-negative number');
    }

    if (input.records_remaining !== undefined && (typeof input.records_remaining !== 'number' || input.records_remaining < 0)) {
      throw new Error('records_remaining must be a non-negative number');
    }

    const now = new Date();

    const checkpoint: MigrationCheckpoint = {
      id: uuidv4(),
      entity_type: input.entity_type,
      migration_run_id: input.migration_run_id,
      last_processed_id: input.last_processed_id || '',
      batch_position: input.batch_position || 0,
      records_processed: input.records_processed || 0,
      records_remaining: input.records_remaining || 0,
      checkpoint_data: input.checkpoint_data || {},
      created_at: now,
      updated_at: now
    };

    // Final validation
    const validation = this.validate(checkpoint);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    return checkpoint;
  }

  /**
   * Validates a migration checkpoint against all business rules
   */
  static validate(checkpoint: MigrationCheckpoint): ValidationResult {
    const errors: string[] = [];

    // Validate required fields
    if (!checkpoint.id) {
      errors.push('id is required');
    }

    if (!checkpoint.entity_type) {
      errors.push('entity_type is required');
    }

    if (!checkpoint.migration_run_id) {
      errors.push('migration_run_id is required');
    }

    // Validate entity_type
    if (checkpoint.entity_type && !VALID_ENTITY_TYPES.includes(checkpoint.entity_type as ValidEntityType)) {
      errors.push('Invalid entity_type');
    }

    // Validate non-negative numbers
    if (checkpoint.records_processed < 0) {
      errors.push('records_processed must be non-negative');
    }

    if (checkpoint.records_remaining < 0) {
      errors.push('records_remaining must be non-negative');
    }

    if (checkpoint.batch_position < 0) {
      errors.push('batch_position must be non-negative');
    }

    // Validate timestamps
    if (checkpoint.created_at > checkpoint.updated_at) {
      errors.push('updated_at must be greater than or equal to created_at');
    }

    // Validate checkpoint_data is an object
    if (checkpoint.checkpoint_data && typeof checkpoint.checkpoint_data !== 'object') {
      errors.push('checkpoint_data must be an object');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Updates checkpoint progress with validation
   */
  static updateProgress(
    checkpoint: MigrationCheckpoint,
    updates: MigrationCheckpointUpdateInput
  ): MigrationCheckpoint {
    // Validate update inputs
    if (updates.batch_position !== undefined && (typeof updates.batch_position !== 'number' || updates.batch_position < 0)) {
      throw new Error('batch_position must be a non-negative number');
    }

    if (updates.records_processed !== undefined && (typeof updates.records_processed !== 'number' || updates.records_processed < 0)) {
      throw new Error('records_processed must be a non-negative number');
    }

    if (updates.records_remaining !== undefined && (typeof updates.records_remaining !== 'number' || updates.records_remaining < 0)) {
      throw new Error('records_remaining must be a non-negative number');
    }

    if (updates.checkpoint_data !== undefined && typeof updates.checkpoint_data !== 'object') {
      throw new Error('checkpoint_data must be an object');
    }

    // Create updated checkpoint
    const updatedCheckpoint: MigrationCheckpoint = {
      ...checkpoint,
      ...updates,
      updated_at: new Date()
    };

    // Validate the updated checkpoint
    const validation = this.validate(updatedCheckpoint);
    if (!validation.isValid) {
      throw new Error(`Update validation failed: ${validation.errors.join(', ')}`);
    }

    return updatedCheckpoint;
  }

  /**
   * Calculates checkpoint progress metrics
   */
  static calculateProgress(checkpoint: MigrationCheckpoint): {
    totalRecords: number;
    progressPercentage: number;
    isComplete: boolean;
    estimatedTimeRemaining: number | null;
  } {
    const totalRecords = checkpoint.records_processed + checkpoint.records_remaining;
    const progressPercentage = totalRecords > 0
      ? Math.round((checkpoint.records_processed / totalRecords) * 100 * 100) / 100
      : 0;

    const isComplete = checkpoint.records_remaining === 0;

    // Calculate estimated time remaining based on checkpoint data
    let estimatedTimeRemaining: number | null = null;

    if (checkpoint.checkpoint_data && typeof checkpoint.checkpoint_data === 'object') {
      const data = checkpoint.checkpoint_data as any;
      if (data.avg_processing_time_per_record && checkpoint.records_remaining > 0) {
        estimatedTimeRemaining = Math.round(data.avg_processing_time_per_record * checkpoint.records_remaining);
      }
    }

    return {
      totalRecords,
      progressPercentage,
      isComplete,
      estimatedTimeRemaining
    };
  }

  /**
   * Creates checkpoint data with processing statistics
   */
  static createCheckpointData(options: {
    batchSize?: number;
    processingStartTime?: Date;
    avgProcessingTimePerRecord?: number;
    errorsEncountered?: number;
    lastSuccessfulRecordId?: string;
    batchProcessingTimes?: number[];
    memoryUsageMb?: number;
    additionalData?: object;
  } = {}): object {
    const data: any = {
      batch_size: options.batchSize || 1000,
      processing_start: options.processingStartTime || new Date(),
      errors_encountered: options.errorsEncountered || 0,
      checkpoint_version: '1.0.0',
      created_by: 'differential-migration-system'
    };

    if (options.avgProcessingTimePerRecord) {
      data.avg_processing_time_per_record = options.avgProcessingTimePerRecord;
    }

    if (options.lastSuccessfulRecordId) {
      data.last_successful_record_id = options.lastSuccessfulRecordId;
    }

    if (options.batchProcessingTimes && options.batchProcessingTimes.length > 0) {
      data.batch_processing_times = options.batchProcessingTimes;
      data.avg_batch_time_ms = options.batchProcessingTimes.reduce((sum, time) => sum + time, 0) / options.batchProcessingTimes.length;
    }

    if (options.memoryUsageMb) {
      data.memory_usage_mb = options.memoryUsageMb;
    }

    if (options.additionalData) {
      Object.assign(data, options.additionalData);
    }

    return data;
  }

  /**
   * Determines if checkpoint is ready for resumption
   */
  static isResumable(checkpoint: MigrationCheckpoint): {
    resumable: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];

    // Check if there are remaining records to process
    if (checkpoint.records_remaining <= 0) {
      reasons.push('No remaining records to process');
    }

    // Check if checkpoint data contains necessary resume information
    if (!checkpoint.checkpoint_data || typeof checkpoint.checkpoint_data !== 'object') {
      reasons.push('Checkpoint data is missing or invalid');
    }

    // Check if the checkpoint is not too old (24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (checkpoint.updated_at < twentyFourHoursAgo) {
      reasons.push('Checkpoint is older than 24 hours and may be stale');
    }

    // Check if entity type is valid
    if (!VALID_ENTITY_TYPES.includes(checkpoint.entity_type as ValidEntityType)) {
      reasons.push('Invalid or unsupported entity type');
    }

    const resumable = reasons.length === 0;

    return { resumable, reasons };
  }

  /**
   * Serializes checkpoint for database storage
   */
  static serialize(checkpoint: MigrationCheckpoint): {
    id: string;
    entity_type: string;
    migration_run_id: string;
    last_processed_id: string;
    batch_position: number;
    records_processed: number;
    records_remaining: number;
    checkpoint_data: string; // JSON string
    created_at: string; // ISO string
    updated_at: string; // ISO string
  } {
    return {
      id: checkpoint.id,
      entity_type: checkpoint.entity_type,
      migration_run_id: checkpoint.migration_run_id,
      last_processed_id: checkpoint.last_processed_id,
      batch_position: checkpoint.batch_position,
      records_processed: checkpoint.records_processed,
      records_remaining: checkpoint.records_remaining,
      checkpoint_data: JSON.stringify(checkpoint.checkpoint_data),
      created_at: checkpoint.created_at.toISOString(),
      updated_at: checkpoint.updated_at.toISOString()
    };
  }

  /**
   * Deserializes checkpoint from database storage
   */
  static deserialize(data: any): MigrationCheckpoint {
    try {
      return {
        id: data.id,
        entity_type: data.entity_type,
        migration_run_id: data.migration_run_id,
        last_processed_id: data.last_processed_id,
        batch_position: parseInt(data.batch_position),
        records_processed: parseInt(data.records_processed),
        records_remaining: parseInt(data.records_remaining),
        checkpoint_data: typeof data.checkpoint_data === 'string' ? JSON.parse(data.checkpoint_data) : data.checkpoint_data,
        created_at: typeof data.created_at === 'string' ? new Date(data.created_at) : data.created_at,
        updated_at: typeof data.updated_at === 'string' ? new Date(data.updated_at) : data.updated_at
      };
    } catch (error) {
      throw new Error(`Failed to deserialize checkpoint: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generates a unique migration run ID
   */
  static generateMigrationRunId(entityType: string, sessionId?: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const session = sessionId ? sessionId.substring(0, 8) : uuidv4().substring(0, 8);
    return `${entityType}-${timestamp}-${session}`;
  }

  /**
   * Compares two checkpoints to determine which is more recent
   */
  static compareCheckpoints(a: MigrationCheckpoint, b: MigrationCheckpoint): number {
    // Compare by updated_at timestamp
    if (a.updated_at > b.updated_at) return 1;
    if (a.updated_at < b.updated_at) return -1;

    // If timestamps are equal, compare by records_processed
    if (a.records_processed > b.records_processed) return 1;
    if (a.records_processed < b.records_processed) return -1;

    // If still equal, compare by batch_position
    return a.batch_position - b.batch_position;
  }

  /**
   * Extracts processing statistics from checkpoint data
   */
  static extractProcessingStats(checkpoint: MigrationCheckpoint): {
    avgProcessingTimePerRecord: number | null;
    errorsEncountered: number;
    batchProcessingTimes: number[];
    memoryUsageMb: number | null;
    throughputRecordsPerSecond: number | null;
  } {
    const defaultStats = {
      avgProcessingTimePerRecord: null,
      errorsEncountered: 0,
      batchProcessingTimes: [],
      memoryUsageMb: null,
      throughputRecordsPerSecond: null
    };

    if (!checkpoint.checkpoint_data || typeof checkpoint.checkpoint_data !== 'object') {
      return defaultStats;
    }

    const data = checkpoint.checkpoint_data as any;

    // Calculate throughput if we have timing information
    let throughputRecordsPerSecond: number | null = null;
    if (data.processing_start && checkpoint.records_processed > 0) {
      const startTime = new Date(data.processing_start);
      const elapsedSeconds = (Date.now() - startTime.getTime()) / 1000;
      if (elapsedSeconds > 0) {
        throughputRecordsPerSecond = Math.round((checkpoint.records_processed / elapsedSeconds) * 100) / 100;
      }
    }

    return {
      avgProcessingTimePerRecord: data.avg_processing_time_per_record || null,
      errorsEncountered: data.errors_encountered || 0,
      batchProcessingTimes: data.batch_processing_times || [],
      memoryUsageMb: data.memory_usage_mb || null,
      throughputRecordsPerSecond
    };
  }

  /**
   * Creates a checkpoint with enhanced processing statistics
   */
  static createWithStats(
    input: MigrationCheckpointCreateInput,
    stats: {
      processingStartTime?: Date;
      avgProcessingTimePerRecord?: number;
      errorsEncountered?: number;
      batchProcessingTimes?: number[];
      memoryUsageMb?: number;
    } = {}
  ): MigrationCheckpoint {
    const checkpointData = this.createCheckpointData({
      processingStartTime: stats.processingStartTime,
      avgProcessingTimePerRecord: stats.avgProcessingTimePerRecord,
      errorsEncountered: stats.errorsEncountered,
      batchProcessingTimes: stats.batchProcessingTimes,
      memoryUsageMb: stats.memoryUsageMb,
      additionalData: input.checkpoint_data
    });

    return this.create({
      ...input,
      checkpoint_data: checkpointData
    });
  }

  /**
   * Creates structured checkpoint data
   */
  private static createCheckpointData(options: {
    batchSize?: number;
    processingStartTime?: Date;
    avgProcessingTimePerRecord?: number;
    errorsEncountered?: number;
    lastSuccessfulRecordId?: string;
    batchProcessingTimes?: number[];
    memoryUsageMb?: number;
    additionalData?: object;
  } = {}): object {
    const data: any = {
      batch_size: options.batchSize || 1000,
      processing_start: (options.processingStartTime || new Date()).toISOString(),
      errors_encountered: options.errorsEncountered || 0,
      checkpoint_version: '1.0.0',
      created_by: 'differential-migration-system',
      system_info: {
        node_version: process.version,
        platform: process.platform,
        timestamp: new Date().toISOString()
      }
    };

    if (options.avgProcessingTimePerRecord) {
      data.avg_processing_time_per_record = options.avgProcessingTimePerRecord;
    }

    if (options.lastSuccessfulRecordId) {
      data.last_successful_record_id = options.lastSuccessfulRecordId;
    }

    if (options.batchProcessingTimes && options.batchProcessingTimes.length > 0) {
      data.batch_processing_times = options.batchProcessingTimes;
      data.avg_batch_time_ms = Math.round(
        options.batchProcessingTimes.reduce((sum, time) => sum + time, 0) / options.batchProcessingTimes.length
      );
    }

    if (options.memoryUsageMb) {
      data.memory_usage_mb = options.memoryUsageMb;
    }

    if (options.additionalData) {
      Object.assign(data, options.additionalData);
    }

    return data;
  }

  /**
   * Checks if a checkpoint represents completion
   */
  static isCompleted(checkpoint: MigrationCheckpoint): boolean {
    return checkpoint.records_remaining === 0;
  }

  /**
   * Checks if a checkpoint needs attention (errors or warnings)
   */
  static needsAttention(checkpoint: MigrationCheckpoint): {
    needsAttention: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];

    // Check for errors in checkpoint data
    const stats = this.extractProcessingStats(checkpoint);
    if (stats.errorsEncountered > 0) {
      reasons.push(`${stats.errorsEncountered} error(s) encountered during processing`);
    }

    // Check for stalled progress (no updates in last 30 minutes)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    if (checkpoint.updated_at < thirtyMinutesAgo && checkpoint.records_remaining > 0) {
      reasons.push('Checkpoint has not been updated in over 30 minutes');
    }

    // Check for low throughput
    if (stats.throughputRecordsPerSecond && stats.throughputRecordsPerSecond < 10) {
      reasons.push('Processing throughput is below expected threshold (<10 records/second)');
    }

    // Check for high memory usage
    if (stats.memoryUsageMb && stats.memoryUsageMb > 400) {
      reasons.push('Memory usage is approaching limits (>400MB)');
    }

    return {
      needsAttention: reasons.length > 0,
      reasons
    };
  }

  /**
   * Creates a summary view of checkpoint for reporting
   */
  static createSummary(checkpoint: MigrationCheckpoint): {
    id: string;
    entityType: string;
    migrationRunId: string;
    progress: {
      totalRecords: number;
      progressPercentage: number;
      isComplete: boolean;
    };
    performance: {
      throughputRecordsPerSecond: number | null;
      errorsEncountered: number;
      memoryUsageMb: number | null;
    };
    timestamps: {
      createdAt: Date;
      updatedAt: Date;
      processingStart: Date | null;
    };
    status: 'active' | 'stalled' | 'completed' | 'needs_attention';
  } {
    const progress = this.calculateProgress(checkpoint);
    const stats = this.extractProcessingStats(checkpoint);
    const attention = this.needsAttention(checkpoint);

    // Determine status
    let status: 'active' | 'stalled' | 'completed' | 'needs_attention';
    if (progress.isComplete) {
      status = 'completed';
    } else if (attention.needsAttention) {
      status = 'needs_attention';
    } else if (checkpoint.updated_at < new Date(Date.now() - 30 * 60 * 1000)) {
      status = 'stalled';
    } else {
      status = 'active';
    }

    // Extract processing start time
    let processingStart: Date | null = null;
    if (checkpoint.checkpoint_data && typeof checkpoint.checkpoint_data === 'object') {
      const data = checkpoint.checkpoint_data as any;
      if (data.processing_start) {
        processingStart = new Date(data.processing_start);
      }
    }

    return {
      id: checkpoint.id,
      entityType: checkpoint.entity_type,
      migrationRunId: checkpoint.migration_run_id,
      progress: {
        totalRecords: progress.totalRecords,
        progressPercentage: progress.progressPercentage,
        isComplete: progress.isComplete
      },
      performance: {
        throughputRecordsPerSecond: stats.throughputRecordsPerSecond,
        errorsEncountered: stats.errorsEncountered,
        memoryUsageMb: stats.memoryUsageMb
      },
      timestamps: {
        createdAt: checkpoint.created_at,
        updatedAt: checkpoint.updated_at,
        processingStart
      },
      status
    };
  }
}