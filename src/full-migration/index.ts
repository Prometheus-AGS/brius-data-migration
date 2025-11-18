/**
 * Full Migration System - Main Entry Point
 *
 * Comprehensive database migration system with orchestration,
 * validation, and CLI capabilities.
 */

export { FullMigrationOrchestrator } from './full-migration-orchestrator';
export { FullMigrationCli } from './full-migration-cli';
export { FullMigrationValidator } from './full-migration-validator';

export type {
  MigrationEntity,
  MigrationPlan,
  MigrationProgress,
  MigrationResult
} from './full-migration-orchestrator';

export type {
  CliOptions
} from './full-migration-cli';

export type {
  ValidationType,
  ValidationRule,
  ValidationIssue,
  ValidationResult,
  ValidationStatistics,
  EntityValidationResult
} from './full-migration-validator';

// Export convenience functions for common use cases
export { initializeFullMigrationSystem, executeFullMigration, validateMigration } from './full-migration-utils';