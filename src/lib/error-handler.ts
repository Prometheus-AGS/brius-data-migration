/**
 * Comprehensive Error Handling and Logging Infrastructure
 *
 * Provides enterprise-grade error handling, logging, and monitoring capabilities
 * for the database migration system with structured logging and error categorization.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getConfig, configUtils } from './environment-config';
import { ErrorType, MigrationError } from '../models/migration-models';

// ===== ERROR CLASSIFICATION =====

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum ErrorCategory {
  DATABASE = 'database',
  NETWORK = 'network',
  VALIDATION = 'validation',
  BUSINESS_LOGIC = 'business_logic',
  SYSTEM = 'system',
  CONFIGURATION = 'configuration'
}

export enum RecoveryStrategy {
  RETRY = 'retry',
  SKIP = 'skip',
  FAIL_FAST = 'fail_fast',
  ROLLBACK = 'rollback',
  MANUAL_INTERVENTION = 'manual_intervention'
}

// ===== CUSTOM ERROR CLASSES =====

export class MigrationBaseError extends Error {
  public readonly errorCode: string;
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly recoveryStrategy: RecoveryStrategy;
  public readonly context: Record<string, any>;
  public readonly timestamp: Date;
  public readonly correlationId?: string;

  constructor(
    message: string,
    errorCode: string,
    category: ErrorCategory,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    recoveryStrategy: RecoveryStrategy = RecoveryStrategy.RETRY,
    context: Record<string, any> = {},
    correlationId?: string
  ) {
    super(message);
    this.name = this.constructor.name;
    this.errorCode = errorCode;
    this.category = category;
    this.severity = severity;
    this.recoveryStrategy = recoveryStrategy;
    this.context = context;
    this.timestamp = new Date();
    this.correlationId = correlationId;

    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert to structured log format
   */
  toLogFormat(): LogEntry {
    return {
      timestamp: this.timestamp,
      level: this.severityToLogLevel(this.severity),
      message: this.message,
      error_code: this.errorCode,
      category: this.category,
      severity: this.severity,
      recovery_strategy: this.recoveryStrategy,
      context: this.context,
      stack_trace: this.stack,
      correlation_id: this.correlationId
    };
  }

  /**
   * Convert to migration error model
   */
  toMigrationError(
    migrationId: string,
    entityStatusId?: string,
    batchId?: string,
    sourceRecordId?: string
  ): Omit<MigrationError, 'id' | 'created_at' | 'updated_at'> {
    return {
      migration_id: migrationId,
      entity_status_id: entityStatusId,
      batch_id: batchId,
      error_type: this.categoryToErrorType(this.category),
      error_code: this.errorCode,
      error_message: this.message,
      source_record_id: sourceRecordId,
      source_data: this.context.sourceData || {},
      context: {
        category: this.category,
        severity: this.severity,
        recovery_strategy: this.recoveryStrategy,
        correlation_id: this.correlationId,
        ...this.context
      },
      stack_trace: this.stack,
      occurred_at: this.timestamp,
      is_resolved: false
    };
  }

  private severityToLogLevel(severity: ErrorSeverity): LogLevel {
    switch (severity) {
      case ErrorSeverity.LOW:
        return LogLevel.WARN;
      case ErrorSeverity.MEDIUM:
        return LogLevel.ERROR;
      case ErrorSeverity.HIGH:
      case ErrorSeverity.CRITICAL:
        return LogLevel.ERROR;
      default:
        return LogLevel.ERROR;
    }
  }

  private categoryToErrorType(category: ErrorCategory): ErrorType {
    switch (category) {
      case ErrorCategory.DATABASE:
        return ErrorType.CONNECTION_ERROR;
      case ErrorCategory.NETWORK:
        return ErrorType.CONNECTION_ERROR;
      case ErrorCategory.VALIDATION:
        return ErrorType.DATA_VALIDATION;
      case ErrorCategory.BUSINESS_LOGIC:
        return ErrorType.CONSTRAINT_VIOLATION;
      case ErrorCategory.SYSTEM:
        return ErrorType.TIMEOUT;
      default:
        return ErrorType.UNKNOWN;
    }
  }
}

