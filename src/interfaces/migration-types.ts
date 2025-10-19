/**
 * T001: TypeScript interfaces from contracts
 * Final Database Migration Phase - Core Type Definitions
 */

// Re-export all interfaces from the contracts for easy importing
export * from '../../specs/004-specify-scripts-bash/contracts/migration-interfaces';
export * from '../../specs/004-specify-scripts-bash/contracts/migration-service-api';

// Additional types specific to this migration phase
export interface FinalMigrationPhase {
  tables: readonly [
    'template_view_groups',
    'template_view_roles',
    'technicians',
    'technician_roles',
    'brackets',
    'treatment_discussions',
    'order_cases',
    'message_attachments',
    'purchases'
  ];
  totalEstimatedRecords: number;
  estimatedDuration: number; // milliseconds
  criticalTables: string[];
  optionalTables: string[];
}

export interface TableMigrationMetadata {
  tableName: string;
  sourceTable: string;
  targetTable: string;
  complexity: 'low' | 'medium' | 'high';
  estimatedRecords: number;
  estimatedDuration: number; // milliseconds
  dependencies: string[];
  requiresValidation: boolean;
  supportResume: boolean;
  migrationOrder: number;
}

export interface SystemValidationResult {
  overallStatus: 'ready' | 'partial' | 'failed';
  tableResults: TableMigrationResult[];
  systemChecks: {
    connectivity: ValidationResult;
    schema: ValidationResult;
    dependencies: ValidationResult;
    relationships: ValidationResult;
    performance: ValidationResult;
    integrity: ValidationResult;
  };
  summary: {
    tables: {
      total: number;
      completed: number;
      partial: number;
      failed: number;
    };
    records: {
      total: number;
      byTable: Array<{ table: string; count: number }>;
    };
    issues: {
      total: number;
      byTable: Array<{ table: string; count: number }>;
    };
  };
  timestamp: Date;
  recommendedActions: string[];
}

// Additional interfaces for database connection management
export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface ConnectionStatus {
  sourceConnected: boolean;
  targetConnected: boolean;
  sourceError: string | null;
  targetError: string | null;
}

// Error handling interfaces
export interface MigrationContext {
  serviceName: string;
  tableName: string;
  operationPhase: string;
  batchNumber: number;
  recordNumber: number;
  timestamp: Date;
  additionalContext?: any;
}

export interface ErrorHandlingResult {
  canContinue: boolean;
  shouldRetry: boolean;
  skipCurrentRecord?: boolean;
  recoveryAction: string;
  abortMigration?: boolean;
  userNotificationRequired?: boolean;
}

export interface MigrationErrorHandler {
  handleError(error: Error, context: MigrationContext): Promise<ErrorHandlingResult>;
  isRecoverable(error: Error, context: MigrationContext): boolean;
  generateRecoveryPlan(error: Error, context: MigrationContext): ErrorRecovery;
}

// Batch processing interfaces
export interface BatchProcessingResult<T> {
  batchNumber: number;
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  errors: string[];
  results: T[];
}

export interface BatchProcessingOptions {
  sourceTable: string;
  targetTable: string;
  batchSize: number;
  transformRecord: (source: any, lookups: LookupMappings) => any;
  generateInsertQuery: () => { query: string; params: string[] };
}

// Report generation interfaces
export interface ReportGenerator {
  generateTableReport(serviceName: string, stats: MigrationStats, validation: ValidationResult): Promise<string>;
  generateFinalReport(results: TableMigrationResult[]): Promise<string>;
  saveReport(content: string, fileName: string): Promise<void>;
}

// Migration service interfaces
export interface MigrationService {
  migrate(): Promise<TableMigrationResult>;
  validate(): Promise<ValidationResult>;
  getProgress(): ProgressTracker;
}