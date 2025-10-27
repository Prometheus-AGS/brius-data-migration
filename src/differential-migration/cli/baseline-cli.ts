/**
 * Baseline Analysis CLI
 * Implements differential:analyze command with table/JSON output, entity filtering
 */

import { Pool } from 'pg';
import { BaselineAnalyzer, type BaselineAnalysisReport, type DatabaseConnectionConfig } from '../services/baseline-analyzer';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';

// Type definitions
export interface BaselineOptions {
  entities: string[];
  output: 'table' | 'json' | 'csv';
  includeMappings: boolean;
  verbose: boolean;
  dryRun: boolean;
  config?: string;
}

export interface BaselineOutput {
  analysisId: string;
  timestamp: string;
  entitySummary: Array<{
    entityType: string;
    sourceCount: number;
    destinationCount: number;
    mappingCount?: number;
    status: string;
    lastMigrationTimestamp?: string;
  }>;
  overallStatus: string;
  totalSourceRecords: number;
  totalDestinationRecords: number;
  overallGap: number;
  recommendations?: string[];
}

export interface BaselineConfiguration {
  batchSize: number;
  sourceDatabase: DatabaseConnectionConfig;
  destinationDatabase: DatabaseConnectionConfig;
  timeout: number;
  maxRetries: number;
}

// Default entity types based on existing migration infrastructure
const ALL_ENTITY_TYPES = [
  'offices', 'doctors', 'doctor_offices', 'patients', 'orders', 'cases',
  'files', 'case_files', 'messages', 'message_files', 'jaw', 'dispatch_records',
  'system_messages', 'message_attachments', 'technician_roles', 'order_cases',
  'purchases', 'treatment_discussions', 'template_view_groups', 'template_view_roles'
];

/**
 * BaselineCLI Implementation
 *
 * Provides command-line interface for baseline analysis operations including
 * database comparison, gap analysis, and mapping validation.
 */
export class BaselineCLI {
  private config: BaselineConfiguration;
  private analyzer: BaselineAnalyzer | null = null;

  constructor() {
    this.config = this.loadConfiguration();
  }

