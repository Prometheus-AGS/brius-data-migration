/**
 * Migration Service API Contract
 * Final Database Migration Phase - Remaining Tables
 *
 * This defines the standardized API that all migration services must implement
 * for consistent execution, monitoring, and reporting.
 */
import { MigrationStats, MigrationConfig, ValidationResult, LookupMappings, ProgressTracker, ErrorRecovery } from './migration-interfaces';
/**
 * Standard Migration Service Interface
 * All migration scripts must implement this for consistency
 */
export interface MigrationService {
    /**
     * Get service metadata and capabilities
     */
    getMetadata(): MigrationServiceMetadata;
    /**
     * Prepare for migration - build mappings, validate prerequisites
     * @param config Migration configuration
     */
    prepare(config: MigrationConfig): Promise<PreparationResult>;
    /**
     * Execute the migration with progress tracking
     * @param config Migration configuration
     * @param progressCallback Callback for progress updates
     */
    execute(config: MigrationConfig, progressCallback?: (progress: ProgressTracker) => void): Promise<MigrationStats>;
    /**
     * Validate migration results
     * @param config Migration configuration
     */
    validate(config: MigrationConfig): Promise<ValidationResult>;
    /**
     * Get current progress status
     */
    getProgress(): ProgressTracker | null;
    /**
     * Handle error recovery
     * @param config Migration configuration
     * @param lastKnownState Error recovery state
     */
    recover(config: MigrationConfig, lastKnownState?: ErrorRecovery): Promise<boolean>;
    /**
     * Clean up resources
     */
    cleanup(): Promise<void>;
}
/**
 * Migration Service Metadata
 */
export interface MigrationServiceMetadata {
    serviceName: string;
    version: string;
    targetTable: string;
    sourceTable: string;
    dependencies: string[];
    estimatedRecords: number;
    estimatedDuration: number;
    complexityLevel: 'low' | 'medium' | 'high';
    supportResume: boolean;
    supportRollback: boolean;
    requiresValidation: boolean;
}
/**
 * Preparation Result
 */
export interface PreparationResult {
    success: boolean;
    lookupMappings: LookupMappings;
    sourceRecordCount: number;
    targetRecordCount: number;
    prerequisites: PrerequisiteCheck[];
    warnings: string[];
    errors: string[];
}
/**
 * Prerequisite Check Result
 */
export interface PrerequisiteCheck {
    check: string;
    passed: boolean;
    message: string;
    critical: boolean;
}
/**
 * Batch Processor Interface
 * Standardizes batch processing across all migrations
 */
export interface BatchProcessor<TSource, TTarget> {
    /**
     * Process a single batch of records
     * @param records Source records to process
     * @param batchNumber Current batch number
     * @param lookupMappings UUID mappings for foreign keys
     */
    processBatch(records: TSource[], batchNumber: number, lookupMappings: LookupMappings): Promise<BatchProcessingResult<TTarget>>;
    /**
     * Transform source record to target format
     * @param sourceRecord Record from source database
     * @param lookupMappings UUID mappings
     */
    transformRecord(sourceRecord: TSource, lookupMappings: LookupMappings): TTarget | null;
    /**
     * Validate transformed record before insertion
     * @param targetRecord Transformed record
     */
    validateRecord(targetRecord: TTarget): ValidationIssue[];
}
/**
 * Batch Processing Result
 */
export interface BatchProcessingResult<TTarget> {
    batchNumber: number;
    inputRecords: number;
    transformedRecords: TTarget[];
    skippedRecords: number;
    validationIssues: ValidationIssue[];
    insertionResult: {
        successful: number;
        failed: number;
        errors: string[];
    };
}
/**
 * Report Generator Interface
 */
export interface ReportGenerator {
    /**
     * Generate migration report for a single table
     * @param serviceName Name of migration service
     * @param stats Migration statistics
     * @param validation Validation results
     */
    generateTableReport(serviceName: string, stats: MigrationStats, validation: ValidationResult): Promise<string>;
    /**
     * Generate comprehensive final report
     * @param allResults All table migration results
     */
    generateFinalReport(allResults: TableMigrationResult[]): Promise<string>;
    /**
     * Generate progress report (for real-time monitoring)
     * @param currentProgress Current progress state
     */
    generateProgressReport(currentProgress: ProgressTracker[]): string;
}
/**
 * Error Handler Interface
 */
export interface MigrationErrorHandler {
    /**
     * Handle migration error with context
     * @param error The error that occurred
     * @param context Migration context when error occurred
     */
    handleError(error: Error, context: MigrationContext): Promise<ErrorHandlingResult>;
    /**
     * Determine if error is recoverable
     * @param error The error to analyze
     * @param context Migration context
     */
    isRecoverable(error: Error, context: MigrationContext): boolean;
    /**
     * Generate error recovery plan
     * @param error The error that occurred
     * @param context Migration context
     */
    generateRecoveryPlan(error: Error, context: MigrationContext): ErrorRecovery;
}
/**
 * Migration Context for Error Handling
 */
export interface MigrationContext {
    serviceName: string;
    tableName: string;
    batchNumber: number;
    recordNumber: number;
    operationPhase: 'preparation' | 'migration' | 'validation' | 'cleanup';
    timestamp: Date;
    additionalContext: object;
}
/**
 * Error Handling Result
 */
export interface ErrorHandlingResult {
    canContinue: boolean;
    shouldRetry: boolean;
    recoveryAction?: string;
    skipCurrentRecord?: boolean;
    skipCurrentBatch?: boolean;
    abortMigration?: boolean;
    userNotificationRequired?: boolean;
}
/**
 * Migration Configuration Builder
 */
export interface ConfigurationBuilder {
    /**
     * Build configuration from environment variables
     */
    buildFromEnv(): MigrationConfig;
    /**
     * Validate configuration settings
     * @param config Configuration to validate
     */
    validateConfig(config: MigrationConfig): ConfigValidationResult;
    /**
     * Get default configuration values
     */
    getDefaults(): Partial<MigrationConfig>;
}
/**
 * Configuration Validation Result
 */
export interface ConfigValidationResult {
    valid: boolean;
    issues: ConfigurationIssue[];
    warnings: string[];
}
/**
 * Configuration Issue
 */
export interface ConfigurationIssue {
    setting: string;
    issue: string;
    severity: 'error' | 'warning';
    suggestedValue?: string;
}
/**
 * Standard Configuration Constants
 */
export declare const MIGRATION_CONSTANTS: {
    readonly DEFAULT_BATCH_SIZE: 500;
    readonly MAX_BATCH_SIZE: 2000;
    readonly MIN_BATCH_SIZE: 10;
    readonly DEFAULT_TIMEOUT: 300000;
    readonly MAX_RETRY_ATTEMPTS: 3;
    readonly PROGRESS_UPDATE_INTERVAL: 1000;
    readonly LOG_ROTATION_SIZE: 100000000;
};
/**
 * Table Migration Order
 * Defines the required order for dependency management
 */
export declare const MIGRATION_ORDER: readonly ["template_view_groups", "template_view_roles", "technicians", "technician_roles", "brackets", "treatment_discussions", "order_cases", "message_attachments", "purchases"];
/**
 * Migration Priorities
 */
export declare const MIGRATION_PRIORITIES: {
    readonly CRITICAL: readonly ["message_attachments", "technicians", "technician_roles"];
    readonly IMPORTANT: readonly ["brackets", "order_cases", "purchases", "treatment_discussions"];
    readonly OPTIONAL: readonly ["template_view_groups", "template_view_roles"];
};
//# sourceMappingURL=migration-service-api.d.ts.map