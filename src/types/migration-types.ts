// TypeScript interfaces for Database Migration and Synchronization System
// Based on data model entities and database schema

// Core enums for type safety
export enum OperationType {
  DIFFERENTIAL_MIGRATION = 'differential_migration',
  SYNC_OPERATION = 'sync_operation',
  VALIDATION = 'validation'
}

export enum CheckpointStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PAUSED = 'paused'
}

export enum ComparisonType {
  MISSING_RECORDS = 'missing_records',
  CONFLICTED_RECORDS = 'conflicted_records',
  DELETED_RECORDS = 'deleted_records'
}

export enum ResolutionStrategy {
  SOURCE_WINS = 'source_wins',
  TARGET_WINS = 'target_wins',
  MANUAL_REVIEW = 'manual_review',
  SKIP = 'skip'
}

export enum JobType {
  SCHEDULED_SYNC = 'scheduled_sync',
  MANUAL_SYNC = 'manual_sync',
  DIFFERENTIAL_MIGRATION = 'differential_migration'
}

export enum SyncDirection {
  SOURCE_TO_TARGET = 'source_to_target',
  BIDIRECTIONAL = 'bidirectional'
}

export enum ConflictResolution {
  SOURCE_WINS = 'source_wins',
  TARGET_WINS = 'target_wins',
  MANUAL = 'manual'
}

export enum JobStatus {
  SCHEDULED = 'scheduled',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PAUSED = 'paused',
  CANCELLED = 'cancelled'
}

export enum ValidationType {
  DATA_INTEGRITY = 'data_integrity',
  RELATIONSHIP_INTEGRITY = 'relationship_integrity',
  COMPLETENESS_CHECK = 'completeness_check',
  PERFORMANCE_CHECK = 'performance_check'
}

export enum ValidationStatus {
  PENDING = 'pending',
  VALIDATED = 'validated',
  ERROR = 'error'
}

export enum RunType {
  SCHEDULED = 'scheduled',
  MANUAL = 'manual',
  RETRY = 'retry'
}

export enum RunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

// Core entity interfaces
export interface MigrationCheckpoint {
  id: string;
  operation_type: OperationType;
  entity_type: string;
  last_processed_id?: string;
  records_processed: number;
  records_total?: number;
  batch_size: number;
  status: CheckpointStatus;
  started_at: Date;
  completed_at?: Date;
  error_message?: string;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface DataDifferential {
  id: string;
  source_table: string;
  target_table: string;
  comparison_type: ComparisonType;
  legacy_ids: any[];
  record_count: number;
  comparison_criteria: Record<string, any>;
  resolution_strategy: ResolutionStrategy;
  resolved: boolean;
  resolved_at?: Date;
  created_at: Date;
  metadata: Record<string, any>;
}

export interface SynchronizationJob {
  id: string;
  job_name: string;
  job_type: JobType;
  schedule_config: Record<string, any>;
  entities_to_sync: string[];
  sync_direction: SyncDirection;
  conflict_resolution: ConflictResolution;
  max_records_per_batch: number;
  status: JobStatus;
  last_run_at?: Date;
  next_run_at?: Date;
  total_records_synced: number;
  success_rate: number;
  average_duration_ms: number;
  created_at: Date;
  updated_at: Date;
  metadata: Record<string, any>;
}

export interface MigrationValidationReport {
  id: string;
  validation_type: ValidationType;
  source_entity: string;
  target_entity: string;
  records_validated: number;
  validation_passed: boolean;
  discrepancies_found: number;
  discrepancy_details: Record<string, any>;
  validation_criteria: Record<string, any>;
  execution_time_ms: number;
  generated_at: Date;
  expires_at: Date;
  metadata: Record<string, any>;
}

export interface SyncRunHistory {
  id: string;
  job_id: string;
  run_type: RunType;
  started_at: Date;
  completed_at?: Date;
  records_synced: number;
  records_failed: number;
  status: RunStatus;
  error_summary?: string;
  performance_metrics: Record<string, any>;
  entities_processed: string[];
  created_at: Date;
}

export interface LegacyIdMapping {
  id: string;
  entity_type: string;
  legacy_id: number;
  uuid_id: string;
  migration_batch: string;
  migration_timestamp: Date;
  validation_status: ValidationStatus;
  source_table: string;
  target_table: string;
  checksum: string;
  metadata: Record<string, any>;
}

// Supporting interfaces for services and operations
export interface MigrationStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  skipped: number;
  duration?: number;
}