export class DatabaseError extends MigrationBaseError {
  constructor(
    message: string,
    errorCode: string = 'DB_ERROR',
    context: Record<string, any> = {},
    correlationId?: string
  ) {
    super(
      message,
      errorCode,
      ErrorCategory.DATABASE,
      ErrorSeverity.HIGH,
      RecoveryStrategy.RETRY,
      context,
      correlationId
    );
  }
}

export class NetworkError extends MigrationBaseError {
  constructor(
    message: string,
    errorCode: string = 'NETWORK_ERROR',
    context: Record<string, any> = {},
    correlationId?: string
  ) {
    super(
      message,
      errorCode,
      ErrorCategory.NETWORK,
      ErrorSeverity.MEDIUM,
      RecoveryStrategy.RETRY,
      context,
      correlationId
    );
  }
}

export class ValidationError extends MigrationBaseError {
  constructor(
    message: string,
    errorCode: string = 'VALIDATION_ERROR',
    context: Record<string, any> = {},
    correlationId?: string
  ) {
    super(
      message,
      errorCode,
      ErrorCategory.VALIDATION,
      ErrorSeverity.LOW,
      RecoveryStrategy.SKIP,
      context,
      correlationId
    );
  }
}

export class BusinessLogicError extends MigrationBaseError {
  constructor(
    message: string,
    errorCode: string = 'BUSINESS_ERROR',
    context: Record<string, any> = {},
    recoveryStrategy: RecoveryStrategy = RecoveryStrategy.MANUAL_INTERVENTION,
    correlationId?: string
  ) {
    super(
      message,
      errorCode,
      ErrorCategory.BUSINESS_LOGIC,
      ErrorSeverity.HIGH,
      recoveryStrategy,
      context,
      correlationId
    );
  }
}

export class SystemError extends MigrationBaseError {
  constructor(
    message: string,
    errorCode: string = 'SYSTEM_ERROR',
    context: Record<string, any> = {},
    correlationId?: string
  ) {
    super(
      message,
      errorCode,
      ErrorCategory.SYSTEM,
      ErrorSeverity.CRITICAL,
      RecoveryStrategy.FAIL_FAST,
      context,
      correlationId
    );
  }
}

export class ConfigurationError extends MigrationBaseError {
  constructor(
    message: string,
    errorCode: string = 'CONFIG_ERROR',
    context: Record<string, any> = {},
    correlationId?: string
  ) {
    super(
      message,
      errorCode,
      ErrorCategory.CONFIGURATION,
      ErrorSeverity.CRITICAL,
      RecoveryStrategy.FAIL_FAST,
      context,
      correlationId
    );
  }
}

// ===== LOGGING INFRASTRUCTURE =====

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  error_code?: string;
  category?: ErrorCategory;
  severity?: ErrorSeverity;
  recovery_strategy?: RecoveryStrategy;
  stack_trace?: string;
  correlation_id?: string;
  migration_id?: string;
  entity_name?: string;
  batch_id?: string;
}

export interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableFile: boolean;
  logDirectory: string;
  maxFileSize?: number; // in bytes
  maxFiles?: number;
  enableStructuredLogging: boolean;
  enableCorrelationId: boolean;
}

export class Logger {
  private config: LoggerConfig;
  private correlationId: string | null = null;
  private migrationId: string | null = null;
  private currentLogFile: string | null = null;

  constructor(config?: Partial<LoggerConfig>) {
    const appConfig = getConfig();

    this.config = {
      level: this.parseLogLevel(appConfig.logging.level),
      enableConsole: true,
      enableFile: appConfig.logging.enableFileLogging,
      logDirectory: appConfig.logging.logDirectory,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
      enableStructuredLogging: true,
      enableCorrelationId: true,
      ...config
    };

    this.ensureLogDirectory();
    this.initializeLogFile();
  }

  /**
   * Set correlation ID for request tracing
   */
  setCorrelationId(correlationId: string): void {
    this.correlationId = correlationId;
  }

  /**
   * Set migration ID for migration-specific logging
   */
  setMigrationId(migrationId: string): void {
    this.migrationId = migrationId;
  }

