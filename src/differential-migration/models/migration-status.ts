/**
 * MigrationStatus Model
 * Tracks overall migration execution status across all entities
 */

import { v4 as uuidv4 } from 'uuid';

// Core interfaces
export type MigrationStatusEnum = 'pending' | 'running' | 'paused' | 'completed' | 'failed';

export interface MigrationStatus {
  id: string;
  migration_session_id: string;
  overall_status: MigrationStatusEnum;
  entities_pending: string[];
  entities_running: string[];
  entities_completed: string[];
  entities_failed: string[];
  total_records_processed: number;
  total_records_remaining: number;
  estimated_completion: Date | null;
  error_summary: object;
  performance_metrics: object;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface MigrationStatusCreateInput {
  migration_session_id?: string;
  overall_status?: MigrationStatusEnum;
  entities_pending?: string[];
  entities_running?: string[];
  entities_completed?: string[];
  entities_failed?: string[];
  total_records_processed?: number;
  total_records_remaining?: number;
  estimated_completion?: Date | null;
  error_summary?: object;
  performance_metrics?: object;
}

export interface MigrationStatusUpdateInput {
  overall_status?: MigrationStatusEnum;
  entities_pending?: string[];
  entities_running?: string[];
  entities_completed?: string[];
  entities_failed?: string[];
  total_records_processed?: number;
  total_records_remaining?: number;
  estimated_completion?: Date | null;
  error_summary?: object;
  performance_metrics?: object;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface ProgressCalculation {
  progressPercentage: number;
  isComplete: boolean;
  estimatedTimeRemaining: number | null;
  throughputRecordsPerSecond: number | null;
}

export interface StatusSummary {
  totalEntities: number;
  entitiesInProgress: number;
  entitiesCompleted: number;
  entitiesFailed: number;
  successRate: number | null;
}

// Valid status values
const VALID_STATUSES: MigrationStatusEnum[] = ['pending', 'running', 'paused', 'completed', 'failed'];

/**
 * MigrationStatus Model Implementation
 *
 * Provides functionality for tracking and managing overall migration status
 * across multiple entities with comprehensive progress monitoring.
 */
export class MigrationStatusModel {
  /**
   * Creates a new migration status with validation
   */
  static create(input: MigrationStatusCreateInput = {}): MigrationStatus {
    // Validate arrays
    if (input.entities_pending && !Array.isArray(input.entities_pending)) {
      throw new Error('entities_pending must be an array');
    }
    if (input.entities_running && !Array.isArray(input.entities_running)) {
      throw new Error('entities_running must be an array');
    }
    if (input.entities_completed && !Array.isArray(input.entities_completed)) {
      throw new Error('entities_completed must be an array');
    }
    if (input.entities_failed && !Array.isArray(input.entities_failed)) {
      throw new Error('entities_failed must be an array');
    }

    // Validate numeric inputs
    if (input.total_records_processed !== undefined && (typeof input.total_records_processed !== 'number' || input.total_records_processed < 0)) {
      throw new Error('total_records_processed must be a non-negative number');
    }

    if (input.total_records_remaining !== undefined && (typeof input.total_records_remaining !== 'number' || input.total_records_remaining < 0)) {
      throw new Error('total_records_remaining must be a non-negative number');
    }

    // Validate status
    if (input.overall_status && !VALID_STATUSES.includes(input.overall_status)) {
      throw new Error(`Invalid overall_status: ${input.overall_status}. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const now = new Date();
    const sessionId = input.migration_session_id || uuidv4();

    const status: MigrationStatus = {
      id: uuidv4(),
      migration_session_id: sessionId,
      overall_status: input.overall_status || 'pending',
      entities_pending: input.entities_pending ? [...input.entities_pending] : [],
      entities_running: input.entities_running ? [...input.entities_running] : [],
      entities_completed: input.entities_completed ? [...input.entities_completed] : [],
      entities_failed: input.entities_failed ? [...input.entities_failed] : [],
      total_records_processed: input.total_records_processed || 0,
      total_records_remaining: input.total_records_remaining || 0,
      estimated_completion: input.estimated_completion || null,
      error_summary: input.error_summary ? { ...input.error_summary } : {},
      performance_metrics: input.performance_metrics ? { ...input.performance_metrics } : {},
      started_at: (input.overall_status === 'running') ? now : null,
      completed_at: null,
      created_at: now,
      updated_at: now
    };

    // Final validation
    const validation = this.validate(status);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    return status;
  }

  /**
   * Validates a migration status against all business rules
   */
  static validate(status: MigrationStatus): ValidationResult {
    const errors: string[] = [];

    // Validate required fields
    if (!status.id) {
      errors.push('id is required');
    }

    if (!status.migration_session_id) {
      errors.push('migration_session_id is required');
    }

    // Validate overall_status
    if (!VALID_STATUSES.includes(status.overall_status)) {
      errors.push('Invalid overall_status');
    }

    // Validate entity arrays don't overlap
    const allEntities = [
      ...status.entities_pending,
      ...status.entities_running,
      ...status.entities_completed,
      ...status.entities_failed
    ];

    const uniqueEntities = new Set(allEntities);
    if (allEntities.length !== uniqueEntities.size) {
      errors.push('Entity arrays must not overlap - entities cannot be in multiple states');
    }

    // Validate non-negative counts
    if (status.total_records_processed < 0) {
      errors.push('total_records_processed must be non-negative');
    }

    if (status.total_records_remaining < 0) {
      errors.push('total_records_remaining must be non-negative');
    }

    // Validate timestamps
    if (status.completed_at && status.started_at && status.completed_at < status.started_at) {
      errors.push('completed_at must be after started_at');
    }

    if (status.created_at > status.updated_at) {
      errors.push('updated_at must be greater than or equal to created_at');
    }

    // Validate status consistency
    if (status.overall_status === 'completed') {
      if (status.entities_running.length > 0) {
        errors.push('Cannot have running entities when overall status is completed');
      }
      if (status.entities_pending.length > 0) {
        errors.push('Cannot have pending entities when overall status is completed');
      }
    }

    if (status.overall_status === 'running') {
      if (status.entities_running.length === 0 && status.entities_pending.length === 0) {
        errors.push('Running status requires at least one running or pending entity');
      }
    }

    // Validate estimated completion is in the future for running migrations
    if (status.overall_status === 'running' && status.estimated_completion && status.estimated_completion <= new Date()) {
      errors.push('estimated_completion must be in the future for running migrations');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Updates migration status with automatic state management
   */
  static updateStatus(
    currentStatus: MigrationStatus,
    updates: MigrationStatusUpdateInput
  ): MigrationStatus {
    const now = new Date();

    // Create updated status
    const updatedStatus: MigrationStatus = {
      ...currentStatus,
      ...updates,
      updated_at: now
    };

    // Handle automatic timestamp management
    if (updates.overall_status && updates.overall_status !== currentStatus.overall_status) {
      // Starting migration
      if (updates.overall_status === 'running' && currentStatus.overall_status === 'pending') {
        updatedStatus.started_at = now;
      }

      // Resuming from pause (don't change started_at)
      if (updates.overall_status === 'running' && currentStatus.overall_status === 'paused') {
        updatedStatus.started_at = currentStatus.started_at;
      }

      // Completing or failing migration
      if (updates.overall_status === 'completed' || updates.overall_status === 'failed') {
        updatedStatus.completed_at = now;
      }
    }

    // Auto-calculate estimated completion if not provided
    if (updatedStatus.overall_status === 'running' && !updates.estimated_completion) {
      updatedStatus.estimated_completion = this.calculateEstimatedCompletion(updatedStatus);
    }

    // Validate the updated status
    const validation = this.validate(updatedStatus);
    if (!validation.isValid) {
      throw new Error(`Update validation failed: ${validation.errors.join(', ')}`);
    }

    return updatedStatus;
  }

  /**
   * Calculates comprehensive progress metrics
   */
  static calculateProgress(status: MigrationStatus): ProgressCalculation {
    const totalRecords = status.total_records_processed + status.total_records_remaining;
    const progressPercentage = totalRecords > 0
      ? Math.round((status.total_records_processed / totalRecords) * 100 * 100) / 100
      : 0;

    const isComplete = status.overall_status === 'completed' || status.total_records_remaining === 0;

    let estimatedTimeRemaining: number | null = null;
    let throughputRecordsPerSecond: number | null = null;

    if (status.started_at && status.overall_status === 'running') {
      const elapsedMs = Date.now() - status.started_at.getTime();
      const elapsedSeconds = elapsedMs / 1000;

      if (elapsedSeconds > 0 && status.total_records_processed > 0) {
        throughputRecordsPerSecond = Math.round((status.total_records_processed / elapsedSeconds) * 100) / 100;

        if (throughputRecordsPerSecond > 0 && status.total_records_remaining > 0) {
          estimatedTimeRemaining = Math.round(status.total_records_remaining / throughputRecordsPerSecond);
        }
      }
    }

    return {
      progressPercentage,
      isComplete,
      estimatedTimeRemaining,
      throughputRecordsPerSecond
    };
  }

  /**
   * Calculates status summary across all entities
   */
  static getStatusSummary(status: MigrationStatus): StatusSummary {
    const totalEntities = status.entities_pending.length +
                         status.entities_running.length +
                         status.entities_completed.length +
                         status.entities_failed.length;

    const entitiesInProgress = status.entities_pending.length + status.entities_running.length;
    const entitiesCompleted = status.entities_completed.length;
    const entitiesFailed = status.entities_failed.length;

    const completedOrFailed = entitiesCompleted + entitiesFailed;
    const successRate = completedOrFailed > 0
      ? Math.round((entitiesCompleted / completedOrFailed) * 100 * 100) / 100
      : null;

    return {
      totalEntities,
      entitiesInProgress,
      entitiesCompleted,
      entitiesFailed,
      successRate
    };
  }

  /**
   * Moves an entity from one state to another with validation
   */
  static moveEntityToState(
    status: MigrationStatus,
    entityType: string,
    newState: 'pending' | 'running' | 'completed' | 'failed'
  ): MigrationStatus {
    // Find and remove entity from current state
    const updatedStatus: MigrationStatus = {
      ...status,
      entities_pending: status.entities_pending.filter(e => e !== entityType),
      entities_running: status.entities_running.filter(e => e !== entityType),
      entities_completed: status.entities_completed.filter(e => e !== entityType),
      entities_failed: status.entities_failed.filter(e => e !== entityType),
      updated_at: new Date()
    };

    // Add entity to new state
    switch (newState) {
      case 'pending':
        updatedStatus.entities_pending.push(entityType);
        break;
      case 'running':
        updatedStatus.entities_running.push(entityType);
        break;
      case 'completed':
        updatedStatus.entities_completed.push(entityType);
        break;
      case 'failed':
        updatedStatus.entities_failed.push(entityType);
        break;
    }

    // Auto-update overall status based on entity states
    updatedStatus.overall_status = this.determineOverallStatus(updatedStatus);

    return updatedStatus;
  }

  /**
   * Determines overall status based on entity states
   */
  static determineOverallStatus(status: MigrationStatus): MigrationStatusEnum {
    const hasRunning = status.entities_running.length > 0;
    const hasPending = status.entities_pending.length > 0;
    const hasFailed = status.entities_failed.length > 0;
    const totalEntities = status.entities_pending.length + status.entities_running.length +
                         status.entities_completed.length + status.entities_failed.length;

    // Failed takes priority
    if (hasFailed && !hasRunning && !hasPending) {
      return 'failed';
    }

    // All entities completed
    if (status.entities_completed.length === totalEntities && totalEntities > 0) {
      return 'completed';
    }

    // Some entities running
    if (hasRunning) {
      return 'running';
    }

    // Only pending entities
    if (hasPending && !hasRunning) {
      return 'pending';
    }

    // Mixed completed/failed but no active work
    if (status.entities_completed.length > 0 && !hasRunning && !hasPending) {
      return hasFailed ? 'failed' : 'completed';
    }

    // Default to current status if cannot determine
    return status.overall_status;
  }

  /**
   * Calculates estimated completion time based on current progress
   */
  static calculateEstimatedCompletion(status: MigrationStatus): Date | null {
    if (status.overall_status !== 'running' || !status.started_at) {
      return null;
    }

    const progress = this.calculateProgress(status);

    if (!progress.throughputRecordsPerSecond || progress.throughputRecordsPerSecond <= 0) {
      return null;
    }

    if (status.total_records_remaining <= 0) {
      return new Date(); // Complete now
    }

    const estimatedSecondsRemaining = Math.round(status.total_records_remaining / progress.throughputRecordsPerSecond);
    const estimatedCompletion = new Date(Date.now() + estimatedSecondsRemaining * 1000);

    return estimatedCompletion;
  }

  /**
   * Creates performance metrics object
   */
  static createPerformanceMetrics(options: {
    recordsPerSecond?: number;
    averageBatchTimeMs?: number;
    memoryUsageMb?: number;
    connectionPoolStatus?: {
      sourceConnections: number;
      destinationConnections: number;
      activeQueries: number;
    };
    errorRate?: number;
    lastBatchSize?: number;
    totalBatchesProcessed?: number;
    additionalMetrics?: object;
  } = {}): object {
    const metrics: any = {
      last_updated: new Date().toISOString(),
      system_info: {
        node_version: process.version,
        platform: process.platform,
        uptime_seconds: Math.round(process.uptime())
      }
    };

    if (options.recordsPerSecond) {
      metrics.records_per_second = Math.round(options.recordsPerSecond * 100) / 100;
    }

    if (options.averageBatchTimeMs) {
      metrics.average_batch_time_ms = Math.round(options.averageBatchTimeMs);
    }

    if (options.memoryUsageMb) {
      metrics.memory_usage_mb = Math.round(options.memoryUsageMb);
    }

    if (options.connectionPoolStatus) {
      metrics.connection_pool_status = options.connectionPoolStatus;
    }

    if (options.errorRate !== undefined) {
      metrics.error_rate = Math.round(options.errorRate * 100 * 100) / 100; // Percentage with 2 decimals
    }

    if (options.lastBatchSize) {
      metrics.last_batch_size = options.lastBatchSize;
    }

    if (options.totalBatchesProcessed) {
      metrics.total_batches_processed = options.totalBatchesProcessed;
    }

    if (options.additionalMetrics) {
      Object.assign(metrics, options.additionalMetrics);
    }

    return metrics;
  }

  /**
   * Creates error summary object
   */
  static createErrorSummary(options: {
    totalErrors?: number;
    errorsByEntity?: Record<string, number>;
    errorsByType?: Record<string, number>;
    criticalErrors?: Array<{
      entityType: string;
      errorType: string;
      message: string;
      timestamp: Date;
    }>;
    lastError?: {
      entityType: string;
      message: string;
      timestamp: Date;
    };
    additionalSummary?: object;
  } = {}): object {
    const summary: any = {
      last_updated: new Date().toISOString(),
      total_errors: options.totalErrors || 0
    };

    if (options.errorsByEntity && Object.keys(options.errorsByEntity).length > 0) {
      summary.errors_by_entity = options.errorsByEntity;
    }

    if (options.errorsByType && Object.keys(options.errorsByType).length > 0) {
      summary.errors_by_type = options.errorsByType;
    }

    if (options.criticalErrors && options.criticalErrors.length > 0) {
      summary.critical_errors = options.criticalErrors.map(error => ({
        ...error,
        timestamp: error.timestamp.toISOString()
      }));
    }

    if (options.lastError) {
      summary.last_error = {
        ...options.lastError,
        timestamp: options.lastError.timestamp.toISOString()
      };
    }

    if (options.additionalSummary) {
      Object.assign(summary, options.additionalSummary);
    }

    return summary;
  }

  /**
   * Adds or updates an error in the error summary
   */
  static addErrorToSummary(
    status: MigrationStatus,
    error: {
      entityType: string;
      errorType: string;
      message: string;
      isCritical?: boolean;
    }
  ): MigrationStatus {
    const currentSummary = status.error_summary as any || {};

    // Update total error count
    const totalErrors = (currentSummary.total_errors || 0) + 1;

    // Update errors by entity
    const errorsByEntity = currentSummary.errors_by_entity || {};
    errorsByEntity[error.entityType] = (errorsByEntity[error.entityType] || 0) + 1;

    // Update errors by type
    const errorsByType = currentSummary.errors_by_type || {};
    errorsByType[error.errorType] = (errorsByType[error.errorType] || 0) + 1;

    // Add to critical errors if marked as critical
    let criticalErrors = currentSummary.critical_errors || [];
    if (error.isCritical) {
      criticalErrors = [...criticalErrors, {
        entityType: error.entityType,
        errorType: error.errorType,
        message: error.message,
        timestamp: new Date().toISOString()
      }];

      // Keep only last 10 critical errors to avoid bloat
      if (criticalErrors.length > 10) {
        criticalErrors = criticalErrors.slice(-10);
      }
    }

    // Update last error
    const lastError = {
      entityType: error.entityType,
      message: error.message,
      timestamp: new Date().toISOString()
    };

    const updatedErrorSummary = {
      ...currentSummary,
      total_errors: totalErrors,
      errors_by_entity: errorsByEntity,
      errors_by_type: errorsByType,
      critical_errors: criticalErrors,
      last_error: lastError,
      last_updated: new Date().toISOString()
    };

    return this.updateStatus(status, {
      error_summary: updatedErrorSummary
    });
  }

  /**
   * Updates performance metrics
   */
  static updatePerformanceMetrics(
    status: MigrationStatus,
    metrics: {
      recordsPerSecond?: number;
      averageBatchTimeMs?: number;
      memoryUsageMb?: number;
      connectionPoolStatus?: object;
      additionalMetrics?: object;
    }
  ): MigrationStatus {
    const currentMetrics = status.performance_metrics as any || {};

    const updatedMetrics = this.createPerformanceMetrics({
      ...currentMetrics,
      ...metrics,
      additionalMetrics: {
        ...currentMetrics,
        ...metrics.additionalMetrics
      }
    });

    return this.updateStatus(status, {
      performance_metrics: updatedMetrics
    });
  }

  /**
   * Creates a detailed status report
   */
  static createStatusReport(status: MigrationStatus): {
    sessionId: string;
    overallStatus: MigrationStatusEnum;
    progress: ProgressCalculation;
    entitySummary: StatusSummary;
    timing: {
      startedAt: Date | null;
      completedAt: Date | null;
      elapsedSeconds: number | null;
      estimatedCompletion: Date | null;
    };
    performance: {
      throughput: number | null;
      memoryUsage: number | null;
      errorRate: number | null;
    };
    entities: {
      pending: string[];
      running: string[];
      completed: string[];
      failed: string[];
    };
    recommendations: string[];
  } {
    const progress = this.calculateProgress(status);
    const entitySummary = this.getStatusSummary(status);

    // Calculate elapsed time
    let elapsedSeconds: number | null = null;
    if (status.started_at) {
      const endTime = status.completed_at || new Date();
      elapsedSeconds = Math.round((endTime.getTime() - status.started_at.getTime()) / 1000);
    }

    // Extract performance data
    const perfMetrics = status.performance_metrics as any || {};
    const errorSummary = status.error_summary as any || {};

    // Generate recommendations
    const recommendations: string[] = [];

    if (progress.throughputRecordsPerSecond && progress.throughputRecordsPerSecond < 50) {
      recommendations.push('Low throughput detected - consider optimizing batch size or connection pooling');
    }

    if (perfMetrics.memory_usage_mb && perfMetrics.memory_usage_mb > 400) {
      recommendations.push('High memory usage detected - consider reducing batch size');
    }

    if (entitySummary.entitiesFailed > 0) {
      recommendations.push('Some entities have failed - review error logs and resolve issues before proceeding');
    }

    if (status.overall_status === 'running' && elapsedSeconds && elapsedSeconds > 3600) {
      recommendations.push('Migration has been running for over 1 hour - monitor for any issues');
    }

    if (errorSummary.total_errors && errorSummary.total_errors > 10) {
      recommendations.push('Multiple errors encountered - review migration logic and data quality');
    }

    return {
      sessionId: status.migration_session_id,
      overallStatus: status.overall_status,
      progress,
      entitySummary,
      timing: {
        startedAt: status.started_at,
        completedAt: status.completed_at,
        elapsedSeconds,
        estimatedCompletion: status.estimated_completion
      },
      performance: {
        throughput: progress.throughputRecordsPerSecond,
        memoryUsage: perfMetrics.memory_usage_mb || null,
        errorRate: errorSummary.error_rate || null
      },
      entities: {
        pending: [...status.entities_pending],
        running: [...status.entities_running],
        completed: [...status.entities_completed],
        failed: [...status.entities_failed]
      },
      recommendations
    };
  }

  /**
   * Serializes migration status for database storage
   */
  static serialize(status: MigrationStatus): {
    id: string;
    migration_session_id: string;
    overall_status: string;
    entities_pending: string;
    entities_running: string;
    entities_completed: string;
    entities_failed: string;
    total_records_processed: number;
    total_records_remaining: number;
    estimated_completion: string | null;
    error_summary: string;
    performance_metrics: string;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
  } {
    return {
      id: status.id,
      migration_session_id: status.migration_session_id,
      overall_status: status.overall_status,
      entities_pending: JSON.stringify(status.entities_pending),
      entities_running: JSON.stringify(status.entities_running),
      entities_completed: JSON.stringify(status.entities_completed),
      entities_failed: JSON.stringify(status.entities_failed),
      total_records_processed: status.total_records_processed,
      total_records_remaining: status.total_records_remaining,
      estimated_completion: status.estimated_completion?.toISOString() || null,
      error_summary: JSON.stringify(status.error_summary),
      performance_metrics: JSON.stringify(status.performance_metrics),
      started_at: status.started_at?.toISOString() || null,
      completed_at: status.completed_at?.toISOString() || null,
      created_at: status.created_at.toISOString(),
      updated_at: status.updated_at.toISOString()
    };
  }

  /**
   * Deserializes migration status from database storage
   */
  static deserialize(data: any): MigrationStatus {
    try {
      return {
        id: data.id,
        migration_session_id: data.migration_session_id,
        overall_status: data.overall_status as MigrationStatusEnum,
        entities_pending: typeof data.entities_pending === 'string' ? JSON.parse(data.entities_pending) : data.entities_pending,
        entities_running: typeof data.entities_running === 'string' ? JSON.parse(data.entities_running) : data.entities_running,
        entities_completed: typeof data.entities_completed === 'string' ? JSON.parse(data.entities_completed) : data.entities_completed,
        entities_failed: typeof data.entities_failed === 'string' ? JSON.parse(data.entities_failed) : data.entities_failed,
        total_records_processed: parseInt(data.total_records_processed),
        total_records_remaining: parseInt(data.total_records_remaining),
        estimated_completion: data.estimated_completion ? new Date(data.estimated_completion) : null,
        error_summary: typeof data.error_summary === 'string' ? JSON.parse(data.error_summary) : data.error_summary,
        performance_metrics: typeof data.performance_metrics === 'string' ? JSON.parse(data.performance_metrics) : data.performance_metrics,
        started_at: data.started_at ? new Date(data.started_at) : null,
        completed_at: data.completed_at ? new Date(data.completed_at) : null,
        created_at: typeof data.created_at === 'string' ? new Date(data.created_at) : data.created_at,
        updated_at: typeof data.updated_at === 'string' ? new Date(data.updated_at) : data.updated_at
      };
    } catch (error) {
      throw new Error(`Failed to deserialize migration status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Creates a status for a new migration session with entity queue
   */
  static createForSession(
    sessionId: string,
    entities: string[],
    totalRecordsEstimate: number = 0
  ): MigrationStatus {
    return this.create({
      migration_session_id: sessionId,
      overall_status: 'pending',
      entities_pending: [...entities],
      total_records_remaining: totalRecordsEstimate,
      performance_metrics: this.createPerformanceMetrics(),
      error_summary: this.createErrorSummary()
    });
  }

  /**
   * Checks if the migration status indicates completion readiness
   */
  static isReadyForCompletion(status: MigrationStatus): {
    ready: boolean;
    blockers: string[];
  } {
    const blockers: string[] = [];

    // Check for running or pending entities
    if (status.entities_running.length > 0) {
      blockers.push(`${status.entities_running.length} entities still running: ${status.entities_running.join(', ')}`);
    }

    if (status.entities_pending.length > 0) {
      blockers.push(`${status.entities_pending.length} entities still pending: ${status.entities_pending.join(', ')}`);
    }

    // Check for remaining records
    if (status.total_records_remaining > 0) {
      blockers.push(`${status.total_records_remaining} records still need processing`);
    }

    // Check for critical errors that need resolution
    const errorSummary = status.error_summary as any || {};
    if (errorSummary.critical_errors && errorSummary.critical_errors.length > 0) {
      blockers.push(`${errorSummary.critical_errors.length} critical errors need resolution`);
    }

    return {
      ready: blockers.length === 0,
      blockers
    };
  }

  /**
   * Gets next entity to process based on dependency order
   */
  static getNextEntityToProcess(status: MigrationStatus): string | null {
    if (status.entities_pending.length === 0) {
      return null;
    }

    // Entity dependency order
    const dependencyOrder = [
      'offices', 'doctors', 'doctor_offices', 'patients', 'orders',
      'cases', 'files', 'case_files', 'messages', 'message_files',
      'jaw', 'dispatch_records', 'system_messages', 'message_attachments',
      'technician_roles', 'order_cases', 'purchases', 'treatment_discussions',
      'template_view_groups', 'template_view_roles'
    ];

    // Find first entity in dependency order that is pending
    for (const entity of dependencyOrder) {
      if (status.entities_pending.includes(entity)) {
        return entity;
      }
    }

    // If no entity found in dependency order, return first pending
    return status.entities_pending[0];
  }
}