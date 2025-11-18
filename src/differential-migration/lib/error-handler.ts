/**
 * Comprehensive Error Handling System
 *
 * Implements error handling strategies for differential migration operations
 * including network failures, data integrity errors, and schema mismatches
 */

export interface MigrationError {
  id: string;
  type: 'network' | 'data_integrity' | 'schema_mismatch' | 'validation' | 'system' | 'business_rule';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  details: {
    entityType?: string;
    recordId?: string;
    batchNumber?: number;
    tableName?: string;
    columnName?: string;
    originalValue?: any;
    expectedValue?: any;
    stackTrace?: string;
    context?: any;
  };
  timestamp: Date;
  retryable: boolean;
  retryCount: number;
  maxRetries: number;
  resolution?: ErrorResolution;
}

export interface ErrorResolution {
  action: 'retry' | 'skip' | 'manual_intervention' | 'rollback' | 'halt';
  reason: string;
  automatedFix?: {
    applied: boolean;
    description: string;
    success?: boolean;
  };
  manualSteps?: string[];
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  exponentialBackoff: boolean;
  jitterEnabled: boolean;
  retryableErrorTypes: string[];
}

export interface ErrorHandlingMetrics {
  totalErrors: number;
  errorsByType: Record<string, number>;
  errorsBySeverity: Record<string, number>;
  retriesAttempted: number;
  retriesSuccessful: number;
  manualInterventionsRequired: number;
  averageRecoveryTime: number;
  mostCommonErrors: Array<{
    type: string;
    count: number;
    percentage: number;
    lastOccurrence: Date;
  }>;
}

/**
 * Migration Error Handler
 *
 * Provides comprehensive error handling with automatic recovery, retry logic,
 * and detailed error analysis for migration operations
 */
export class MigrationErrorHandler {
  private config: RetryConfig;
  private errors: MigrationError[] = [];
  private errorMetrics: ErrorHandlingMetrics;

