// Sync Logger Service
// Provides file-based structured logging for debugging and operational tracking

import { writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { OperationType } from '../types/migration-types';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  levelName: string;
  operationId?: string;
  entityType?: string;
  operationType?: OperationType;
  message: string;
  metadata?: Record<string, any>;
  duration?: number;
  recordCount?: number;
  batchId?: string;
  error?: string;
  stack?: string;
}

export interface LoggerConfig {
  logDir?: string;
  logLevel?: LogLevel;
  maxFileSize?: number; // in MB
  maxFiles?: number;
  enableConsole?: boolean;
  structuredFormat?: boolean;
  dateRotation?: boolean;
}

export interface LogStats {
  totalEntries: number;
  errorCount: number;
  warnCount: number;
  lastEntry: Date;
  logFiles: string[];
}

export class SyncLoggerService {
  private config: Required<LoggerConfig>;
  private currentLogFile: string;
  private sessionId: string;

  constructor(config: LoggerConfig = {}) {
    this.config = {
      logDir: config.logDir || join(process.cwd(), 'logs'),
      logLevel: config.logLevel ?? LogLevel.INFO,
      maxFileSize: config.maxFileSize || 50, // 50MB
      maxFiles: config.maxFiles || 10,
      enableConsole: config.enableConsole ?? true,
      structuredFormat: config.structuredFormat ?? true,
      dateRotation: config.dateRotation ?? true
    };

    this.sessionId = this.generateSessionId();
    this.ensureLogDirectory();
    this.currentLogFile = this.determineCurrentLogFile();
  }

  /**
   * Log debug message
   */
  debug(message: string, metadata?: Record<string, any>, operationId?: string): void {
    this.log(LogLevel.DEBUG, message, metadata, operationId);
  }

  /**
   * Log info message
   */
  info(message: string, metadata?: Record<string, any>, operationId?: string): void {
    this.log(LogLevel.INFO, message, metadata, operationId);
  }

  /**
   * Log warning message
   */
  warn(message: string, metadata?: Record<string, any>, operationId?: string): void {
    this.log(LogLevel.WARN, message, metadata, operationId);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, metadata?: Record<string, any>, operationId?: string): void {
    const errorMetadata = {
      ...metadata,
      error: error?.message,
      stack: error?.stack
    };
    this.log(LogLevel.ERROR, message, errorMetadata, operationId);
  }

  /**
   * Start an operation and return a scoped logger
   */
  startOperation(
    operationType: OperationType,
    entityType: string,
    operationId?: string
  ): OperationLogger {
    const opId = operationId || this.generateOperationId(operationType, entityType);

    this.info(`Starting ${operationType} for ${entityType}`, {
      operation_type: operationType,
      entity_type: entityType,
      session_id: this.sessionId
    }, opId);

    return new OperationLogger(this, opId, operationType, entityType);
  }

  /**
   * Log batch processing start
   */
  logBatchStart(
    operationId: string,
    batchId: string,
    batchSize: number,
    entityType: string,
    startIndex: number = 0
  ): void {
    this.info(`Batch processing started`, {
      batch_id: batchId,
      batch_size: batchSize,
      entity_type: entityType,
      start_index: startIndex,
      batch_start_time: new Date().toISOString()
    }, operationId);
  }

  /**
   * Log batch processing completion
   */
  logBatchComplete(
    operationId: string,
    batchId: string,
    recordsProcessed: number,
    recordsSuccessful: number,
    recordsFailed: number,
    duration: number
  ): void {
    this.info(`Batch processing completed`, {
      batch_id: batchId,
      records_processed: recordsProcessed,
      records_successful: recordsSuccessful,
      records_failed: recordsFailed,
      duration_ms: duration,
      success_rate: ((recordsSuccessful / recordsProcessed) * 100).toFixed(2) + '%',
      batch_end_time: new Date().toISOString()
    }, operationId);
  }

  /**
   * Log checkpoint save
   */
  logCheckpoint(
    operationId: string,
    entityType: string,
    lastProcessedId: string,
    recordsProcessed: number,
    totalRecords?: number
  ): void {
    const progressPercentage = totalRecords
      ? ((recordsProcessed / totalRecords) * 100).toFixed(2) + '%'
      : 'unknown';

    this.info(`Checkpoint saved`, {
      entity_type: entityType,
      last_processed_id: lastProcessedId,
      records_processed: recordsProcessed,
      total_records: totalRecords,
      progress_percentage: progressPercentage,
      checkpoint_time: new Date().toISOString()
    }, operationId);
  }

