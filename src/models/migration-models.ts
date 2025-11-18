/**
 * Migration Orchestration Data Models
 *
 * Comprehensive data models for the full database migration system.
 * Based on specifications in specs/001-full-database-migration/data-model.md
 */

import { Pool, PoolClient } from 'pg';

// ===== CORE ENUMS =====

export enum MigrationType {
  FULL_MIGRATION = 'full_migration',
  INCREMENTAL = 'incremental',
  SCHEMA_CLEANUP = 'schema_cleanup'
}

export enum MigrationStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  ROLLING_BACK = 'rolling_back'
}

export enum EntityStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped'
}

export enum CheckpointType {
  BATCH_COMPLETION = 'batch_completion',
  ENTITY_COMPLETION = 'entity_completion',
  ERROR_RECOVERY = 'error_recovery'
}

export enum BatchStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying'
}

export enum ErrorType {
  CONNECTION_ERROR = 'connection_error',
  DATA_VALIDATION = 'data_validation',
  CONSTRAINT_VIOLATION = 'constraint_violation',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown'
}

export enum SchemaOperationType {
  DROP_COLUMN = 'drop_column',
  ADD_COLUMN = 'add_column',
  MODIFY_COLUMN = 'modify_column',
  CREATE_BACKUP = 'create_backup'
}

export enum SchemaOperationStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  ROLLED_BACK = 'rolled_back'
}

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum ValidationType {
  REFERENTIAL_INTEGRITY = 'referential_integrity',
  DATA_COMPLETENESS = 'data_completeness',
  BUSINESS_RULES = 'business_rules',
  PERFORMANCE = 'performance'
}

export enum ValidationStatus {
  PASSED = 'passed',
  FAILED = 'failed',
  WARNING = 'warning'
}

// ===== CORE INTERFACES =====

