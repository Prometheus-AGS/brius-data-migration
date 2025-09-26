#!/usr/bin/env node

// Data Validator CLI
// Command line interface for comprehensive data validation and integrity checks

import { Command } from 'commander';
import { Pool } from 'pg';
import { DataValidatorService } from '../services/data-validator';
import {
  ValidationType,
  ValidationOptions,
  ValidationError
} from '../types/migration-types';

// Database configuration
const sourceDbConfig = {
  host: process.env.SOURCE_DB_HOST || 'localhost',
  port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
  database: process.env.SOURCE_DB_NAME || 'dispatch_dev',
  user: process.env.SOURCE_DB_USER || 'postgres',
  password: process.env.SOURCE_DB_PASSWORD || ''
};

const targetDbConfig = {
  host: process.env.TARGET_DB_HOST || 'localhost',
  port: parseInt(process.env.TARGET_DB_PORT || '54322'),
  database: process.env.TARGET_DB_NAME || 'postgres',
  user: process.env.TARGET_DB_USER || 'supabase_admin',
  password: process.env.TARGET_DB_PASSWORD || 'postgres'
};

// Available entity types
const VALID_ENTITIES = [
  'offices', 'profiles', 'doctors', 'patients', 'orders',
  'products', 'jaws', 'projects', 'treatment-plans'
];

// Available validation types
const VALIDATION_TYPES = [
  'data_integrity',
  'relationship_integrity',
  'completeness_check',
  'performance_check'
];

/**
 * Initialize database connections
 */
function initializeConnections(): { sourceDb: Pool; targetDb: Pool } {
  const sourceDb = new Pool(sourceDbConfig);
  const targetDb = new Pool(targetDbConfig);

  return { sourceDb, targetDb };
}

/**
 * Validate entity types
 */
function validateEntities(entities: string[]): void {
  const invalidEntities = entities.filter(entity => !VALID_ENTITIES.includes(entity));
  if (invalidEntities.length > 0) {
    console.error(`❌ Invalid entity types: ${invalidEntities.join(', ')}`);
    console.error(`Valid entities: ${VALID_ENTITIES.join(', ')}`);
    process.exit(1);
  }
}

/**
 * Validate validation type
 */