export interface BatchProcessorConfig {
  batchSize: number;
  maxRetries: number;
  retryDelay: number;
  parallelism: number;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

export interface DifferentialMigrationOptions {
  entities: string[];
  batchSize?: number;
  dryRun?: boolean;
  conflictResolution?: ConflictResolution;
  skipValidation?: boolean;
}

export interface SyncJobConfig {
  jobName: string;
  schedule: string;
  entities: string[];
  conflictResolution: ConflictResolution;
  maxRecords: number;
  description?: string;
}

export interface ValidationOptions {
  validationType: ValidationType;
  entities: string[];
  samplingRate?: number;
  timeout?: number;
  verbose?: boolean;
}

export interface ConflictResolutionResult {
  conflicts_detected: number;
  conflicts_resolved: number;
  resolution_strategy: ResolutionStrategy;
  failed_resolutions: number;
  resolution_details: Record<string, any>;
}

export interface DataComparisonResult {
  missing_records: number;
  conflicted_records: number;
  deleted_records: number;
  identical_records: number;
  total_source_records: number;
  total_target_records: number;
  comparison_timestamp: Date;
}

export interface CheckpointInfo {
  checkpoint_id: string;
  entity_type: string;
  last_processed_id?: string;
  progress_percentage: number;
  estimated_time_remaining?: number;
  can_resume: boolean;
}

// CLI Command interfaces for API contracts
export interface DifferentialMigrationRequest {
  entities: string[];
  batchSize?: number;
  dryRun?: boolean;
}

export interface DifferentialMigrationResponse {
  operationId: string;
  totalProcessed: number;
  successful: number;
  failed: number;
  skipped: number;
  duration: number;
  checkpoints: MigrationCheckpoint[];
  errors: MigrationError[];
}

export interface SyncJobRequest {
  jobName: string;
  schedule: string;
  entities: string[];
  conflictResolution?: ConflictResolution;
  maxRecords?: number;
}

export interface SyncJobResponse {
  jobId: string;
  jobName: string;
  status: JobStatus;
  nextRunAt?: Date;
  createdAt: Date;
}

export interface ValidationRequest {
  validationType: ValidationType;
  entities: string[];
  samplingRate?: number;
}

export interface ValidationResponse {
  validationId: string;
  validationType: ValidationType;
  recordsValidated: number;
  validationPassed: boolean;
  discrepanciesFound: number;
  executionTime: number;
  reports: ValidationReport[];
  generatedAt: Date;
}

export interface MigrationError {
  entityType: string;
  legacyId: string;
  errorCode: string;
  errorMessage: string;
  timestamp: Date;
}

export interface ValidationReport {
  entity: string;
  recordsChecked: number;
  issuesFound: number;
  issues: ValidationIssue[];
}

export interface ValidationIssue {
  type: string;
  description: string;
  affectedRecords: number;
}

export interface SyncRunSummary {
  runId: string;
  startedAt: Date;
  completedAt?: Date;
  recordsSynced: number;
  status: RunStatus;
}

// Error types for better error handling
export class MigrationError extends Error {
  constructor(
    message: string,
    public entityType?: string,
    public legacyId?: string,
    public errorCode?: string
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public validationType?: ValidationType,
    public entity?: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ConflictResolutionError extends Error {
  constructor(
    message: string,
    public conflictType?: ComparisonType,
    public resolutionStrategy?: ResolutionStrategy
  ) {
    super(message);
    this.name = 'ConflictResolutionError';
  }
}

export class CheckpointError extends Error {
  constructor(
    message: string,
    public checkpointId?: string,
    public operation?: string
  ) {
    super(message);
    this.name = 'CheckpointError';
  }
}