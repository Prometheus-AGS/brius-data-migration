/**
 * Differential Detection CLI
 * Implements differential:detect command with timestamp filtering, result persistence
 */

import { Pool } from 'pg';
import * as fs from 'fs/promises';
import { DifferentialDetector, type DetectionResult, type DetectionConfig } from '../services/differential-detector';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';

// Type definitions
export interface DetectionOptions {
  entities: string[];
  since?: Date;
  includeDeleted: boolean;
  output: 'table' | 'json' | 'csv';
  saveTo?: string;
  threshold: number;
  config?: string;
  verbose?: boolean;
}

export interface DetectionOutput {
  detectionId: string;
  timestamp: string;
  entityResults: Array<{
    entityType: string;
    summary: {
      newRecords: number;
      modifiedRecords: number;
      deletedRecords: number;
      totalChanges: number;
      changePercentage: number;
    };
    performance: {
      analysisDurationMs: number;
      recordsPerSecond: number;
    };
  }>;
  overallSummary: {
    totalChanges: number;
    estimatedMigrationTime: string;
    averageChangePercentage: number;
  };
}

export interface DetectionConfiguration {
  timestampField: string;
  contentHashField: string;
  enableContentHashing: boolean;
  batchSize: number;
  parallelConnections: number;
  sourceDatabase: any;
  destinationDatabase: any;
}

// Default entity types for change detection
const ALL_ENTITY_TYPES = [
  'offices', 'doctors', 'doctor_offices', 'patients', 'orders', 'cases',
  'files', 'case_files', 'messages', 'message_files', 'jaw', 'dispatch_records',
  'system_messages', 'message_attachments', 'technician_roles', 'order_cases',
  'purchases', 'treatment_discussions', 'template_view_groups', 'template_view_roles'
];

/**
 * DifferentialCLI Implementation
 *
 * Provides command-line interface for differential change detection including
 * timestamp-based analysis, content hash verification, and result persistence.
 */
export class DifferentialCLI {
  private config: DetectionConfiguration;
  private sourcePool: Pool | null = null;
  private destinationPool: Pool | null = null;

  constructor() {
    this.config = this.loadConfiguration();
  }