export interface MigrationOrchestration {
  id: string;
  migration_type: MigrationType;
  status: MigrationStatus;
  started_at: Date;
  completed_at?: Date;
  progress_percentage: number;
  total_entities: number;
  completed_entities: number;
  error_count: number;
  configuration: Record<string, any>;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface EntityMigrationStatus {
  id: string;
  migration_id: string;
  entity_name: string;
  target_entity: string;
  dependency_order: number;
  status: EntityStatus;
  records_total: number;
  records_processed: number;
  records_failed: number;
  started_at: Date;
  completed_at?: Date;
  last_processed_id?: string;
  batch_size: number;
  throughput_per_second: number;
  created_at: Date;
  updated_at: Date;
}

export interface MigrationCheckpoint {
  id: string;
  migration_id: string;
  entity_name: string;
  checkpoint_type: CheckpointType;
  batch_number: number;
  last_source_id?: string;
  records_processed: number;
  system_state: Record<string, any>;
  created_at: Date;
  is_resumable: boolean;
}

export interface MigrationMapping {
  id: string;
  migration_id: string;
  source_table: string;
  source_id: string;
  destination_table: string;
  destination_id: string;
  entity_type: string;
  mapping_metadata: Record<string, any>;
  created_at: Date;
  is_active: boolean;
}

export interface BatchProcessingStatus {
  id: string;
  entity_status_id: string;
  batch_number: number;
  batch_size: number;
  status: BatchStatus;
  records_successful: number;
  records_failed: number;
  started_at: Date;
  completed_at?: Date;
  processing_duration_ms: number;
  retry_count: number;
  error_summary?: string;
  created_at: Date;
  updated_at: Date;
}

export interface MigrationError {
  id: string;
  migration_id: string;
  entity_status_id?: string;
  batch_id?: string;
  error_type: ErrorType;
  error_code: string;
  error_message: string;
  source_record_id?: string;
  source_data: Record<string, any>;
  context: Record<string, any>;
  stack_trace?: string;
  occurred_at: Date;
  is_resolved: boolean;
  resolution_notes?: string;
  created_at: Date;
  updated_at: Date;
}

export interface SchemaChangeOperation {
  id: string;
  migration_id: string;
  operation_type: SchemaOperationType;
  table_name: string;
  column_name?: string;
  operation_sql: string;
  status: SchemaOperationStatus;
  executed_at?: Date;
  rollback_sql: string;
  backup_table_name?: string;
  risk_level: RiskLevel;
  validation_results: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface LegacyEntityMapping {
  id: string;
  source_entity: string;
  destination_entity: string;
  transformation_rules: Record<string, any>;
  dependency_entities: string[];
  validation_rules: Record<string, any>;
  is_active: boolean;
  version: string;
  created_at: Date;
  updated_at: Date;
}

export interface DataValidationResult {
  id: string;
  migration_id: string;
  validation_type: ValidationType;
  entity_name: string;
  status: ValidationStatus;
  records_validated: number;
  issues_found: number;
  issue_details: Record<string, any>;
  validation_criteria: Record<string, any>;
  executed_at: Date;
  execution_duration_ms: number;
  created_at: Date;
}

// ===== CREATE TABLE INTERFACES =====

export interface CreateMigrationOrchestrationData {
  migration_type: MigrationType;
  status?: MigrationStatus;
  progress_percentage?: number;
  total_entities: number;
  completed_entities?: number;
  error_count?: number;
  configuration: Record<string, any>;
  created_by: string;
}

export interface CreateEntityMigrationStatusData {
  migration_id: string;
  entity_name: string;
  target_entity: string;
  dependency_order: number;
  status?: EntityStatus;
  records_total: number;
  records_processed?: number;
  records_failed?: number;
  batch_size: number;
  throughput_per_second?: number;
}

export interface CreateMigrationCheckpointData {
  migration_id: string;
  entity_name: string;
  checkpoint_type: CheckpointType;
  batch_number: number;
  last_source_id?: string;
  records_processed: number;
  system_state: Record<string, any>;
  is_resumable?: boolean;
}

export interface CreateMigrationMappingData {
  migration_id: string;
  source_table: string;
  source_id: string;
  destination_table: string;
  destination_id: string;
  entity_type: string;
  mapping_metadata?: Record<string, any>;
  is_active?: boolean;
}

export interface CreateBatchProcessingStatusData {
  entity_status_id: string;
  batch_number: number;
  batch_size: number;
  status?: BatchStatus;
  records_successful?: number;
  records_failed?: number;
  processing_duration_ms?: number;
  retry_count?: number;
  error_summary?: string;
}

export interface CreateMigrationErrorData {
  migration_id: string;
  entity_status_id?: string;
  batch_id?: string;
  error_type: ErrorType;
  error_code: string;
  error_message: string;
  source_record_id?: string;
  source_data: Record<string, any>;
  context: Record<string, any>;
  stack_trace?: string;
  is_resolved?: boolean;
  resolution_notes?: string;
}

export interface CreateSchemaChangeOperationData {
  migration_id: string;
  operation_type: SchemaOperationType;
  table_name: string;
  column_name?: string;
  operation_sql: string;
  status?: SchemaOperationStatus;
  rollback_sql: string;
  backup_table_name?: string;
  risk_level: RiskLevel;
  validation_results: Record<string, any>;
}

export interface CreateLegacyEntityMappingData {
  source_entity: string;
  destination_entity: string;
  transformation_rules: Record<string, any>;
  dependency_entities: string[];
  validation_rules: Record<string, any>;
  is_active?: boolean;
  version: string;
}

export interface CreateDataValidationResultData {
  migration_id: string;
  validation_type: ValidationType;
  entity_name: string;
  status: ValidationStatus;
  records_validated: number;
  issues_found: number;
  issue_details: Record<string, any>;
  validation_criteria: Record<string, any>;
  execution_duration_ms: number;
}

// ===== UPDATE INTERFACES =====

export interface UpdateMigrationOrchestrationData {
  status?: MigrationStatus;
  progress_percentage?: number;
  completed_entities?: number;
  error_count?: number;
  completed_at?: Date;
  configuration?: Record<string, any>;
}

export interface UpdateEntityMigrationStatusData {
  status?: EntityStatus;
  records_processed?: number;
  records_failed?: number;
  completed_at?: Date;
  last_processed_id?: string;
  throughput_per_second?: number;
}

export interface UpdateBatchProcessingStatusData {
  status?: BatchStatus;
  records_successful?: number;
  records_failed?: number;
  completed_at?: Date;
  processing_duration_ms?: number;
  retry_count?: number;
  error_summary?: string;
}

export interface UpdateMigrationErrorData {
  is_resolved?: boolean;
  resolution_notes?: string;
}

export interface UpdateSchemaChangeOperationData {
  status?: SchemaOperationStatus;
  executed_at?: Date;
  validation_results?: Record<string, any>;
}

// ===== QUERY FILTER INTERFACES =====

export interface MigrationOrchestrationFilters {
  migration_type?: MigrationType;
  status?: MigrationStatus;
  created_by?: string;
  created_after?: Date;
  created_before?: Date;
  limit?: number;
  offset?: number;
}

export interface EntityMigrationStatusFilters {
  migration_id?: string;
  entity_name?: string;
  status?: EntityStatus;
  dependency_order?: number;
  limit?: number;
  offset?: number;
}

export interface MigrationCheckpointFilters {
  migration_id?: string;
  entity_name?: string;
  checkpoint_type?: CheckpointType;
  is_resumable?: boolean;
  limit?: number;
  offset?: number;
}

export interface MigrationMappingFilters {
  migration_id?: string;
  source_table?: string;
  destination_table?: string;
  entity_type?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

export interface BatchProcessingStatusFilters {
  entity_status_id?: string;
  status?: BatchStatus;
  batch_number?: number;
  limit?: number;
  offset?: number;
}

export interface MigrationErrorFilters {
  migration_id?: string;
  entity_status_id?: string;
  error_type?: ErrorType;
  is_resolved?: boolean;
  occurred_after?: Date;
  occurred_before?: Date;
  limit?: number;
  offset?: number;
}

export interface SchemaChangeOperationFilters {
  migration_id?: string;
  operation_type?: SchemaOperationType;
  table_name?: string;
  status?: SchemaOperationStatus;
  risk_level?: RiskLevel;
  limit?: number;
  offset?: number;
}

export interface DataValidationResultFilters {
  migration_id?: string;
  validation_type?: ValidationType;
  entity_name?: string;
  status?: ValidationStatus;
  executed_after?: Date;
  executed_before?: Date;
  limit?: number;
  offset?: number;
}

// ===== VALIDATION UTILITIES =====

export class MigrationModelValidation {