  /**
   * Clear context (correlation ID and migration ID)
   */
  clearContext(): void {
    this.correlationId = null;
    this.migrationId = null;
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error | MigrationBaseError, context?: Record<string, any>): void {
    const errorContext = error instanceof MigrationBaseError
      ? { ...context, ...error.context, error_details: error.toLogFormat() }
      : { ...context, error_message: error?.message, stack_trace: error?.stack };

    this.log(LogLevel.ERROR, message, errorContext);
  }

  /**
   * Log migration error with structured format
   */
  logMigrationError(
    error: MigrationBaseError,
    entityName?: string,
    batchId?: string
  ): void {
    const logEntry = error.toLogFormat();
    logEntry.migration_id = this.migrationId || undefined;
    logEntry.entity_name = entityName;
    logEntry.batch_id = batchId;

    this.writeLogEntry(logEntry);
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, message: string, context?: Record<string, any>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const logEntry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      context,
      correlation_id: this.correlationId || undefined,
      migration_id: this.migrationId || undefined
    };

    this.writeLogEntry(logEntry);
  }

  /**
   * Write log entry to configured outputs
   */
  private writeLogEntry(entry: LogEntry): void {
    const formattedEntry = this.formatLogEntry(entry);

    // Console output
    if (this.config.enableConsole) {
      this.writeToConsole(entry.level, formattedEntry);
    }

    // File output
    if (this.config.enableFile) {
      this.writeToFile(formattedEntry);
    }
  }

  /**
   * Format log entry based on configuration
   */
  private formatLogEntry(entry: LogEntry): string {
    if (this.config.enableStructuredLogging) {
      return JSON.stringify({
        ...entry,
        timestamp: entry.timestamp.toISOString()
      });
    } else {
      const timestamp = entry.timestamp.toISOString();
      const level = entry.level.toUpperCase().padEnd(5);
      const correlation = entry.correlation_id ? `[${entry.correlation_id}] ` : '';
      const migration = entry.migration_id ? `[${entry.migration_id}] ` : '';
      const context = entry.context ? ` ${JSON.stringify(entry.context)}` : '';

      return `${timestamp} ${level} ${correlation}${migration}${entry.message}${context}`;
    }
  }

  /**
   * Write to console with appropriate method
   */
  private writeToConsole(level: LogLevel, message: string): void {
    switch (level) {
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
        break;
    }
  }

  /**
   * Write to log file
   */
  private writeToFile(message: string): void {
    if (!this.currentLogFile) {
      return;
    }

    try {
      fs.appendFileSync(this.currentLogFile, message + '\n');
      this.checkLogRotation();
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  /**
   * Check if log should be written based on level
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const configLevelIndex = levels.indexOf(this.config.level);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= configLevelIndex;
  }

  /**
   * Parse log level from string
   */
  private parseLogLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case 'debug':
        return LogLevel.DEBUG;
      case 'info':
        return LogLevel.INFO;
      case 'warn':
      case 'warning':
        return LogLevel.WARN;
      case 'error':
        return LogLevel.ERROR;
      default:
        return LogLevel.INFO;
    }
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDirectory(): void {
    if (!this.config.enableFile) {
      return;
    }

    try {
      if (!fs.existsSync(this.config.logDirectory)) {
        fs.mkdirSync(this.config.logDirectory, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create log directory:', error);
      this.config.enableFile = false;
    }
  }

  /**
   * Initialize log file
   */
  private initializeLogFile(): void {
    if (!this.config.enableFile) {
      return;
    }

    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `migration-${timestamp}.log`;
    this.currentLogFile = path.join(this.config.logDirectory, filename);
  }

  /**
   * Check and perform log rotation if needed
   */
  private checkLogRotation(): void {
    if (!this.currentLogFile || !this.config.maxFileSize) {
      return;
    }

    try {
      const stats = fs.statSync(this.currentLogFile);
      if (stats.size > this.config.maxFileSize) {
        this.rotateLogFile();
      }
    } catch (error) {
      console.error('Failed to check log file size:', error);
    }
  }

  /**
   * Rotate log file
   */
  private rotateLogFile(): void {
    if (!this.currentLogFile) {
      return;
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedFile = this.currentLogFile.replace('.log', `-${timestamp}.log`);

      fs.renameSync(this.currentLogFile, rotatedFile);
      this.initializeLogFile();

      this.cleanupOldLogFiles();
    } catch (error) {
      console.error('Failed to rotate log file:', error);
    }
  }

  /**
   * Clean up old log files
   */
  private cleanupOldLogFiles(): void {
    if (!this.config.maxFiles) {
      return;
    }

    try {
      const files = fs.readdirSync(this.config.logDirectory)
        .filter(file => file.startsWith('migration-') && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: path.join(this.config.logDirectory, file),
          mtime: fs.statSync(path.join(this.config.logDirectory, file)).mtime
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      const filesToDelete = files.slice(this.config.maxFiles);
      filesToDelete.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (error) {
          console.error(`Failed to delete old log file ${file.name}:`, error);
        }
      });
    } catch (error) {
      console.error('Failed to cleanup old log files:', error);
    }
  }
}

// ===== ERROR HANDLER CLASS =====

export interface ErrorHandlerConfig {
  maxRetryAttempts: number;
  retryDelayMs: number;
  enableCircuitBreaker: boolean;
  circuitBreakerThreshold: number;
  circuitBreakerTimeoutMs: number;
  enableErrorReporting: boolean;
  errorReportingEndpoint?: string;
}

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: Error) => boolean;
}