  private readonly DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    exponentialBackoff: true,
    jitterEnabled: true,
    retryableErrorTypes: [
      'network',
      'system',
      'connection_timeout',
      'query_timeout',
      'temporary_lock'
    ]
  };

  // Error pattern detection
  private readonly ERROR_PATTERNS = {
    network: [
      /connection\s+(timed?\s?out|refused|reset)/i,
      /network\s+(error|timeout)/i,
      /econnreset|econnrefused|etimedout/i,
      /socket\s+hang\s+up/i
    ],
    data_integrity: [
      /foreign\s+key\s+(constraint|violation)/i,
      /unique\s+(constraint|violation)/i,
      /check\s+constraint/i,
      /not\s+null\s+(constraint|violation)/i,
      /duplicate\s+key/i
    ],
    schema_mismatch: [
      /column\s+.*\s+does\s+not\s+exist/i,
      /table\s+.*\s+does\s+not\s+exist/i,
      /data\s+type\s+mismatch/i,
      /invalid\s+input\s+syntax/i
    ],
    validation: [
      /validation\s+(failed|error)/i,
      /record\s+count\s+mismatch/i,
      /checksum\s+(failed|mismatch)/i
    ]
  };

  constructor(retryConfig?: Partial<RetryConfig>) {
    this.config = { ...this.DEFAULT_RETRY_CONFIG, ...retryConfig };
    this.errorMetrics = this.initializeMetrics();
  }

  private initializeMetrics(): ErrorHandlingMetrics {
    return {
      totalErrors: 0,
      errorsByType: {},
      errorsBySeverity: {},
      retriesAttempted: 0,
      retriesSuccessful: 0,
      manualInterventionsRequired: 0,
      averageRecoveryTime: 0,
      mostCommonErrors: []
    };
  }

  /**
   * Handle error with automatic classification and resolution
   */
  async handleError(
    error: Error,
    context: {
      entityType?: string;
      recordId?: string;
      batchNumber?: number;
      operation?: string;
    }
  ): Promise<ErrorResolution> {
    // Create migration error record
    const migrationError = this.createMigrationError(error, context);

    // Store error for analysis
    this.errors.push(migrationError);
    this.updateErrorMetrics(migrationError);

    // Determine resolution strategy
    const resolution = await this.determineResolution(migrationError);
    migrationError.resolution = resolution;

    // Execute automated resolution if available
    if (resolution.automatedFix) {
      await this.executeAutomatedFix(migrationError, resolution);
    }

    return resolution;
  }

  private createMigrationError(error: Error, context: any): MigrationError {
    const errorType = this.classifyError(error.message);
    const severity = this.determineSeverity(errorType, error.message);

    return {
      id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: errorType,
      severity,
      message: error.message,
      details: {
        ...context,
        stackTrace: error.stack,
        originalError: error.name
      },
      timestamp: new Date(),
      retryable: this.isRetryable(errorType, error.message),
      retryCount: 0,
      maxRetries: this.config.maxRetries
    };
  }

  private classifyError(errorMessage: string): MigrationError['type'] {
    for (const [type, patterns] of Object.entries(this.ERROR_PATTERNS)) {
      if (patterns.some(pattern => pattern.test(errorMessage))) {
        return type as MigrationError['type'];
      }
    }

    // Default classification based on common keywords
    if (errorMessage.toLowerCase().includes('timeout')) {
      return 'network';
    } else if (errorMessage.toLowerCase().includes('constraint') || errorMessage.toLowerCase().includes('violation')) {
      return 'data_integrity';
    } else if (errorMessage.toLowerCase().includes('column') || errorMessage.toLowerCase().includes('table')) {
      return 'schema_mismatch';
    } else {
      return 'system';
    }
  }

  private determineSeverity(errorType: MigrationError['type'], errorMessage: string): MigrationError['severity'] {
    switch (errorType) {
      case 'data_integrity':
      case 'schema_mismatch':
        return 'high';

      case 'network':
        return errorMessage.toLowerCase().includes('timeout') ? 'medium' : 'high';

      case 'validation':
        return errorMessage.toLowerCase().includes('critical') ? 'high' : 'medium';

      case 'business_rule':
        return 'medium';

      case 'system':
      default:
        return errorMessage.toLowerCase().includes('critical') ||
               errorMessage.toLowerCase().includes('fatal') ? 'critical' : 'medium';
    }
  }

  private isRetryable(errorType: MigrationError['type'], errorMessage: string): boolean {
    // Check if error type is in retryable list
    if (this.config.retryableErrorTypes.includes(errorType)) {
      return true;
    }

    // Additional retryable patterns
    const retryablePatterns = [
      /connection.*timeout/i,
      /temporary.*lock/i,
      /deadlock/i,
      /server.*unavailable/i,
      /too.*many.*connections/i
    ];

    return retryablePatterns.some(pattern => pattern.test(errorMessage));
  }

  private async determineResolution(error: MigrationError): Promise<ErrorResolution> {
    const resolution: ErrorResolution = {
      action: 'manual_intervention',
      reason: 'Unknown error requires manual investigation'
    };

    switch (error.type) {
      case 'network':
        if (error.retryable && error.retryCount < error.maxRetries) {
          resolution.action = 'retry';
          resolution.reason = 'Network error is retryable with exponential backoff';
          resolution.automatedFix = {
            applied: false,
            description: `Retry attempt ${error.retryCount + 1}/${error.maxRetries} with exponential backoff`
          };
        } else {
          resolution.action = 'halt';
          resolution.reason = 'Max retries exceeded for network error';
          resolution.manualSteps = [
            'Check network connectivity to databases',
            'Verify database server availability',
            'Review connection timeout settings',
            'Resume migration after connectivity is restored'
          ];
        }
        break;

      case 'data_integrity':
        resolution.action = 'halt';
        resolution.reason = 'Data integrity error requires manual review';
        resolution.manualSteps = [
          'Review source data quality for the failing record',
          'Check foreign key relationships in source database',
          'Verify constraint definitions match between source and destination',
          'Fix data issues in source system or create data transformation rule',
          'Resume migration after data issues are resolved'
        ];
        break;

      case 'schema_mismatch':
        resolution.action = 'halt';
        resolution.reason = 'Schema mismatch requires schema synchronization';
        resolution.manualSteps = [
          'Compare source and destination table schemas',
          'Update destination schema to match source requirements',
          'Run schema migration if necessary',
          'Update field mappings in migration configuration',
          'Restart migration after schema synchronization'
        ];
        break;

      case 'validation':
        if (error.severity === 'low' || error.severity === 'medium') {
          resolution.action = 'skip';
          resolution.reason = 'Validation error is non-critical, can continue migration';
          resolution.automatedFix = {
            applied: true,
            description: 'Record marked as failed validation, migration continues'
          };
        } else {
          resolution.action = 'halt';
          resolution.reason = 'Critical validation error requires investigation';
          resolution.manualSteps = [
            'Review validation rules and data quality',
            'Check if validation criteria are appropriate',
            'Fix source data or update validation rules',
            'Resume migration after validation issues are resolved'
          ];
        }
        break;

      case 'system':
        if (error.message.toLowerCase().includes('memory') || error.message.toLowerCase().includes('heap')) {
          resolution.action = 'retry';
          resolution.reason = 'System resource error, retry with reduced batch size';
          resolution.automatedFix = {
            applied: false,
            description: 'Reduce batch size and retry operation'
          };
        } else {
          resolution.action = 'halt';
          resolution.reason = 'System error requires investigation';
        }
        break;

      case 'business_rule':
        resolution.action = 'skip';
        resolution.reason = 'Business rule violation, record skipped with logging';
        resolution.automatedFix = {
          applied: true,
          description: 'Record marked as business rule violation, logged for review'
        };
        break;
    }

    return resolution;
  }

  private async executeAutomatedFix(error: MigrationError, resolution: ErrorResolution): Promise<void> {
    if (!resolution.automatedFix) return;

    try {
      switch (resolution.action) {
        case 'retry':
          // Calculate retry delay with exponential backoff
          const delay = this.calculateRetryDelay(error.retryCount);
          await new Promise(resolve => setTimeout(resolve, delay));
          resolution.automatedFix.success = true;
          break;

        case 'skip':
          // Log skip action
          console.warn(`⚠️  Skipping record ${error.details.recordId} due to: ${error.message}`);
          resolution.automatedFix.success = true;
          break;

        default:
          resolution.automatedFix.success = false;
      }

      resolution.automatedFix.applied = true;

    } catch (fixError) {
      resolution.automatedFix.success = false;
      console.error(`❌ Automated fix failed: ${fixError.message}`);
    }
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  private calculateRetryDelay(retryCount: number): number {
    let delay = this.config.baseDelayMs;

    if (this.config.exponentialBackoff) {
      delay = Math.min(
        this.config.baseDelayMs * Math.pow(2, retryCount),
        this.config.maxDelayMs
      );
    }

    // Add jitter to prevent thundering herd
    if (this.config.jitterEnabled) {
      delay = delay + Math.random() * (delay * 0.1);
    }

    return Math.floor(delay);
  }

  /**
   * Execute operation with retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: {
      entityType?: string;
      recordId?: string;
      batchNumber?: number;
      operationName: string;
    }
  ): Promise<{ success: boolean; result?: T; error?: MigrationError }> {
    let lastError: Error | null = null;
    let retryCount = 0;

    while (retryCount <= this.config.maxRetries) {
      try {
        const result = await operation();

        // If we had previous failures but now succeeded, log recovery
        if (retryCount > 0) {
          this.errorMetrics.retriesSuccessful++;
          console.log(`✅ Operation recovered after ${retryCount} retries: ${context.operationName}`);
        }

        return { success: true, result };

      } catch (error) {
        lastError = error;
        const migrationError = this.createMigrationError(error, {
          ...context,
          retryAttempt: retryCount
        });

        // Determine if we should retry
        if (retryCount < this.config.maxRetries && migrationError.retryable) {
          retryCount++;
          migrationError.retryCount = retryCount;
          this.errorMetrics.retriesAttempted++;

          const delay = this.calculateRetryDelay(retryCount);
          console.warn(`⚠️  Retry ${retryCount}/${this.config.maxRetries} for ${context.operationName} after ${delay}ms delay: ${error.message}`);

          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Max retries reached or non-retryable error
        const resolution = await this.determineResolution(migrationError);
        migrationError.resolution = resolution;

        this.errors.push(migrationError);
        this.updateErrorMetrics(migrationError);

        return { success: false, error: migrationError };
      }
    }

    // This should never be reached, but included for type safety
    return { success: false, error: undefined };
  }

  /**
   * Handle batch-level errors with record-level recovery
   */
  async handleBatchError<T>(
    batchRecords: T[],
    processRecord: (record: T) => Promise<void>,
    context: {
      entityType: string;
      batchNumber: number;
    }
  ): Promise<{
    successfulRecords: T[];
    failedRecords: Array<{ record: T; error: MigrationError }>;
    canContinue: boolean;
  }> {
    const successfulRecords: T[] = [];
    const failedRecords: Array<{ record: T; error: MigrationError }> = [];

    for (let i = 0; i < batchRecords.length; i++) {
      const record = batchRecords[i];

      try {
        await processRecord(record);
        successfulRecords.push(record);

      } catch (error) {
        const migrationError = this.createMigrationError(error, {
          ...context,
          recordId: (record as any).id?.toString() || i.toString(),
          recordIndex: i
        });

        const resolution = await this.determineResolution(migrationError);
        migrationError.resolution = resolution;

        this.errors.push(migrationError);
        this.updateErrorMetrics(migrationError);

        failedRecords.push({ record, error: migrationError });

        // Determine if we should halt batch processing
        if (resolution.action === 'halt') {
          console.error(`❌ Halting batch processing due to critical error: ${error.message}`);
          return {
            successfulRecords,
            failedRecords,
            canContinue: false
          };
        }
      }
    }

    // Determine if batch processing can continue
    const criticalErrorCount = failedRecords.filter(fr => fr.error.severity === 'critical').length;
    const canContinue = criticalErrorCount === 0 && (failedRecords.length / batchRecords.length) < 0.5; // Less than 50% failure rate

    return {
      successfulRecords,
      failedRecords,
      canContinue
    };
  }

  /**
   * Generate comprehensive error analysis report
   */
  generateErrorAnalysisReport(): {
    summary: ErrorHandlingMetrics;
    criticalErrors: MigrationError[];
    recoveryRecommendations: string[];
    patternAnalysis: {
      pattern: string;
      frequency: number;
      suggestedFix: string;
    }[];
    systemHealthImpact: {
      migrationHalted: boolean;
      dataIntegrityRisk: 'none' | 'low' | 'medium' | 'high';
      recoverabilityScore: number; // 0-100
    };
  } {
    // Get critical errors requiring immediate attention
    const criticalErrors = this.errors.filter(err =>
      err.severity === 'critical' ||
      err.resolution?.action === 'halt'
    );

    // Analyze error patterns
    const errorPatterns = new Map<string, number>();
    this.errors.forEach(error => {
      const pattern = `${error.type}:${error.message.substring(0, 50)}`;
      errorPatterns.set(pattern, (errorPatterns.get(pattern) || 0) + 1);
    });

    const patternAnalysis = Array.from(errorPatterns.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([pattern, frequency]) => ({
        pattern,
        frequency,
        suggestedFix: this.getSuggestedFix(pattern)
      }));

    // Generate recovery recommendations
    const recoveryRecommendations = this.generateRecoveryRecommendations(criticalErrors);

    // Assess system health impact
    const migrationHalted = criticalErrors.some(err => err.resolution?.action === 'halt');
    const dataIntegrityErrors = this.errors.filter(err => err.type === 'data_integrity').length;
    const dataIntegrityRisk = dataIntegrityErrors === 0 ? 'none' :
                             dataIntegrityErrors < 10 ? 'low' :
                             dataIntegrityErrors < 50 ? 'medium' : 'high';

    const totalRetryable = this.errors.filter(err => err.retryable).length;
    const recoverabilityScore = this.errors.length > 0 ?
      Math.floor((totalRetryable / this.errors.length) * 100) : 100;

    return {
      summary: { ...this.errorMetrics },
      criticalErrors,
      recoveryRecommendations,
      patternAnalysis,
      systemHealthImpact: {
        migrationHalted,
        dataIntegrityRisk,
        recoverabilityScore
      }
    };
  }

  private getSuggestedFix(pattern: string): string {
    const [errorType] = pattern.split(':');

    switch (errorType) {
      case 'network':
        return 'Check network connectivity and increase connection timeout';
      case 'data_integrity':
        return 'Review and fix source data quality issues';
      case 'schema_mismatch':
        return 'Synchronize database schemas before migration';
      case 'validation':
        return 'Review validation rules and data quality standards';
      case 'system':
        return 'Check system resources and configuration';
      default:
        return 'Investigate error context and logs for specific solution';
    }
  }

  private generateRecoveryRecommendations(criticalErrors: MigrationError[]): string[] {
    const recommendations: string[] = [];

    const errorTypeCount = criticalErrors.reduce((acc, err) => {
      acc[err.type] = (acc[err.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    if (errorTypeCount.network > 0) {
      recommendations.push('Verify database connectivity and network stability');
      recommendations.push('Consider increasing connection timeouts and retry limits');
    }

    if (errorTypeCount.data_integrity > 0) {
      recommendations.push('Perform comprehensive source data quality analysis');
      recommendations.push('Fix foreign key relationships and constraint violations');
      recommendations.push('Consider implementing data validation pre-processing');
    }

    if (errorTypeCount.schema_mismatch > 0) {
      recommendations.push('Run schema comparison and synchronization');
      recommendations.push('Update field mappings and transformation rules');
      recommendations.push('Validate entity relationships match between systems');
    }

    if (errorTypeCount.validation > 0) {
      recommendations.push('Review post-migration validation criteria');
      recommendations.push('Implement data quality checks in migration pipeline');
    }

    if (recommendations.length === 0) {
      recommendations.push('Review error logs for specific issues');
      recommendations.push('Contact system administrator for technical support');
    }

    return recommendations;
  }

  private updateErrorMetrics(error: MigrationError): void {
    this.errorMetrics.totalErrors++;
    this.errorMetrics.errorsByType[error.type] = (this.errorMetrics.errorsByType[error.type] || 0) + 1;
    this.errorMetrics.errorsBySeverity[error.severity] = (this.errorMetrics.errorsBySeverity[error.severity] || 0) + 1;

    if (error.resolution?.action === 'manual_intervention') {
      this.errorMetrics.manualInterventionsRequired++;
    }

    // Update most common errors
    const errorCounts = Object.entries(this.errorMetrics.errorsByType)
      .map(([type, count]) => ({
        type,
        count,
        percentage: (count / this.errorMetrics.totalErrors) * 100,
        lastOccurrence: error.timestamp
      }))
      .sort((a, b) => b.count - a.count);

    this.errorMetrics.mostCommonErrors = errorCounts.slice(0, 5);
  }

  /**
   * Get error statistics
   */
  getErrorMetrics(): ErrorHandlingMetrics {
    return { ...this.errorMetrics };
  }

  /**
   * Get errors by criteria
   */
  getErrors(criteria?: {
    type?: MigrationError['type'];
    severity?: MigrationError['severity'];
    entityType?: string;
    retryable?: boolean;
    since?: Date;
    limit?: number;
  }): MigrationError[] {
    let filteredErrors = [...this.errors];

    if (criteria) {
      if (criteria.type) {
        filteredErrors = filteredErrors.filter(err => err.type === criteria.type);
      }
      if (criteria.severity) {
        filteredErrors = filteredErrors.filter(err => err.severity === criteria.severity);
      }
      if (criteria.entityType) {
        filteredErrors = filteredErrors.filter(err => err.details.entityType === criteria.entityType);
      }
      if (criteria.retryable !== undefined) {
        filteredErrors = filteredErrors.filter(err => err.retryable === criteria.retryable);
      }
      if (criteria.since) {
        filteredErrors = filteredErrors.filter(err => err.timestamp >= criteria.since!);
      }
      if (criteria.limit) {
        filteredErrors = filteredErrors.slice(-criteria.limit);
      }
    }

    return filteredErrors;
  }

  /**
   * Clear error history
   */
  clearErrors(olderThan?: Date): void {
    if (olderThan) {
      this.errors = this.errors.filter(error => error.timestamp >= olderThan);
    } else {
      this.errors = [];
    }

    // Recalculate metrics
    this.errorMetrics = this.initializeMetrics();
    this.errors.forEach(error => this.updateErrorMetrics(error));
  }

  /**
   * Create detailed error context for logging
   */
  createErrorContext(error: MigrationError): any {
    return {
      errorId: error.id,
      timestamp: error.timestamp.toISOString(),
      type: error.type,
      severity: error.severity,
      message: error.message,
      entityType: error.details.entityType,
      recordId: error.details.recordId,
      batchNumber: error.details.batchNumber,
      retryCount: error.retryCount,
      retryable: error.retryable,
      resolution: error.resolution ? {
        action: error.resolution.action,
        reason: error.resolution.reason,
        automatedFixApplied: error.resolution.automatedFix?.applied || false,
        manualStepsRequired: error.resolution.manualSteps?.length || 0
      } : null,
      systemContext: {
        nodeVersion: process.version,
        platform: process.platform,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      }
    };
  }
}