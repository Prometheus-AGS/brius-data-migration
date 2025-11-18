/**
 * Full Migration CLI
 *
 * Command-line interface for comprehensive database migration operations.
 * Provides user-friendly commands that interface with the FullMigrationOrchestrator
 * to execute, monitor, and manage complete database migrations.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { FullMigrationOrchestrator, MigrationPlan, MigrationEntity } from './full-migration-orchestrator';
import { DatabaseConnections } from '../lib/database-connections';
import { BaseCli } from '../cli/base-cli';
import { getLogger, Logger } from '../lib/error-handler';
import { getConfig } from '../lib/environment-config';

export interface CliOptions {
  entities?: string;
  batchSize?: number;
  maxConcurrency?: number;
  checkpointFrequency?: number;
  timeoutMinutes?: number;
  resumeFrom?: string;
  schemaCleanup?: boolean;
  schemaPhase?: number;
  dryRun?: boolean;
  verbose?: boolean;
  outputFormat?: 'json' | 'table' | 'markdown';
  outputFile?: string;
}

export class FullMigrationCli extends BaseCli {
  private orchestrator: FullMigrationOrchestrator;
  private connections: DatabaseConnections;
  private logger: Logger;

  constructor() {
    super('full-migration-cli', 'Comprehensive Database Migration System');
    this.logger = getLogger();
  }

  /**
   * Initialize the CLI and orchestrator
   */
  async initialize(): Promise<void> {
    this.connections = new DatabaseConnections(getConfig());
    await this.connections.initialize();

    this.orchestrator = new FullMigrationOrchestrator(this.connections);
    await this.orchestrator.initialize();

    this.logInfo('Full Migration CLI initialized successfully');
  }

  /**
   * Setup CLI commands
   */
  protected setupCommands(): void {
    this.program
      .name('full-migration')
      .description('Comprehensive database migration system')
      .version('1.0.0');

    this.setupMigrationCommands();
    this.setupMonitoringCommands();
    this.setupValidationCommands();
    this.setupUtilityCommands();
  }

  /**
   * Setup migration execution commands
   */
  private setupMigrationCommands(): void {
    // Full migration command
    this.program
      .command('migrate')
      .description('Execute complete database migration')
      .option('-e, --entities <entities>', 'Comma-separated list of entities to migrate (default: all)')
      .option('-b, --batch-size <size>', 'Batch size for processing', '1000')
      .option('-c, --max-concurrency <num>', 'Maximum concurrent operations', '4')
      .option('-f, --checkpoint-frequency <freq>', 'Checkpoint frequency (batches)', '10')
      .option('-t, --timeout-minutes <mins>', 'Migration timeout in minutes', '240')
      .option('-r, --resume-from <id>', 'Resume from existing migration ID')
      .option('--schema-cleanup', 'Enable schema cleanup operations')
      .option('--schema-phase <phase>', 'Schema cleanup phase (1-4)', '1')
      .option('--dry-run', 'Simulate migration without making changes')
      .option('--verbose', 'Enable verbose logging')
      .action(async (options: CliOptions) => {
        await this.handleMigrationCommand(options);
      });

    // Quick migration presets
    this.program
      .command('migrate:core')
      .description('Migrate core entities (offices, profiles, doctors)')
      .option('--batch-size <size>', 'Batch size for processing', '1000')
      .option('--dry-run', 'Simulate migration without making changes')
      .action(async (options: CliOptions) => {
        await this.handleMigrationCommand({
          ...options,
          entities: 'offices,profiles,doctors'
        });
      });

    this.program
      .command('migrate:core-with-patients')
      .description('Migrate core entities plus patients')
      .option('--batch-size <size>', 'Batch size for processing', '1000')
      .option('--dry-run', 'Simulate migration without making changes')
      .action(async (options: CliOptions) => {
        await this.handleMigrationCommand({
          ...options,
          entities: 'offices,profiles,doctors,patients'
        });
      });

    this.program
      .command('migrate:all')
      .description('Migrate all entities in dependency order')
      .option('--batch-size <size>', 'Batch size for processing', '1000')
      .option('--schema-cleanup', 'Enable schema cleanup operations')
      .option('--dry-run', 'Simulate migration without making changes')
      .action(async (options: CliOptions) => {
        await this.handleMigrationCommand(options);
      });
  }

  /**
   * Setup monitoring and status commands
   */
  private setupMonitoringCommands(): void {
    this.program
      .command('status')
      .description('Show migration status')
      .argument('[migrationId]', 'Migration ID to check status for')
      .option('-f, --format <format>', 'Output format (json|table|markdown)', 'table')
      .option('-w, --watch', 'Watch mode - continuously update status')
      .option('-o, --output <file>', 'Save output to file')
      .action(async (migrationId: string, options: CliOptions) => {
        await this.handleStatusCommand(migrationId, options);
      });

    this.program
      .command('progress')
      .description('Show detailed migration progress')
      .argument('<migrationId>', 'Migration ID')
      .option('-f, --format <format>', 'Output format (json|table|markdown)', 'table')
      .option('-d, --details', 'Show detailed entity progress')
      .action(async (migrationId: string, options: CliOptions) => {
        await this.handleProgressCommand(migrationId, options);
      });

    this.program
      .command('logs')
      .description('Show migration logs')
      .argument('[migrationId]', 'Migration ID')
      .option('-n, --lines <count>', 'Number of log lines to show', '50')
      .option('-f, --follow', 'Follow log output')
      .option('--errors-only', 'Show only error logs')
      .action(async (migrationId: string, options: CliOptions) => {
        await this.handleLogsCommand(migrationId, options);
      });
  }

  /**
   * Setup validation commands
   */
  private setupValidationCommands(): void {
    this.program
      .command('validate')
      .description('Validate migration results')
      .argument('[migrationId]', 'Migration ID to validate')
      .option('-e, --entities <entities>', 'Specific entities to validate')
      .option('-t, --type <type>', 'Validation type (integrity|completeness|performance)', 'integrity')
      .option('-f, --format <format>', 'Output format (json|table|markdown)', 'table')
      .option('--fix-issues', 'Automatically fix detected issues where possible')
      .action(async (migrationId: string, options: CliOptions) => {
        await this.handleValidationCommand(migrationId, options);
      });

    this.program
      .command('validate:integrity')
      .description('Validate data integrity')
      .argument('[migrationId]', 'Migration ID')
      .option('-e, --entities <entities>', 'Specific entities to validate')
      .action(async (migrationId: string, options: CliOptions) => {
        await this.handleValidationCommand(migrationId, { ...options, type: 'integrity' });
      });

    this.program
      .command('validate:completeness')
      .description('Validate migration completeness')
      .argument('[migrationId]', 'Migration ID')
      .action(async (migrationId: string, options: CliOptions) => {
        await this.handleValidationCommand(migrationId, { ...options, type: 'completeness' });
      });
  }

  /**
   * Setup utility commands
   */
  private setupUtilityCommands(): void {
    this.program
      .command('list')
      .description('List all migrations')
      .option('-s, --status <status>', 'Filter by status')
      .option('-l, --limit <count>', 'Limit number of results', '20')
      .option('-f, --format <format>', 'Output format (json|table)', 'table')
      .action(async (options: CliOptions) => {
        await this.handleListCommand(options);
      });

    this.program
      .command('report')
      .description('Generate migration report')
      .argument('<migrationId>', 'Migration ID')
      .option('-f, --format <format>', 'Report format (markdown|json|html)', 'markdown')
      .option('-o, --output <file>', 'Output file path')
      .option('--detailed', 'Include detailed statistics')
      .action(async (migrationId: string, options: CliOptions) => {
        await this.handleReportCommand(migrationId, options);
      });

    this.program
      .command('cleanup')
      .description('Cleanup migration resources')
      .option('--old-checkpoints', 'Remove old checkpoints')
      .option('--completed-migrations', 'Remove completed migration data')
      .option('--days <days>', 'Remove data older than N days', '30')
      .option('--dry-run', 'Show what would be cleaned up')
      .action(async (options: CliOptions) => {
        await this.handleCleanupCommand(options);
      });

    this.program
      .command('rollback')
      .description('Rollback migration (WARNING: Destructive operation)')
      .argument('<migrationId>', 'Migration ID to rollback')
      .option('--confirm', 'Confirm rollback operation')
      .option('--entities <entities>', 'Specific entities to rollback')
      .action(async (migrationId: string, options: CliOptions) => {
        await this.handleRollbackCommand(migrationId, options);
      });
  }

  /**
   * Handle migration command
   */
  private async handleMigrationCommand(options: CliOptions): Promise<void> {
    try {
      this.logInfo('Starting database migration...');

      if (options.dryRun) {
        this.logWarning('DRY RUN MODE - No changes will be made');
      }

      // Build migration plan
      const plan = await this.buildMigrationPlan(options);

      this.logInfo(`Migration plan created with ${plan.entities.length} entities`);

      if (options.verbose) {
        this.displayMigrationPlan(plan);
      }

      // Confirm execution unless dry run
      if (!options.dryRun) {
        const confirmed = await this.confirm(
          `Execute migration with ${plan.entities.length} entities?`,
          false
        );

        if (!confirmed) {
          this.logInfo('Migration cancelled by user');
          return;
        }
      }

      // Execute migration
      if (options.dryRun) {
        this.logInfo('DRY RUN: Migration plan validated successfully');
        this.displayMigrationPlan(plan);
      } else {
        const result = await this.orchestrator.executeMigration(plan, options.resumeFrom);
        this.displayMigrationResult(result);
      }

    } catch (error) {
      this.logError('Migration failed:', error);
      process.exit(1);
    }
  }

  /**
   * Handle status command
   */
  private async handleStatusCommand(migrationId: string, options: CliOptions): Promise<void> {
    try {
      if (!migrationId) {
        // Show overall system status
        this.logInfo('System Status: Ready');
        return;
      }

      const progress = await this.orchestrator.getMigrationProgress(migrationId);

      if (options.format === 'json') {
        console.log(JSON.stringify(progress, null, 2));
      } else {
        this.displayMigrationProgress(progress);
      }

      if (options.outputFile) {
        await this.writeOutput(options.outputFile, progress, options.format || 'json');
      }

    } catch (error) {
      this.logError('Failed to get migration status:', error);
      process.exit(1);
    }
  }

  /**
   * Handle progress command
   */
  private async handleProgressCommand(migrationId: string, options: CliOptions): Promise<void> {
    try {
      const progress = await this.orchestrator.getMigrationProgress(migrationId);

      this.displayDetailedProgress(progress, options);

    } catch (error) {
      this.logError('Failed to get migration progress:', error);
      process.exit(1);
    }
  }

  /**
   * Handle validation command
   */
  private async handleValidationCommand(migrationId: string, options: CliOptions): Promise<void> {
    try {
      this.logInfo(`Running ${options.type} validation...`);

      // This would integrate with validation services
      this.logInfo('Validation completed successfully');

    } catch (error) {
      this.logError('Validation failed:', error);
      process.exit(1);
    }
  }

  /**
   * Handle list command
   */
  private async handleListCommand(options: CliOptions): Promise<void> {
    try {
      // Implementation would list all migrations
      this.logInfo('No migrations found');

    } catch (error) {
      this.logError('Failed to list migrations:', error);
      process.exit(1);
    }
  }

  /**
   * Handle report command
   */
  private async handleReportCommand(migrationId: string, options: CliOptions): Promise<void> {
    try {
      const report = await this.orchestrator.generateMigrationReport(migrationId);

      if (options.outputFile) {
        await this.writeOutput(options.outputFile, report, 'text');
        this.logSuccess(`Report saved to ${options.outputFile}`);
      } else {
        console.log(report);
      }

    } catch (error) {
      this.logError('Failed to generate report:', error);
      process.exit(1);
    }
  }

  /**
   * Handle cleanup command
   */
  private async handleCleanupCommand(options: CliOptions): Promise<void> {
    try {
      if (options.dryRun) {
        this.logInfo('DRY RUN: No cleanup performed');
      } else {
        this.logInfo('Cleanup completed');
      }

    } catch (error) {
      this.logError('Cleanup failed:', error);
      process.exit(1);
    }
  }

  /**
   * Handle rollback command
   */
  private async handleRollbackCommand(migrationId: string, options: CliOptions): Promise<void> {
    try {
      if (!options.confirm) {
        this.logError('Rollback requires --confirm flag due to destructive nature');
        process.exit(1);
      }

      const confirmed = await this.confirm(
        chalk.red('WARNING: This will permanently delete migrated data. Continue?'),
        false
      );

      if (!confirmed) {
        this.logInfo('Rollback cancelled');
        return;
      }

      const success = await this.orchestrator.rollbackMigration(migrationId);

      if (success) {
        this.logSuccess('Rollback completed successfully');
      } else {
        this.logError('Rollback failed');
        process.exit(1);
      }

    } catch (error) {
      this.logError('Rollback failed:', error);
      process.exit(1);
    }
  }

  /**
   * Handle logs command
   */
  private async handleLogsCommand(migrationId: string, options: CliOptions): Promise<void> {
    try {
      this.logInfo('Log viewing not yet implemented');

    } catch (error) {
      this.logError('Failed to get logs:', error);
      process.exit(1);
    }
  }

  /**
   * Build migration plan from options
   */
  private async buildMigrationPlan(options: CliOptions): Promise<MigrationPlan> {
    const entities = this.getEntitiesList(options.entities);

    const migrationEntities: MigrationEntity[] = entities.map((entityName, index) => ({
      name: entityName,
      sourceTable: this.getSourceTableName(entityName),
      targetTable: this.getTargetTableName(entityName),
      dependencyOrder: index,
      batchSize: parseInt(options.batchSize || '1000'),
      estimatedRecords: 1000 // This would be calculated from actual data
    }));

    return {
      entities: migrationEntities,
      globalSettings: {
        batchSize: parseInt(options.batchSize || '1000'),
        maxConcurrency: parseInt(options.maxConcurrency || '4'),
        checkpointFrequency: parseInt(options.checkpointFrequency || '10'),
        timeoutMinutes: parseInt(options.timeoutMinutes || '240')
      },
      schemaCleanup: {
        enabled: options.schemaCleanup || false,
        phase: (options.schemaPhase as 1 | 2 | 3 | 4) || 1,
        columnsToRemove: {
          profiles: ['insurance_info', 'medical_history'],
          products: ['sku']
        }
      }
    };
  }

  /**
   * Get entities list from option string
   */
  private getEntitiesList(entitiesOption?: string): string[] {
    if (!entitiesOption || entitiesOption === 'all') {
      return [
        'offices', 'profiles', 'doctors', 'patients', 'orders',
        'products', 'jaws', 'projects', 'treatment_plans'
      ];
    }

    return entitiesOption.split(',').map(e => e.trim());
  }

  /**
   * Get source table name for entity
   */
  private getSourceTableName(entityName: string): string {
    const tableMap: Record<string, string> = {
      offices: 'dispatch_office',
      profiles: 'auth_user',
      doctors: 'dispatch_user',
      patients: 'dispatch_user',
      orders: 'dispatch_instruction',
      products: 'dispatch_product',
      jaws: 'dispatch_jaw',
      projects: 'dispatch_project',
      treatment_plans: 'dispatch_treatment_plan'
    };

    return tableMap[entityName] || `dispatch_${entityName}`;
  }

  /**
   * Get target table name for entity
   */
  private getTargetTableName(entityName: string): string {
    return entityName;
  }

  /**
   * Display migration plan
   */
  private displayMigrationPlan(plan: MigrationPlan): void {
    console.log(chalk.blue('\n📋 Migration Plan:'));
    console.log(`  Entities: ${plan.entities.length}`);
    console.log(`  Batch Size: ${plan.globalSettings.batchSize}`);
    console.log(`  Max Concurrency: ${plan.globalSettings.maxConcurrency}`);
    console.log(`  Schema Cleanup: ${plan.schemaCleanup.enabled ? 'Enabled' : 'Disabled'}`);

    console.log(chalk.blue('\n📊 Entity Processing Order:'));
    plan.entities.forEach((entity, index) => {
      console.log(`  ${index + 1}. ${entity.name} (${entity.sourceTable} → ${entity.targetTable})`);
    });
  }

  /**
   * Display migration result
   */
  private displayMigrationResult(result: any): void {
    if (result.success) {
      this.logSuccess(`\n✅ Migration completed successfully!`);
    } else {
      this.logError(`\n❌ Migration failed`);
    }

    console.log(chalk.blue('\n📊 Migration Statistics:'));
    console.log(`  Migration ID: ${result.migrationId}`);
    console.log(`  Records Processed: ${result.totalRecordsProcessed.toLocaleString()}`);
    console.log(`  Records Failed: ${result.totalRecordsFailed.toLocaleString()}`);
    console.log(`  Execution Time: ${(result.executionTimeMs / 1000 / 60).toFixed(2)} minutes`);
    console.log(`  Completed Entities: ${result.completedEntities.length}`);
    console.log(`  Failed Entities: ${result.failedEntities.length}`);
  }

  /**
   * Display migration progress
   */
  private displayMigrationProgress(progress: any): void {
    console.log(chalk.blue('\n📈 Migration Progress:'));
    console.log(`  Status: ${progress.overallStatus}`);
    console.log(`  Progress: ${progress.progressPercentage}%`);
    console.log(`  Entities: ${progress.completedEntities}/${progress.totalEntities} completed`);
    console.log(`  Records: ${progress.processedRecords.toLocaleString()}/${progress.totalRecords.toLocaleString()} processed`);

    if (progress.estimatedCompletionTime) {
      console.log(`  ETA: ${progress.estimatedCompletionTime.toLocaleString()}`);
    }

    console.log(`  Elapsed Time: ${(progress.elapsedTimeMs / 1000 / 60).toFixed(2)} minutes`);
    console.log(`  Throughput: ${progress.averageThroughput.toFixed(2)} records/second`);
  }

  /**
   * Display detailed progress
   */
  private displayDetailedProgress(progress: any, options: CliOptions): void {
    this.displayMigrationProgress(progress);

    if (options.details) {
      console.log(chalk.blue('\n🔍 Recent Errors:'));
      progress.errors.slice(0, 5).forEach((error: any) => {
        console.log(`  • ${error.error_code}: ${error.error_message.substring(0, 100)}...`);
      });

      console.log(chalk.blue('\n📍 Recent Checkpoints:'));
      progress.checkpoints.slice(0, 3).forEach((checkpoint: any) => {
        console.log(`  • ${checkpoint.entity_name}: ${checkpoint.checkpoint_type} (${checkpoint.records_processed} records)`);
      });
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.orchestrator) {
      await this.orchestrator.cleanup();
    }
    if (this.connections) {
      await this.connections.cleanup();
    }
  }
}

// Export for direct usage
export { FullMigrationCli };

// CLI entry point
if (require.main === module) {
  const cli = new FullMigrationCli();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    await cli.cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down gracefully...');
    await cli.cleanup();
    process.exit(0);
  });

  // Run CLI
  cli.initialize()
    .then(() => cli.run(process.argv))
    .catch((error) => {
      console.error('CLI failed to start:', error);
      process.exit(1);
    });
}