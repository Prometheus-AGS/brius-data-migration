/**
 * MigrationExecutionLog Model
 * Implements structured logging for migration operations with context data serialization
 */

import { v4 as uuidv4 } from 'uuid';

// Core interfaces
export type OperationType = 'baseline_analysis' | 'differential_detection' | 'record_migration' | 'validation' | 'checkpoint_save' | 'checkpoint_restore';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface MigrationExecutionLog {
  id: string;
  migration_session_id: string;
  entity_type: string | null;
  operation_type: OperationType;
  record_id: string | null;
  log_level: LogLevel;
  message: string;
  error_details: object | null;
  performance_data: object | null;
  context_data: object;
  timestamp: Date;
  created_at: Date;
}

export interface MigrationExecutionLogCreateInput {
  migration_session_id: string;
  entity_type?: string | null;
  operation_type: OperationType;
  record_id?: string | null;
  log_level?: LogLevel;
  message: string;
  error_details?: object | null;
  performance_data?: object | null;
  context_data?: object;
  timestamp?: Date;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface LogSummary {
  total: number;
  byLevel: Record<LogLevel, number>;
  byOperation: Record<OperationType, number>;
  errorCount: number;
  warningCount: number;
}

// Valid types
const VALID_OPERATION_TYPES: OperationType[] = [
  'baseline_analysis', 'differential_detection', 'record_migration',
  'validation', 'checkpoint_save', 'checkpoint_restore'
];

const VALID_LOG_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug'];

const VALID_ENTITY_TYPES = [
  'offices', 'doctors', 'doctor_offices', 'patients', 'orders',
  'cases', 'files', 'case_files', 'messages', 'message_files',
  'jaw', 'dispatch_records', 'system_messages', 'message_attachments',
  'technician_roles', 'order_cases', 'purchases', 'treatment_discussions',
  'template_view_groups', 'template_view_roles'
] as const;

export type ValidEntityType = typeof VALID_ENTITY_TYPES[number];

/**
 * MigrationExecutionLog Model Implementation
 *
 * Provides comprehensive structured logging functionality for differential migration operations
 * with context serialization, performance tracking, and advanced filtering capabilities.
 */
export class MigrationExecutionLogModel {
  /**
   * Creates a new migration execution log entry with validation
   */
  static create(input: MigrationExecutionLogCreateInput): MigrationExecutionLog {
    // Input validation
    if (!input.migration_session_id || typeof input.migration_session_id !== 'string') {
      throw new Error('migration_session_id is required and must be a string');
    }

    if (!input.operation_type) {
      throw new Error('operation_type is required');
    }

    if (!input.message || typeof input.message !== 'string') {
      throw new Error('message is required and must be a string');
    }

    // Validate operation type
    if (!VALID_OPERATION_TYPES.includes(input.operation_type)) {
      throw new Error(`Invalid operation_type: ${input.operation_type}. Must be one of: ${VALID_OPERATION_TYPES.join(', ')}`);
    }

    // Validate log level if provided
    const logLevel = input.log_level || 'info';
    if (!VALID_LOG_LEVELS.includes(logLevel)) {
      throw new Error(`Invalid log_level: ${logLevel}. Must be one of: ${VALID_LOG_LEVELS.join(', ')}`);
    }

    // Validate entity type if provided
    if (input.entity_type && !VALID_ENTITY_TYPES.includes(input.entity_type as ValidEntityType)) {
      throw new Error(`Invalid entity_type: ${input.entity_type}. Must be one of: ${VALID_ENTITY_TYPES.join(', ')}`);
    }

    const now = new Date();
    const timestamp = input.timestamp || now;

    // Validate timestamp is not too far in the future
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    if (timestamp > oneHourFromNow) {
      throw new Error('timestamp cannot be more than 1 hour in the future');
    }

    const log: MigrationExecutionLog = {
      id: uuidv4(),
      migration_session_id: input.migration_session_id,
      entity_type: input.entity_type || null,
      operation_type: input.operation_type,
      record_id: input.record_id || null,
      log_level: logLevel,
      message: input.message.trim(),
      error_details: input.error_details || null,
      performance_data: input.performance_data || null,
      context_data: input.context_data ? { ...input.context_data } : {},
      timestamp: timestamp,
      created_at: now
    };

    // Final validation
    const validation = this.validate(log);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    return log;
  }