  /**
   * Log validation results
   */
  logValidation(
    operationId: string,
    entityType: string,
    recordsValidated: number,
    validationPassed: boolean,
    discrepancies: number,
    executionTime: number
  ): void {
    const level = validationPassed ? LogLevel.INFO : LogLevel.WARN;

    this.log(level, `Validation ${validationPassed ? 'passed' : 'failed'}`, {
      entity_type: entityType,
      records_validated: recordsValidated,
      validation_passed: validationPassed,
      discrepancies_found: discrepancies,
      execution_time_ms: executionTime,
      validation_time: new Date().toISOString()
    }, operationId);
  }

  /**
   * Log performance metrics
   */
  logPerformance(
    operationId: string,
    entityType: string,
    operation: string,
    metrics: Record<string, any>
  ): void {
    this.info(`Performance metrics`, {
      entity_type: entityType,
      operation: operation,
      ...metrics,
      measured_at: new Date().toISOString()
    }, operationId);
  }

  /**
   * Core logging method
   */
  private log(
    level: LogLevel,
    message: string,
    metadata?: Record<string, any>,
    operationId?: string
  ): void {
    if (level < this.config.logLevel) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      levelName: LogLevel[level],
      message,
      operationId,
      metadata: metadata || {}
    };

    // Add common metadata
    if (metadata?.entityType) entry.entityType = metadata.entityType;
    if (metadata?.operationType) entry.operationType = metadata.operationType;
    if (metadata?.duration) entry.duration = metadata.duration;
    if (metadata?.recordCount) entry.recordCount = metadata.recordCount;
    if (metadata?.batchId) entry.batchId = metadata.batchId;
    if (metadata?.error) entry.error = metadata.error;
    if (metadata?.stack) entry.stack = metadata.stack;

    // Write to file
    this.writeToFile(entry);