  /**
   * Main entry point for CLI execution
   */
  async main(args: string[]): Promise<void> {
    try {
      const options = this.parseArguments(args);

      // Initialize services
      await this.initializeServices();

      if (options.dryRun) {
        console.log('🔍 DRY RUN MODE: Testing connections and configuration...');

        const connectionsOk = await this.testDatabaseConnections();
        if (!connectionsOk) {
          process.exit(2);
        }

        console.log('✅ Configuration and connections verified');
        console.log('💡 Run without --dry-run to execute actual analysis');
        return;
      }

      // Test database connections first
      const connectionsOk = await this.testDatabaseConnections();
      if (!connectionsOk) {
        process.exit(2);
      }

      // Execute baseline analysis
      await this.runAnalysis(options);

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
  parseArguments(args: string[]): BaselineOptions {
    const options: BaselineOptions = {
      entities: ['all'],
      output: 'table',
      includeMappings: false,
      verbose: false,
      dryRun: false
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

        case '--include-mappings':
          options.includeMappings = true;
          break;

        case '--verbose':
          options.verbose = true;
          break;

        case '--dry-run':
          options.dryRun = true;
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

    return options;
  }

  /**
   * Tests database connections
   */
  async testDatabaseConnections(): Promise<boolean> {
    if (!this.analyzer) {
      console.error('❌ Analyzer not initialized');
      return false;
    }

    try {
      console.log('🔌 Testing database connections...');

      const connectionResults = await this.analyzer.testConnections();

      if (!connectionResults.sourceConnection.successful) {
        console.error('❌ Source database connection failed:', connectionResults.sourceConnection.error);
        return false;
      }

      if (!connectionResults.destinationConnection.successful) {
        console.error('❌ Destination database connection failed:', connectionResults.destinationConnection.error);
        return false;
      }

      console.log(`✅ Source database connected (${connectionResults.sourceConnection.latencyMs}ms)`);
      console.log(`✅ Destination database connected (${connectionResults.destinationConnection.latencyMs}ms)`);

      return true;

    } catch (error) {
      console.error('❌ Connection test failed:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Executes baseline analysis
   */
  async runAnalysis(options: BaselineOptions): Promise<void> {
    if (!this.analyzer) {
      throw new Error('Analyzer not initialized');
    }

    try {
      console.log('📊 Starting baseline analysis...');

      // Determine entities to analyze
      const entitiesToAnalyze = options.entities.includes('all')
        ? ALL_ENTITY_TYPES
        : options.entities;

      console.log(`🎯 Analyzing ${entitiesToAnalyze.length} entities: ${entitiesToAnalyze.join(', ')}`);

      // Generate baseline report
      const report = await this.analyzer.generateBaselineReport(entitiesToAnalyze, uuidv4());

      console.log(`✅ Analysis completed in ${report.performanceMetrics.analysisDurationMs}ms`);

      // Format and display output
      this.formatOutput(report, options.output, options.verbose);

      // Exit with appropriate code based on status
      if (report.overallStatus === 'critical_issues') {
        process.exit(3);
      } else if (report.overallStatus === 'gaps_detected') {
        console.log('\n⚠️  Gaps detected - migration recommended');
        process.exit(0);
      } else {
        console.log('\n✅ All entities are synchronized');
        process.exit(0);
      }

    } catch (error) {
      const entityList = options.entities.join(', ');
      const timestamp = new Date().toISOString();

      console.error(`❌ ERROR: Analysis failed for entity '${entityList}'`);
      console.error(`📋 Details: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(`🔄 Suggestion: Check database connections and entity names`);
      console.error(`⏰ Timestamp: ${timestamp}`);

      process.exit(3);
    }
  }

  /**
   * Formats and displays analysis results
   */
  formatOutput(report: BaselineAnalysisReport, format: 'table' | 'json' | 'csv', verbose: boolean): void {
    if (format === 'json') {
      this.formatJsonOutput(report);
    } else if (format === 'csv') {
      this.formatCsvOutput(report);
    } else {
      this.formatTableOutput(report, verbose);
    }
  }

  /**
   * Loads configuration from environment or config file
   */
  loadConfiguration(configPath?: string): BaselineConfiguration {
    // Load environment variables
    if (configPath) {
      dotenv.config({ path: configPath });
    } else {
      dotenv.config();
    }

    return {
      batchSize: parseInt(process.env.BATCH_SIZE || '1000'),
      sourceDatabase: {
        host: process.env.SOURCE_DB_HOST || 'localhost',
        port: parseInt(process.env.SOURCE_DB_PORT || '5432'),
        database: process.env.SOURCE_DB_NAME || 'source_db',
        user: process.env.SOURCE_DB_USER || 'postgres',
        password: process.env.SOURCE_DB_PASSWORD || '',
        maxConnections: parseInt(process.env.SOURCE_DB_MAX_CONNECTIONS || '10'),
        idleTimeoutMs: parseInt(process.env.SOURCE_DB_IDLE_TIMEOUT || '30000'),
        connectionTimeoutMs: parseInt(process.env.SOURCE_DB_CONNECTION_TIMEOUT || '10000')
      },
      destinationDatabase: {
        host: process.env.TARGET_DB_HOST || 'localhost',
        port: parseInt(process.env.TARGET_DB_PORT || '54322'),
        database: process.env.TARGET_DB_NAME || 'postgres',
        user: process.env.TARGET_DB_USER || 'postgres',
        password: process.env.TARGET_DB_PASSWORD || 'postgres',
        maxConnections: parseInt(process.env.TARGET_DB_MAX_CONNECTIONS || '10'),
        idleTimeoutMs: parseInt(process.env.TARGET_DB_IDLE_TIMEOUT || '30000'),
        connectionTimeoutMs: parseInt(process.env.TARGET_DB_CONNECTION_TIMEOUT || '10000')
      },
      timeout: parseInt(process.env.MIGRATION_TIMEOUT || '300000'),
      maxRetries: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3')
    };
  }

  /**
   * Gets current configuration
   */
  getConfiguration(): BaselineConfiguration {
    return this.config;
  }

  /**
   * Private helper methods
   */

  private async initializeServices(): Promise<void> {
    try {
      this.analyzer = new BaselineAnalyzer(
        this.config.sourceDatabase,
        this.config.destinationDatabase,
        uuidv4()
      );
    } catch (error) {
      throw new Error(`Failed to initialize services: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async cleanup(): Promise<void> {
    if (this.analyzer) {
      await this.analyzer.close();
      this.analyzer = null;
    }
  }

  private formatTableOutput(report: BaselineAnalysisReport, verbose: boolean): void {
    console.log('\n📊 Entity Analysis Summary');
    console.log('==========================');

    // Format entity data for table display
    const tableData = report.entityResults.map(result => ({
      Entity: result.entityType,
      Source: result.sourceCount.toLocaleString(),
      Dest: result.destinationCount.toLocaleString(),
      Gap: result.recordGap.toLocaleString(),
      Status: this.getStatusDisplay(result.recordGap, result.gapPercentage),
      'Last Migration': result.lastMigrationTimestamp
        ? result.lastMigrationTimestamp.toISOString().replace('T', ' ').substring(0, 19)
        : 'never'
    }));

    console.table(tableData);

    // Overall summary
    console.log(`\n📈 Overall Status: ${report.summary.overallGap.toLocaleString()} records behind`);
    console.log(`📊 Total Records: ${report.summary.totalSourceRecords.toLocaleString()} source, ${report.summary.totalDestinationRecords.toLocaleString()} destination`);

    if (verbose) {
      this.displayVerboseInformation(report);
    }

    // Display recommendations
    if (report.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      report.recommendations.forEach((rec, index) => {
        console.log(`   ${index + 1}. ${rec}`);
      });
    }

    // Display mapping validation if any issues
    const mappingIssues = report.mappingValidation.filter(v => !v.isValid);
    if (mappingIssues.length > 0) {
      console.log('\n⚠️  Mapping Validation Issues:');
      mappingIssues.forEach(issue => {
        console.log(`   ${issue.entityType}: ${issue.missingMappings.length} missing mappings, ${issue.orphanedMappings.length} orphaned mappings`);
      });
    }
  }

  private formatJsonOutput(report: BaselineAnalysisReport): void {
    const output: BaselineOutput = {
      analysisId: report.analysisId,
      timestamp: report.generatedAt.toISOString(),
      entitySummary: report.entityResults.map(result => ({
        entityType: result.entityType,
        sourceCount: result.sourceCount,
        destinationCount: result.destinationCount,
        status: this.getStatusDisplay(result.recordGap, result.gapPercentage),
        lastMigrationTimestamp: result.lastMigrationTimestamp?.toISOString()
      })),
      overallStatus: report.overallStatus,
      totalSourceRecords: report.summary.totalSourceRecords,
      totalDestinationRecords: report.summary.totalDestinationRecords,
      overallGap: report.summary.overallGap,
      recommendations: report.recommendations
    };

    console.log(JSON.stringify(output, null, 2));
  }

  private formatCsvOutput(report: BaselineAnalysisReport): void {
    // CSV header
    console.log('Entity,Source,Destination,Gap,Status,Last Migration');

    // CSV data rows
    report.entityResults.forEach(result => {
      const lastMigration = result.lastMigrationTimestamp?.toISOString() || 'never';
      const status = this.getStatusDisplay(result.recordGap, result.gapPercentage);

      console.log(`${result.entityType},${result.sourceCount},${result.destinationCount},${result.recordGap},${status},${lastMigration}`);
    });

    // Summary row
    console.log(`TOTAL,${report.summary.totalSourceRecords},${report.summary.totalDestinationRecords},${report.summary.overallGap},${report.overallStatus},`);
  }

  private displayVerboseInformation(report: BaselineAnalysisReport): void {
    console.log('\n🔧 Performance Metrics:');
    console.log(`   Analysis Duration: ${report.performanceMetrics.analysisDurationMs.toLocaleString()}ms`);
    console.log(`   Queries Executed: ${report.performanceMetrics.queriesExecuted}`);
    console.log(`   Average Query Time: ${report.performanceMetrics.averageQueryTimeMs}ms`);

    if (report.mappingValidation.length > 0) {
      console.log('\n🗺️  Mapping Validation Summary:');
      report.mappingValidation.forEach(validation => {
        const status = validation.isValid ? '✅' : '❌';
        console.log(`   ${status} ${validation.entityType}: ${validation.missingMappings.length} missing, ${validation.orphanedMappings.length} orphaned, ${validation.schemaChanges.length} schema changes`);
      });
    }

    console.log('\n📋 Detailed Entity Information:');
    report.entityResults.forEach(result => {
      console.log(`   ${result.entityType}:`);
      console.log(`     Records: ${result.sourceCount} → ${result.destinationCount} (${result.gapPercentage}% gap)`);
      console.log(`     Last Migration: ${result.lastMigrationTimestamp?.toISOString() || 'never'}`);
      console.log(`     Data Available: ${result.hasData ? 'yes' : 'no'}`);
    });
  }

  private getStatusDisplay(gap: number, gapPercentage: number): string {
    if (gap === 0) {
      return 'synced';
    } else if (gapPercentage < 1) {
      return 'minor_gap';
    } else if (gapPercentage < 5) {
      return 'behind';
    } else {
      return 'major_gap';
    }
  }

  private showHelp(): void {
    console.log(`
📊 Differential Migration: Baseline Analysis
============================================

Usage:
  npm run differential:analyze [options]
  npx ts-node src/differential-migration.ts analyze [options]

Description:
  Establishes migration baseline by comparing source and destination databases,
  identifying record gaps, and validating mapping integrity.

Options:
  --entities <list>      Comma-separated entities to analyze (default: all)
  --output <format>      Output format: table, json, csv (default: table)
  --include-mappings     Include UUID mapping analysis
  --verbose              Show detailed analysis information
  --dry-run              Test connections without executing analysis
  --config <path>        Custom configuration file path
  --help                 Show this help message

Examples:
  # Analyze all entities with table output
  npm run differential:analyze

  # Analyze specific entities with JSON output
  npm run differential:analyze -- --entities offices,doctors --output json

  # Include mapping analysis with verbose output
  npm run differential:analyze -- --include-mappings --verbose

  # Test configuration without running analysis
  npm run differential:analyze -- --dry-run

Exit Codes:
  0  Analysis completed successfully
  1  Invalid parameters or configuration
  2  Database connection failure
  3  Analysis failed due to data issues
  4  Insufficient permissions
  7  System error (unexpected failure)

Environment Variables:
  SOURCE_DB_HOST         Source database hostname
  SOURCE_DB_PORT         Source database port (default: 5432)
  SOURCE_DB_NAME         Source database name
  SOURCE_DB_USER         Source database username
  SOURCE_DB_PASSWORD     Source database password
  TARGET_DB_HOST         Target database hostname
  TARGET_DB_PORT         Target database port (default: 54322)
  TARGET_DB_NAME         Target database name
  TARGET_DB_USER         Target database username
  TARGET_DB_PASSWORD     Target database password
  BATCH_SIZE             Default batch size (default: 1000)
`);
  }
}

// CLI execution when run directly
if (require.main === module) {
  const cli = new BaselineCLI();
  cli.main(process.argv.slice(2)).catch(error => {
    console.error('CLI execution failed:', error);
    process.exit(7);
  });
}