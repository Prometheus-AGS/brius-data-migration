/**
 * Logs Viewing CLI
 * Implements differential:logs command with filtering, export functionality
 */

import { Pool } from 'pg';
import * as fs from 'fs/promises';
import * as dotenv from 'dotenv';
import { MigrationExecutionLogModel, type MigrationExecutionLog } from '../models/execution-log';
import { v4 as uuidv4 } from 'uuid';

// Type definitions
export interface LogsOptions {
  sessionId?: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  entity: string;
  follow: boolean;
  tail: number;
  export?: string;
  format: 'table' | 'json' | 'csv';
  config?: string;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  sessionId: string;
  entityType: string | null;
  level: 'debug' | 'info' | 'warn' | 'error';
  operationType: string;
  message: string;
  contextData: object;
}

export interface LogsConfiguration {
  destinationDatabase: any;
  logRetentionDays: number;
  maxLogEntries: number;
  realTimeUpdateInterval: number;
}

/**
 * LogsCLI Implementation
 *
 * Provides command-line interface for viewing migration execution logs including
 * filtering, real-time following, and export functionality.
 */
export class LogsCLI {
  private config: LogsConfiguration;
  private destinationPool: Pool | null = null;
  private followInterval: NodeJS.Timeout | null = null;
  private lastLogId: string | null = null;

  constructor() {
    this.config = this.loadConfiguration();
  }