  /**
   * Validate MigrationOrchestration state transitions
   */
  static validateMigrationStatusTransition(
    currentStatus: MigrationStatus,
    newStatus: MigrationStatus
  ): boolean {
    const validTransitions: Record<MigrationStatus, MigrationStatus[]> = {
      [MigrationStatus.PENDING]: [MigrationStatus.RUNNING],
      [MigrationStatus.RUNNING]: [MigrationStatus.COMPLETED, MigrationStatus.FAILED, MigrationStatus.ROLLING_BACK],
      [MigrationStatus.ROLLING_BACK]: [MigrationStatus.PENDING],
      [MigrationStatus.COMPLETED]: [], // Terminal state
      [MigrationStatus.FAILED]: [MigrationStatus.PENDING] // Can retry
    };

    return validTransitions[currentStatus]?.includes(newStatus) || false;
  }

  /**
   * Validate progress percentage is within bounds
   */
  static validateProgressPercentage(percentage: number): boolean {
    return percentage >= 0 && percentage <= 100;
  }

  /**
   * Validate completed entities does not exceed total
   */
  static validateEntityCounts(completed: number, total: number): boolean {
    return completed >= 0 && completed <= total;
  }

  /**
   * Validate batch record counts
   */
  static validateBatchRecords(successful: number, failed: number, batchSize: number): boolean {
    return successful >= 0 && failed >= 0 && (successful + failed) <= batchSize;
  }

  /**
   * Validate entity record counts
   */
  static validateEntityRecords(processed: number, failed: number, total: number): boolean {
    return processed >= 0 && failed >= 0 && (processed + failed) <= total;
  }

