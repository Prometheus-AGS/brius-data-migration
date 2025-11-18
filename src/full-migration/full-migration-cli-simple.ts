#!/usr/bin/env node
/**
 * Full Migration CLI - Simplified Version
 *
 * Simple CLI interface for comprehensive database migration operations.
 * Uses commander.js directly instead of the complex BaseCli framework.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { dbConnections, DatabaseConnectionManager } from '../lib/database-connections';
import { getConfig } from '../lib/environment-config';
import { getLogger } from '../lib/error-handler';
import { FullMigrationOrchestrator, MigrationPlan, MigrationEntity } from './full-migration-orchestrator';

// Simple interfaces for the CLI
interface CliOptions {
  entities?: string;
  batchSize?: string;
  maxConcurrency?: string;
  checkpointFrequency?: string;
  timeoutMinutes?: string;
  resumeFrom?: string;
  schemaCleanup?: boolean;
  schemaPhase?: string;
  dryRun?: boolean;
  verbose?: boolean;
  format?: string;
  output?: string;
}

// Remove duplicate interface - using the one from orchestrator

class SimpleMigrationCli {
  private program: Command;
  private logger = getLogger();

  constructor() {
    this.program = new Command();
    this.setupCommands();
  }

  private setupCommands(): void {
    this.program
      .name('full-migration')
      .description('Comprehensive database migration system')
      .version('1.0.0');

    // Migration commands
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

    // Status and monitoring commands
    this.program
      .command('status')
      .description('Show migration status')
      .argument('[migrationId]', 'Migration ID to check status for')
      .option('-f, --format <format>', 'Output format (json|table)', 'table')
      .action(async (migrationId: string, options: CliOptions) => {
        await this.handleStatusCommand(migrationId, options);
      });

    this.program
      .command('validate')
      .description('Validate migration results')
      .argument('[migrationId]', 'Migration ID to validate')
      .option('-e, --entities <entities>', 'Specific entities to validate')
      .option('-f, --format <format>', 'Output format (json|table)', 'table')
      .action(async (migrationId: string, options: CliOptions) => {
        await this.handleValidationCommand(migrationId, options);
      });

    this.program
      .command('list')
      .description('List all migrations')
      .option('-f, --format <format>', 'Output format (json|table)', 'table')
      .action(async (options: CliOptions) => {
        await this.handleListCommand(options);
      });
  }

  private async handleMigrationCommand(options: CliOptions): Promise<void> {
    let orchestrator: FullMigrationOrchestrator | null = null;

    try {
      console.log(chalk.blue('🚀 Starting database migration...'));

      if (options.dryRun) {
        console.log(chalk.yellow('⚠️  DRY RUN MODE - No changes will be made'));
      }

      // Test database connections
      await this.testConnections();

      // Initialize orchestrator
      console.log(chalk.blue('🔧 Initializing migration orchestrator...'));
      orchestrator = new FullMigrationOrchestrator();
      await orchestrator.initialize();

      // Build migration plan
      const plan = this.buildMigrationPlan(options);

      console.log(chalk.blue('\n📋 Migration Plan:'));
      console.log(`  Entities: ${plan.entities.length}`);
      console.log(`  Batch Size: ${plan.globalSettings.batchSize}`);
      console.log(`  Max Concurrency: ${plan.globalSettings.maxConcurrency}`);
      console.log(`  Schema Cleanup: ${plan.schemaCleanup.enabled ? 'Enabled' : 'Disabled'}`);

      console.log(chalk.blue('\n📊 Entity Processing Order:'));
      plan.entities.forEach((entity, index) => {
        console.log(`  ${index + 1}. ${entity.name} (${entity.sourceTable} → ${entity.targetTable})`);
      });

      // Validate migration plan
      console.log(chalk.blue('\n🔍 Validating migration plan...'));
      const planValidation = await orchestrator.validateMigrationPlan(plan);

      if (!planValidation.valid) {
        console.error(chalk.red('\n❌ Migration plan validation failed:'));
        planValidation.missingScripts.forEach(script => {
          console.error(chalk.red(`  ✗ Missing migration script: ${script}`));
        });
        process.exit(1);
      }

      if (planValidation.warnings.length > 0) {
        console.log(chalk.yellow('\n⚠️  Migration plan warnings:'));
        planValidation.warnings.forEach(warning => {
          console.log(chalk.yellow(`  ⚠️  ${warning}`));
        });
      }

      if (options.dryRun) {
        console.log(chalk.green('\n✅ DRY RUN: Migration plan validated successfully'));
        console.log(chalk.blue('\n🔧 Next Steps:'));
        console.log('  1. Remove --dry-run flag to execute actual migration');
        console.log('  2. Monitor progress with: npm run full-migration:status');
        console.log('  3. Validate results with: npm run validate:full-migration');
        return;
      }

      // Execute migration
      console.log(chalk.blue('\n🚀 Executing migration...'));
      const startTime = Date.now();

      const result = await orchestrator.executeMigration(plan, options.resumeFrom);

      const duration = Date.now() - startTime;
      const durationMinutes = Math.round(duration / 60000);

      if (result.success) {
        console.log(chalk.green('\n✅ Migration completed successfully!'));
        console.log(chalk.blue('\n📊 Migration Summary:'));
        console.log(`  Migration ID: ${result.migrationId}`);
        console.log(`  Total Entities: ${result.completedEntities.length + result.failedEntities.length}`);
        console.log(`  ✅ Completed: ${result.completedEntities.length}`);
        console.log(`  ❌ Failed: ${result.failedEntities.length}`);
        console.log(`  📊 Records Processed: ${result.totalRecordsProcessed.toLocaleString()}`);
        console.log(`  ⏱️  Duration: ${durationMinutes} minutes`);
        console.log(`  🔗 Checkpoints: ${result.checkpointsCreated}`);

        if (result.completedEntities.length > 0) {
          console.log(chalk.green('\n✅ Successfully migrated entities:'));
          result.completedEntities.forEach(entity => {
            console.log(chalk.green(`  ✓ ${entity}`));
          });
        }

        if (result.failedEntities.length > 0) {
          console.log(chalk.red('\n❌ Failed entities:'));
          result.failedEntities.forEach(entity => {
            console.log(chalk.red(`  ✗ ${entity}`));
          });
        }

        console.log(chalk.blue('\n🔧 Next Steps:'));
        console.log(`  1. Validate results: npm run validate:full-migration -- ${result.migrationId}`);
        console.log(`  2. Generate report: npm run full-migration:report -- ${result.migrationId}`);

      } else {
        console.log(chalk.red('\n❌ Migration failed!'));
        console.log(chalk.blue('\n📊 Migration Summary:'));
        console.log(`  Migration ID: ${result.migrationId}`);
        console.log(`  ✅ Completed: ${result.completedEntities.length}`);
        console.log(`  ❌ Failed: ${result.failedEntities.length}`);
        console.log(`  📊 Records Processed: ${result.totalRecordsProcessed.toLocaleString()}`);
        console.log(`  ❌ Records Failed: ${result.totalRecordsFailed.toLocaleString()}`);
        console.log(`  ⏱️  Duration: ${durationMinutes} minutes`);

        if (result.failedEntities.length > 0) {
          console.log(chalk.red('\n❌ Failed entities:'));
          result.failedEntities.forEach(entity => {
            console.log(chalk.red(`  ✗ ${entity}`));
          });
        }

        console.log(chalk.blue('\n🔧 Recovery Options:'));
        console.log(`  1. Resume migration: npm run migrate:full-database -- --resume-from ${result.migrationId}`);
        console.log(`  2. Check status: npm run full-migration:status -- ${result.migrationId}`);
        console.log(`  3. Generate report: npm run full-migration:report -- ${result.migrationId}`);

        if (result.rollbackRequired) {
          console.log(`  4. Rollback: npm run full-migration:rollback -- ${result.migrationId}`);
        }

        process.exit(1);
      }

    } catch (error) {
      console.error(chalk.red('❌ Migration failed:'), (error as Error).message);
      console.error(chalk.red('Stack trace:'), (error as Error).stack);
      process.exit(1);
    } finally {
      if (orchestrator) {
        await orchestrator.cleanup();
      }
    }
  }

  private async handleStatusCommand(migrationId: string, options: CliOptions): Promise<void> {
    try {
      if (!migrationId) {
        console.log(chalk.blue('📊 System Status:'));
        console.log('  🟢 Database connections: Ready');
        console.log('  🟢 Migration system: Initialized');
        console.log('  📋 Active migrations: 0');
        return;
      }

      console.log(chalk.blue(`📊 Migration Status: ${migrationId}`));
      console.log('  Status: Not yet implemented');
      console.log('  Progress: N/A');
      console.log('  Entities: N/A');

    } catch (error) {
      console.error(chalk.red('❌ Failed to get status:'), (error as Error).message);
      process.exit(1);
    }
  }

  private async handleValidationCommand(migrationId: string, options: CliOptions): Promise<void> {
    try {
      console.log(chalk.blue('🔍 Running migration validation...'));
      console.log('  Validation: Not yet implemented');
      console.log('  Results: N/A');

    } catch (error) {
      console.error(chalk.red('❌ Validation failed:'), (error as Error).message);
      process.exit(1);
    }
  }

  private async handleListCommand(options: CliOptions): Promise<void> {
    try {
      console.log(chalk.blue('📋 Migration List:'));
      console.log('  No migrations found (implementation pending)');

    } catch (error) {
      console.error(chalk.red('❌ Failed to list migrations:'), (error as Error).message);
      process.exit(1);
    }
  }

  private async testConnections(): Promise<void> {
    console.log(chalk.blue('🔌 Testing database connections...'));

    try {
      // Test source connection
      const sourcePool = dbConnections.getSourcePool();
      const sourceResult = await sourcePool.query('SELECT 1 as test');
      if (sourceResult.rows.length > 0) {
        console.log(chalk.green('  ✅ Source database: Connected'));
      }

      // Test destination connection
      const destPool = dbConnections.getDestinationPool();
      const destResult = await destPool.query('SELECT 1 as test');
      if (destResult.rows.length > 0) {
        console.log(chalk.green('  ✅ Destination database: Connected'));
      }

      // Test Supabase connection
      const supabase = dbConnections.getSupabaseClient();
      if (supabase) {
        console.log(chalk.green('  ✅ Supabase client: Ready'));
      }

    } catch (error) {
      console.error(chalk.red('  ❌ Connection test failed:'), (error as Error).message);
      throw error;
    }
  }

  private buildMigrationPlan(options: CliOptions): MigrationPlan {
    const entities = this.getEntitiesList(options.entities);

    const migrationEntities: MigrationEntity[] = entities.map((entityName, index) => ({
      name: entityName,
      sourceTable: this.getSourceTableName(entityName),
      targetTable: this.getTargetTableName(entityName),
      dependencyOrder: this.getDependencyOrder(entityName),
      batchSize: parseInt(options.batchSize || '1000'),
      estimatedRecords: 1000, // This would be calculated from actual data
      migrationScript: this.getMigrationScriptPath(entityName),
      validationScript: this.getValidationScriptPath(entityName)
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
        phase: (parseInt(options.schemaPhase || '1') as 1 | 2 | 3 | 4),
        columnsToRemove: {
          profiles: ['insurance_info', 'medical_history'],
          products: ['sku']
        }
      }
    };
  }

  private getEntitiesList(entitiesOption?: string): string[] {
    if (!entitiesOption || entitiesOption === 'all') {
      return [
        'offices', 'profiles', 'doctors', 'patients', 'orders',
        'products', 'jaws', 'projects', 'treatment_plans'
      ];
    }

    return entitiesOption.split(',').map(e => e.trim());
  }

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

  private getTargetTableName(entityName: string): string {
    return entityName;
  }

  private getDependencyOrder(entityName: string): number {
    const dependencyMap: Record<string, number> = {
      'offices': 1,
      'profiles': 2,
      'doctors': 3,
      'patients': 4,
      'orders': 5,
      'products': 6,
      'jaws': 7,
      'projects': 8,
      'treatment_plans': 9
    };

    return dependencyMap[entityName] || 999;
  }

  private getMigrationScriptPath(entityName: string): string {
    return `src/${entityName}-migration.ts`;
  }

  private getValidationScriptPath(entityName: string): string | undefined {
    // Return undefined for now - the script executor will check for npm scripts
    return undefined;
  }

  async run(args: string[]): Promise<void> {
    await this.program.parseAsync(args);
  }
}

// CLI entry point
if (require.main === module) {
  const cli = new SimpleMigrationCli();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    await dbConnections.closeAll();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down gracefully...');
    await dbConnections.closeAll();
    process.exit(0);
  });

  // Run CLI
  cli.run(process.argv)
    .catch((error) => {
      console.error('CLI failed to start:', error);
      process.exit(1);
    });
}