    // Write to console if enabled
    if (this.config.enableConsole) {
      this.writeToConsole(entry);
    }
  }

  /**
   * Write log entry to file
   */
  private writeToFile(entry: LogEntry): void {
    try {
      // Check if file rotation is needed
      if (this.shouldRotateFile()) {
        this.rotateLogFile();
      }

      const logLine = this.formatLogEntry(entry);
      appendFileSync(this.currentLogFile, logLine + '\n', 'utf8');
    } catch (error) {
      console.error('Failed to write log entry:', error);
    }
  }

  /**
   * Write log entry to console
   */
  private writeToConsole(entry: LogEntry): void {
    const timestamp = entry.timestamp.substring(11, 19); // HH:MM:SS
    const level = entry.levelName.padEnd(5);
    const operationId = entry.operationId ? `[${entry.operationId}] ` : '';
    const message = `${timestamp} ${level} ${operationId}${entry.message}`;

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(message);
        break;
      case LogLevel.INFO:
        console.info(message);
        break;
      case LogLevel.WARN:
        console.warn(message);
        break;
      case LogLevel.ERROR:
        console.error(message);
        if (entry.stack) {
          console.error(entry.stack);
        }
        break;
    }
  }

  /**
   * Format log entry for file output
   */
  private formatLogEntry(entry: LogEntry): string {
    if (this.config.structuredFormat) {
      return JSON.stringify(entry);
    } else {
      const timestamp = entry.timestamp;
      const level = entry.levelName.padEnd(5);
      const operationId = entry.operationId ? `[${entry.operationId}] ` : '';
      const metadata = Object.keys(entry.metadata || {}).length > 0
        ? ` | ${JSON.stringify(entry.metadata)}`
        : '';

      return `${timestamp} ${level} ${operationId}${entry.message}${metadata}`;
    }
  }

  /**
   * Check if log file should be rotated
   */
  private shouldRotateFile(): boolean {
    if (!existsSync(this.currentLogFile)) {
      return false;
    }

    const stats = statSync(this.currentLogFile);
    const fileSizeMB = stats.size / (1024 * 1024);

    // Size-based rotation
    if (fileSizeMB >= this.config.maxFileSize) {
      return true;
    }

    // Date-based rotation (daily)
    if (this.config.dateRotation) {
      const fileDate = new Date(stats.birthtime).toDateString();
      const currentDate = new Date().toDateString();
      return fileDate !== currentDate;
    }

    return false;
  }

  /**
   * Rotate log file
   */
  private rotateLogFile(): void {
    try {
      // Generate new filename
      const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const rotatedFile = join(
        this.config.logDir,
        `sync-log-${timestamp}-${Date.now()}.log`
      );

      // Rename current file
      if (existsSync(this.currentLogFile)) {
        const fs = require('fs');
        fs.renameSync(this.currentLogFile, rotatedFile);
      }

      // Update current log file
      this.currentLogFile = this.determineCurrentLogFile();

      // Clean up old files
      this.cleanupOldFiles();

      this.info('Log file rotated', {
        new_file: this.currentLogFile,
        rotated_file: rotatedFile
      });
    } catch (error) {
      console.error('Failed to rotate log file:', error);
    }
  }

  /**
   * Clean up old log files
   */
  private cleanupOldFiles(): void {
    try {
      const files = readdirSync(this.config.logDir)
        .filter(file => file.startsWith('sync-log-') && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: join(this.config.logDir, file),
          mtime: statSync(join(this.config.logDir, file)).mtime
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // Keep only the most recent files
      const filesToDelete = files.slice(this.config.maxFiles);

      for (const file of filesToDelete) {
        unlinkSync(file.path);
        console.log(`Deleted old log file: ${file.name}`);
      }
    } catch (error) {
      console.error('Failed to cleanup old log files:', error);
    }
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDirectory(): void {
    if (!existsSync(this.config.logDir)) {
      mkdirSync(this.config.logDir, { recursive: true });
    }
  }

  /**
   * Determine current log file path
   */
  private determineCurrentLogFile(): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return join(this.config.logDir, `sync-log-${date}.log`);
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate operation ID
   */
  private generateOperationId(operationType: OperationType, entityType: string): string {
    return `${operationType}_${entityType}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  /**
   * Get log statistics
   */
  async getLogStats(): Promise<LogStats> {
    try {
      const logFiles = readdirSync(this.config.logDir)
        .filter(file => file.startsWith('sync-log-') && file.endsWith('.log'))
        .map(file => join(this.config.logDir, file));

      let totalEntries = 0;
      let errorCount = 0;
      let warnCount = 0;
      let lastEntry = new Date(0);

      for (const logFile of logFiles) {
        const content = require('fs').readFileSync(logFile, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());

        totalEntries += lines.length;

        for (const line of lines) {
          if (this.config.structuredFormat) {
            try {
              const entry = JSON.parse(line);
              if (entry.level === LogLevel.ERROR) errorCount++;
              if (entry.level === LogLevel.WARN) warnCount++;

              const entryDate = new Date(entry.timestamp);
              if (entryDate > lastEntry) {
                lastEntry = entryDate;
              }
            } catch (e) {
              // Skip invalid JSON lines
            }
          } else {
            if (line.includes(' ERROR ')) errorCount++;
            if (line.includes(' WARN ')) warnCount++;
          }
        }
      }

      return {
        totalEntries,
        errorCount,
        warnCount,
        lastEntry,
        logFiles: logFiles.map(f => f.split('/').pop() || f)
      };
    } catch (error) {
      return {
        totalEntries: 0,
        errorCount: 0,
        warnCount: 0,
        lastEntry: new Date(),
        logFiles: []
      };
    }
  }

  /**
   * Search logs for specific patterns
   */
  async searchLogs(
    pattern: string,
    level?: LogLevel,
    entityType?: string,
    operationId?: string,
    limit: number = 100
  ): Promise<LogEntry[]> {
    const results: LogEntry[] = [];

    try {
      const logFiles = readdirSync(this.config.logDir)
        .filter(file => file.startsWith('sync-log-') && file.endsWith('.log'))
        .map(file => join(this.config.logDir, file))
        .sort()
        .reverse(); // Most recent first

      for (const logFile of logFiles) {
        if (results.length >= limit) break;

        const content = require('fs').readFileSync(logFile, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());

        for (const line of lines) {
          if (results.length >= limit) break;

          if (!line.includes(pattern)) continue;

          if (this.config.structuredFormat) {
            try {
              const entry = JSON.parse(line) as LogEntry;

              // Apply filters
              if (level !== undefined && entry.level !== level) continue;
              if (entityType && entry.entityType !== entityType) continue;
              if (operationId && entry.operationId !== operationId) continue;

              results.push(entry);
            } catch (e) {
              // Skip invalid JSON lines
            }
          } else {
            // For plain text format, create basic entry
            const entry: LogEntry = {
              timestamp: line.substring(0, 24),
              level: line.includes(' ERROR ') ? LogLevel.ERROR :
                     line.includes(' WARN ') ? LogLevel.WARN :
                     line.includes(' DEBUG ') ? LogLevel.DEBUG : LogLevel.INFO,
              levelName: '',
              message: line
            };

            results.push(entry);
          }
        }
      }
    } catch (error) {
      console.error('Failed to search logs:', error);
    }

    return results;
  }

  /**
   * Archive old logs
   */
  async archiveLogs(olderThanDays: number = 30): Promise<string[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const archivedFiles: string[] = [];

    try {
      const files = readdirSync(this.config.logDir)
        .filter(file => file.startsWith('sync-log-') && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: join(this.config.logDir, file),
          mtime: statSync(join(this.config.logDir, file)).mtime
        }))
        .filter(file => file.mtime < cutoffDate);

      // Create archive directory
      const archiveDir = join(this.config.logDir, 'archive');
      if (!existsSync(archiveDir)) {
        mkdirSync(archiveDir, { recursive: true });
      }

      // Move old files to archive
      for (const file of files) {
        const archivePath = join(archiveDir, file.name);
        require('fs').renameSync(file.path, archivePath);
        archivedFiles.push(file.name);
      }

      if (archivedFiles.length > 0) {
        this.info(`Archived ${archivedFiles.length} old log files`, {
          archived_files: archivedFiles,
          archive_directory: archiveDir
        });
      }
    } catch (error) {
      this.error('Failed to archive logs', error as Error);
    }

    return archivedFiles;
  }
}

/**
 * Operation-scoped logger for tracking specific operations
 */
export class OperationLogger {
  private startTime: Date;

  constructor(
    private logger: SyncLoggerService,
    private operationId: string,
    private operationType: OperationType,
    private entityType: string
  ) {
    this.startTime = new Date();
  }

  debug(message: string, metadata?: Record<string, any>): void {
    this.logger.debug(message, this.enrichMetadata(metadata), this.operationId);
  }

  info(message: string, metadata?: Record<string, any>): void {
    this.logger.info(message, this.enrichMetadata(metadata), this.operationId);
  }

  warn(message: string, metadata?: Record<string, any>): void {
    this.logger.warn(message, this.enrichMetadata(metadata), this.operationId);
  }

  error(message: string, error?: Error, metadata?: Record<string, any>): void {
    this.logger.error(message, error, this.enrichMetadata(metadata), this.operationId);
  }

  logBatchStart(batchId: string, batchSize: number, startIndex: number = 0): void {
    this.logger.logBatchStart(this.operationId, batchId, batchSize, this.entityType, startIndex);
  }

  logBatchComplete(
    batchId: string,
    recordsProcessed: number,
    recordsSuccessful: number,
    recordsFailed: number,
    duration: number
  ): void {
    this.logger.logBatchComplete(
      this.operationId,
      batchId,
      recordsProcessed,
      recordsSuccessful,
      recordsFailed,
      duration
    );
  }

  logCheckpoint(lastProcessedId: string, recordsProcessed: number, totalRecords?: number): void {
    this.logger.logCheckpoint(
      this.operationId,
      this.entityType,
      lastProcessedId,
      recordsProcessed,
      totalRecords
    );
  }

  logPerformance(operation: string, metrics: Record<string, any>): void {
    this.logger.logPerformance(this.operationId, this.entityType, operation, metrics);
  }

  complete(recordsProcessed: number, recordsSuccessful: number, recordsFailed: number): void {
    const duration = Date.now() - this.startTime.getTime();
    const successRate = recordsProcessed > 0 ? (recordsSuccessful / recordsProcessed) * 100 : 0;

    this.logger.info(`Operation completed`, {
      operation_type: this.operationType,
      entity_type: this.entityType,
      records_processed: recordsProcessed,
      records_successful: recordsSuccessful,
      records_failed: recordsFailed,
      success_rate: successRate.toFixed(2) + '%',
      duration_ms: duration,
      completed_at: new Date().toISOString()
    }, this.operationId);
  }

  fail(error: Error, recordsProcessed: number = 0): void {
    const duration = Date.now() - this.startTime.getTime();

    this.logger.error(`Operation failed`, error, {
      operation_type: this.operationType,
      entity_type: this.entityType,
      records_processed: recordsProcessed,
      duration_ms: duration,
      failed_at: new Date().toISOString()
    }, this.operationId);
  }

  private enrichMetadata(metadata?: Record<string, any>): Record<string, any> {
    return {
      ...metadata,
      operation_type: this.operationType,
      entity_type: this.entityType,
      operation_id: this.operationId
    };
  }
}