export interface CircuitBreakerState {
  failures: number;
  lastFailureTime: Date | null;
  state: 'closed' | 'open' | 'half-open';
}

export class ErrorHandler {
  private config: ErrorHandlerConfig;
  private logger: Logger;
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private errorCounts: Map<string, number> = new Map();

  constructor(logger: Logger, config?: Partial<ErrorHandlerConfig>) {
    this.logger = logger;
    this.config = {
      maxRetryAttempts: 3,
      retryDelayMs: 1000,
      enableCircuitBreaker: true,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeoutMs: 60000, // 1 minute
      enableErrorReporting: false,
      ...config
    };
  }

  /**
   * Handle error with automatic classification and recovery strategy
   */
  async handleError(
    error: Error,
    context: Record<string, any> = {},
    correlationId?: string
  ): Promise<MigrationBaseError> {
    // Convert to MigrationBaseError if not already
    const migrationError = this.classifyError(error, context, correlationId);

    // Log the error
    this.logger.logMigrationError(
      migrationError,
      context.entityName,
      context.batchId
    );

    // Track error for circuit breaker
    this.trackError(migrationError);

    // Report error if enabled
    if (this.config.enableErrorReporting) {
      await this.reportError(migrationError, context);
    }

    return migrationError;
  }

  /**
   * Execute operation with retry logic
   */
  async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    options?: RetryOptions
  ): Promise<T> {
    const retryOptions: Required<RetryOptions> = {
      maxAttempts: options?.maxAttempts ?? this.config.maxRetryAttempts,
      delayMs: options?.delayMs ?? this.config.retryDelayMs,
      backoffMultiplier: options?.backoffMultiplier ?? 2,
      maxDelayMs: options?.maxDelayMs ?? 30000, // 30 seconds
      shouldRetry: options?.shouldRetry ?? this.defaultShouldRetry.bind(this)
    };

    let attempt = 1;
    let lastError: Error;

    while (attempt <= retryOptions.maxAttempts) {
      try {
        // Check circuit breaker
        if (this.config.enableCircuitBreaker && this.isCircuitOpen(operationName)) {
          throw new SystemError(
            `Circuit breaker is open for operation: ${operationName}`,
            'CIRCUIT_BREAKER_OPEN',
            { operation_name: operationName, attempt }
          );
        }

        const result = await operation();

        // Reset circuit breaker on success
        this.resetCircuitBreaker(operationName);

        if (attempt > 1) {
          this.logger.info(`Operation succeeded after ${attempt - 1} retries`, {
            operation_name: operationName,
            total_attempts: attempt - 1
          });
        }

        return result;

      } catch (error) {
        lastError = error as Error;

        const migrationError = await this.handleError(lastError, {
          operation_name: operationName,
          attempt,
          max_attempts: retryOptions.maxAttempts
        });

        // Check if we should retry
        if (attempt >= retryOptions.maxAttempts || !retryOptions.shouldRetry(lastError)) {
          throw migrationError;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          retryOptions.delayMs * Math.pow(retryOptions.backoffMultiplier, attempt - 1),
          retryOptions.maxDelayMs
        );

        this.logger.warn(`Operation failed, retrying in ${delay}ms`, {
          operation_name: operationName,
          attempt,
          max_attempts: retryOptions.maxAttempts,
          error_message: lastError.message,
          delay_ms: delay
        });

        await this.sleep(delay);
        attempt++;
      }
    }

    throw lastError!;
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async withCircuitBreaker<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    if (!this.config.enableCircuitBreaker) {
      return operation();
    }

    // Check circuit state
    if (this.isCircuitOpen(operationName)) {
      throw new SystemError(
        `Circuit breaker is open for operation: ${operationName}`,
        'CIRCUIT_BREAKER_OPEN',
        { operation_name: operationName }
      );
    }

    try {
      const result = await operation();
      this.resetCircuitBreaker(operationName);
      return result;
    } catch (error) {
      this.recordCircuitBreakerFailure(operationName);
      throw error;
    }
  }

  /**
   * Classify error into appropriate MigrationBaseError type
   */
  private classifyError(
    error: Error,
    context: Record<string, any>,
    correlationId?: string
  ): MigrationBaseError {
    // Return as-is if already a MigrationBaseError
    if (error instanceof MigrationBaseError) {
      return error;
    }

    const message = error.message.toLowerCase();

    // Database errors
    if (message.includes('connection') || message.includes('econnrefused') || message.includes('timeout')) {
      return new DatabaseError(error.message, 'DB_CONNECTION_ERROR', context, correlationId);
    }

    // Network errors
    if (message.includes('network') || message.includes('enotfound') || message.includes('econnreset')) {
      return new NetworkError(error.message, 'NETWORK_CONNECTION_ERROR', context, correlationId);
    }

    // Validation errors
    if (message.includes('validation') || message.includes('invalid') || message.includes('constraint')) {
      return new ValidationError(error.message, 'DATA_VALIDATION_ERROR', context, correlationId);
    }

    // Configuration errors
    if (message.includes('config') || message.includes('environment') || message.includes('missing')) {
      return new ConfigurationError(error.message, 'CONFIGURATION_ERROR', context, correlationId);
    }

    // Default to system error
    return new SystemError(error.message, 'UNKNOWN_ERROR', context, correlationId);
  }

  /**
   * Default retry logic
   */
  private defaultShouldRetry(error: Error): boolean {
    if (error instanceof MigrationBaseError) {
      return error.recoveryStrategy === RecoveryStrategy.RETRY;
    }

    // Retry on network and temporary database errors
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('network') ||
      message.includes('econnreset') ||
      message.includes('enotfound')
    );
  }

  /**
   * Track error for circuit breaker
   */
  private trackError(error: MigrationBaseError): void {
    const key = `${error.category}:${error.errorCode}`;
    const currentCount = this.errorCounts.get(key) || 0;
    this.errorCounts.set(key, currentCount + 1);
  }

  /**
   * Check if circuit breaker is open
   */
  private isCircuitOpen(operationName: string): boolean {
    const state = this.circuitBreakers.get(operationName);
    if (!state) {
      return false;
    }

    const now = new Date();

    if (state.state === 'open') {
      // Check if we should transition to half-open
      if (state.lastFailureTime &&
          (now.getTime() - state.lastFailureTime.getTime()) > this.config.circuitBreakerTimeoutMs) {
        state.state = 'half-open';
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Record circuit breaker failure
   */
  private recordCircuitBreakerFailure(operationName: string): void {
    const state = this.circuitBreakers.get(operationName) || {
      failures: 0,
      lastFailureTime: null,
      state: 'closed' as const
    };

    state.failures += 1;
    state.lastFailureTime = new Date();

    if (state.failures >= this.config.circuitBreakerThreshold) {
      state.state = 'open';
      this.logger.warn(`Circuit breaker opened for operation: ${operationName}`, {
        operation_name: operationName,
        failure_count: state.failures,
        threshold: this.config.circuitBreakerThreshold
      });
    }

    this.circuitBreakers.set(operationName, state);
  }

  /**
   * Reset circuit breaker on success
   */
  private resetCircuitBreaker(operationName: string): void {
    const state = this.circuitBreakers.get(operationName);
    if (state && state.failures > 0) {
      state.failures = 0;
      state.state = 'closed';
      state.lastFailureTime = null;
      this.circuitBreakers.set(operationName, state);

      this.logger.info(`Circuit breaker reset for operation: ${operationName}`);
    }
  }

  /**
   * Report error to external system
   */
  private async reportError(
    error: MigrationBaseError,
    context: Record<string, any>
  ): Promise<void> {
    if (!this.config.errorReportingEndpoint) {
      return;
    }

    try {
      // Implementation would depend on your error reporting service
      // This is a placeholder for external error reporting
      this.logger.debug('Error reporting not implemented', {
        error_code: error.errorCode,
        severity: error.severity,
        context
      });
    } catch (reportingError) {
      this.logger.error('Failed to report error to external system', reportingError as Error);
    }
  }

  /**
   * Get error statistics
   */
  getErrorStatistics(): Record<string, any> {
    const circuitBreakerStats = Array.from(this.circuitBreakers.entries()).map(([name, state]) => ({
      operation_name: name,
      state: state.state,
      failure_count: state.failures,
      last_failure: state.lastFailureTime
    }));

    const errorStats = Array.from(this.errorCounts.entries()).map(([key, count]) => ({
      error_key: key,
      count
    }));

    return {
      circuit_breakers: circuitBreakerStats,
      error_counts: errorStats,
      total_errors: Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0)
    };
  }

  /**
   * Clear error statistics
   */
  clearStatistics(): void {
    this.errorCounts.clear();
    this.circuitBreakers.clear();
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ===== SINGLETON INSTANCES =====

let globalLogger: Logger | null = null;
let globalErrorHandler: ErrorHandler | null = null;

/**
 * Get global logger instance
 */
export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger();
  }
  return globalLogger;
}

/**
 * Get global error handler instance
 */
export function getErrorHandler(): ErrorHandler {
  if (!globalErrorHandler) {
    globalErrorHandler = new ErrorHandler(getLogger());
  }
  return globalErrorHandler;
}

/**
 * Initialize logging and error handling with specific configuration
 */
export function initializeErrorHandling(
  loggerConfig?: Partial<LoggerConfig>,
  errorHandlerConfig?: Partial<ErrorHandlerConfig>
): { logger: Logger; errorHandler: ErrorHandler } {
  globalLogger = new Logger(loggerConfig);
  globalErrorHandler = new ErrorHandler(globalLogger, errorHandlerConfig);

  return {
    logger: globalLogger,
    errorHandler: globalErrorHandler
  };
}

// ===== UTILITY FUNCTIONS =====

/**
 * Generate correlation ID for request tracing
 */
export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Wrap async function with error handling
 */
export function withErrorHandling<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  operationName: string,
  context?: Record<string, any>
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const correlationId = generateCorrelationId();
    const logger = getLogger();
    const errorHandler = getErrorHandler();

    logger.setCorrelationId(correlationId);

    try {
      logger.debug(`Starting operation: ${operationName}`, { ...context, args: args.length });
      const result = await fn(...args);
      logger.debug(`Completed operation: ${operationName}`, { ...context });
      return result;
    } catch (error) {
      await errorHandler.handleError(error as Error, {
        operation_name: operationName,
        ...context
      }, correlationId);
      throw error;
    } finally {
      logger.clearContext();
    }
  };
}

/**
 * Wrap function with retry logic
 */
export function withRetry<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  operationName: string,
  retryOptions?: RetryOptions
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const errorHandler = getErrorHandler();
    return errorHandler.withRetry(() => fn(...args), operationName, retryOptions);
  };
}