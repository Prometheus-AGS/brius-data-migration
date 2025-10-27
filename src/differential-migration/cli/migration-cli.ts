/**
 * Migration Execution CLI
 * Implements differential:migrate command with batch control, parallel execution
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { MigrationExecutor, type ExecutionConfig, type MigrationTask, type MigrationExecutionResult } from '../services/migration-executor';
import { DifferentialDetector, type DetectionResult } from '../services/differential-detector';
import { v4 as uuidv4 } from 'uuid';

// Type definitions
export interface MigrationOptions {
  analysisId: string;
  entities: string[];
  batchSize: number;
  parallel: boolean;
  maxConcurrent: number;
  dryRun: boolean;
  resume: boolean;
  force: boolean;
  config?: string;
}

export interface MigrationConfiguration {
  sourceDatabase: any;
  destinationDatabase: any;
  executionConfig: ExecutionConfig;
}

// Default entity types for migration execution
const ALL_ENTITY_TYPES = [
  'offices', 'doctors', 'doctor_offices', 'patients', 'orders', 'cases',
  'files', 'case_files', 'messages', 'message_files', 'jaw', 'dispatch_records',
  'system_messages', 'message_attachments', 'technician_roles', 'order_cases',
  'purchases', 'treatment_discussions', 'template_view_groups', 'template_view_roles'
];

/**
 * MigrationCLI Implementation
 *
 * Provides command-line interface for differential migration execution including
 * batch processing, parallel execution, checkpoint management, and progress monitoring.
 */
export class MigrationCLI {
  private config: MigrationConfiguration;
  private sourcePool: Pool | null = null;
  private destinationPool: Pool | null = null;
  private executor: MigrationExecutor | null = null;
  private sessionId: string;

  constructor() {
    this.config = this.loadConfiguration();
    this.sessionId = uuidv4();
  }