  /**
   * Validates a migration execution log against all business rules
   */
  static validate(log: MigrationExecutionLog): ValidationResult {
    const errors: string[] = [];

    // Validate required fields
    if (!log.id) {
      errors.push('id is required');
    }

    if (!log.migration_session_id) {
      errors.push('migration_session_id is required');
    }

    if (!log.operation_type) {
      errors.push('operation_type is required');
    }

    if (!log.message) {
      errors.push('message is required');
    }

    // Validate operation_type
    if (!VALID_OPERATION_TYPES.includes(log.operation_type)) {
      errors.push('Invalid operation_type');
    }

    // Validate log_level
    if (!VALID_LOG_LEVELS.includes(log.log_level)) {
      errors.push('Invalid log_level');
    }

    // Validate message is not empty
    if (!log.message || log.message.trim().length === 0) {
      errors.push('Message cannot be empty');
    }

    // Validate timestamp is reasonable (not more than 1 hour in the future)
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    if (log.timestamp > oneHourFromNow) {
      errors.push('Timestamp cannot be more than 1 hour in the future');
    }

    // Validate entity_type if provided
    if (log.entity_type && !VALID_ENTITY_TYPES.includes(log.entity_type as ValidEntityType)) {
      errors.push('Invalid entity_type');
    }

    // Validate error_details structure for error logs
    if (log.log_level === 'error' && log.error_details) {
      if (typeof log.error_details !== 'object') {
        errors.push('error_details must be an object for error logs');
      }
    }

    // Validate context_data is an object
    if (log.context_data && typeof log.context_data !== 'object') {
      errors.push('context_data must be an object');
    }

    // Validate timestamps
    if (log.created_at > new Date()) {
      const timeDiffMinutes = (log.created_at.getTime() - Date.now()) / (1000 * 60);
      if (timeDiffMinutes > 1) {
        errors.push('created_at cannot be significantly in the future');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Creates an info-level log entry
   */
  static createInfoLog(
    sessionId: string,
    operationType: OperationType,
    message: string,
    options: {
      entityType?: string;
      recordId?: string;
      contextData?: object;
      performanceData?: object;
    } = {}
  ): MigrationExecutionLog {
    return this.create({
      migration_session_id: sessionId,
      entity_type: options.entityType,
      operation_type: operationType,
      record_id: options.recordId,
      log_level: 'info',
      message: message,
      context_data: options.contextData,
      performance_data: options.performanceData
    });
  }

  /**
   * Creates an error-level log entry
   */
  static createErrorLog(
    sessionId: string,
    operationType: OperationType,
    message: string,
    errorDetails: object,
    options: {
      entityType?: string;
      recordId?: string;
      contextData?: object;
    } = {}
  ): MigrationExecutionLog {
    return this.create({
      migration_session_id: sessionId,
      entity_type: options.entityType,
      operation_type: operationType,
      record_id: options.recordId,
      log_level: 'error',
      message: message,
      error_details: errorDetails,
      context_data: options.contextData
    });
  }

  /**
   * Creates a warning-level log entry
   */
  static createWarningLog(
    sessionId: string,
    operationType: OperationType,
    message: string,
    options: {
      entityType?: string;
      recordId?: string;
      contextData?: object;
    } = {}
  ): MigrationExecutionLog {
    return this.create({
      migration_session_id: sessionId,
      entity_type: options.entityType,
      operation_type: operationType,
      record_id: options.recordId,
      log_level: 'warn',
      message: message,
      context_data: options.contextData
    });
  }

  /**
   * Creates a debug-level log entry
   */
  static createDebugLog(
    sessionId: string,
    operationType: OperationType,
    message: string,
    options: {
      entityType?: string;
      recordId?: string;
      contextData?: object;
      performanceData?: object;
    } = {}
  ): MigrationExecutionLog {
    return this.create({
      migration_session_id: sessionId,
      entity_type: options.entityType,
      operation_type: operationType,
      record_id: options.recordId,
      log_level: 'debug',
      message: message,
      context_data: options.contextData,
      performance_data: options.performanceData
    });
  }

  /**
   * Filters logs by log level
   */
  static filterLogsByLevel(logs: MigrationExecutionLog[], level: LogLevel): MigrationExecutionLog[] {
    return logs.filter(log => log.log_level === level);
  }

  /**
   * Filters logs by operation type
   */
  static filterLogsByOperation(logs: MigrationExecutionLog[], operationType: OperationType): MigrationExecutionLog[] {
    return logs.filter(log => log.operation_type === operationType);
  }

  /**
   * Filters logs by entity type
   */
  static filterLogsByEntity(logs: MigrationExecutionLog[], entityType: string): MigrationExecutionLog[] {
    return logs.filter(log => log.entity_type === entityType);
  }

  /**
   * Filters logs by session ID
   */
  static filterLogsBySession(logs: MigrationExecutionLog[], sessionId: string): MigrationExecutionLog[] {
    return logs.filter(log => log.migration_session_id === sessionId);
  }

  /**
   * Filters logs by time range
   */
  static filterLogsByTimeRange(
    logs: MigrationExecutionLog[],
    startTime: Date,
    endTime: Date
  ): MigrationExecutionLog[] {
    return logs.filter(log =>
      log.timestamp >= startTime && log.timestamp <= endTime
    );
  }

  /**
   * Filters logs by record ID
   */
  static filterLogsByRecord(logs: MigrationExecutionLog[], recordId: string): MigrationExecutionLog[] {
    return logs.filter(log => log.record_id === recordId);
  }

  /**
   * Generates comprehensive logs summary
   */
  static getLogsSummary(logs: MigrationExecutionLog[]): LogSummary {
    const summary: LogSummary = {
      total: logs.length,
      byLevel: {
        error: 0,
        warn: 0,
        info: 0,
        debug: 0
      },
      byOperation: {
        baseline_analysis: 0,
        differential_detection: 0,
        record_migration: 0,
        validation: 0,
        checkpoint_save: 0,
        checkpoint_restore: 0
      },
      errorCount: 0,
      warningCount: 0
    };

    logs.forEach(log => {
      summary.byLevel[log.log_level]++;
      summary.byOperation[log.operation_type]++;

      if (log.log_level === 'error') summary.errorCount++;
      if (log.log_level === 'warn') summary.warningCount++;
    });

    return summary;
  }

  /**
   * Creates performance metrics from log entries
   */
  static extractPerformanceMetrics(logs: MigrationExecutionLog[]): {
    totalOperations: number;
    operationDurations: Record<string, number[]>;
    averageDurations: Record<string, number>;
    throughputMetrics: {
      recordsPerSecond: number | null;
      operationsPerMinute: number;
    };
    errorRates: Record<OperationType, number>;
  } {
    const operationDurations: Record<string, number[]> = {};
    const operationCounts: Record<OperationType, number> = {
      baseline_analysis: 0,
      differential_detection: 0,
      record_migration: 0,
      validation: 0,
      checkpoint_save: 0,
      checkpoint_restore: 0
    };
    const operationErrors: Record<OperationType, number> = {
      baseline_analysis: 0,
      differential_detection: 0,
      record_migration: 0,
      validation: 0,
      checkpoint_save: 0,
      checkpoint_restore: 0
    };

    let totalRecordsProcessed = 0;

    logs.forEach(log => {
      operationCounts[log.operation_type]++;

      if (log.log_level === 'error') {
        operationErrors[log.operation_type]++;
      }

      // Extract performance data
      if (log.performance_data && typeof log.performance_data === 'object') {
        const perfData = log.performance_data as any;

        if (perfData.duration_ms) {
          const key = `${log.operation_type}_${log.entity_type || 'general'}`;
          if (!operationDurations[key]) {
            operationDurations[key] = [];
          }
          operationDurations[key].push(perfData.duration_ms);
        }

        if (perfData.records_processed) {
          totalRecordsProcessed += perfData.records_processed;
        }
      }
    });

    // Calculate averages
    const averageDurations: Record<string, number> = {};
    Object.entries(operationDurations).forEach(([key, durations]) => {
      averageDurations[key] = Math.round(
        durations.reduce((sum, duration) => sum + duration, 0) / durations.length
      );
    });

    // Calculate throughput
    let recordsPerSecond: number | null = null;
    if (logs.length > 0 && totalRecordsProcessed > 0) {
      const timeRange = logs[logs.length - 1].timestamp.getTime() - logs[0].timestamp.getTime();
      const seconds = timeRange / 1000;
      if (seconds > 0) {
        recordsPerSecond = Math.round((totalRecordsProcessed / seconds) * 100) / 100;
      }
    }

    const operationsPerMinute = logs.length > 0 ? Math.round(logs.length / ((logs[logs.length - 1].timestamp.getTime() - logs[0].timestamp.getTime()) / 60000)) : 0;

    // Calculate error rates
    const errorRates: Record<OperationType, number> = {} as Record<OperationType, number>;
    VALID_OPERATION_TYPES.forEach(opType => {
      const total = operationCounts[opType];
      const errors = operationErrors[opType];
      errorRates[opType] = total > 0 ? Math.round((errors / total) * 100 * 100) / 100 : 0;
    });

    return {
      totalOperations: logs.length,
      operationDurations,
      averageDurations,
      throughputMetrics: {
        recordsPerSecond,
        operationsPerMinute
      },
      errorRates
    };
  }

  /**
   * Creates context data for different operation types
   */
  static createContextData(operation: OperationType, data: any = {}): object {
    const baseContext = {
      operation: operation,
      timestamp: new Date().toISOString(),
      system_info: {
        node_version: process.version,
        platform: process.platform
      }
    };

    switch (operation) {
      case 'baseline_analysis':
        return {
          ...baseContext,
          analyzed_entities: data.analyzedEntities || [],
          total_records_analyzed: data.totalRecordsAnalyzed || 0,
          analysis_duration_ms: data.analysisDurationMs || null,
          ...data
        };

      case 'differential_detection':
        return {
          ...baseContext,
          entity_type: data.entityType,
          changes_detected: data.changesDetected || 0,
          new_records: data.newRecords || 0,
          modified_records: data.modifiedRecords || 0,
          deleted_records: data.deletedRecords || 0,
          detection_method: data.detectionMethod || 'timestamp_based',
          ...data
        };

      case 'record_migration':
        return {
          ...baseContext,
          entity_type: data.entityType,
          batch_number: data.batchNumber || null,
          batch_size: data.batchSize || null,
          records_processed: data.recordsProcessed || 0,
          migration_mode: data.migrationMode || 'differential',
          ...data
        };

      case 'validation':
        return {
          ...baseContext,
          entity_type: data.entityType,
          validation_type: data.validationType || 'completeness',
          records_validated: data.recordsValidated || 0,
          validation_passed: data.validationPassed || true,
          ...data
        };

      case 'checkpoint_save':
      case 'checkpoint_restore':
        return {
          ...baseContext,
          entity_type: data.entityType,
          checkpoint_id: data.checkpointId,
          records_processed: data.recordsProcessed || 0,
          records_remaining: data.recordsRemaining || 0,
          ...data
        };

      default:
        return { ...baseContext, ...data };
    }
  }

  /**
   * Creates error details object for different error scenarios
   */
  static createErrorDetails(options: {
    errorCode?: string;
    originalError?: Error | string;
    stackTrace?: string;
    affectedRecords?: number;
    retryAttempts?: number;
    errorCategory?: 'database' | 'validation' | 'network' | 'business_logic' | 'system';
    recoverable?: boolean;
    additionalDetails?: object;
  }): object {
    const errorDetails: any = {
      error_timestamp: new Date().toISOString(),
      error_code: options.errorCode || 'UNKNOWN_ERROR',
      error_category: options.errorCategory || 'system',
      recoverable: options.recoverable !== undefined ? options.recoverable : true
    };

    if (options.originalError) {
      if (options.originalError instanceof Error) {
        errorDetails.original_error = {
          name: options.originalError.name,
          message: options.originalError.message,
          stack: options.stackTrace || options.originalError.stack
        };
      } else {
        errorDetails.original_error = options.originalError;
      }
    }

    if (options.affectedRecords !== undefined) {
      errorDetails.affected_records = options.affectedRecords;
    }

    if (options.retryAttempts !== undefined) {
      errorDetails.retry_attempts = options.retryAttempts;
    }

    if (options.additionalDetails) {
      Object.assign(errorDetails, options.additionalDetails);
    }

    return errorDetails;
  }

  /**
   * Serializes log for database storage
   */
  static serialize(log: MigrationExecutionLog): {
    id: string;
    migration_session_id: string;
    entity_type: string | null;
    operation_type: string;
    record_id: string | null;
    log_level: string;
    message: string;
    error_details: string | null; // JSON string
    performance_data: string | null; // JSON string
    context_data: string; // JSON string
    timestamp: string; // ISO string
    created_at: string; // ISO string
  } {
    return {
      id: log.id,
      migration_session_id: log.migration_session_id,
      entity_type: log.entity_type,
      operation_type: log.operation_type,
      record_id: log.record_id,
      log_level: log.log_level,
      message: log.message,
      error_details: log.error_details ? JSON.stringify(log.error_details) : null,
      performance_data: log.performance_data ? JSON.stringify(log.performance_data) : null,
      context_data: JSON.stringify(log.context_data),
      timestamp: log.timestamp.toISOString(),
      created_at: log.created_at.toISOString()
    };
  }

  /**
   * Deserializes log from database storage
   */
  static deserialize(data: any): MigrationExecutionLog {
    try {
      return {
        id: data.id,
        migration_session_id: data.migration_session_id,
        entity_type: data.entity_type,
        operation_type: data.operation_type as OperationType,
        record_id: data.record_id,
        log_level: data.log_level as LogLevel,
        message: data.message,
        error_details: data.error_details ? (typeof data.error_details === 'string' ? JSON.parse(data.error_details) : data.error_details) : null,
        performance_data: data.performance_data ? (typeof data.performance_data === 'string' ? JSON.parse(data.performance_data) : data.performance_data) : null,
        context_data: typeof data.context_data === 'string' ? JSON.parse(data.context_data) : data.context_data,
        timestamp: typeof data.timestamp === 'string' ? new Date(data.timestamp) : data.timestamp,
        created_at: typeof data.created_at === 'string' ? new Date(data.created_at) : data.created_at
      };
    } catch (error) {
      throw new Error(`Failed to deserialize migration execution log: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Creates a comprehensive log report for a migration session
   */
  static createSessionReport(sessionId: string, logs: MigrationExecutionLog[]): {
    sessionId: string;
    totalLogs: number;
    timeRange: { start: Date | null; end: Date | null };
    summary: LogSummary;
    performance: ReturnType<typeof MigrationExecutionLogModel.extractPerformanceMetrics>;
    criticalIssues: MigrationExecutionLog[];
    recommendations: string[];
    entityBreakdown: Record<string, { total: number; errors: number; warnings: number }>;
  } {
    const sessionLogs = logs.filter(log => log.migration_session_id === sessionId);
    const summary = this.getLogsSummary(sessionLogs);
    const performance = this.extractPerformanceMetrics(sessionLogs);

    // Calculate time range
    const timeRange = {
      start: sessionLogs.length > 0 ? sessionLogs[0].timestamp : null,
      end: sessionLogs.length > 0 ? sessionLogs[sessionLogs.length - 1].timestamp : null
    };

    // Identify critical issues
    const criticalIssues = sessionLogs.filter(log =>
      log.log_level === 'error' ||
      (log.log_level === 'warn' && log.message.toLowerCase().includes('critical'))
    );

    // Generate entity breakdown
    const entityBreakdown: Record<string, { total: number; errors: number; warnings: number }> = {};
    sessionLogs.forEach(log => {
      const entity = log.entity_type || 'general';
      if (!entityBreakdown[entity]) {
        entityBreakdown[entity] = { total: 0, errors: 0, warnings: 0 };
      }
      entityBreakdown[entity].total++;
      if (log.log_level === 'error') entityBreakdown[entity].errors++;
      if (log.log_level === 'warn') entityBreakdown[entity].warnings++;
    });

    // Generate recommendations
    const recommendations: string[] = [];

    if (summary.errorCount > summary.total * 0.05) {
      recommendations.push('High error rate detected (>5%) - investigate root causes');
    }

    if (performance.throughputMetrics.recordsPerSecond && performance.throughputMetrics.recordsPerSecond < 50) {
      recommendations.push('Low throughput detected (<50 records/sec) - consider performance optimization');
    }

    if (criticalIssues.length > 0) {
      recommendations.push(`${criticalIssues.length} critical issue(s) found - review error logs immediately`);
    }

    Object.entries(performance.errorRates).forEach(([operation, rate]) => {
      if (rate > 10) {
        recommendations.push(`High error rate for ${operation} operations (${rate}%) - investigate operation-specific issues`);
      }
    });

    if (recommendations.length === 0) {
      recommendations.push('Migration session completed successfully with no major issues identified');
    }

    return {
      sessionId,
      totalLogs: sessionLogs.length,
      timeRange,
      summary,
      performance,
      criticalIssues,
      recommendations,
      entityBreakdown
    };
  }
}