#!/usr/bin/env node

// Differential Migration CLI
// Command line interface for differential database migration operations

import { Command } from 'commander';
import { Pool } from 'pg';
import { DifferentialMigrationService } from '../services/differential-migration-service';
import {
  DifferentialMigrationOptions,
  ConflictResolution,
  MigrationError
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
 * Format duration for display
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Display migration results
 */
function displayResults(result: any, isDryRun: boolean = false): void {
  const prefix = isDryRun ? '🔍 [DRY RUN]' : '✅';

  console.log(`\n${prefix} Migration Results:`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Operation ID: ${result.operationId}`);
  console.log(`📈 Total Processed: ${result.totalProcessed.toLocaleString()}`);
  console.log(`✅ Successful: ${result.successful.toLocaleString()}`);
  console.log(`❌ Failed: ${result.failed.toLocaleString()}`);
  console.log(`⏭️  Skipped: ${result.skipped.toLocaleString()}`);
  console.log(`⏱️  Duration: ${formatDuration(result.duration)}`);

  if (result.successful > 0) {
    const successRate = ((result.successful / result.totalProcessed) * 100).toFixed(1);
    console.log(`📊 Success Rate: ${successRate}%`);
  }

  // Display checkpoints if any
  if (result.checkpoints && result.checkpoints.length > 0) {
    console.log(`\n📍 Checkpoints (${result.checkpoints.length}):`);
    result.checkpoints.forEach((checkpoint: any) => {
      const progress = checkpoint.recordsTotal
        ? Math.round((checkpoint.recordsProcessed / checkpoint.recordsTotal) * 100)
        : 100;
      console.log(`  • ${checkpoint.entityType}: ${progress}% (${checkpoint.recordsProcessed} records)`);
    });
  }

  // Display errors if any
  if (result.errors && result.errors.length > 0) {
    console.log(`\n❌ Errors (${result.errors.length}):`);
    result.errors.slice(0, 5).forEach((error: any) => {
      console.log(`  • ${error.entityType}[${error.legacyId}]: ${error.errorMessage}`);
    });

    if (result.errors.length > 5) {
      console.log(`  ... and ${result.errors.length - 5} more errors`);
    }
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

/**
 * Display analysis results
 */
function displayAnalysis(analysis: any): void {
  console.log(`\n📋 Migration Analysis Results:`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📁 Total Scripts: ${analysis.total_scripts}`);
  console.log(`✅ Reusable Scripts: ${analysis.reusable_scripts}`);
  console.log(`🔧 Need Modification: ${analysis.scripts_needing_modification}`);
  console.log(`❌ Unsupported: ${analysis.unsupported_scripts}`);

  if (analysis.analysis_details && analysis.analysis_details.length > 0) {
    console.log(`\n📊 Script Details:`);
    analysis.analysis_details.forEach((script: any) => {
      const status = script.reusable ? '✅' : '🔧';
      console.log(`  ${status} ${script.filename} (${script.entityType}) - Complexity: ${script.complexity_score}`);

      if (script.modifications_needed && script.modifications_needed.length > 0) {
        script.modifications_needed.forEach((mod: string) => {
          console.log(`    • ${mod}`);
        });
      }
    });
  }

  if (analysis.recommendations && analysis.recommendations.length > 0) {
    console.log(`\n💡 Recommendations:`);
    analysis.recommendations.forEach((rec: string) => {
      console.log(`  • ${rec}`);
    });
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

/**
 * Handle CLI errors
 */
function handleError(error: Error): never {
  console.error(`\n❌ Error: ${error.message}`);

  if (error instanceof MigrationError) {
    if (error.entityType) {
      console.error(`   Entity: ${error.entityType}`);
    }
    if (error.legacyId) {
      console.error(`   Legacy ID: ${error.legacyId}`);
    }
  }

  process.exit(1);
}

/**
 * Create migration service instance
 */
function createMigrationService(): DifferentialMigrationService {
  const { sourceDb, targetDb } = initializeConnections();
  return new DifferentialMigrationService(sourceDb, targetDb);
}

// Create CLI program
const program = new Command();

program
  .name('differential-migration')
  .description('CLI for differential database migration operations')
  .version('1.0.0');

// Analyze command
program
  .command('analyze')
  .description('Analyze existing migration scripts for reusability')
  .option('-e, --entities <entities...>', 'Entity types to analyze', VALID_ENTITIES)
  .option('-v, --verbose', 'Show detailed analysis information', false)
  .action(async (options) => {
    try {
      console.log('🔍 Analyzing existing migration scripts...\n');

      const migrationService = createMigrationService();
      const analysis = await migrationService.createMigrationPlan({
        entities: options.entities,
        dryRun: true,
        skipValidation: true
      });

      displayAnalysis(analysis.analysisResults);

      // Also show comparison results
      if (analysis.comparisonResults) {
        console.log(`📊 Data Comparison Overview:`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`📈 Missing Records: ${analysis.comparisonResults.missing_records.toLocaleString()}`);
        console.log(`⚠️  Conflicted Records: ${analysis.comparisonResults.conflicted_records.toLocaleString()}`);
        console.log(`🗑️  Deleted Records: ${analysis.comparisonResults.deleted_records.toLocaleString()}`);
        console.log(`✅ Identical Records: ${analysis.comparisonResults.identical_records.toLocaleString()}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
      }

      console.log(`📋 Execution Plan (${analysis.executionSteps.length} steps):`);
      analysis.executionSteps.forEach((step: string, index: number) => {
        console.log(`  ${index + 1}. ${step}`);
      });

      console.log(`\n🎯 Risk Assessment: ${analysis.riskAssessment}`);
      console.log(`📊 Estimated Records: ${analysis.estimatedRecords.toLocaleString()}`);

    } catch (error) {
      handleError(error as Error);
    }
  });

// Migrate command
program
  .command('migrate')
  .description('Execute differential migration')
  .requiredOption('-e, --entities <entities...>', 'Entity types to migrate')
  .option('-b, --batch-size <size>', 'Records to process per batch', '500')
  .option('-d, --dry-run', 'Validate without making changes', false)
  .option('-c, --conflict-resolution <strategy>', 'Conflict resolution strategy', 'source_wins')
  .option('--skip-validation', 'Skip post-migration validation', false)
  .action(async (options) => {
    try {
      // Validate inputs
      validateEntities(options.entities);

      const batchSize = parseInt(options.batchSize);
      if (isNaN(batchSize) || batchSize < 1 || batchSize > 1000) {
        console.error('❌ Batch size must be between 1 and 1000');
        process.exit(1);
      }

      const validStrategies = ['source_wins', 'target_wins', 'manual'];
      if (!validStrategies.includes(options.conflictResolution)) {
        console.error(`❌ Invalid conflict resolution strategy. Valid options: ${validStrategies.join(', ')}`);
        process.exit(1);
      }

      console.log(`🚀 Starting differential migration${options.dryRun ? ' (DRY RUN)' : ''}...`);
      console.log(`📋 Entities: ${options.entities.join(', ')}`);
      console.log(`📦 Batch Size: ${batchSize}`);
      console.log(`⚔️  Conflict Resolution: ${options.conflictResolution}`);
      console.log();

      const migrationService = createMigrationService();

      const migrationOptions: DifferentialMigrationOptions = {
        entities: options.entities,
        batchSize,
        dryRun: options.dryRun,
        conflictResolution: options.conflictResolution as ConflictResolution,
        skipValidation: options.skipValidation
      };

      const result = await migrationService.executeDifferentialMigration(migrationOptions);

      displayResults(result, options.dryRun);

      // Exit with appropriate code
      if (result.failed > 0) {
        console.log('⚠️  Migration completed with errors. Check logs for details.');
        process.exit(1);
      } else {
        console.log('🎉 Migration completed successfully!');
        process.exit(0);
      }

    } catch (error) {
      handleError(error as Error);
    }
  });

// Resume command
program
  .command('resume')
  .description('Resume differential migration from checkpoint')
  .requiredOption('-c, --checkpoint <checkpointId>', 'Checkpoint ID to resume from')
  .requiredOption('-e, --entities <entities...>', 'Entity types to migrate')
  .option('-b, --batch-size <size>', 'Records to process per batch', '500')
  .option('--skip-validation', 'Skip post-migration validation', false)
  .action(async (options) => {
    try {
      validateEntities(options.entities);

      const batchSize = parseInt(options.batchSize);
      if (isNaN(batchSize) || batchSize < 1 || batchSize > 1000) {
        console.error('❌ Batch size must be between 1 and 1000');
        process.exit(1);
      }

      console.log(`🔄 Resuming differential migration from checkpoint: ${options.checkpoint}`);
      console.log(`📋 Entities: ${options.entities.join(', ')}`);
      console.log();

      const migrationService = createMigrationService();

      const migrationOptions: DifferentialMigrationOptions = {
        entities: options.entities,
        batchSize,
        dryRun: false,
        skipValidation: options.skipValidation
      };

      const result = await migrationService.resumeDifferentialMigration(
        options.checkpoint,
        migrationOptions
      );

      displayResults(result);

      if (result.failed > 0) {
        console.log('⚠️  Migration resumed with errors. Check logs for details.');
        process.exit(1);
      } else {
        console.log('🎉 Migration resumed and completed successfully!');
        process.exit(0);
      }

    } catch (error) {
      handleError(error as Error);
    }
  });

// Status command
program
  .command('status')
  .description('Get migration status and progress')
  .option('-o, --operation <operationId>', 'Specific operation ID to check')
  .action(async (options) => {
    try {
      console.log('📊 Retrieving migration status...\n');

      const migrationService = createMigrationService();
      const status = await migrationService.getMigrationStatus(options.operation);

      console.log(`📋 System Status: ${status.system_status.system_health.toUpperCase()}`);
      console.log(`🕐 Last Updated: ${new Date(status.timestamp).toLocaleString()}`);

      if (status.system_status.entity_statuses) {
        console.log(`\n📊 Entity Status:`);
        status.system_status.entity_statuses.forEach((entity: any) => {
          const statusEmoji = entity.error ? '❌' : entity.has_active_operations ? '🔄' : '✅';
          console.log(`  ${statusEmoji} ${entity.entity}: ${entity.checkpoint_info?.status || 'no operations'}`);

          if (entity.last_migration_date) {
            console.log(`    Last migration: ${new Date(entity.last_migration_date).toLocaleString()}`);
          }
        });
      }

      if (status.checkpoint_status && status.checkpoint_status.length > 0) {
        console.log(`\n📍 Active Checkpoints:`);
        status.checkpoint_status.forEach((checkpoint: any) => {
          console.log(`  📌 ${checkpoint.entity_type}: ${checkpoint.progress_percentage}%`);
          if (checkpoint.estimated_time_remaining) {
            console.log(`    ⏱️  Est. remaining: ${formatDuration(checkpoint.estimated_time_remaining)}`);
          }
        });
      }

      if (status.recent_activity && status.recent_activity.length > 0) {
        console.log(`\n📝 Recent Activity (last ${status.recent_activity.length}):`);
        status.recent_activity.slice(0, 10).forEach((log: any) => {
          const time = new Date(log.timestamp).toLocaleTimeString();
          console.log(`  ${time} [${log.levelName}] ${log.message}`);
        });
      }

    } catch (error) {
      handleError(error as Error);
    }
  });

// Stats command
program
  .command('stats')
  .description('Show migration statistics')
  .action(async (options) => {
    try {
      console.log('📈 Retrieving migration statistics...\n');

      const migrationService = createMigrationService();
      const stats = await migrationService.getMigrationStatistics();

      console.log(`📊 Migration Statistics:`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      if (stats.system_statistics) {
        console.log(`📈 System Statistics:`);
        console.log(`  Total Processed: ${stats.system_statistics.totalProcessed.toLocaleString()}`);
        console.log(`  Successful: ${stats.system_statistics.successful.toLocaleString()}`);
        console.log(`  Failed: ${stats.system_statistics.failed.toLocaleString()}`);
        console.log(`  Skipped: ${stats.system_statistics.skipped.toLocaleString()}`);
        if (stats.system_statistics.duration) {
          console.log(`  Total Duration: ${formatDuration(stats.system_statistics.duration)}`);
        }
      }

      if (stats.log_statistics) {
        console.log(`\n📝 Log Statistics:`);
        console.log(`  Total Entries: ${stats.log_statistics.totalEntries.toLocaleString()}`);
        console.log(`  Errors: ${stats.log_statistics.errorCount.toLocaleString()}`);
        console.log(`  Warnings: ${stats.log_statistics.warnCount.toLocaleString()}`);
        console.log(`  Last Entry: ${new Date(stats.log_statistics.lastEntry).toLocaleString()}`);
      }

      console.log(`\n🕐 Generated At: ${new Date(stats.generated_at).toLocaleString()}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    } catch (error) {
      handleError(error as Error);
    }
  });

// Parse command line arguments
if (require.main === module) {
  program.parse();
}

export { program };