  /**
   * Validate timestamp sequence
   */
  static validateTimestamps(startedAt: Date, completedAt?: Date): boolean {
    if (!completedAt) return true;
    return startedAt.getTime() < completedAt.getTime();
  }

  /**
   * Validate dependency order uniqueness
   */
  static validateDependencyOrder(
    entityStatuses: Pick<EntityMigrationStatus, 'dependency_order' | 'migration_id' | 'id'>[],
    migrationId: string,
    newOrder: number,
    excludeId?: string
  ): boolean {
    const ordersInMigration = entityStatuses
      .filter(e => e.migration_id === migrationId && e.id !== excludeId)
      .map(e => e.dependency_order);

    return !ordersInMigration.includes(newOrder);
  }

  /**
   * Validate error type is known
   */
  static validateErrorType(errorType: string): boolean {
    return Object.values(ErrorType).includes(errorType as ErrorType);
  }

  /**
   * Validate JSON fields
   */
  static validateJSON(value: any): boolean {
    try {
      JSON.stringify(value);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate UUID format
   */
  static validateUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Validate entity name follows naming conventions
   */
  static validateEntityName(name: string): boolean {
    // Allow alphanumeric, underscores, and hyphens
    const nameRegex = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
    return nameRegex.test(name) && name.length >= 2 && name.length <= 100;
  }

  /**
   * Validate risk level for schema operations
   */
  static validateRiskLevel(level: string): boolean {
    return Object.values(RiskLevel).includes(level as RiskLevel);
  }

  /**
   * Validate batch number sequence
   */
  static validateBatchSequence(
    existingBatches: Pick<BatchProcessingStatus, 'batch_number'>[],
    newBatchNumber: number
  ): boolean {
    const existingNumbers = existingBatches.map(b => b.batch_number).sort((a, b) => a - b);

    // New batch number should be sequential (next in sequence)
    const expectedNext = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
    return newBatchNumber === expectedNext;
  }

  /**
   * Validate checkpoint sequence
   */
  static validateCheckpointSequence(
    existingCheckpoints: Pick<MigrationCheckpoint, 'batch_number' | 'created_at'>[],
    newBatchNumber: number
  ): boolean {
    // Checkpoints should be created in chronological order
    const sortedCheckpoints = existingCheckpoints.sort((a, b) =>
      a.created_at.getTime() - b.created_at.getTime()
    );

    if (sortedCheckpoints.length === 0) return true;

    const lastCheckpoint = sortedCheckpoints[sortedCheckpoints.length - 1];
    return newBatchNumber >= lastCheckpoint.batch_number;
  }
}

// ===== SUMMARY STATISTICS INTERFACES =====

export interface MigrationSummaryStats {
  migration_id: string;
  total_entities: number;
  completed_entities: number;
  failed_entities: number;
  total_records: number;
  processed_records: number;
  failed_records: number;
  overall_progress_percentage: number;
  average_throughput: number;
  total_errors: number;
  unresolved_errors: number;
  estimated_completion_time?: Date;
  started_at: Date;
  duration_ms?: number;
}

export interface EntitySummaryStats {
  entity_name: string;
  target_entity: string;
  status: EntityStatus;
  records_total: number;
  records_processed: number;
  records_failed: number;
  progress_percentage: number;
  throughput_per_second: number;
  total_batches: number;
  completed_batches: number;
  failed_batches: number;
  error_count: number;
  duration_ms?: number;
}

export interface BatchSummaryStats {
  entity_status_id: string;
  total_batches: number;
  completed_batches: number;
  failed_batches: number;
  retrying_batches: number;
  average_batch_size: number;
  average_processing_time_ms: number;
  total_records_successful: number;
  total_records_failed: number;
  success_rate_percentage: number;
}

export interface ErrorSummaryStats {
  migration_id: string;
  total_errors: number;
  resolved_errors: number;
  unresolved_errors: number;
  error_rate_percentage: number;
  most_common_error_types: Array<{
    error_type: ErrorType;
    count: number;
    percentage: number;
  }>;
  errors_by_entity: Array<{
    entity_name: string;
    error_count: number;
    resolved_count: number;
  }>;
}

// ===== EXPORT ALL TYPES =====

export * from './migration-models';