  /**
   * Main entry point for CLI execution
   */
  async main(args: string[]): Promise<void> {
    try {
      const options = this.parseArguments(args);

      // Initialize database connections
      await this.initializeDatabasePools();

      // Get baseline timestamp if not provided
      if (!options.since) {
        console.log('🔍 No timestamp provided, looking for last migration baseline...');
        const lastMigration = await this.getLastMigrationTimestamp();

        if (!lastMigration) {
          console.error('❌ ERROR: No baseline found');
          console.error('📋 Details: No previous migration timestamp detected');
          console.error('🔄 Suggestion: Run differential:analyze first to establish baseline');
          console.error(`⏰ Timestamp: ${new Date().toISOString()}`);
          process.exit(3);
        }

        options.since = lastMigration;
        console.log(`✅ Using last migration baseline: ${lastMigration.toISOString()}`);
      }

      // Execute differential detection
      await this.runDetection(options);

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
  parseArguments(args: string[]): DetectionOptions {
    const options: DetectionOptions = {
      entities: ['all'],
      includeDeleted: true,
      output: 'table',
      threshold: 0
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      switch (arg) {
        case '--help':
          this.showHelp();
          process.exit(0);
          break;

        case '--entities':
          if (i + 1 >= args.length) {
            throw new Error('--entities requires a value');
          }
          options.entities = args[++i].split(',').map(e => e.trim());
          break;

        case '--since':
          if (i + 1 >= args.length) {
            throw new Error('--since requires a timestamp value');
          }
          const timestampStr = args[++i];
          const parsedDate = new Date(timestampStr);
          if (isNaN(parsedDate.getTime())) {
            throw new Error(`Invalid timestamp format: ${timestampStr}`);
          }
          options.since = parsedDate;
          break;

        case '--include-deleted':
          options.includeDeleted = true;
          break;

        case '--no-include-deleted':
          options.includeDeleted = false;
          break;

        case '--output':
          if (i + 1 >= args.length) {
            throw new Error('--output requires a value');
          }
          const outputFormat = args[++i];
          if (!['table', 'json', 'csv'].includes(outputFormat)) {
            throw new Error('--output must be table, json, or csv');
          }
          options.output = outputFormat as 'table' | 'json' | 'csv';
          break;

        case '--save-to':
          if (i + 1 >= args.length) {
            throw new Error('--save-to requires a file path');
          }
          options.saveTo = args[++i];
          break;

        case '--threshold':
          if (i + 1 >= args.length) {
            throw new Error('--threshold requires a numeric value');
          }
          options.threshold = parseFloat(args[++i]);
          if (isNaN(options.threshold) || options.threshold < 0 || options.threshold > 100) {
            throw new Error('--threshold must be a number between 0 and 100');
          }
          break;

        case '--config':
          if (i + 1 >= args.length) {
            throw new Error('--config requires a file path');
          }
          options.config = args[++i];
          break;

        case '--verbose':
          options.verbose = true;
          break;

        default:
          throw new Error(`Unknown argument: ${arg}`);
      }
    }

    return options;
  }

  /**
   * Executes differential detection
   */
  async runDetection(options: DetectionOptions): Promise<void> {
    try {
      console.log('🔎 Starting differential change detection...');

      // Determine entities to analyze
      const entitiesToAnalyze = options.entities.includes('all')
        ? ALL_ENTITY_TYPES
        : options.entities;

      console.log(`🎯 Detecting changes for ${entitiesToAnalyze.length} entities since ${options.since!.toISOString()}`);

      const results: DetectionResult[] = [];
      let entityIndex = 0;

      for (const entityType of entitiesToAnalyze) {
        entityIndex++;
        this.showProgress(entityIndex, entitiesToAnalyze.length, entityType);

        try {
          const detector = new DifferentialDetector(
            this.sourcePool!,
            this.destinationPool!,
            entityType,
            {
              timestampField: this.config.timestampField,
              contentHashField: this.config.contentHashField,
              enableContentHashing: this.config.enableContentHashing,
              batchSize: this.config.batchSize,
              parallelConnections: this.config.parallelConnections
            },
            uuidv4()
          );

          const result = await detector.detectChanges({
            entityType,
            sinceTimestamp: options.since!,
            includeDeletes: options.includeDeleted,
            enableContentHashing: true,
            batchSize: this.config.batchSize
          });

          // Apply threshold filter
          if (result.summary.changePercentage >= options.threshold) {
            results.push(result);
            console.log(`   ✅ ${entityType}: ${result.summary.totalChanges} changes (${result.summary.changePercentage}%)`);
          } else {
            console.log(`   ⏭️  Skipping ${entityType}: change percentage (${result.summary.changePercentage}%) below threshold (${options.threshold}%)`);
          }

        } catch (error) {
          console.error(`   ❌ Failed to analyze ${entityType}: ${error instanceof Error ? error.message : 'Unknown error'}`);

          const timestamp = new Date().toISOString();
          console.error(`❌ ERROR: Detection failed for entity '${entityType}'`);
          console.error(`📋 Details: ${error instanceof Error ? error.message : 'Unknown error'}`);
          console.error(`🔄 Suggestion: Check entity configuration and database permissions`);
          console.error(`⏰ Timestamp: ${timestamp}`);

          process.exit(3);
        }
      }

      console.log(`\n✅ Detection completed for ${results.length} entities with changes`);

      // Format and display results
      this.formatOutput(results, options.output, options.verbose || false);

      // Save to file if requested
      if (options.saveTo) {
        await this.saveResults(results, options.saveTo, options.output);
      }

    } catch (error) {
      console.error(`❌ Detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(3);
    }
  }

  /**
   * Gets last migration timestamp for baseline
   */
  async getLastMigrationTimestamp(): Promise<Date | null> {
    if (!this.destinationPool) {
      return null;
    }

    try {
      // Query migration_control table for last successful migration
      const query = `
        SELECT MAX(completed_at) as last_migration
        FROM migration_control
        WHERE status = 'completed'
        AND completed_at IS NOT NULL
      `;

      const result = await this.destinationPool.query(query);

      if (result.rows.length > 0 && result.rows[0].last_migration) {
        return new Date(result.rows[0].last_migration);
      }

      return null;

    } catch (error) {
      // migration_control table might not exist or be accessible
      return null;
    }
  }

  /**
   * Shows progress indicator
   */
  showProgress(current: number, total: number, entityType: string): void {
    const percentage = Math.round((current / total) * 100);
    const progressBar = this.createProgressBar(current, total);
    console.log(`🔄 [${current}/${total}] ${progressBar} ${percentage}% - Analyzing ${entityType}...`);
  }

  /**
   * Formats and displays detection results
   */
  formatOutput(results: DetectionResult[], format: 'table' | 'json' | 'csv', verbose: boolean): void {
    if (results.length === 0) {
      console.log('\n📄 No changes detected since last migration');
      console.log('✅ All entities are up to date');
      return;
    }

    if (format === 'json') {
      this.formatJsonOutput(results);
    } else if (format === 'csv') {
      this.formatCsvOutput(results);
    } else {
      this.formatTableOutput(results, verbose);
    }
  }

  /**
   * Saves results to file
   */
  async saveResults(results: DetectionResult[], filePath: string, format: 'table' | 'json' | 'csv'): Promise<void> {
    try {
      let content: string;

      if (format === 'json') {
        const output = this.buildJsonOutput(results);
        content = JSON.stringify(output, null, 2);
      } else if (format === 'csv') {
        content = this.buildCsvOutput(results);
      } else {
        content = this.buildTableOutput(results);
      }

      await fs.writeFile(filePath, content, 'utf8');
      console.log(`💾 Results saved to: ${filePath}`);

    } catch (error) {
      console.error(`❌ Failed to save results to file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Loads configuration from environment
   */
  loadConfiguration(configPath?: string): DetectionConfiguration {
    // Load environment variables
    if (configPath) {
      dotenv.config({ path: configPath });
    } else {
      dotenv.config();
    }

    return {
      timestampField: process.env.TIMESTAMP_FIELD || 'updated_at',
      contentHashField: process.env.CONTENT_HASH_FIELD || 'content_hash',
      enableContentHashing: process.env.ENABLE_CONTENT_HASHING !== 'false',
      batchSize: parseInt(process.env.DETECTION_BATCH_SIZE || '1000'),
      parallelConnections: parseInt(process.env.PARALLEL_CONNECTIONS || '3'),
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
        application_name: 'differential_detection_source'
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
        application_name: 'differential_detection_destination'
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

  private formatTableOutput(results: DetectionResult[], verbose: boolean): void {
    console.log('\n🔎 Differential Analysis Results');
    console.log('=================================');

    // Calculate totals
    const totalNew = results.reduce((sum, r) => sum + r.summary.newRecords, 0);
    const totalModified = results.reduce((sum, r) => sum + r.summary.modifiedRecords, 0);
    const totalDeleted = results.reduce((sum, r) => sum + r.summary.deletedRecords, 0);
    const totalChanges = totalNew + totalModified + totalDeleted;

    // Format entity data for table display
    const tableData = results.map(result => ({
      Entity: result.entityType,
      New: result.summary.newRecords.toLocaleString(),
      Modified: result.summary.modifiedRecords.toLocaleString(),
      Deleted: result.summary.deletedRecords.toLocaleString(),
      'Change%': `${result.summary.changePercentage}%`,
      'Est. Time': this.estimateMigrationTime(result.summary.totalChanges)
    }));

    console.table(tableData);

    console.log(`\n📊 Total Changes: ${totalChanges.toLocaleString()} records`);
    console.log(`⏰ Estimated Migration Time: ${this.estimateMigrationTime(totalChanges)}`);

    if (verbose) {
      this.displayVerboseInformation(results);
    }

    // Display recommendations
    const allRecommendations = results.flatMap(r => r.recommendations);
    if (allRecommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      const uniqueRecommendations = [...new Set(allRecommendations)];
      uniqueRecommendations.forEach((rec, index) => {
        console.log(`   ${index + 1}. ${rec}`);
      });
    }
  }

  private formatJsonOutput(results: DetectionResult[]): void {
    const output = this.buildJsonOutput(results);
    console.log(JSON.stringify(output, null, 2));
  }

  private formatCsvOutput(results: DetectionResult[]): void {
    const csvOutput = this.buildCsvOutput(results);
    console.log(csvOutput);
  }

  private buildJsonOutput(results: DetectionResult[]): DetectionOutput {
    const totalChanges = results.reduce((sum, r) => sum + r.summary.totalChanges, 0);
    const averageChangePercentage = results.length > 0
      ? Math.round((results.reduce((sum, r) => sum + r.summary.changePercentage, 0) / results.length) * 100) / 100
      : 0;

    return {
      detectionId: uuidv4(),
      timestamp: new Date().toISOString(),
      entityResults: results.map(result => ({
        entityType: result.entityType,
        summary: result.summary,
        performance: {
          analysisDurationMs: result.performance.analysisDurationMs,
          recordsPerSecond: result.performance.recordsPerSecond
        }
      })),
      overallSummary: {
        totalChanges,
        estimatedMigrationTime: this.estimateMigrationTime(totalChanges),
        averageChangePercentage
      }
    };
  }

  private buildCsvOutput(results: DetectionResult[]): string {
    const header = 'Entity,New,Modified,Deleted,Total Changes,Change %,Records/sec';
    const rows = results.map(result =>
      `${result.entityType},${result.summary.newRecords},${result.summary.modifiedRecords},${result.summary.deletedRecords},${result.summary.totalChanges},${result.summary.changePercentage},${result.performance.recordsPerSecond}`
    );

    return [header, ...rows].join('\n');
  }

  private buildTableOutput(results: DetectionResult[]): string {
    const lines = ['Differential Analysis Results', '================================='];

    results.forEach(result => {
      lines.push(`Entity: ${result.entityType}`);
      lines.push(`  New: ${result.summary.newRecords}`);
      lines.push(`  Modified: ${result.summary.modifiedRecords}`);
      lines.push(`  Deleted: ${result.summary.deletedRecords}`);
      lines.push(`  Change %: ${result.summary.changePercentage}%`);
      lines.push('');
    });

    const totalChanges = results.reduce((sum, r) => sum + r.summary.totalChanges, 0);
    lines.push(`Total Changes: ${totalChanges} records`);
    lines.push(`Estimated Migration Time: ${this.estimateMigrationTime(totalChanges)}`);

    return lines.join('\n');
  }

  private displayVerboseInformation(results: DetectionResult[]): void {
    console.log('\n🔧 Performance Metrics:');

    const totalAnalysisTime = results.reduce((sum, r) => sum + r.performance.analysisDurationMs, 0);
    const totalRecords = results.reduce((sum, r) => sum + r.totalRecordsAnalyzed, 0);
    const averageThroughput = totalAnalysisTime > 0
      ? Math.round((totalRecords / totalAnalysisTime) * 1000)
      : 0;

    console.log(`   Total Analysis Time: ${totalAnalysisTime.toLocaleString()}ms`);
    console.log(`   Average Throughput: ${averageThroughput.toLocaleString()} records/sec`);
    console.log(`   Total Records Analyzed: ${totalRecords.toLocaleString()}`);

    console.log('\n📋 Per-Entity Details:');
    results.forEach(result => {
      console.log(`   ${result.entityType}:`);
      console.log(`     Detection Method: ${result.detectionMethod}`);
      console.log(`     Records Analyzed: ${result.totalRecordsAnalyzed.toLocaleString()}`);
      console.log(`     Analysis Time: ${result.performance.analysisDurationMs}ms`);
      console.log(`     Throughput: ${result.performance.recordsPerSecond} records/sec`);
      console.log(`     Queries: ${result.performance.queriesExecuted}`);

      if (result.changesDetected.length > 0) {
        const sampleChanges = result.changesDetected.slice(0, 3);
        console.log(`     Sample Changes:`);
        sampleChanges.forEach(change => {
          console.log(`       ${change.changeType}: ${change.recordId} (${change.sourceTimestamp.toISOString()})`);
        });
      }
    });
  }

  private createProgressBar(current: number, total: number, width: number = 20): string {
    const percentage = current / total;
    const filled = Math.round(width * percentage);
    const empty = width - filled;

    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  private estimateMigrationTime(changeCount: number): string {
    // Base estimation: ~1000 records per minute
    const baseRatePerMinute = 1000;
    const estimatedMinutes = Math.ceil(changeCount / baseRatePerMinute);

    if (estimatedMinutes < 1) {
      return '< 1 min';
    } else if (estimatedMinutes < 60) {
      return `${estimatedMinutes} min`;
    } else {
      const hours = Math.ceil(estimatedMinutes / 60);
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    }
  }

  private showHelp(): void {
    console.log(`
🔎 Differential Migration: Change Detection
===========================================

Usage:
  npm run differential:detect [options]
  npx ts-node src/differential-migration.ts detect [options]

Description:
  Identifies new, modified, and deleted records since the last migration or
  specified timestamp. Uses timestamp-based detection with optional content
  hash verification for maximum accuracy.

Options:
  --entities <list>        Comma-separated entities to analyze (default: all)
  --since <timestamp>      Baseline timestamp (default: last migration)
  --include-deleted        Include soft-deleted records (default: true)
  --no-include-deleted     Exclude soft-deleted records
  --output <format>        Output format: table, json, csv (default: table)
  --save-to <file>         Save results to specified file
  --threshold <percent>    Minimum change percentage to report (default: 0)
  --config <path>          Custom configuration file path
  --help                   Show this help message

Examples:
  # Detect changes for all entities since last migration
  npm run differential:detect

  # Detect changes for specific entities since timestamp
  npm run differential:detect -- --entities orders,cases --since "2025-10-25 12:00:00"

  # Include soft-deleted records with JSON output
  npm run differential:detect -- --include-deleted --output json

  # Save results to file with change threshold
  npm run differential:detect -- --threshold 1.0 --save-to changes.json

Timestamp Format:
  Accepts ISO 8601 format or PostgreSQL-compatible timestamps:
  - "2025-10-25T12:00:00Z"
  - "2025-10-25 12:00:00"
  - "2025-10-25"

Exit Codes:
  0  Detection completed successfully
  1  Invalid parameters
  2  Database connection failure
  3  No baseline found (run analyze first)
  7  System error (unexpected failure)

Environment Variables:
  TIMESTAMP_FIELD           Timestamp field for change detection (default: updated_at)
  CONTENT_HASH_FIELD        Content hash field name (default: content_hash)
  ENABLE_CONTENT_HASHING    Enable content hash verification (default: true)
  DETECTION_BATCH_SIZE      Batch size for detection queries (default: 1000)
  PARALLEL_CONNECTIONS      Parallel database connections (default: 3)
`);
  }
}

// CLI execution when run directly
if (require.main === module) {
  const cli = new DifferentialCLI();
  cli.main(process.argv.slice(2)).catch(error => {
    console.error('CLI execution failed:', error);
    process.exit(7);
  });
}