function validateValidationType(validationType: string): ValidationType {
  if (!VALIDATION_TYPES.includes(validationType)) {
    console.error(`❌ Invalid validation type: ${validationType}`);
    console.error(`Valid types: ${VALIDATION_TYPES.join(', ')}`);
    process.exit(1);
  }
  return validationType as ValidationType;
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format date for display
 */
function formatDate(date: Date | string): string {
  return new Date(date).toLocaleString();
}

/**
 * Get validation type emoji
 */
function getValidationEmoji(validationType: ValidationType): string {
  const emojiMap: Record<ValidationType, string> = {
    [ValidationType.DATA_INTEGRITY]: '🔍',
    [ValidationType.RELATIONSHIP_INTEGRITY]: '🔗',
    [ValidationType.COMPLETENESS_CHECK]: '📊',
    [ValidationType.PERFORMANCE_CHECK]: '⚡'
  };
  return emojiMap[validationType] || '📋';
}

/**
 * Get issue type emoji
 */
function getIssueEmoji(issueType: string): string {
  const emojiMap: Record<string, string> = {
    'null_constraint_violation': '❌',
    'unique_constraint_violation': '🔄',
    'foreign_key_violation': '🔗',
    'invalid_email_format': '📧',
    'invalid_date_of_birth': '📅',
    'missing_records': '📉',
    'unexpected_records': '📈',
    'data_conflicts': '⚠️',
    'slow_query': '🐌',
    'query_error': '💥',
    'missing_indexes': '🏃',
    'large_table': '💾',
    'circular_reference': '🔄',
    'validation_error': '❌'
  };
  return emojiMap[issueType] || '⚠️';
}

/**
 * Display validation results
 */
function displayValidationResults(result: any): void {
  const validationEmoji = getValidationEmoji(result.validationType);
  const statusEmoji = result.validationPassed ? '✅' : '❌';

  console.log(`\n${validationEmoji} ${statusEmoji} Validation Results:`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📋 Validation ID: ${result.validationId}`);
  console.log(`🔍 Type: ${result.validationType.replace(/_/g, ' ').toUpperCase()}`);
  console.log(`📊 Records Validated: ${result.recordsValidated.toLocaleString()}`);
  console.log(`${statusEmoji} Validation Passed: ${result.validationPassed ? 'YES' : 'NO'}`);
  console.log(`⚠️  Discrepancies Found: ${result.discrepanciesFound.toLocaleString()}`);
  console.log(`⏱️  Execution Time: ${formatDuration(result.executionTime)}`);
  console.log(`🕐 Generated: ${formatDate(result.generatedAt)}`);

  if (result.reports && result.reports.length > 0) {
    console.log(`\n📊 Entity Reports (${result.reports.length}):`);

    result.reports.forEach((report: any) => {
      console.log(`\n  📋 ${report.entity.toUpperCase()}:`);
      console.log(`    Records Checked: ${report.recordsChecked.toLocaleString()}`);
      console.log(`    Issues Found: ${report.issuesFound}`);

      if (report.issues && report.issues.length > 0) {
        console.log(`    Issues:`);
        report.issues.slice(0, 10).forEach((issue: any, index: number) => {
          const issueEmoji = getIssueEmoji(issue.type);
          console.log(`      ${issueEmoji} ${issue.description} (${issue.affectedRecords} records)`);
        });

        if (report.issues.length > 10) {
          console.log(`      ... and ${report.issues.length - 10} more issues`);
        }
      }
    });
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

/**
 * Display validation summary
 */
function displayValidationSummary(summary: any): void {
  console.log(`📊 Validation Summary:`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (summary && summary.length > 0) {
    summary.forEach((item: any) => {
      const validationEmoji = getValidationEmoji(item.validation_type as ValidationType);
      const passRate = item.total_reports > 0 ? ((item.passed_reports / item.total_reports) * 100).toFixed(1) : '0.0';

      console.log(`${validationEmoji} ${item.validation_type.replace(/_/g, ' ').toUpperCase()}:`);
      console.log(`  📊 Total Reports: ${item.total_reports}`);
      console.log(`  ✅ Passed: ${item.passed_reports} (${passRate}%)`);
      console.log(`  📈 Active: ${item.active_reports}`);
      console.log(`  🕐 Last Validation: ${formatDate(item.last_validation)}`);
      console.log(`  ⏱️  Avg Execution: ${formatDuration(item.avg_execution_time)}`);
      console.log();
    });
  } else {
    console.log('📭 No validation reports found.');
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

/**
 * Handle CLI errors
 */
function handleError(error: Error): never {
  console.error(`\n❌ Error: ${error.message}`);

  if (error instanceof ValidationError) {
    if (error.validationType) {
      console.error(`   Validation Type: ${error.validationType}`);
    }
    if (error.entity) {
      console.error(`   Entity: ${error.entity}`);
    }
  }

  process.exit(1);
}

/**
 * Create validator service instance
 */
function createValidatorService(): DataValidatorService {
  const { sourceDb, targetDb } = initializeConnections();
  return new DataValidatorService(sourceDb, targetDb);
}

// Create CLI program
const program = new Command();

program
  .name('data-validator')
  .description('CLI for comprehensive data validation and integrity checks')
  .version('1.0.0');

// Validate command
program
  .command('validate')
  .description('Perform data validation')
  .requiredOption('-t, --type <type>', 'Validation type (data_integrity, relationship_integrity, completeness_check, performance_check)')
  .requiredOption('-e, --entities <entities...>', 'Entity types to validate')
  .option('-s, --sampling-rate <rate>', 'Sampling rate (0.01-1.0)', '1.0')
  .option('-T, --timeout <ms>', 'Timeout in milliseconds', '300000')
  .option('-v, --verbose', 'Show detailed validation information', false)
  .action(async (options) => {
    try {
      // Validate inputs
      const validationType = validateValidationType(options.type);
      validateEntities(options.entities);

      const samplingRate = parseFloat(options.samplingRate);
      if (isNaN(samplingRate) || samplingRate < 0.01 || samplingRate > 1.0) {
        console.error('❌ Sampling rate must be between 0.01 and 1.0');
        process.exit(1);
      }

      const timeout = parseInt(options.timeout);
      if (isNaN(timeout) || timeout < 1000) {
        console.error('❌ Timeout must be at least 1000ms (1 second)');
        process.exit(1);
      }

      const validationEmoji = getValidationEmoji(validationType);
      console.log(`${validationEmoji} Starting ${validationType.replace(/_/g, ' ')} validation...`);
      console.log(`📋 Entities: ${options.entities.join(', ')}`);
      console.log(`📊 Sampling Rate: ${(samplingRate * 100).toFixed(1)}%`);
      console.log(`⏱️  Timeout: ${formatDuration(timeout)}`);
      console.log();

      const validatorService = createValidatorService();

      const validationOptions: ValidationOptions = {
        validationType,
        entities: options.entities,
        samplingRate,
        timeout,
        verbose: options.verbose
      };

      const result = await validatorService.validateByType(validationOptions);

      displayValidationResults(result);

      // Exit with appropriate code
      if (!result.validationPassed) {
        console.log('⚠️  Validation completed with issues. Check the report above for details.');
        process.exit(1);
      } else {
        console.log('🎉 Validation passed successfully!');
        process.exit(0);
      }

    } catch (error) {
      handleError(error as Error);
    }
  });

// Validate all command
program
  .command('validate-all')
  .description('Perform comprehensive validation across all types')
  .requiredOption('-e, --entities <entities...>', 'Entity types to validate')
  .option('-s, --sampling-rate <rate>', 'Sampling rate (0.01-1.0)', '0.1')
  .option('-T, --timeout <ms>', 'Timeout in milliseconds', '600000')
  .option('--skip-performance', 'Skip performance checks', false)
  .action(async (options) => {
    try {
      validateEntities(options.entities);

      const samplingRate = parseFloat(options.samplingRate);
      if (isNaN(samplingRate) || samplingRate < 0.01 || samplingRate > 1.0) {
        console.error('❌ Sampling rate must be between 0.01 and 1.0');
        process.exit(1);
      }

      const timeout = parseInt(options.timeout);
      if (isNaN(timeout) || timeout < 1000) {
        console.error('❌ Timeout must be at least 1000ms (1 second)');
        process.exit(1);
      }

      console.log(`🔍 Starting comprehensive validation...`);
      console.log(`📋 Entities: ${options.entities.join(', ')}`);
      console.log(`📊 Sampling Rate: ${(samplingRate * 100).toFixed(1)}%`);
      console.log(`⏱️  Timeout: ${formatDuration(timeout)}`);
      console.log(`⚡ Performance Checks: ${options.skipPerformance ? 'DISABLED' : 'ENABLED'}`);
      console.log();

      const validatorService = createValidatorService();

      // Configure validator to skip performance checks if requested
      if (options.skipPerformance) {
        validatorService['config'].enablePerformanceChecks = false;
      }

      const validationOptions: ValidationOptions = {
        validationType: ValidationType.DATA_INTEGRITY, // Will be overridden by validateAll
        entities: options.entities,
        samplingRate,
        timeout,
        verbose: true
      };

      const result = await validatorService.validateAll(validationOptions);

      displayValidationResults(result);

      if (!result.validationPassed) {
        console.log('⚠️  Comprehensive validation completed with issues.');
        process.exit(1);
      } else {
        console.log('🎉 Comprehensive validation passed successfully!');
        process.exit(0);
      }

    } catch (error) {
      handleError(error as Error);
    }
  });

// Report command
program
  .command('report')
  .description('Generate validation reports')
  .option('-t, --type <type>', 'Filter by validation type')
  .option('-e, --entity <entity>', 'Filter by entity type')
  .option('-l, --limit <number>', 'Maximum number of reports to show', '10')
  .option('--include-expired', 'Include expired reports', false)
  .action(async (options) => {
    try {
      if (options.type) {
        validateValidationType(options.type);
      }

      if (options.entity) {
        validateEntities([options.entity]);
      }

      const limit = parseInt(options.limit);
      if (isNaN(limit) || limit < 1) {
        console.error('❌ Limit must be a positive number');
        process.exit(1);
      }

      console.log('📊 Retrieving validation reports...\n');

      const validatorService = createValidatorService();

      if (options.entity && options.type) {
        // Get specific reports for entity and type
        const reports = await validatorService['reportModel'].findByEntityAndType(
          options.entity,
          options.type as ValidationType,
          options.includeExpired
        );

        if (reports.length === 0) {
          console.log(`📭 No validation reports found for ${options.entity} (${options.type}).`);
          return;
        }

        console.log(`📊 Found ${reports.length} report${reports.length === 1 ? '' : 's'} for ${options.entity}:\n`);

        reports.slice(0, limit).forEach(report => {
          const validationEmoji = getValidationEmoji(report.validation_type);
          const statusEmoji = report.validation_passed ? '✅' : '❌';

          console.log(`${validationEmoji} ${statusEmoji} ${report.validation_type.replace(/_/g, ' ')} (${report.id})`);
          console.log(`  📊 Records: ${report.records_validated.toLocaleString()}`);
          console.log(`  ⚠️  Discrepancies: ${report.discrepancies_found}`);
          console.log(`  ⏱️  Duration: ${formatDuration(report.execution_time_ms)}`);
          console.log(`  🕐 Generated: ${formatDate(report.generated_at)}`);
          console.log(`  📅 Expires: ${formatDate(report.expires_at)}`);
          console.log();
        });

      } else {
        // Get recent reports
        const reports = await validatorService['reportModel'].getRecentReports(
          limit,
          options.type as ValidationType | undefined
        );

        if (reports.length === 0) {
          console.log('📭 No recent validation reports found.');
          return;
        }

        console.log(`📊 Recent Validation Reports (${reports.length}):\n`);

        reports.forEach(report => {
          const validationEmoji = getValidationEmoji(report.validation_type);
          const statusEmoji = report.validation_passed ? '✅' : '❌';

          console.log(`${validationEmoji} ${statusEmoji} ${report.source_entity} → ${report.target_entity}`);
          console.log(`  🔍 Type: ${report.validation_type.replace(/_/g, ' ')}`);
          console.log(`  📊 Records: ${report.records_validated.toLocaleString()}`);
          console.log(`  ⚠️  Discrepancies: ${report.discrepancies_found}`);
          console.log(`  🕐 Generated: ${formatDate(report.generated_at)}`);
          console.log();
        });
      }

    } catch (error) {
      handleError(error as Error);
    }
  });

// Summary command
program
  .command('summary')
  .description('Show validation summary dashboard')
  .action(async (options) => {
    try {
      console.log('📊 Retrieving validation summary...\n');

      const validatorService = createValidatorService();
      const summary = await validatorService.getValidationSummary();

      displayValidationSummary(summary);

    } catch (error) {
      handleError(error as Error);
    }
  });

// Check record command
program
  .command('check-record')
  .description('Check a specific record for validation issues')
  .requiredOption('-e, --entity <entity>', 'Entity type')
  .requiredOption('-i, --id <id>', 'Record ID (legacy ID or UUID)')
  .option('-t, --type <type>', 'Specific validation type to run', 'data_integrity')
  .action(async (options) => {
    try {
      validateEntities([options.entity]);
      const validationType = validateValidationType(options.type);

      console.log(`🔍 Checking record validation...`);
      console.log(`📋 Entity: ${options.entity}`);
      console.log(`🆔 Record ID: ${options.id}`);
      console.log(`🔍 Validation Type: ${validationType.replace(/_/g, ' ')}`);
      console.log();

      const validatorService = createValidatorService();

      // This is a simplified implementation - in practice, you might want to
      // add specific record validation methods to the service
      const validationOptions: ValidationOptions = {
        validationType,
        entities: [options.entity],
        samplingRate: 1.0, // Check all records for this entity (small scope)
        verbose: true
      };

      const result = await validatorService.validateByType(validationOptions);

      // Filter results to show only issues that might affect this record
      console.log(`📊 Validation Results for ${options.entity}:`);

      if (result.reports && result.reports.length > 0) {
        const entityReport = result.reports.find(r => r.entity === options.entity);

        if (entityReport) {
          console.log(`  📊 Records Checked: ${entityReport.recordsChecked.toLocaleString()}`);
          console.log(`  ⚠️  Issues Found: ${entityReport.issuesFound}`);

          if (entityReport.issues && entityReport.issues.length > 0) {
            console.log(`  Issues that may affect record ${options.id}:`);
            entityReport.issues.forEach(issue => {
              const issueEmoji = getIssueEmoji(issue.type);
              console.log(`    ${issueEmoji} ${issue.description} (${issue.affectedRecords} records affected)`);
            });
          } else {
            console.log(`  ✅ No validation issues found that would affect this record.`);
          }
        } else {
          console.log(`  📭 No validation data found for ${options.entity}.`);
        }
      }

      console.log(`\n💡 For detailed record-level validation, consider running a more specific query against the database.`);

    } catch (error) {
      handleError(error as Error);
    }
  });

// Cleanup command
program
  .command('cleanup')
  .description('Clean up expired validation reports')
  .action(async (options) => {
    try {
      console.log('🧹 Cleaning up expired validation reports...');

      const validatorService = createValidatorService();
      const deletedCount = await validatorService.cleanup();

      console.log(`✅ Cleanup completed!`);
      console.log(`📊 Expired Reports Deleted: ${deletedCount}`);

    } catch (error) {
      handleError(error as Error);
    }
  });

// Parse command line arguments
if (require.main === module) {
  program.parse();
}

export { program };