  /**
   * Main entry point for CLI execution
   */
  async main(args: string[]): Promise<void> {
    try {
      const options = this.parseArguments(args);

      // Initialize database connection
      await this.initializeDatabasePool();

      if (options.follow) {
        // Start follow mode
        console.log(`👁️  Following logs (Ctrl+C to stop)`);
        await this.startFollowMode(options);
      } else {
        // Single log query
        await this.displayLogs(options);
      }

      // Cleanup
      await this.cleanup();

    } catch (error) {
      if (error instanceof Error && error.message.includes('Process exit:')) {
        throw error; // Re-throw process exits
      }

      console.error(`❌ Failed to retrieve logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(7);
    }
  }

  /**
   * Parses command line arguments
   */
  parseArguments(args: string[]): LogsOptions {
    const options: LogsOptions = {
      level: 'info',
      entity: 'all',
      follow: false,
      tail: 50,
      format: 'table'
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      switch (arg) {
        case '--help':
          this.showHelp();
          process.exit(0);
          break;

        case '--session-id':
          if (i + 1 >= args.length) {
            throw new Error('--session-id requires a UUID value');
          }
          const sessionId = args[++i];
          if (!this.isValidUUID(sessionId)) {
            throw new Error(`Invalid session ID format: ${sessionId}`);
          }
          options.sessionId = sessionId;
          break;

        case '--level':
          if (i + 1 >= args.length) {
            throw new Error('--level requires a value');
          }
          const level = args[++i];
          if (!['debug', 'info', 'warn', 'error'].includes(level)) {
            throw new Error('--level must be debug, info, warn, or error');
          }
          options.level = level as LogsOptions['level'];
          break;

        case '--entity':
          if (i + 1 >= args.length) {
            throw new Error('--entity requires a value');
          }
          options.entity = args[++i];
          break;

        case '--follow':
          options.follow = true;
          break;

        case '--tail':
          if (i + 1 >= args.length) {
            throw new Error('--tail requires a numeric value');
          }
          options.tail = parseInt(args[++i]);
          if (isNaN(options.tail) || options.tail < 1 || options.tail > 10000) {
            throw new Error('--tail must be between 1 and 10000');
          }
          break;

        case '--export':
          if (i + 1 >= args.length) {
            throw new Error('--export requires a file path');
          }
          options.export = args[++i];
          break;

        case '--format':
          if (i + 1 >= args.length) {
            throw new Error('--format requires a value');
          }
          const format = args[++i];
          if (!['table', 'json', 'csv'].includes(format)) {
            throw new Error('--format must be table, json, or csv');
          }
          options.format = format as LogsOptions['format'];
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
   * Displays migration logs based on options
   */
  async displayLogs(options: LogsOptions): Promise<void> {
    if (!this.destinationPool) {
      throw new Error('Database pool not initialized');
    }

    try {
      // Determine session ID if not provided
      let sessionId = options.sessionId;
      if (!sessionId) {
        sessionId = await this.getLatestSessionId();
        if (!sessionId) {
          console.log('📄 No migration sessions found');
          console.log('💡 Run differential:migrate to start a migration and generate logs');
          return;
        }
        console.log(`🔍 Using latest session: ${sessionId}`);
      }

      // Query logs
      const logs = await this.queryLogs({
        sessionId,
        level: options.level,
        entity: options.entity,
        limit: options.tail
      });

      if (logs.length === 0) {
        console.log(`📄 No logs found for session ${sessionId}`);
        console.log('💡 Check session ID and filter criteria');
        return;
      }

      // Display logs
      this.formatLogsOutput(logs, options.format);

      // Export if requested
      if (options.export) {
        await this.exportLogs(logs, options.export, options.format);
      }

    } catch (error) {
      const timestamp = new Date().toISOString();
      console.error('❌ ERROR: Failed to retrieve logs');
      console.error(`📋 Details: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(`🔄 Suggestion: Check session ID and database connection`);
      console.error(`⏰ Timestamp: ${timestamp}`);
      if (options.sessionId) {
        console.error(`📊 Session ID: ${options.sessionId}`);
      }

      process.exit(3);
    }
  }

  /**
   * Starts follow mode for real-time log streaming
   */
  async startFollowMode(options: LogsOptions): Promise<void> {
    // Display initial logs
    await this.displayLogs(options);

    // Start follow interval
    this.followInterval = setInterval(async () => {
      try {
        const sessionId = options.sessionId || await this.getLatestSessionId();
        if (!sessionId) return;

        // Query new logs since last update
        const newLogs = await this.queryNewLogs({
          sessionId,
          level: options.level,
          entity: options.entity,
          afterId: this.lastLogId
        });

        if (newLogs.length > 0) {
          console.log(`\n📡 New logs (${new Date().toLocaleString()}):`);
          this.formatLogsOutput(newLogs, 'table');

          // Update last log ID
          this.lastLogId = newLogs[newLogs.length - 1].id;
        }
      } catch (error) {
        console.error(`Error refreshing logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }, this.config.realTimeUpdateInterval);

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      console.log('\n👋 Stopping log following...');
      this.stopFollowMode();
      process.exit(0);
    });

    // Keep the process alive
    return new Promise(() => {}); // Intentionally never resolves
  }

  /**
   * Stops follow mode
   */
  stopFollowMode(): void {
    if (this.followInterval) {
      clearInterval(this.followInterval);
      this.followInterval = null;
    }
  }

  /**
   * Queries logs from database
   */
  async queryLogs(criteria: {
    sessionId: string;
    level: string;
    entity: string;
    limit: number;
  }): Promise<LogEntry[]> {
    if (!this.destinationPool) {
      throw new Error('Database pool not initialized');
    }

    // Mock implementation - in real implementation, query migration_execution_logs table
    const mockLogs: LogEntry[] = [
      {
        id: uuidv4(),
        timestamp: new Date(Date.now() - 300000),
        sessionId: criteria.sessionId,
        entityType: 'doctors',
        level: 'info',
        operationType: 'batch_start',
        message: 'Starting batch migration for doctors entity',
        contextData: {
          batchNumber: 1,
          batchSize: 500,
          entityType: 'doctors'
        }
      },
      {
        id: uuidv4(),
        timestamp: new Date(Date.now() - 240000),
        sessionId: criteria.sessionId,
        entityType: 'doctors',
        level: 'info',
        operationType: 'record_migration',
        message: 'Successfully migrated doctor record',
        contextData: {
          recordId: 'doctor_123',
          legacyId: 123,
          batchNumber: 1
        }
      },
      {
        id: uuidv4(),
        timestamp: new Date(Date.now() - 180000),
        sessionId: criteria.sessionId,
        entityType: 'doctors',
        level: 'warn',
        operationType: 'validation_warning',
        message: 'Data validation warning during migration',
        contextData: {
          recordId: 'doctor_456',
          warning: 'Missing secondary phone number',
          severity: 'minor'
        }
      },
      {
        id: uuidv4(),
        timestamp: new Date(Date.now() - 120000),
        sessionId: criteria.sessionId,
        entityType: 'patients',
        level: 'error',
        operationType: 'migration_error',
        message: 'Failed to migrate patient record due to constraint violation',
        contextData: {
          recordId: 'patient_789',
          error: 'Foreign key constraint violation',
          constraintName: 'fk_patient_doctor',
          retryable: true
        }
      },
      {
        id: uuidv4(),
        timestamp: new Date(Date.now() - 60000),
        sessionId: criteria.sessionId,
        entityType: 'doctors',
        level: 'info',
        operationType: 'batch_complete',
        message: 'Completed batch migration for doctors entity',
        contextData: {
          batchNumber: 1,
          recordsProcessed: 450,
          recordsFailed: 50,
          durationMs: 45000
        }
      }
    ];

    // Apply filters
    let filteredLogs = mockLogs.filter(log => log.sessionId === criteria.sessionId);

    // Filter by log level
    const levelPriority = { debug: 0, info: 1, warn: 2, error: 3 };
    const minLevel = levelPriority[criteria.level as keyof typeof levelPriority];
    filteredLogs = filteredLogs.filter(log => levelPriority[log.level] >= minLevel);

    // Filter by entity
    if (criteria.entity !== 'all') {
      filteredLogs = filteredLogs.filter(log => log.entityType === criteria.entity);
    }

    // Sort by timestamp (newest first) and limit
    filteredLogs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return filteredLogs.slice(0, criteria.limit);
  }

  /**
   * Queries new logs since last check
   */
  async queryNewLogs(criteria: {
    sessionId: string;
    level: string;
    entity: string;
    afterId: string | null;
  }): Promise<LogEntry[]> {
    // Mock implementation - in real implementation, query for logs after specific ID
    if (!criteria.afterId) return [];

    // Simulate new logs occasionally
    if (Math.random() > 0.7) {
      return [{
        id: uuidv4(),
        timestamp: new Date(),
        sessionId: criteria.sessionId,
        entityType: 'patients',
        level: 'info',
        operationType: 'record_migration',
        message: 'Processing patient record in real-time',
        contextData: {
          recordId: `patient_${Date.now()}`,
          progress: '75%'
        }
      }];
    }

    return [];
  }

  /**
   * Gets the latest session ID from logs
   */
  async getLatestSessionId(): Promise<string | null> {
    // Mock implementation - in real implementation, query for most recent session
    return '550e8400-e29b-41d4-a716-446655440000';
  }

  /**
   * Formats and displays logs
   */
  formatLogsOutput(logs: LogEntry[], format: 'table' | 'json' | 'csv'): void {
    if (logs.length === 0) {
      console.log('📄 No logs to display');
      return;
    }

    switch (format) {
      case 'json':
        console.log(JSON.stringify(logs, null, 2));
        break;
      case 'csv':
        this.formatCsvOutput(logs);
        break;
      default:
        this.formatTableOutput(logs);
    }
  }

  /**
   * Formats logs as table output
   */
  formatTableOutput(logs: LogEntry[]): void {
    console.log('\n📋 Migration Execution Logs');
    console.log('============================');

    logs.forEach(log => {
      const timestamp = log.timestamp.toISOString().replace('T', ' ').substring(0, 19);
      const levelIcon = this.getLevelIcon(log.level);
      const entityDisplay = log.entityType || 'system';

      console.log(`${timestamp} ${levelIcon} [${entityDisplay}] ${log.message}`);

      // Show context data if it contains useful information
      if (log.contextData && Object.keys(log.contextData).length > 0) {
        const contextKeys = Object.keys(log.contextData);
        const relevantKeys = contextKeys.filter(key =>
          !['service', 'timestamp'].includes(key) &&
          typeof log.contextData[key as keyof typeof log.contextData] !== 'object'
        );

        if (relevantKeys.length > 0) {
          const contextItems = relevantKeys.map(key =>
            `${key}=${log.contextData[key as keyof typeof log.contextData]}`
          ).join(', ');
          console.log(`    Context: ${contextItems}`);
        }
      }
    });

    console.log(`\n📊 Displayed ${logs.length} log entries`);
  }

  /**
   * Formats logs as CSV output
   */
  formatCsvOutput(logs: LogEntry[]): void {
    console.log('Timestamp,Level,Entity,Operation,Message,Context');

    logs.forEach(log => {
      const timestamp = log.timestamp.toISOString();
      const entity = log.entityType || 'system';
      const context = JSON.stringify(log.contextData).replace(/"/g, '""'); // Escape quotes for CSV

      console.log(`"${timestamp}","${log.level}","${entity}","${log.operationType}","${log.message}","${context}"`);
    });
  }

  /**
   * Exports logs to file
   */
  async exportLogs(logs: LogEntry[], filePath: string, format: 'table' | 'json' | 'csv'): Promise<void> {
    try {
      let content: string;

      switch (format) {
        case 'json':
          content = JSON.stringify(logs, null, 2);
          break;
        case 'csv':
          content = this.buildCsvContent(logs);
          break;
        default:
          content = this.buildTableContent(logs);
      }

      await fs.writeFile(filePath, content, 'utf8');
      console.log(`💾 Logs exported to: ${filePath}`);
      console.log(`📊 Exported ${logs.length} log entries`);

    } catch (error) {
      console.error(`❌ Failed to export logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Builds CSV content for export
   */
  buildCsvContent(logs: LogEntry[]): string {
    const header = 'Timestamp,Level,Entity,Operation,Message,Context';
    const rows = logs.map(log => {
      const timestamp = log.timestamp.toISOString();
      const entity = log.entityType || 'system';
      const context = JSON.stringify(log.contextData).replace(/"/g, '""');

      return `"${timestamp}","${log.level}","${entity}","${log.operationType}","${log.message}","${context}"`;
    });

    return [header, ...rows].join('\n');
  }

  /**
   * Builds table content for export
   */
  buildTableContent(logs: LogEntry[]): string {
    const lines = ['Migration Execution Logs', '============================', ''];

    logs.forEach(log => {
      const timestamp = log.timestamp.toISOString().replace('T', ' ').substring(0, 19);
      const levelText = log.level.toUpperCase().padEnd(5);
      const entityDisplay = (log.entityType || 'system').padEnd(12);

      lines.push(`${timestamp} ${levelText} [${entityDisplay}] ${log.message}`);

      if (log.contextData && Object.keys(log.contextData).length > 0) {
        const contextStr = JSON.stringify(log.contextData, null, 2)
          .split('\n')
          .map(line => `    ${line}`)
          .join('\n');
        lines.push(contextStr);
      }

      lines.push(''); // Empty line between entries
    });

    lines.push(`Exported ${logs.length} log entries at ${new Date().toISOString()}`);

    return lines.join('\n');
  }

  /**
   * Loads configuration from environment
   */
  loadConfiguration(configPath?: string): LogsConfiguration {
    // Load environment variables
    if (configPath) {
      dotenv.config({ path: configPath });
    } else {
      dotenv.config();
    }

    return {
      destinationDatabase: {
        host: process.env.TARGET_DB_HOST || 'localhost',
        port: parseInt(process.env.TARGET_DB_PORT || '54322'),
        database: process.env.TARGET_DB_NAME || 'postgres',
        user: process.env.TARGET_DB_USER || 'postgres',
        password: process.env.TARGET_DB_PASSWORD || 'postgres'
      },
      logRetentionDays: parseInt(process.env.LOG_RETENTION_DAYS || '30'),
      maxLogEntries: parseInt(process.env.MAX_LOG_ENTRIES || '10000'),
      realTimeUpdateInterval: parseInt(process.env.LOG_UPDATE_INTERVAL || '5000')
    };
  }

  /**
   * Private helper methods
   */

  private async initializeDatabasePool(): Promise<void> {
    try {
      this.destinationPool = new Pool({
        host: this.config.destinationDatabase.host,
        port: this.config.destinationDatabase.port,
        database: this.config.destinationDatabase.database,
        user: this.config.destinationDatabase.user,
        password: this.config.destinationDatabase.password,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        application_name: 'differential_migration_logs'
      });

    } catch (error) {
      throw new Error(`Failed to initialize database pool: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async cleanup(): Promise<void> {
    this.stopFollowMode();

    try {
      if (this.destinationPool) {
        await this.destinationPool.end();
        this.destinationPool = null;
      }
    } catch (error) {
      // Log cleanup errors but don't fail
      console.error('Warning: Error during cleanup:', error);
    }
  }

  private getLevelIcon(level: string): string {
    switch (level) {
      case 'debug': return '🔍';
      case 'info': return 'ℹ️ ';
      case 'warn': return '⚠️ ';
      case 'error': return '❌';
      default: return '📝';
    }
  }

  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  private showHelp(): void {
    console.log(`
📋 Differential Migration: Logs Viewer
======================================

Usage:
  npm run differential:logs [options]
  npx ts-node src/differential-migration.ts logs [options]

Description:
  View detailed migration execution logs with filtering and export capabilities.
  Supports both historical log viewing and real-time log following.

Options:
  --session-id <uuid>      Migration session to view (default: latest)
  --level <level>          Log level filter: debug, info, warn, error (default: info)
  --entity <name>          Filter by entity type (default: all)
  --follow                 Follow logs in real-time (refresh automatically)
  --tail <number>          Number of recent entries to show (default: 50, max: 10000)
  --export <file>          Export logs to specified file
  --format <format>        Output/export format: table, json, csv (default: table)
  --config <path>          Custom configuration file path
  --help                   Show this help message

Examples:
  # Show recent logs for latest session
  npm run differential:logs

  # Show logs for specific session with error level
  npm run differential:logs -- --session-id 550e8400-e29b-41d4-a716-446655440000 --level error

  # Filter logs by entity with JSON output
  npm run differential:logs -- --entity doctors --format json

  # Follow logs in real-time
  npm run differential:logs -- --follow --tail 100

  # Export logs to file
  npm run differential:logs -- --export migration-logs.json --format json

  # Show debug logs for specific entity
  npm run differential:logs -- --level debug --entity patients --tail 200

Log Levels:
  debug    🔍 Detailed debugging information
  info     ℹ️  General informational messages
  warn     ⚠️  Warning messages and minor issues
  error    ❌ Error messages and failures

Output Format (Table):
  2025-10-26 10:30:00 ℹ️  [doctors     ] Starting batch migration for doctors entity
      Context: batchNumber=1, batchSize=500
  2025-10-26 10:30:15 ⚠️  [doctors     ] Data validation warning during migration
      Context: recordId=doctor_456, warning=Missing secondary phone number
  2025-10-26 10:30:30 ❌ [patients    ] Failed to migrate patient record
      Context: recordId=patient_789, error=Foreign key constraint violation

Follow Mode:
  - Press Ctrl+C to stop real-time log following
  - Logs update automatically based on configured interval
  - New logs appear with timestamp headers

Export Formats:
  table    Human-readable text format with context
  json     Structured JSON with full log data
  csv      Comma-separated values for spreadsheet import

Exit Codes:
  0  Logs retrieved successfully
  1  Invalid parameters
  2  Database connection failure
  3  Session not found or log query failed
  7  System error (unexpected failure)

Environment Variables:
  TARGET_DB_HOST           Target database hostname
  TARGET_DB_PORT           Target database port (default: 54322)
  TARGET_DB_NAME           Target database name
  TARGET_DB_USER           Target database username
  TARGET_DB_PASSWORD       Target database password
  LOG_RETENTION_DAYS       Log retention period in days (default: 30)
  MAX_LOG_ENTRIES          Maximum log entries per query (default: 10000)
  LOG_UPDATE_INTERVAL      Real-time update interval in ms (default: 5000)

Notes:
  - Logs are stored in the migration_execution_logs table
  - Real-time following requires active migration sessions
  - Large log exports may take time to complete
  - Log levels are inclusive (warn includes error, info includes warn+error)
`);
  }
}

// CLI execution when run directly
if (require.main === module) {
  const cli = new LogsCLI();
  cli.main(process.argv.slice(2)).catch(error => {
    console.error('CLI execution failed:', error);
    process.exit(7);
  });
}