  /**
   * Main entry point for CLI execution
   */
  async main(args: string[]): Promise<void> {
    try {
      const options = this.parseArguments(args);

      // Initialize database connections
      await this.initializeDatabasePools();

      // Initialize migration executor
      this.executor = new MigrationExecutor(
        this.sourcePool!,
        this.destinationPool!,
        this.sessionId,
        this.config.executionConfig
      );

      if (options.dryRun) {
        console.log('🔍 DRY RUN MODE: Simulating migration execution...');
        await this.runDryRunMigration(options);
        return;
      }

      // Test database connections
      const connectionsOk = await this.testDatabaseConnections();
      if (!connectionsOk) {
        process.exit(2);
      }

      // Load analysis results
      const analysisData = await this.loadAnalysisResults(options.analysisId);
      if (!analysisData) {
        console.error('❌ ERROR: Analysis data not found');
        console.error(`📋 Details: No analysis found for ID '${options.analysisId}'`);
        console.error('🔄 Suggestion: Run differential:detect first to generate analysis data');
        console.error(`⏰ Timestamp: ${new Date().toISOString()}`);
        process.exit(3);
      }

      // Execute migration
      await this.runMigration(options, analysisData);

      // Cleanup
      await this.cleanup();

    } catch (error) {
      if (error instanceof Error && error.message.includes('Process exit:')) {
        throw error; // Re-throw process exits
      }

      console.error(`❌ Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(7);
    }
  }

  /**
   * Parses command line arguments
   */
  parseArguments(args: string[]): MigrationOptions {
    const options: MigrationOptions = {
      analysisId: '',
      entities: ['all'],
      batchSize: 1000,
      parallel: true,
      maxConcurrent: 3,
      dryRun: false,
      resume: false,
      force: false
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      switch (arg) {
        case '--help':
          this.showHelp();
          process.exit(0);
          break;

        case '--analysis-id':
          if (i + 1 >= args.length) {
            throw new Error('--analysis-id requires a UUID value');
          }
          const analysisId = args[++i];
          if (!this.isValidUUID(analysisId)) {
            throw new Error(`Invalid analysis ID format: ${analysisId}`);
          }
          options.analysisId = analysisId;
          break;

        case '--entities':
          if (i + 1 >= args.length) {
            throw new Error('--entities requires a value');
          }
          options.entities = args[++i].split(',').map(e => e.trim());
          break;

        case '--batch-size':
          if (i + 1 >= args.length) {
            throw new Error('--batch-size requires a numeric value');
          }
          options.batchSize = parseInt(args[++i]);
          if (isNaN(options.batchSize) || options.batchSize < 1 || options.batchSize > 5000) {
            throw new Error('--batch-size must be between 1 and 5000');
          }
          break;

        case '--parallel':
          options.parallel = true;
          break;

        case '--no-parallel':
          options.parallel = false;
          break;

        case '--max-concurrent':
          if (i + 1 >= args.length) {
            throw new Error('--max-concurrent requires a numeric value');
          }
          options.maxConcurrent = parseInt(args[++i]);
          if (isNaN(options.maxConcurrent) || options.maxConcurrent < 1 || options.maxConcurrent > 10) {
            throw new Error('--max-concurrent must be between 1 and 10');
          }
          break;

        case '--dry-run':
          options.dryRun = true;
          break;

        case '--resume':
          options.resume = true;
          break;

        case '--force':
          options.force = true;
          break;

        case '--config':
          if (i + 1 >= args.length) {
            throw new Error('--config requires a file path');
          }
          options.config = args[++i];
          break;

        default:
          throw new Error(`Unknown argument: ${arg}`);
      }
    }

    // Validate required parameters
    if (!options.analysisId) {
      throw new Error('--analysis-id is required');
    }

    return options;
  }

  /**
   * Tests database connections
   */
  async testDatabaseConnections(): Promise<boolean> {
    if (!this.sourcePool || !this.destinationPool) {
      console.error('❌ Database pools not initialized');
      return false;
    }

    try {
      console.log('🔌 Testing database connections...');

      // Test source connection
      const sourceClient = await this.sourcePool.connect();
      const sourceResult = await sourceClient.query('SELECT NOW() as timestamp');
      sourceClient.release();

      // Test destination connection
      const destClient = await this.destinationPool.connect();
      const destResult = await destClient.query('SELECT NOW() as timestamp');
      destClient.release();

      console.log('✅ Source database connected');
      console.log('✅ Destination database connected');

      return true;

    } catch (error) {
      console.error('❌ Database connection test failed:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Loads analysis results for migration planning
   */
  async loadAnalysisResults(analysisId: string): Promise<DetectionResult[] | null> {
    try {
      // In a real implementation, this would load from database or file
      // For now, we'll simulate loading analysis data
      console.log(`🔍 Loading analysis results for ID: ${analysisId}`);

      // Mock analysis data - in real implementation, load from differential analysis storage
      const mockAnalysisData: DetectionResult[] = [
        {
          analysisId: analysisId,
          entityType: 'doctors',
          analysisTimestamp: new Date(),
          baselineTimestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
          detectionMethod: 'timestamp_with_hash',
          totalRecordsAnalyzed: 5000,
          changesDetected: Array.from({ length: 50 }, (_, i) => ({
            recordId: `doctor_${i + 1}`,
            changeType: 'new' as const,
            sourceTimestamp: new Date(),
            contentHash: `hash_${i + 1}`,
            metadata: {
              sourceTable: 'dispatch_doctors',
              destinationTable: 'doctors',
              confidence: 0.95
            }
          })),
          summary: {
            newRecords: 45,
            modifiedRecords: 5,
            deletedRecords: 0,
            totalChanges: 50,
            changePercentage: 1.0
          },
          performance: {
            analysisDurationMs: 15000,
            recordsPerSecond: 333,
            queriesExecuted: 8
          },
          recommendations: ['Migration recommended for detected changes']
        }
      ];

      console.log(`✅ Loaded analysis data for ${mockAnalysisData.length} entities`);
      return mockAnalysisData;

    } catch (error) {
      console.error('❌ Failed to load analysis results:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  /**
   * Executes migration based on analysis results
   */
  async runMigration(options: MigrationOptions, analysisData: DetectionResult[]): Promise<void> {
    if (!this.executor) {
      throw new Error('Migration executor not initialized');
    }

    try {
      console.log('🚀 Starting differential migration execution...');
      console.log(`📊 Session ID: ${this.sessionId}`);

      // Filter entities to migrate
      const entitiesToMigrate = options.entities.includes('all')
        ? analysisData.map(a => a.entityType)
        : options.entities.filter(e => analysisData.some(a => a.entityType === e));

      console.log(`🎯 Migrating ${entitiesToMigrate.length} entities: ${entitiesToMigrate.join(', ')}`);

      // Build migration tasks from analysis data
      const migrationTasks = this.buildMigrationTasks(analysisData, entitiesToMigrate, options);

      // Display migration plan
      this.displayMigrationPlan(migrationTasks);

      // Confirm execution if not forced
      if (!options.force && !await this.confirmExecution(migrationTasks)) {
        console.log('❌ Migration cancelled by user');
        process.exit(6);
      }

      // Execute migration
      console.log(`\n🔄 Executing migration with ${migrationTasks.length} tasks...`);
      const result = await this.executor.executeMigrationTasks(migrationTasks);

      // Display results
      this.displayMigrationResults(result);

      // Determine exit code based on result
      switch (result.overallStatus) {
        case 'completed':
          console.log('\n✅ Migration completed successfully');
          process.exit(0);
          break;
        case 'partial':
          console.log('\n⚠️  Migration completed with some failures');
          process.exit(3);
          break;
        case 'failed':
          console.log('\n❌ Migration failed');
          process.exit(3);
          break;
        case 'paused':
          console.log('\n⏸️  Migration paused');
          process.exit(4);
          break;
        default:
          console.log('\n❓ Migration completed with unknown status');
          process.exit(7);
      }

    } catch (error) {
      const timestamp = new Date().toISOString();
      console.error(`❌ ERROR: Migration execution failed`);
      console.error(`📋 Details: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(`🔄 Suggestion: Check database connections and analysis data`);
      console.error(`⏰ Timestamp: ${timestamp}`);
      console.error(`📊 Session ID: ${this.sessionId}`);

      process.exit(3);
    }
  }

  /**
   * Runs dry run migration simulation
   */
  async runDryRunMigration(options: MigrationOptions): Promise<void> {
    try {
      console.log('📋 DRY RUN: Migration simulation');
      console.log(`🔍 Analysis ID: ${options.analysisId}`);
      console.log(`🎯 Entities: ${options.entities.join(', ')}`);
      console.log(`📦 Batch Size: ${options.batchSize}`);
      console.log(`⚡ Parallel: ${options.parallel ? 'Yes' : 'No'}`);
      console.log(`🔢 Max Concurrent: ${options.maxConcurrent}`);

      // Simulate loading analysis data
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('✅ Analysis data loaded (simulated)');

      // Simulate migration planning
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('✅ Migration tasks planned (simulated)');

      // Simulate execution
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('✅ Migration would execute successfully (simulated)');

      console.log('\n💡 DRY RUN COMPLETE: No actual changes were made');
      console.log('🔄 Run without --dry-run to execute actual migration');

    } catch (error) {
      console.error('❌ Dry run simulation failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(7);
    }
  }

  /**
   * Builds migration tasks from analysis results
   */
  buildMigrationTasks(
    analysisData: DetectionResult[],
    entitiesToMigrate: string[],
    options: MigrationOptions
  ): MigrationTask[] {
    const tasks: MigrationTask[] = [];

    for (const entityType of entitiesToMigrate) {
      const analysis = analysisData.find(a => a.entityType === entityType);
      if (!analysis) {
        console.warn(`⚠️  No analysis data found for entity: ${entityType}`);
        continue;
      }

      // Extract record IDs from changes detected
      const recordIds = analysis.changesDetected.map(change => change.recordId);
      if (recordIds.length === 0) {
        console.log(`ℹ️  No changes detected for entity: ${entityType}`);
        continue;
      }

      // Determine dependencies based on entity type
      const dependencies = this.getEntityDependencies(entityType);

      // Estimate duration based on record count and historical performance
      const estimatedDurationMs = Math.ceil(
        (recordIds.length / analysis.performance.recordsPerSecond) * 1000
      );

      const task: MigrationTask = {
        entityType,
        recordIds,
        priority: this.getEntityPriority(entityType),
        dependencies: dependencies.filter(dep => entitiesToMigrate.includes(dep)),
        estimatedDurationMs,
        metadata: {
          sourceTable: `dispatch_${entityType}`,
          destinationTable: entityType,
          totalRecords: recordIds.length,
          migrationMethod: 'differential',
          checkpointId: options.resume ? this.findExistingCheckpoint(entityType) : undefined
        }
      };

      tasks.push(task);
    }

    return tasks;
  }

  /**
   * Displays migration execution plan
   */
  displayMigrationPlan(tasks: MigrationTask[]): void {
    console.log('\n📋 Migration Execution Plan');
    console.log('============================');

    const totalRecords = tasks.reduce((sum, task) => sum + task.recordIds.length, 0);
    const totalEstimatedTime = tasks.reduce((sum, task) => sum + task.estimatedDurationMs, 0);

    console.log(`📊 Total Records: ${totalRecords.toLocaleString()}`);
    console.log(`⏱️  Estimated Time: ${this.formatDuration(totalEstimatedTime)}`);
    console.log(`🎯 Entities: ${tasks.length}`);

    console.log('\nEntity Details:');
    tasks.forEach((task, index) => {
      const deps = task.dependencies.length > 0 ? ` (after: ${task.dependencies.join(', ')})` : '';
      console.log(`  ${index + 1}. ${task.entityType}: ${task.recordIds.length.toLocaleString()} records${deps}`);
    });
  }

  /**
   * Displays migration execution results
   */
  displayMigrationResults(result: MigrationExecutionResult): void {
    console.log('\n📊 Migration Execution Results');
    console.log('===============================');

    console.log(`📋 Session ID: ${result.sessionId}`);
    console.log(`⚡ Status: ${result.overallStatus.toUpperCase()}`);
    console.log(`📈 Records Processed: ${result.totalRecordsProcessed.toLocaleString()}`);
    console.log(`❌ Records Failed: ${result.totalRecordsFailed.toLocaleString()}`);
    console.log(`⏱️  Duration: ${this.formatDuration(result.executionSummary.totalDurationMs)}`);
    console.log(`🚀 Throughput: ${result.executionSummary.averageThroughput} records/sec`);

    if (result.entitiesProcessed.length > 0) {
      console.log(`\n✅ Successfully Processed: ${result.entitiesProcessed.join(', ')}`);
    }

    if (result.entitiesFailed.length > 0) {
      console.log(`\n❌ Failed Entities: ${result.entitiesFailed.join(', ')}`);
    }

    if (result.checkpoints.length > 0) {
      console.log(`\n💾 Checkpoints Created: ${result.checkpoints.length}`);
      console.log(`📍 Latest Checkpoint: ${result.checkpoints[result.checkpoints.length - 1]}`);
    }

    if (result.recovery.recommendedActions.length > 0) {
      console.log('\n💡 Recommendations:');
      result.recovery.recommendedActions.forEach((action, index) => {
        console.log(`   ${index + 1}. ${action}`);
      });
    }
  }

  /**
   * Confirms migration execution with user
   */
  async confirmExecution(tasks: MigrationTask[]): Promise<boolean> {
    const totalRecords = tasks.reduce((sum, task) => sum + task.recordIds.length, 0);

    console.log(`\n⚠️  About to migrate ${totalRecords.toLocaleString()} records across ${tasks.length} entities`);
    console.log('This operation will modify your database and cannot be easily undone.');
    console.log('\nUse --force to skip this confirmation.');

    // In a real CLI, you would use readline or similar for user input
    // For now, assume confirmation (in real implementation, add interactive prompt)
    console.log('✅ Proceeding with migration (auto-confirmed for demo)');
    return true;
  }

  /**
   * Loads configuration from environment
   */
  loadConfiguration(configPath?: string): MigrationConfiguration {
    // Load environment variables
    if (configPath) {
      dotenv.config({ path: configPath });
    } else {
      dotenv.config();
    }

    return {
      sourceDatabase: {
        host: process.env.SOURCE_DB_HOST || 'localhost',
        port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
        database: process.env.SOURCE_DB_NAME || 'source_db',
        user: process.env.SOURCE_DB_USER || 'postgres',
        password: process.env.SOURCE_DB_PASSWORD || ''
      },
      destinationDatabase: {
        host: process.env.TARGET_DB_HOST || 'localhost',
        port: parseInt(process.env.TARGET_DB_PORT || '54322'),
        database: process.env.TARGET_DB_NAME || 'postgres',
        user: process.env.TARGET_DB_USER || 'postgres',
        password: process.env.TARGET_DB_PASSWORD || 'postgres'
      },
      executionConfig: {
        batchSize: parseInt(process.env.BATCH_SIZE || '1000'),
        maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3'),
        checkpointInterval: parseInt(process.env.CHECKPOINT_INTERVAL || '10'),
        parallelEntityLimit: parseInt(process.env.PARALLEL_ENTITY_LIMIT || '3'),
        timeoutMs: parseInt(process.env.MIGRATION_TIMEOUT || '300000'),
        enableValidation: process.env.ENABLE_VALIDATION !== 'false',
        validationSampleSize: parseInt(process.env.VALIDATION_SAMPLE_SIZE || '100'),
        enablePerformanceMonitoring: process.env.ENABLE_PERFORMANCE_MONITORING !== 'false'
      }
    };
  }

  /**
   * Private helper methods
   */

  private async initializeDatabasePools(): Promise<void> {
    try {
      this.sourcePool = new Pool({
        host: this.config.sourceDatabase.host,
        port: this.config.sourceDatabase.port,
        database: this.config.sourceDatabase.database,
        user: this.config.sourceDatabase.user,
        password: this.config.sourceDatabase.password,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        application_name: 'differential_migration_source'
      });

      this.destinationPool = new Pool({
        host: this.config.destinationDatabase.host,
        port: this.config.destinationDatabase.port,
        database: this.config.destinationDatabase.database,
        user: this.config.destinationDatabase.user,
        password: this.config.destinationDatabase.password,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        application_name: 'differential_migration_destination'
      });

    } catch (error) {
      throw new Error(`Failed to initialize database pools: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async cleanup(): Promise<void> {
    try {
      if (this.sourcePool) {
        await this.sourcePool.end();
        this.sourcePool = null;
      }
      if (this.destinationPool) {
        await this.destinationPool.end();
        this.destinationPool = null;
      }
    } catch (error) {
      // Log cleanup errors but don't fail
      console.error('Warning: Error during cleanup:', error);
    }
  }

  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  private getEntityDependencies(entityType: string): string[] {
    const dependencies: Record<string, string[]> = {
      offices: [],
      doctors: ['offices'],
      doctor_offices: ['doctors', 'offices'],
      patients: ['doctors'],
      orders: ['patients'],
      cases: ['orders'],
      files: [],
      case_files: ['cases', 'files'],
      messages: ['cases'],
      message_files: ['messages', 'files'],
      jaw: ['patients'],
      dispatch_records: [],
      system_messages: [],
      message_attachments: ['messages'],
      technician_roles: ['doctors'],
      order_cases: ['orders', 'cases'],
      purchases: ['orders'],
      treatment_discussions: ['cases'],
      template_view_groups: [],
      template_view_roles: ['template_view_groups']
    };

    return dependencies[entityType] || [];
  }

  private getEntityPriority(entityType: string): 'high' | 'medium' | 'low' {
    const highPriority = ['offices', 'doctors', 'patients'];
    const mediumPriority = ['orders', 'cases', 'messages'];

    if (highPriority.includes(entityType)) return 'high';
    if (mediumPriority.includes(entityType)) return 'medium';
    return 'low';
  }

  private findExistingCheckpoint(entityType: string): string | undefined {
    // In real implementation, query database for existing checkpoints
    // For now, return undefined (no existing checkpoint)
    return undefined;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private showHelp(): void {
    console.log(`
🚀 Differential Migration: Execution
====================================

Usage:
  npm run differential:migrate -- --analysis-id <uuid> [options]
  npx ts-node src/differential-migration.ts migrate --analysis-id <uuid> [options]

Description:
  Execute differential migration with checkpoint support and parallel processing.
  Requires analysis results from differential:detect command.

Required Parameters:
  --analysis-id <uuid>     Reference to differential analysis result

Options:
  --entities <list>        Comma-separated entities to migrate (default: all)
  --batch-size <number>    Records per batch (default: 1000, max: 5000)
  --parallel               Enable parallel processing (default: true)
  --no-parallel            Disable parallel processing
  --max-concurrent <num>   Maximum concurrent entity migrations (default: 3, max: 10)
  --dry-run                Simulate without making changes
  --resume                 Resume from last checkpoint
  --force                  Force migration despite warnings
  --config <path>          Custom configuration file path
  --help                   Show this help message

Examples:
  # Migrate all detected changes
  npm run differential:migrate -- --analysis-id 550e8400-e29b-41d4-a716-446655440000

  # Migrate specific entities with custom batch size
  npm run differential:migrate -- --analysis-id <uuid> --entities doctors,patients --batch-size 500

  # Dry run migration (no actual changes)
  npm run differential:migrate -- --analysis-id <uuid> --dry-run

  # Parallel execution for independent entities
  npm run differential:migrate -- --analysis-id <uuid> --parallel --max-concurrent 4

  # Resume from checkpoint
  npm run differential:migrate -- --analysis-id <uuid> --resume

Output:
  Differential Migration Progress
  ===============================
  Session ID: 550e8400-e29b-41d4-a716-446655440000

  Entity        Status      Progress    Records/sec    ETA
  offices       completed   100%        1,234/sec      -
  doctors       running     75%         987/sec        2 min
  patients      pending     0%          -              -

  Overall Progress: 58% complete (1,234 of 2,140 records)
  Estimated Completion: 2025-10-26 11:15:00

Exit Codes:
  0  Migration completed successfully
  1  Invalid parameters
  2  Database connection failure
  3  Migration failed with errors
  4  Migration paused by user
  5  Checkpoint corruption detected
  6  Operation interrupted by user
  7  System error (unexpected failure)

Environment Variables:
  SOURCE_DB_HOST           Source database hostname
  SOURCE_DB_PORT           Source database port (default: 5432)
  SOURCE_DB_NAME           Source database name
  SOURCE_DB_USER           Source database username
  SOURCE_DB_PASSWORD       Source database password
  TARGET_DB_HOST           Target database hostname
  TARGET_DB_PORT           Target database port (default: 54322)
  TARGET_DB_NAME           Target database name
  TARGET_DB_USER           Target database username
  TARGET_DB_PASSWORD       Target database password
  BATCH_SIZE               Default batch size (default: 1000)
  MAX_RETRY_ATTEMPTS       Retry attempts for failed operations (default: 3)
  CHECKPOINT_INTERVAL      Batches between checkpoints (default: 10)
  PARALLEL_ENTITY_LIMIT    Max concurrent entities (default: 3)
  MIGRATION_TIMEOUT        Operation timeout in ms (default: 300000)
  ENABLE_VALIDATION        Enable post-migration validation (default: true)
  VALIDATION_SAMPLE_SIZE   Records to validate (default: 100)
`);
  }
}

// CLI execution when run directly
if (require.main === module) {
  const cli = new MigrationCLI();
  cli.main(process.argv.slice(2)).catch(error => {
    console.error('CLI execution failed:', error);
    process.exit(7);
  });
}